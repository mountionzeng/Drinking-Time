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
