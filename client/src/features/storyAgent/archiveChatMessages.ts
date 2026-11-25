import { isInlineBookRewrite } from '@shared/bookRewrite';
import type { ChatMessage, StoryCard } from "./types";

export function archiveMessagesFrom(
  sourceMessages: ChatMessage[],
  sourceCards: StoryCard[]
) {
  return sourceMessages.map(message => {
    const spawnedCard = message.spawnedCardId
      ? sourceCards.find(card => card.id === message.spawnedCardId)
      : undefined;
    return {
      id: message.id,
      timestamp: message.timestamp,
      who: message.role === "user" ? "u" : "s",
      name: message.role === "user" ? "你" : "聊聊",
      text: message.content,
      photoUrl: message.photoUrl,
      selectionQuote: message.selectionQuote,
      promptCandidate: message.promptCandidate,
      imageRerenderAction: message.imageRerenderAction,
      imageRevision: message.imageRevision,
      imageEditPlan: message.imageEditPlan,
      frameReferences: message.frameReferences,
      frameReview: message.frameReview,
      ...(message.bookRewrite && isInlineBookRewrite(message.bookRewrite) ? { bookRewrite: message.bookRewrite } : {}),
      ...(message.bookRewriteChoices && { bookRewriteChoices: message.bookRewriteChoices }),
      ...(message.bookRewriteFocus && { bookRewriteFocus: message.bookRewriteFocus }),
      ...(message.bookChatDraft && { bookChatDraft: message.bookChatDraft }),
      ...(message.bookDocument && { bookDocument: message.bookDocument }),
      editingTransitionCandidate: message.editingTransitionCandidate,
      pendingCard: spawnedCard
        ? {
            status: "kept",
            cardId: spawnedCard.id,
            content: spawnedCard.content,
            emotion: spawnedCard.emotion,
            sensoryDetails: spawnedCard.sensoryDetails,
          }
        : undefined,
    };
  });
}
