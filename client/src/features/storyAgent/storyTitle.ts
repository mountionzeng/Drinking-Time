import type { ChatMessage, GeneratedScript, StoryCard } from "./types";
import type { PublishingDraftState } from "@shared/publishingDraft";
import { normalizeTitleText, validateGeneratedTitle } from "@shared/textTitle";

const UNTITLED_NAMES = new Set(["", "未命名", "未命名故事", "新故事草稿"]);

export function isUntitledStoryName(value: string | null | undefined): boolean {
  const title = value?.trim() ?? "";
  return UNTITLED_NAMES.has(title) || /^故事\s*#\d+$/.test(title);
}

export function canApplyAutomaticStoryTitle(
  currentTitle: string | null | undefined,
  suggestedTitle: string
): boolean {
  return (
    isUntitledStoryName(currentTitle) ||
    (currentTitle?.trim() ?? "") === suggestedTitle.trim()
  );
}

function compactTitle(value: string): string {
  return normalizeTitleText(
    value
    .replace(/[#*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  );
}

function internalTitleCandidate(value: string | null | undefined): string | null {
  const validation = validateGeneratedTitle({
    kind: "story",
    value: compactTitle(value ?? ""),
    requireAnchor: false,
  });
  return validation.hardFailures.length === 0 && validation.normalizedTitle
    ? validation.normalizedTitle
    : null;
}

function quotedIdeas(messages: readonly string[]): string | null {
  for (const message of [...messages].reverse()) {
    const matches = Array.from(
      message.matchAll(/[“"「『]([^”"」』]{2,18})[”"」』]/g),
      match => compactTitle(match[1] ?? "")
    ).filter(Boolean);
    const unique = Array.from(new Set(matches));
    if (unique.length >= 2) {
      return internalTitleCandidate(`${unique[0]}与${unique[1]}`);
    }
    if (unique.length === 1 && unique[0]!.length >= 4) {
      return internalTitleCandidate(unique[0]!);
    }
  }
  return null;
}

function conversationPhrase(messages: readonly string[]): string | null {
  const candidates = messages
    .flatMap((message, messageIndex) =>
      message
        .replace(
          /^(?:(?:我(?:想|要)|帮我)(?:讲|说|写|做|记录|整理|生成)(?:一下|一个|一件|一段|一篇)?(?:事儿|事情|事|故事|内容)?|我(?:突然)?(?:想到|想起)(?:一个|了)?(?:事儿|事情)?|我觉得|我感觉|其实|就是|最近|今天)[，,：:\s]*(?:就是)?[，,：:\s]*/,
          ""
        )
        .split(/[。！？!?；;，,\n]+/)
        .map((phrase, phraseIndex) => ({
          phrase: compactTitle(phrase),
          order: messageIndex * 100 + phraseIndex,
        }))
    )
    .filter(
      candidate =>
        candidate.phrase.length >= 6 &&
        internalTitleCandidate(candidate.phrase) !== null &&
        !/(?:帮我|可以|怎么|版本|重新|生成|修改|改一下)/.test(
          candidate.phrase
        )
    )
    .sort(
      (left, right) =>
        Math.min(right.phrase.length, 18) -
          Math.min(left.phrase.length, 18) || left.order - right.order
    );
  return internalTitleCandidate(candidates[0]?.phrase) ?? null;
}

export function activePublishingTitle(
  publishing: PublishingDraftState
): string {
  return (
    publishing.drafts[publishing.activePlatform]?.content.title?.trim() ?? ""
  );
}

export function suggestAutomaticStoryTitle(input: {
  currentTitle?: string | null;
  agentSuggestedTitle?: string | null;
  publishingTitle?: string | null;
  scriptTitles?: readonly string[];
  cardTitles?: readonly string[];
  userMessages?: readonly string[];
}): string | null {
  if (!isUntitledStoryName(input.currentTitle)) return null;
  const directCandidates = [
    input.agentSuggestedTitle,
    input.publishingTitle,
    ...(input.scriptTitles ?? []).slice().reverse(),
    ...(input.cardTitles ?? []).slice().reverse(),
  ];
  for (const candidate of directCandidates) {
    const title = internalTitleCandidate(candidate);
    if (title && !isUntitledStoryName(title)) return title;
  }
  const userMessages = input.userMessages ?? [];
  return quotedIdeas(userMessages) ?? conversationPhrase(userMessages);
}

export function suggestAutomaticStoryTitleFromState(input: {
  currentTitle?: string | null;
  agentSuggestedTitle?: string | null;
  publishing: PublishingDraftState;
  scripts: readonly GeneratedScript[];
  cards: readonly StoryCard[];
  messages: readonly ChatMessage[];
}): string | null {
  return suggestAutomaticStoryTitle({
    currentTitle: input.currentTitle,
    agentSuggestedTitle: input.agentSuggestedTitle,
    publishingTitle: activePublishingTitle(input.publishing),
    scriptTitles: input.scripts.map(script => script.title),
    cardTitles: input.cards.map(card => card.title),
    userMessages: input.messages
      .filter(message => message.role === "user")
      .map(message => message.content),
  });
}
