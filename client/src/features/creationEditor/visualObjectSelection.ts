import { visualObjectRefKey, type VisualObjectRef } from "@shared/visualObject";

export function selectedShotNoForVisualObject(
  selected: VisualObjectRef | null
): number | null {
  return selected?.type === "story-shot" ? (selected.shotNo ?? null) : null;
}

export function reconcileVisualObjectSelection(
  selected: VisualObjectRef | null,
  available: readonly VisualObjectRef[],
  sameStory: boolean
): VisualObjectRef | null {
  if (!selected || !sameStory) return null;
  const key = visualObjectRefKey(selected);
  return (
    available.find(candidate => visualObjectRefKey(candidate) === key) ?? null
  );
}
