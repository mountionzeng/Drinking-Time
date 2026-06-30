export type ImageAssetKind = "story_frame" | "style_reference";

export type ImageAssetStatus = "selected" | "rejected" | "pending";

export type ImageAssetAvailability = "available" | "missing" | "unknown";

export type ImageAssetAssignment = "shot" | "unassigned" | "style_reference";
export type PromptAssetFreshness = "current" | "stale" | "legacy";

export type ImageAsset = {
  id: number;
  projectId: number | null;
  storyId: number | null;
  userId: number | null;
  rawShotNo: string | null;
  canonicalShotNo: string | null;
  shotIdentity: string | null;
  imageKey: string | null;
  imageUrl: string;
  prompt: string | null;
  promptCompilationId: number | null;
  promptFreshness: PromptAssetFreshness;
  generationType: "generate" | "initial" | "inpaint";
  parentImageId: number | null;
  isCurrent: boolean;
  maskKey: string | null;
  createdAt: string;
  kind: ImageAssetKind;
  status: ImageAssetStatus;
  assignment: ImageAssetAssignment;
  availability: ImageAssetAvailability;
  isPrimary: boolean;
  selectionSource: "explicit" | "legacy" | "none";
  selectedAt: string | null;
};

const ART_DIRECTION_PATTERN = /^ART(?:-|$)/i;
const NUMERIC_SHOT_PATTERN = /^(?:SH)?0*(\d+)$/i;

export function isStyleReferenceShotNo(
  shotNo: string | null | undefined
): boolean {
  return (
    typeof shotNo === "string" && ART_DIRECTION_PATTERN.test(shotNo.trim())
  );
}

export function canonicalizeShotNo(
  shotNo: string | number | null | undefined
): string | null {
  if (shotNo == null) return null;
  const value = String(shotNo).trim();
  if (!value || isStyleReferenceShotNo(value)) return null;
  const match = NUMERIC_SHOT_PATTERN.exec(value);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return null;
  return `SH${String(numeric).padStart(2, "0")}`;
}

export function shotNoToMobileNumber(
  shotNo: string | number | null | undefined
): number | undefined {
  const canonical = canonicalizeShotNo(shotNo);
  if (!canonical) return undefined;
  return Number(canonical.slice(2));
}
