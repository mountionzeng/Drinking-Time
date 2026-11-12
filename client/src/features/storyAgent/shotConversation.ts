import type { SelectionContext } from "@shared/selectionContext";
import { displayShotCode } from "@shared/shotIdentity";

type Shot = {
  stableShotId?: string | null;
  shotIdentity?: string | null;
  shotNo: number;
  cueCode?: string | null;
  subject?: string | null;
};
const code = (value: string) =>
  value.replace(/^SH/i, "").replace(/^0+/, "") || "0";
function numberCode(value: string) {
  if (/^\d+$/.test(value)) return code(value);
  const digits = "零一二三四五六七八九";
  const parts = value.replace(/两/g, "二").split("十");
  if (parts.length === 2)
    return String(
      (parts[0] ? digits.indexOf(parts[0]) : 1) * 10 +
        (parts[1] ? digits.indexOf(parts[1]) : 0)
    );
  return String(digits.indexOf(value));
}
/** Explicit targets win over a clicked target. Ambiguous/missing targets are not guessed. */
export function resolveConversationShot<T extends Shot>(
  text: string,
  shots: readonly T[]
): T | undefined {
  const matches = [
    ...text.matchAll(
      /第\s*([\d零一二三四五六七八九十两]+)\s*(?:个)?镜(?:头)?|(?:镜头|\bshot)\s*(\d{1,6})/gi
    ),
  ];
  const codes = [...new Set(matches.map(m => numberCode(m[1] ?? m[2])))];
  if (codes.length !== 1) return undefined;
  const found = shots.filter(
    s => code(s.cueCode || String(s.shotNo)) === codes[0]
  );
  return found.length === 1 ? found[0] : undefined;
}
export function hasConversationShotReference(text: string) {
  return /第\s*[\d零一二三四五六七八九十两]+\s*(?:个)?镜|(?:镜头|\bshot)\s*\d/i.test(
    text
  );
}
export function isShotConversationQuestion(text: string) {
  return /怎么|如何|为什么|哪些|记录|历史|\bhow\b|\bwhy\b|\bhistory\b/i.test(text);
}
export function shotConversationSelection(
  storyId: number,
  shot: Shot
): SelectionContext {
  const id = shot.stableShotId ?? shot.shotIdentity ?? "";
  return {
    sourceType: "shot",
    sourceId: id,
    storyId,
    stableShotId: id,
    shotNo: shot.shotNo,
    cueCode: shot.cueCode,
    selectedText: shot.subject || displayShotCode(shot),
    fullText: shot.subject || displayShotCode(shot),
  };
}

type Message = {
  content?: string;
  role: string;
  selectionQuote?: { storyId?: number | null; stableShotId?: string | null };
  imageRevision?: { storyId: number; stableShotId: string };
  frameReferences?: Array<{ storyId: number; stableShotId: string }>;
  frameReview?: { storyId: number; stableShotId: string };
};
/** Old assistant replies lack a quote; inherit only inside the same user turn. */
export function shotConversationMessages<T extends Message>(
  messages: readonly T[],
  storyId: number,
  stableShotId: string,
  legacyShot?: Shot
): T[] {
  let belongs = false;
  return messages.filter(message => {
    const target = message.selectionQuote ?? message.frameReview ?? message.frameReferences?.[0] ?? message.imageRevision;
    if (message.role === "user")
      belongs = target
        ? target.storyId === storyId && target.stableShotId === stableShotId
        : Boolean(
            legacyShot &&
              resolveConversationShot(message.content ?? "", [legacyShot])
          );
    return target
      ? target.storyId === storyId && target.stableShotId === stableShotId
      : belongs;
  });
}

type Image = {
  id: number;
  imageUrl: string;
  shotIdentity?: string | null;
  parentImageId?: number | null;
};
/** Archive projection only: never changes adoption or reattaches a removed image. */
export function shotConversationImages<T extends Image>(
  images: readonly T[],
  stableShotId: string,
  relatedIds: readonly number[] = []
): T[] {
  const ids = new Set(relatedIds);
  for (const image of images)
    if (image.shotIdentity === stableShotId) ids.add(image.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const image of images)
      if (
        !ids.has(image.id) &&
        image.parentImageId &&
        ids.has(image.parentImageId) &&
        (!image.shotIdentity || image.shotIdentity === stableShotId)
      ) {
        ids.add(image.id);
        changed = true;
      }
  }
  return images.filter(image => ids.has(image.id));
}
