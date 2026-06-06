/**
 * storyCardSimilarity — 卡片检索相似度
 *
 * 从 StoryAgentContext「大脑」里拆出来的一块：负责在用户开口时，
 * 从已有故事卡里挑出「最相关的几张」喂给对话 Agent，让小酌能接住上下文。
 * 纯函数、不碰任何 React 状态，所以单独成文件，方便单测与复用。
 *
 * 算法：中英文混合分词 + 余弦式重叠打分，取分数最高的前 3 张。
 */
import type { StoryCard } from './types';

// 把一段文本切成「词集合」：英文/数字按词切，中文按 2 字组（bigram）切。
// 用 Set 是为了后面算重叠时 O(1) 命中。
function tokenizeForSimilarity(input: string): Set<string> {
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
function storyCardSearchText(card: StoryCard): string {
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

// 给定 query（通常是用户刚说的话），从 sourceCards 里挑出最相关的前 3 张。
// 返回的是「精简卡片」（只带 Agent 需要的字段），不是完整 StoryCard。
export function getSimilarCards(query: string, sourceCards: StoryCard[]) {
  const queryTokens = tokenizeForSimilarity(query);
  if (queryTokens.size === 0) return [];

  return sourceCards
    .map((card) => {
      const cardTokens = tokenizeForSimilarity(storyCardSearchText(card));
      let overlap = 0;
      queryTokens.forEach((token) => {
        if (cardTokens.has(token)) overlap += 1;
      });
      // 余弦式归一：重叠数 / sqrt(查询词数 × 卡片词数)，避免长卡片天然占便宜。
      const score =
        cardTokens.size > 0 ? overlap / Math.sqrt(queryTokens.size * cardTokens.size) : 0;
      return {
        content: card.content,
        rawText: card.rawText,
        emotion: card.emotion,
        emotionBlend: card.emotionBlend,
        retrievalQuery: card.retrievalQuery,
        themeHints: card.themeHints,
        personalTrace: card.personalTrace,
        score,
      };
    })
    .filter((card) => card.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
