export type StoryboardMediaKind = "candidate" | "image" | "video";

export type StoryboardMediaSelectionTarget = {
  shotIdentity: string;
  kind: StoryboardMediaKind;
  id: string | number;
};

export type StoryboardMediaSelection = {
  shotIdentity: string;
  kind: StoryboardMediaKind;
  id: string;
  key: string;
};

export function storyboardMediaSelectionKey(
  target: StoryboardMediaSelectionTarget
): string {
  return `${target.shotIdentity}:${target.kind}:${String(target.id)}`;
}

export function storyboardMediaSelection(
  target: StoryboardMediaSelectionTarget
): StoryboardMediaSelection {
  return {
    shotIdentity: target.shotIdentity,
    kind: target.kind,
    id: String(target.id),
    key: storyboardMediaSelectionKey(target),
  };
}

export function isStoryboardMediaSelected(
  selection: StoryboardMediaSelection | null,
  target: StoryboardMediaSelectionTarget
): boolean {
  return selection?.key === storyboardMediaSelectionKey(target);
}

export function storyboardMediaShotExpanded(
  selection: StoryboardMediaSelection | null,
  shotIdentity: string
): boolean {
  return selection?.shotIdentity === shotIdentity;
}
