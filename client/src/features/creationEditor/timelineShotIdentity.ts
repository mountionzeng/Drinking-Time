import { normalizeShotIdentity } from "@shared/shotIdentity";
import type { CreationEditorShot } from "./types";

export const SHOT_STORY_IDENTITY_FIELDS = [
  "shotNo",
  "subject",
  "action",
  "scriptText",
  "dialogue",
  "shotType",
  "beat",
  "cameraAngle",
  "cameraMove",
  "location",
  "timeLight",
  "mood",
  "sound",
  "styleRef",
  "note",
  "emotion",
  "sourceCardContent",
  "intent",
  "rationale",
  "videoStart",
  "videoEnd",
  "transitionIn",
  "transitionOut",
  "videoPrompt",
  "emotionCharge",
  "emotionDelta",
  "visualAnchorText",
  "negativePrompt",
] as const;

export function creationTimelineShotId(
  shot: Pick<
    CreationEditorShot,
    "stableShotId" | "shotIdentity" | "shotKey" | "shotNo"
  >,
  index = 0
): string {
  return (
    normalizeShotIdentity(shot.stableShotId) ??
    normalizeShotIdentity(shot.shotIdentity) ??
    normalizeShotIdentity(shot.shotKey) ??
    `legacy-sh${String(shot.shotNo).padStart(2, "0")}-${index + 1}`
  );
}

export function resolveTimelineShots(
  shots: readonly CreationEditorShot[],
  shotIds: readonly string[]
): CreationEditorShot[] {
  const byId = new Map(
    shots.map((shot, index) => [creationTimelineShotId(shot, index), shot])
  );
  return shotIds
    .map(id => byId.get(id))
    .filter((shot): shot is CreationEditorShot => Boolean(shot));
}
