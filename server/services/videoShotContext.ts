import { canonicalizeShotNo } from "../../shared/imageAsset";
import { normalizeShotIdentity } from "../../shared/shotIdentity";
import type { VideoPromptShotContext } from "./videoPromptDirector";

export function storyVideoContext(
  body: unknown,
  stableShotId: string,
  shotNo: number
): {
  cueCode?: string;
  currentShot?: VideoPromptShotContext;
  previousShot?: VideoPromptShotContext;
  nextShot?: VideoPromptShotContext;
} {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(record.shots)
    ? record.shots.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
  const index = shots.findIndex((shot, candidateIndex) => {
    const identity =
      normalizeShotIdentity(shot.stableShotId) ??
      normalizeShotIdentity(shot.shotIdentity) ??
      normalizeShotIdentity(shot.shotKey);
    if (identity) return identity === stableShotId;
    const canonical = canonicalizeShotNo(
      shot.shotNo as string | number | null | undefined
    );
    return (
      canonical === `SH${String(shotNo).padStart(2, "0")}` ||
      (!canonical && candidateIndex + 1 === shotNo)
    );
  });
  if (index < 0) return {};

  const context = (
    shot: Record<string, unknown> | undefined
  ): VideoPromptShotContext | undefined => {
    if (!shot) return undefined;
    const value = (key: string) =>
      typeof shot[key] === "string" ? String(shot[key]).trim() : "";
    return {
      shotType: value("shotType"),
      cameraAngle: value("cameraAngle"),
      cameraHeight: value("cameraHeight"),
      lens: value("lens"),
      intent: value("intent"),
      subject: value("subject"),
      action: value("action"),
      performance: value("performance"),
      environmentMotion: value("environmentMotion"),
      cameraMove: value("cameraMove"),
      cameraPath: value("cameraPath"),
      subjectPath: value("subjectPath"),
      videoStart: value("videoStart"),
      videoEnd: value("videoEnd"),
      mood: value("mood") || value("emotion"),
      timeLight: value("timeLight"),
      lighting: value("lighting"),
      colorPalette: value("colorPalette"),
      materialTexture: value("materialTexture"),
      dialogue: value("dialogue"),
      sound: value("sound"),
      soundBridge: value("soundBridge"),
      transitionIn: value("transitionIn"),
      transitionOut: value("transitionOut"),
      transitionIntent: value("transitionIntent"),
      negativePrompt: value("negativePrompt"),
    };
  };

  return {
    cueCode:
      typeof shots[index]?.cueCode === "string"
        ? String(shots[index]?.cueCode).trim()
        : undefined,
    currentShot: context(shots[index]),
    previousShot: context(shots[index - 1]),
    nextShot: context(shots[index + 1]),
  };
}
