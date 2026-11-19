import type { SelectionContext } from "@shared/selectionContext";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { CreationEditorShot } from "../creationEditor/types";
import { buildWarehouseShotGroups } from "../creationEditor/warehouseShotMedia";
import type { ChatMessage } from "./types";
import { hasInlineChatImages, inlineChatImageIds } from "@shared/inlineChatImages";
import { resolveConversationShot, shotConversationSelection } from "./shotConversation";

/** Restore the last chat subject; a completed inline edit continues on its result, without adoption. */
export function recoverConversationTarget(input: {
  storyId: number;
  messages: readonly ChatMessage[];
  shots: readonly CreationEditorShot[];
  materialState: StoryMaterialState;
}): SelectionContext | null {
  if (input.materialState.storyId !== input.storyId) return null;
  const latest = [...input.messages].reverse().find(message => message.role === "user" && !message.interfaceAction || message.id.startsWith("remix-result:") || message.id.startsWith("start-shot:"));
  if (latest?.id.startsWith("start-shot:")) {
    const quote=latest.selectionQuote;
    const next=quote?.storyId===input.storyId && input.shots.find(s=>(s.stableShotId??s.shotIdentity)===quote.stableShotId);
    return next ? shotConversationSelection(input.storyId,next) : null;
  }
  const result = latest?.id.startsWith("remix-result:") ? latest.imageRevision : undefined;
  if (result) {
    const shot = input.shots.find(shot => (shot.stableShotId ?? shot.shotIdentity) === result.stableShotId);
    if (result.storyId !== input.storyId || !shot || !input.materialState.warehouseImages?.some(image => image.id === result.imageId)) return null;
    return { ...shotConversationSelection(input.storyId, shot), sourceType: "storyboard-image", sourceId: String(result.imageId),
      imageId: result.imageId, selectedText: `图片 #${result.imageId}`, fullText: `图片 #${result.imageId}`,
      objectVersion: `image:${result.imageId}`, materialStatus: "candidate-image" };
  }
  const turn = [...input.messages].reverse().find(message => message.role === "user" && !message.interfaceAction);
  if (!turn) return null;
  const quote = turn.selectionQuote;
  if (quote && (quote.storyId !== input.storyId || quote.selection ||
    !["shot", "storyboard-image", "animatic-video"].includes(quote.sourceType))) return null;
  const shot = quote
    ? input.shots.find(shot => (shot.stableShotId ?? shot.shotIdentity) === quote.stableShotId)
    : resolveConversationShot(turn.content, input.shots);
  if (!shot) return null;
  const selected = shotConversationSelection(input.storyId, shot);
  // The visible inline reference remains the subject after a quote/cancel/reload.
  if (hasInlineChatImages(turn.content)) {
    let ids: number[];
    try { ids = inlineChatImageIds(turn.content); } catch { return null; }
    if (ids.length === 1 && input.materialState.warehouseImages?.some(image => image.id === ids[0])) {
      return { ...selected, sourceType: "storyboard-image", sourceId: String(ids[0]), imageId: ids[0],
        selectedText: `图片 #${ids[0]}`, fullText: `图片 #${ids[0]}`, objectVersion: `image:${ids[0]}`, materialStatus: "candidate-image" };
    }
  }
  if (quote?.sourceType === "shot" || !quote) return selected;
  const group = buildWarehouseShotGroups(input).find(group => group.id === selected.stableShotId);
  const media = group?.items.find(item => item.ready &&
    (quote.sourceType === "storyboard-image" ? item.kind === "image" && item.id === quote.imageId
      : item.kind === "video" && item.id === quote.videoTakeId));
  if (!media) return null;
  return { ...selected, sourceType: quote.sourceType, sourceId: String(media.id),
    selectedText: quote.selectedText, fullText: quote.selectedText,
    objectVersion: `${media.kind}:${media.id}`,
    ...(media.kind === "image" ? { imageId: media.id } : { videoTakeId: media.id }),
  };
}
