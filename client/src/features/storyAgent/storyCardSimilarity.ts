/**
 * storyCardSimilarity — 卡片检索相似度
 *
 * 从 StoryAgentContext「大脑」里拆出来的一块：负责在用户开口时，
 * 从已有故事卡里挑出「最相关的几张」喂给对话 Agent，让聊聊能接住上下文。
 * 纯函数、不碰任何 React 状态，所以单独成文件，方便单测与复用。
 *
 * 算法：中英文混合分词 + **TF-IDF 加权余弦**，取分数最高的前 3 张。
 *
 * 为什么要 IDF：不加权的重叠计数里，「今天」「有点」「觉得」和「葬礼」「母亲」
 * 是一样重的。用户说的话里虚词占多数，结果就是「谁的卡长、虚词多，谁就被检出」。
 * IDF 用**用户自己的卡池**当语料统计词的稀有度，虚词因为处处都有而自动趋近 0 权重，
 * 不需要维护中文停用词表——这也是停用词表在中文里本来就不好维护的原因。
 */
import type { StoryCard } from './types';

/** 返回给 Agent 的精简卡片（不是完整 StoryCard） */
export type SimilarCard = {
  content: StoryCard['content'];
  rawText: StoryCard['rawText'];
  emotion: StoryCard['emotion'];
  emotionBlend: StoryCard['emotionBlend'];
  retrievalQuery: StoryCard['retrievalQuery'];
  themeHints: StoryCard['themeHints'];
  personalTrace: StoryCard['personalTrace'];
  score: number;
};

/** 检出条数上限 */
const TOP_K = 3;

// 把一段文本切成「词集合」：英文/数字按词切，中文按 2 字组（bigram）切。
// 用 Set 是为了后面算重叠时 O(1) 命中。
export function tokenizeForSimilarity(input: string): Set<string> {
  const lower = input.toLowerCase();
  const tokens = lower.match(/[a-z0-9]+|[一-鿿]{2,}/g) ?? [];
  const chineseChars = Array.from(lower.replace(/[^一-鿿]/g, ''));
  const chineseBigrams: string[] = [];
  for (let i = 0; i < chineseChars.length - 1; i += 1) {
    chineseBigrams.push(`${chineseChars[i]}${chineseChars[i + 1]}`);
  }
  return new Set([...tokens, ...chineseBigrams]);
}

// 把一张卡里所有「可被检索」的字段拼成一段长文本，作为这张卡的搜索语料。
export function storyCardSearchText(card: StoryCard): string {
  return [
    card.content,
    card.rawText,
    card.sourceQuote,
    card.emotion,
    ...(card.emotionBlend ?? []),
    card.trigger,
    card.dramaticFunction,
    card.personalTrace,
    card.retrievalQuery,
    ...(card.themeHints ?? []),
    card.outlierSignal,
    ...(card.softMembership ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * 平滑 IDF：`log(1 + N / (1 + df))`。
 *
 * 分母 +1 防止未登录词除零；整体 +1 保证 idf 恒为正——
 * 否则一个出现在**所有**卡里的词会拿到 0 权重，连带把该卡的向量模长算错。
 */
export function inverseDocumentFrequency(
  documentCount: number,
  documentFrequency: number,
): number {
  return Math.log(1 + documentCount / (1 + documentFrequency));
}

/**
 * 用卡池统计每个词的 IDF。语料就是用户自己的卡——
 * 「什么词算稀有」本来就该按这个人的表达习惯定，不是按通用语料。
 */
export function buildIdfIndex(
  documents: readonly Set<string>[],
): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    document.forEach((token) => {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    });
  }
  const idf = new Map<string, number>();
  documentFrequency.forEach((frequency, token) => {
    idf.set(token, inverseDocumentFrequency(documents.length, frequency));
  });
  return idf;
}

/**
 * TF-IDF 加权余弦。
 *
 * 分词结果是 Set（词在不在），所以 tf 恒为 1，权重就等于 idf。
 * 未登录词（只出现在 query、卡池里没有）用 df=0 的 idf，给它应有的高权重。
 */
export function tfidfCosine(
  queryTokens: Set<string>,
  documentTokens: Set<string>,
  idf: Map<string, number>,
  documentCount: number,
): number {
  const weightOf = (token: string) =>
    idf.get(token) ?? inverseDocumentFrequency(documentCount, 0);

  const sumOfSquares = (tokens: Set<string>) => {
    let total = 0;
    tokens.forEach((token) => {
      const weight = weightOf(token);
      total += weight * weight;
    });
    return total;
  };

  let dot = 0;
  queryTokens.forEach((token) => {
    if (documentTokens.has(token)) {
      const weight = weightOf(token);
      dot += weight * weight;
    }
  });
  if (dot === 0) return 0;

  const queryNorm = sumOfSquares(queryTokens);
  const documentNorm = sumOfSquares(documentTokens);
  if (queryNorm === 0 || documentNorm === 0) return 0;

  return dot / Math.sqrt(queryNorm * documentNorm);
}

// 给定 query（通常是用户刚说的话），从 sourceCards 里挑出最相关的前 3 张。
export function getSimilarCards(
  query: string,
  sourceCards: StoryCard[],
): SimilarCard[] {
  const queryTokens = tokenizeForSimilarity(query);
  if (queryTokens.size === 0) return [];

  const cardTokens = sourceCards.map((card) =>
    tokenizeForSimilarity(storyCardSearchText(card)),
  );
  const idf = buildIdfIndex(cardTokens);

  return sourceCards
    .map((card, index) => ({
      content: card.content,
      rawText: card.rawText,
      emotion: card.emotion,
      emotionBlend: card.emotionBlend,
      retrievalQuery: card.retrievalQuery,
      themeHints: card.themeHints,
      personalTrace: card.personalTrace,
      score: tfidfCosine(
        queryTokens,
        cardTokens[index],
        idf,
        sourceCards.length,
      ),
    }))
    .filter((card) => card.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}
