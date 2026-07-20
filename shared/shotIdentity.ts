import { canonicalizeShotNo } from "./imageAsset";

export const STABLE_SHOT_ID_FIELD = "stableShotId";
export const SHOT_IDENTITY_FIELD = "shotIdentity";

type ShotLike = Record<string, unknown>;

export type ShotDisplayLike = {
  cueCode?: unknown;
  shotKey?: unknown;
  shotNo?: unknown;
};

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

function safeShotNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function displayCandidate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).trim();
  if (!text || /^SH0*\d+$/i.test(text)) return "";
  return text;
}

function promptCandidate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
}

/**
 * The editor keeps legacy SH keys for stable storage and ChatCut mapping, but
 * the user should only see the story's cue code. Legacy-only stories fall back
 * to a neutral numeric label instead of exposing a second numbering system.
 */
export function displayShotCode(shot: ShotDisplayLike): string {
  const cueCode = displayCandidate(shot.cueCode);
  if (cueCode) return cueCode;

  const shotKey = displayCandidate(shot.shotKey);
  if (shotKey) return shotKey;

  const shotNo =
    safeShotNumber(shot.shotNo) ??
    shotNumberFromIdentity(shot.cueCode) ??
    shotNumberFromIdentity(shot.shotKey);
  return shotNo == null ? "未编号镜头" : String(shotNo).padStart(2, "0");
}

/**
 * Model prompts need an unambiguous shot reference. Prefer the story cue code,
 * but keep legacy SH labels when a story has not migrated to cue codes yet.
 */
export function promptShotCode(shot: ShotDisplayLike): string {
  const cueCode = promptCandidate(shot.cueCode);
  if (cueCode) return cueCode;

  const shotKey = promptCandidate(shot.shotKey);
  if (shotKey) return shotKey;

  const shotNo = safeShotNumber(shot.shotNo);
  return shotNo == null
    ? "unnumbered-shot"
    : `SH${String(shotNo).padStart(2, "0")}`;
}

export function shotNumberFromIdentity(value: unknown): number | null {
  const normalized = normalizeShotIdentity(value);
  if (!normalized) return null;

  const canonical = canonicalizeShotNo(normalized);
  if (canonical) return Number(canonical.slice(2));

  const patterns = [
    /(?:^|[-_:])sh[-_:]?0*(\d+)(?:$|[-_:])/,
    /(?:^|[-_:])s[-_:]?0*(\d+)(?:$|[-_:])/,
    /(?:^|[-_:])shot[-_:]?0*(\d+)(?:$|[-_:])/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const shotNo = match ? Number(match[1]) : NaN;
    if (Number.isSafeInteger(shotNo) && shotNo > 0) return shotNo;
  }
  return null;
}

export function shotIdentityAliasesForNumber(shotNo: number): string[] {
  const safe = safeShotNumber(shotNo);
  if (safe == null) return [];
  const padded = String(safe).padStart(2, "0");
  return [
    `genji-s${padded}`,
    `legacy-sh${padded}`,
    `legacy-sh${padded}-shot`,
    `shot-${padded}`,
    `sh${padded}`,
  ];
}

function isManualShotIdentity(value: string | null): boolean {
  return Boolean(value && /^manual[-_:]sh[-_:]?0*\d+(?:$|[-_:])/.test(value));
}

export function shotIdentityMatchKeys(
  identity: unknown,
  shotNo?: number | null
): string[] {
  const keys = new Set<string>();
  const normalized = normalizeShotIdentity(identity);
  if (normalized) keys.add(normalized);
  const inferredShotNo = isManualShotIdentity(normalized)
    ? null
    : shotNumberFromIdentity(normalized);
  const fallbackShotNo = normalized ? null : safeShotNumber(shotNo);
  const resolvedShotNo = inferredShotNo ?? fallbackShotNo;
  if (resolvedShotNo != null) {
    for (const alias of shotIdentityAliasesForNumber(resolvedShotNo)) {
      keys.add(alias);
    }
  }
  return Array.from(keys);
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
