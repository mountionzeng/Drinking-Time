import type {
  ChatMessage,
  StoryCard,
  VisualCanvasItem,
} from "./types";
import type { ArtReferenceMaterial } from "@shared/artDirection";

function compact(value: string, max = 44): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function meaningfulChars(value: string): Set<string> {
  return new Set(
    Array.from(value.toLowerCase()).filter(char =>
      /[a-z0-9\u3400-\u9fff]/.test(char) && !"的是了在和我有就也".includes(char),
    ),
  );
}

function overlapScore(left: string, right: string): number {
  const leftChars = meaningfulChars(left);
  const rightChars = meaningfulChars(right);
  if (leftChars.size === 0 || rightChars.size === 0) return 0;
  return Array.from(leftChars).filter(char => rightChars.has(char)).length;
}

export function buildStoryArtReferences(params: {
  messages: ChatMessage[];
  cards: StoryCard[];
  visualCanvasItems: VisualCanvasItem[];
  targetContent: string;
  maxSelected?: number;
}): ArtReferenceMaterial[] {
  const { messages, cards, visualCanvasItems, targetContent } = params;
  const maxSelected = params.maxSelected ?? 6;
  const cardById = new Map(cards.map(card => [card.id, card]));
  const seenImages = new Set<string>();
  const ranked: Array<{ score: number; reference: ArtReferenceMaterial }> = [];

  visualCanvasItems.forEach((item, index) => {
    const imageUrl = item.originalImageUrl || item.imageUrl;
    if (!imageUrl || seenImages.has(imageUrl)) return;
    seenImages.add(imageUrl);
    const card = item.cardId ? cardById.get(item.cardId) : undefined;
    const searchText = [
      item.title,
      item.analysis.objective,
      item.analysis.aesthetic,
      card?.content,
    ].filter(Boolean).join(" ");
    const hasAestheticDNA =
      item.analysis.visualStyle.length > 0 ||
      item.analysis.colorPalette.length > 0 ||
      Boolean(item.analysis.lighting || item.analysis.composition);
    ranked.push({
      score:
        40 +
        overlapScore(searchText, targetContent) * 4 +
        (card ? 12 : 0) +
        (item.analysis.confidence || 0) * 8 -
        index * 0.01,
      reference: {
        id: `visual:${item.id}`,
        label: card ? `${card.title} · 参考图` : item.title || "视觉参考",
        source: "visual-anchor",
        purpose: item.source === "riff" ? "aesthetic" : hasAestheticDNA ? "both" : "fact",
        selected: false,
        imageUrl,
        text: item.analysis.objective || card?.content || item.title,
        visualStyle: item.analysis.visualStyle,
        colorPalette: item.analysis.colorPalette,
        lighting: item.analysis.lighting,
        composition: item.analysis.composition,
        confidence: item.analysis.confidence,
      },
    });
  });

  messages.forEach((message, index) => {
    if (message.role !== "user" || !message.photoUrl || seenImages.has(message.photoUrl)) {
      return;
    }
    seenImages.add(message.photoUrl);
    ranked.push({
      score:
        32 +
        overlapScore(message.content, targetContent) * 4 +
        index / Math.max(1, messages.length),
      reference: {
        id: `message:${message.id}`,
        label: compact(message.content || "用户照片", 24),
        source: "message-photo",
        purpose: "fact",
        selected: false,
        imageUrl: message.photoUrl,
        text: message.content,
      },
    });
  });

  cards.forEach((card, index) => {
    ranked.push({
      score:
        18 +
        overlapScore(
          [card.content, card.sourceQuote, card.emotion, ...card.sensoryDetails]
            .filter(Boolean)
            .join(" "),
          targetContent,
        ) * 3 +
        index / Math.max(1, cards.length),
      reference: {
        id: `card:${card.id}`,
        label: card.title || `故事卡 ${index + 1}`,
        source: "story-card",
        purpose: "fact",
        selected: false,
        text: compact(
          [card.content, card.sourceQuote, ...card.sensoryDetails]
            .filter(Boolean)
            .join("；"),
          100,
        ),
      },
    });
  });

  return ranked
    .sort((left, right) => right.score - left.score)
    .map(({ reference }, index) => ({
      ...reference,
      selected: index < maxSelected,
    }));
}
