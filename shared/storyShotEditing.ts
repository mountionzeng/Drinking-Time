import { normalizeShotIdentity, shotIdentityFromShot } from "./shotIdentity";

export type StoryShotLike = object & {
  shotNo?: number;
  stableShotId?: unknown;
  shotIdentity?: unknown;
};

function insertedShotId(shotNo: number): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `manual-sh${String(shotNo).padStart(2, "0")}-${Date.now().toString(36)}-${suffix}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createInsertedStoryShot<T extends StoryShotLike>(
  previous: T,
  shotNo: number
): T {
  const stableShotId = insertedShotId(shotNo);
  const source = previous as Record<string, unknown>;
  return {
    stableShotId,
    shotIdentity: stableShotId,
    shotNo,
    subject: "新增镜头",
    action: "",
    dialogue: "",
    shotType: text(source.shotType),
    beat: "补充镜头",
    cameraAngle: "",
    cameraMove: "",
    location: text(source.location),
    timeLight: text(source.timeLight),
    mood: text(source.mood),
    sound: "",
    styleRef: text(source.styleRef),
    note: "手动添加，等待补充。",
    emotion: text(source.emotion),
    sourceCardContent: "手动添加的承接镜头。",
    intent: "承接上一镜，等待补充画面任务。",
    rationale: "手动添加，等待补充导演理由。",
    transitionIn: text(source.transitionOut),
    transitionOut: "",
    videoPrompt: "",
  } as unknown as T;
}

function renumberStoryShots<T extends StoryShotLike>(shots: readonly T[]): T[] {
  return shots.map((shot, index) => ({ ...shot, shotNo: index + 1 }));
}

function storyShotStableId<T extends StoryShotLike>(
  shot: T,
  index: number
): string {
  return (
    normalizeShotIdentity(shot.stableShotId) ??
    normalizeShotIdentity(shot.shotIdentity) ??
    shotIdentityFromShot(shot, index) ??
    ""
  );
}

export function findStoryShotInsertIndex<T extends StoryShotLike>(
  shots: readonly T[],
  shotNo: number,
  stableShotId?: string | null
): number {
  const targetIdentity = normalizeShotIdentity(stableShotId);
  return shots.findIndex((shot, index) => {
    if (targetIdentity) {
      return (
        shotIdentityFromShot(shot, index) === targetIdentity ||
        normalizeShotIdentity(shot.stableShotId) === targetIdentity ||
        normalizeShotIdentity(shot.shotIdentity) === targetIdentity
      );
    }
    return shot.shotNo === shotNo;
  });
}

export function deleteStoryShotAtIndex<T extends StoryShotLike>(
  shots: readonly T[],
  index: number
): {
  shots: T[];
  deletedShotNo: number;
  deletedStableShotId: string;
  nextSelectedShotNo: number | null;
} | null {
  if (shots.length <= 1 || index < 0 || index >= shots.length) return null;
  const deleted = shots[index];
  const remaining = renumberStoryShots([
    ...shots.slice(0, index),
    ...shots.slice(index + 1),
  ]);
  return {
    deletedShotNo:
      typeof deleted.shotNo === "number" && Number.isFinite(deleted.shotNo)
        ? deleted.shotNo
        : index + 1,
    deletedStableShotId: storyShotStableId(deleted, index),
    nextSelectedShotNo:
      remaining[Math.min(index, remaining.length - 1)]?.shotNo ?? null,
    shots: remaining,
  };
}

export function deleteStoryShot<T extends StoryShotLike>(
  shots: readonly T[],
  shotNo: number,
  stableShotId?: string | null
): {
  shots: T[];
  deletedShotNo: number;
  deletedStableShotId: string;
  nextSelectedShotNo: number | null;
} | null {
  const index = findStoryShotInsertIndex(shots, shotNo, stableShotId);
  return deleteStoryShotAtIndex(shots, index);
}

export function insertStoryShotAfter<T extends StoryShotLike>(
  shots: readonly T[],
  shotNo: number,
  stableShotId?: string | null
): { shots: T[]; insertedShotNo: number; insertedStableShotId: string } | null {
  if (shots.length === 0) return null;
  const insertIndex = findStoryShotInsertIndex(shots, shotNo, stableShotId);
  if (insertIndex < 0) return null;

  const insertedShotNo = insertIndex + 2;
  const inserted = createInsertedStoryShot(shots[insertIndex], insertedShotNo);
  const insertedStableShotId =
    normalizeShotIdentity(inserted.stableShotId) ??
    normalizeShotIdentity(inserted.shotIdentity) ??
    "";
  return {
    insertedShotNo,
    insertedStableShotId,
    shots: renumberStoryShots([
      ...shots.slice(0, insertIndex + 1),
      inserted,
      ...shots.slice(insertIndex + 1),
    ]),
  };
}
