/**
 * Story Card 检索真实语料复算。
 *
 * 口径固定为产品实际使用的「每个 story 自己的卡池」；现代 `role=user` 和旧版
 * `who=u` 都纳入，空消息排除，重复消息保留（每条都是一次真实检索事件）。
 */
import { readFileSync } from "node:fs";

import {
  buildIdfIndex,
  storyCardSearchText,
  tfidfCosine,
  tokenizeForSimilarity,
} from "../client/src/features/storyAgent/storyCardSimilarity";
import type { StoryCard } from "../client/src/features/storyAgent/types";
import { resolveEvalDataPath } from "./localDataPath";

const LOCAL_PERSIST_FILENAME = ".webdev/local-persist.json";

type PersistStory = {
  id: number;
  body?: {
    cards?: unknown[];
    messages?: unknown[];
  } | null;
};

type PersistData = { stories?: PersistStory[] };

type QuerySource = "role=user" | "who=u";

type Top1Stats = { matched: number; same: number; different: number };

export type RetrievalDifference = {
  storyId: number;
  messageIndex: number;
  source: QuerySource;
  oldCardId: string | null;
  tfidfCardId: string | null;
};

export type RetrievalCorpusReport = {
  stories: number;
  invalidStories: number;
  duplicateStoryIds: number;
  cardPools: number;
  cards: number;
  invalidCards: number;
  duplicateStoryCardKeys: number;
  messages: {
    modernUser: number;
    legacyUser: number;
    emptyExcluded: number;
    duplicateEventsRetained: number;
    withoutCards: number;
    withoutTokens: number;
    evaluated: number;
    noLexicalMatch: number;
    matched: number;
  };
  idf: {
    /** 每个 story 的 (storyId, token) 词表项总数。 */
    vocabularyEntries: number;
    singleDocumentEntries: number;
    singleDocumentRatio: number;
  };
  top1: {
    same: number;
    different: number;
    bySource: Record<QuerySource, Top1Stats>;
  };
  differences: RetrievalDifference[];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeCard(value: unknown): StoryCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const card = value as Record<string, unknown>;
  if (
    typeof card.id !== "string" ||
    card.id.trim().length === 0 ||
    typeof card.title !== "string" ||
    typeof card.content !== "string" ||
    typeof card.emotion !== "string" ||
    !Array.isArray(card.sensoryDetails) ||
    !card.sensoryDetails.every(item => typeof item === "string") ||
    typeof card.createdAt !== "number" ||
    !Number.isFinite(card.createdAt)
  ) {
    return null;
  }
  return {
    id: card.id,
    title: card.title,
    content: card.content,
    rawText: asString(card.rawText),
    sourceQuote: asString(card.sourceQuote),
    emotion: card.emotion,
    emotionBlend: asStringArray(card.emotionBlend),
    sensoryDetails: card.sensoryDetails,
    trigger: asString(card.trigger),
    dramaticFunction: asString(card.dramaticFunction),
    personalTrace: asString(card.personalTrace),
    retrievalQuery: asString(card.retrievalQuery),
    themeHints: asStringArray(card.themeHints),
    outlierSignal: asString(card.outlierSignal),
    softMembership: asStringArray(card.softMembership),
    createdAt: card.createdAt,
  };
}

function readQuery(
  value: unknown
): { source: QuerySource; text: string } | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.role === "user") {
    return { source: "role=user", text: asString(message.content).trim() };
  }
  if (message.who === "u") {
    return { source: "who=u", text: asString(message.text).trim() };
  }
  return null;
}

function topIndex(scores: readonly number[]): number | null {
  let bestIndex: number | null = null;
  let bestScore = 0;
  scores.forEach((score, index) => {
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function resolveLocalPersistPath(explicit?: string): string {
  return resolveEvalDataPath({
    filename: LOCAL_PERSIST_FILENAME,
    description: "本地持久化语料",
    usage: "用 --persist <路径> 或设 PROMPT_EVAL_LOCAL_PERSIST 指定。",
    explicit,
    environmentPath: process.env.PROMPT_EVAL_LOCAL_PERSIST,
  });
}

export function analyzeRetrievalCorpus(
  data: unknown
): RetrievalCorpusReport {
  const rawStories =
    data && typeof data === "object" &&
    Array.isArray((data as PersistData).stories)
      ? (data as PersistData).stories!
      : [];
  const report: RetrievalCorpusReport = {
    stories: 0,
    invalidStories: 0,
    duplicateStoryIds: 0,
    cardPools: 0,
    cards: 0,
    invalidCards: 0,
    duplicateStoryCardKeys: 0,
    messages: {
      modernUser: 0,
      legacyUser: 0,
      emptyExcluded: 0,
      duplicateEventsRetained: 0,
      withoutCards: 0,
      withoutTokens: 0,
      evaluated: 0,
      noLexicalMatch: 0,
      matched: 0,
    },
    idf: {
      vocabularyEntries: 0,
      singleDocumentEntries: 0,
      singleDocumentRatio: 0,
    },
    top1: {
      same: 0,
      different: 0,
      bySource: {
        "role=user": { matched: 0, same: 0, different: 0 },
        "who=u": { matched: 0, same: 0, different: 0 },
      },
    },
    differences: [],
  };
  const stories: PersistStory[] = [];
  const seenStoryIds = new Set<number>();
  rawStories.forEach(value => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.id !== "number" ||
      !Number.isSafeInteger(value.id) ||
      value.id <= 0
    ) {
      report.invalidStories += 1;
      return;
    }
    if (seenStoryIds.has(value.id)) {
      report.duplicateStoryIds += 1;
      return;
    }
    seenStoryIds.add(value.id);
    stories.push(value);
  });
  report.stories = stories.length;
  const seenCardKeys = new Set<string>();
  const seenQueryEvents = new Set<string>();

  for (const story of stories) {
    const rawCards = Array.isArray(story.body?.cards) ? story.body.cards : [];
    const cards: StoryCard[] = [];
    rawCards.forEach(value => {
      const card = normalizeCard(value);
      if (card) cards.push(card);
      else report.invalidCards += 1;
    });
    report.cards += cards.length;
    if (cards.length > 0) report.cardPools += 1;

    cards.forEach((card, index) => {
      const key = `${story.id}::${card.id || index}`;
      if (seenCardKeys.has(key)) report.duplicateStoryCardKeys += 1;
      seenCardKeys.add(key);
    });

    const documents = cards.map(card =>
      tokenizeForSimilarity(storyCardSearchText(card))
    );
    const idf = buildIdfIndex(documents);
    report.idf.vocabularyEntries += idf.size;
    if (documents.length > 0) {
      const frequencies = new Map<string, number>();
      documents.forEach(document => {
        document.forEach(token => {
          frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
        });
      });
      frequencies.forEach(frequency => {
        if (frequency === 1) report.idf.singleDocumentEntries += 1;
      });
    }

    const messages = Array.isArray(story.body?.messages)
      ? story.body.messages
      : [];
    messages.forEach((message, messageIndex) => {
      const query = readQuery(message);
      if (!query) return;
      if (query.source === "role=user") report.messages.modernUser += 1;
      else report.messages.legacyUser += 1;
      if (!query.text) {
        report.messages.emptyExcluded += 1;
        return;
      }

      const eventKey = `${story.id}::${query.text}`;
      if (seenQueryEvents.has(eventKey)) {
        report.messages.duplicateEventsRetained += 1;
      }
      seenQueryEvents.add(eventKey);

      if (cards.length === 0) {
        report.messages.withoutCards += 1;
        return;
      }
      const queryTokens = tokenizeForSimilarity(query.text);
      if (queryTokens.size === 0) {
        report.messages.withoutTokens += 1;
        return;
      }
      report.messages.evaluated += 1;

      const overlapScores = documents.map(document => {
        let overlap = 0;
        queryTokens.forEach(token => {
          if (document.has(token)) overlap += 1;
        });
        return document.size > 0
          ? overlap / Math.sqrt(queryTokens.size * document.size)
          : 0;
      });
      const tfidfScores = documents.map(document =>
        tfidfCosine(queryTokens, document, idf, documents.length)
      );
      const oldIndex = topIndex(overlapScores);
      const tfidfIndex = topIndex(tfidfScores);
      if (oldIndex == null && tfidfIndex == null) {
        report.messages.noLexicalMatch += 1;
        return;
      }
      report.messages.matched += 1;
      report.top1.bySource[query.source].matched += 1;
      if (oldIndex === tfidfIndex) {
        report.top1.same += 1;
        report.top1.bySource[query.source].same += 1;
      } else {
        report.top1.different += 1;
        report.top1.bySource[query.source].different += 1;
        report.differences.push({
          storyId: story.id,
          messageIndex,
          source: query.source,
          oldCardId: oldIndex == null ? null : cards[oldIndex].id,
          tfidfCardId: tfidfIndex == null ? null : cards[tfidfIndex].id,
        });
      }
    });
  }

  report.idf.singleDocumentRatio =
    report.idf.vocabularyEntries > 0
      ? report.idf.singleDocumentEntries / report.idf.vocabularyEntries
      : 0;
  return report;
}

export function loadRetrievalCorpus(path?: string): {
  path: string;
  report: RetrievalCorpusReport;
} {
  const resolvedPath = resolveLocalPersistPath(path);
  const data: unknown = JSON.parse(readFileSync(resolvedPath, "utf8"));
  return { path: resolvedPath, report: analyzeRetrievalCorpus(data) };
}
