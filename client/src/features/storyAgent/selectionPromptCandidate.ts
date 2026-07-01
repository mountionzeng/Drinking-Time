import type { StoryPromptAggregate } from "@shared/promptLineage";
import type { SelectionContext } from "@shared/selectionContext";
import type { StoryShot } from "./types";

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
};

function shotIdentity(shot: StoryShot | undefined): string | null {
  return shot?.stableShotId?.trim() || shot?.shotIdentity?.trim() || null;
}

export function resolveSelectionPromptTarget(input: {
  selection: SelectionContext;
  shots: readonly StoryShot[];
  aggregate: StoryPromptAggregate;
}): SelectionPromptTarget | null {
  if (input.selection.sourceType !== "shot") return null;
  const [rawIndex, field] = input.selection.sourceId.split(":");
  const index = Number(rawIndex);
  const dimension = SHOT_FIELD_DIMENSIONS[field];
  if (!dimension) return null;
  const stableShotId =
    input.selection.stableShotId?.trim() ||
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
  return {
    nodeId: node.id,
    stableShotId,
    dimension,
    label: `SH${String(input.selection.shotNo ?? index + 1).padStart(2, "0")} · ${field}`,
  };
}
