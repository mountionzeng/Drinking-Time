import type { StoryPromptAggregate } from "@shared/promptLineage";
import type { SelectionContext } from "@shared/selectionContext";
import type { StoryShot } from "./types";
import { displayShotCode } from "@shared/shotIdentity";

const SHOT_FIELD_DIMENSIONS: Record<string, string> = {
  subject: "subject",
  action: "action",
  dialogue: "dialogue",
  emotion: "mood",
  intent: "intent",
  rationale: "rationale",
  beat: "beat",
  cameraMove: "camera_motion",
  location: "location",
  timeLight: "time_light",
  mood: "mood",
  sound: "sound",
  styleRef: "style_reference",
  videoPrompt: "video_prompt",
  promptDraft: "image_prompt",
  negativePrompt: "negative_prompt",
};

export type SelectionPromptTarget = {
  nodeId: number;
  stableShotId: string;
  dimension: string;
  label: string;
  currentContent: string | null;
};

export function resolveSelectionEditText(input: {
  selection: Pick<
    SelectionContext,
    "sourceType" | "selectedText" | "fullText"
  >;
  target: SelectionPromptTarget | null;
}): { fullText: string; selectedText: string } {
  const currentContent = input.target?.currentContent?.trim();
  if (
    input.selection.sourceType === "storyboard-image" &&
    currentContent
  ) {
    return {
      fullText: currentContent,
      selectedText: currentContent,
    };
  }
  return {
    fullText: input.selection.fullText,
    selectedText: input.selection.selectedText,
  };
}

function shotIdentity(shot: StoryShot | undefined): string | null {
  return shot?.stableShotId?.trim() || shot?.shotIdentity?.trim() || null;
}

export function resolveSelectionPromptTarget(input: {
  selection: SelectionContext;
  shots: readonly StoryShot[];
  aggregate: StoryPromptAggregate;
}): SelectionPromptTarget | null {
  const isStoryboardImage =
    input.selection.sourceType === "storyboard-image";
  if (input.selection.sourceType !== "shot" && !isStoryboardImage) return null;

  const [rawIndex, field] = input.selection.sourceId.split(":");
  const index = input.selection.sourceType === "shot" ? Number(rawIndex) : -1;
  const dimension = isStoryboardImage
    ? "image_prompt"
    : SHOT_FIELD_DIMENSIONS[field];
  if (!dimension) return null;
  const shotByNumber =
    input.selection.shotNo == null
      ? undefined
      : input.shots.find(shot => shot.shotNo === input.selection.shotNo);
  const stableShotId =
    input.selection.stableShotId?.trim() ||
    shotIdentity(shotByNumber) ||
    shotIdentity(Number.isInteger(index) ? input.shots[index] : undefined);
  if (!stableShotId) return null;

  const candidates = input.aggregate.nodes
    .filter(
      node =>
        node.dimension === dimension &&
        (node.stableShotId === stableShotId || node.scope === "story"),
    )
    .sort((left, right) => {
      const leftLocal = left.stableShotId === stableShotId ? 1 : 0;
      const rightLocal = right.stableShotId === stableShotId ? 1 : 0;
      return rightLocal - leftLocal || right.id - left.id;
    });
  const node = candidates[0];
  if (!node) return null;
  const currentRevision =
    node.currentRevisionId == null
      ? undefined
      : input.aggregate.revisions.find(
          revision => revision.id === node.currentRevisionId,
        );
  return {
    nodeId: node.id,
    stableShotId,
    dimension,
    currentContent: currentRevision?.content ?? null,
    label: `${displayShotCode({
      cueCode:
        input.selection.cueCode ??
        (Number.isInteger(index) ? input.shots[index]?.cueCode : null),
      shotNo: input.selection.shotNo ?? index + 1,
    })} · ${isStoryboardImage ? "图片要求" : field}`,
  };
}
