import { canonicalizeShotNo } from "./imageAsset";

export const STABLE_SHOT_ID_FIELD = "stableShotId";
export const SHOT_IDENTITY_FIELD = "shotIdentity";

type ShotLike = Record<string, unknown>;

function slugPart(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function normalizeShotIdentity(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || null
  );
}

export function legacyShotIdentityForShot(
  shot: ShotLike,
  index: number
): string {
  const canonical = canonicalizeShotNo(
    (shot.shotNo ?? shot.shotKey) as string | number | null | undefined
  );
  const label = canonical?.toLowerCase() ?? `index-${index + 1}`;
  const anchor =
    slugPart(shot.beat) ||
    slugPart(shot.subject) ||
    slugPart(shot.sourceCardContent) ||
    "shot";
  return `legacy-${label}-${anchor}`;
}

export function shotIdentityFromShot(shot: unknown, index = 0): string | null {
  if (!shot || typeof shot !== "object") return null;
  const record = shot as ShotLike;
  return (
    normalizeShotIdentity(record[STABLE_SHOT_ID_FIELD]) ??
    normalizeShotIdentity(record[SHOT_IDENTITY_FIELD]) ??
    normalizeShotIdentity(record.id) ??
    normalizeShotIdentity(legacyShotIdentityForShot(record, index))
  );
}

export function ensureShotIdentities<T extends object>(
  shots: readonly T[]
): Array<T & { stableShotId: string; shotIdentity: string }> {
  const seen = new Map<string, number>();
  return shots.map((shot, index) => {
    const record = shot as ShotLike;
    const base =
      shotIdentityFromShot(record, index) ??
      normalizeShotIdentity(legacyShotIdentityForShot(record, index)) ??
      `legacy-index-${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const stable = count === 0 ? base : `${base}-${count + 1}`;
    return {
      ...shot,
      stableShotId: stable,
      shotIdentity: stable,
    };
  });
}
