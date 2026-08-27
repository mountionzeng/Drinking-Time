import {
  normalizeStoryArtDirection,
  type StoryArtDirection,
  visualAssetDraftReferencesOf,
} from "./artDirection";
import { normalizeShotIdentity } from "./shotIdentity";

export const STORY_VISUAL_ASSETS_SCHEMA_VERSION = 2 as const;
export const STORY_VISUAL_ASSETS_LEGACY_MIGRATION_VERSION = 1 as const;
export const MAX_VISUAL_ASSET_OPERATION_RECEIPTS = 100;
export const VISUAL_ASSET_IMAGE_SHOT_NO = "VISUAL-ASSET" as const;

export const VISUAL_ASSET_KINDS = ["character", "pet", "scene", "style"] as const;
export type VisualAssetKind = (typeof VISUAL_ASSET_KINDS)[number];
export const VISUAL_ASSET_REFERENCE_ROLES = [
  "character-identity",
  "pet-identity",
  "scene-space",
  "style-language",
] as const;
export type VisualAssetReferenceRole =
  (typeof VISUAL_ASSET_REFERENCE_ROLES)[number];

export type VisualAssetReference = {
  imageId: number;
  role: VisualAssetReferenceRole;
};
export type VisualAssetVersionStatus =
  | "draft"
  | "generating_views"
  | "review"
  | "locked"
  | "superseded";
export type VisualAssetViewStatus = "pending" | "pass" | "fail" | "unknown";

export type CharacterVisualAssetFacts = {
  kind: "character";
  face: string;
  hair: string;
  outfit: string;
  accessories: string[];
};

export type PetVisualAssetFacts = {
  kind: "pet";
  species: string;
  face: string;
  coat: string;
  body: string;
  distinctiveFeatures: string[];
  accessories: string[];
};

export type SceneVisualAssetFacts = {
  kind: "scene";
  geometry: string[];
  materials: string[];
  fixedProps: string[];
};

export type StyleVisualAssetFacts = {
  kind: "style";
  medium: string[];
  brushwork: string[];
  formLanguage: string[];
  colorLanguage: string[];
  forbidden: string[];
};

export type VisualAssetFixedFacts =
  | CharacterVisualAssetFacts
  | PetVisualAssetFacts
  | SceneVisualAssetFacts
  | StyleVisualAssetFacts;

export type CharacterVisualAssetViewRole =
  | "front"
  | "profile"
  | "back"
  | "identity-detail";
export type SceneVisualAssetViewRole =
  | "establishing"
  | "reverse"
  | "side"
  | "top";
export type StyleVisualAssetViewRole =
  | "character-sample"
  | "scene-sample"
  | "object-sample"
  | "closeup-sample";
export type VisualAssetViewRole =
  | CharacterVisualAssetViewRole
  | SceneVisualAssetViewRole
  | StyleVisualAssetViewRole;

export type VisualAssetConflict = {
  field: string;
  descriptions: string[];
  sourceImageIds: number[];
  resolution?: string;
};

export type VisualAssetView = {
  id: string;
  role: VisualAssetViewRole;
  imageId: number;
  status: VisualAssetViewStatus;
  failureReason?: string;
};

export type VisualAssetVersion = {
  id: string;
  version: number;
  status: VisualAssetVersionStatus;
  references: VisualAssetReference[];
  /** Old references without a durable image row remain evidence only. */
  legacyReferenceIds: string[];
  fixedFacts: VisualAssetFixedFacts;
  allowedVariations: string[];
  conflicts: VisualAssetConflict[];
  boardImageId?: number;
  views: VisualAssetView[];
  createdAt: number;
  lockedAt?: number;
};

export type StoryVisualAsset = {
  id: string;
  kind: VisualAssetKind;
  name: string;
  versions: VisualAssetVersion[];
  currentVersionId?: string;
  createdAt: number;
  updatedAt: number;
};

export type VisualAssetVersionRef = {
  assetId: string;
  versionId: string;
};

export type ShotVisualAssetSelection = {
  character?: VisualAssetVersionRef;
  pet?: VisualAssetVersionRef;
  scene?: VisualAssetVersionRef;
  style?: VisualAssetVersionRef;
};

export type ShotVisualAssetBindingProposal = {
  id: string;
  stableShotId: string;
  selections: ShotVisualAssetSelection;
  rationale: Partial<Record<VisualAssetKind, string>>;
  conflicts: VisualAssetBindingConflict[];
  status: "pending" | "confirmed" | "rejected" | "stale";
  assetSetFingerprint?: string;
  createdAt: number;
};

export type VisualAssetBindingConflict = {
  kind: VisualAssetKind;
  field: string;
  assetFact: string;
  shotRequest: string;
};

export type ShotVisualAssetBinding = ShotVisualAssetSelection & {
  stableShotId: string;
  confirmedAt: number;
  sourceProposalId?: string;
};

export type VisualAssetOperationReceipt = {
  token: string;
  kind: "analyze" | "generate_views" | "lock" | "bind" | "generate_shot";
  status: "claimed" | "submitted" | "succeeded" | "failed" | "unknown";
  createdAt: number;
  updatedAt: number;
  providerTaskId?: string;
  inputHash?: string;
  resultId?: string;
  error?: string;
};

/**
 * 找回同一份生成输入最近一次未完成的整板任务。
 *
 * 视角回执使用 `${boardToken}:view:${role}`；恢复时必须继续使用原 boardToken，
 * 服务端才能复用已经付费成功的视角并只补失败部分。
 */
export function recoverableVisualAssetBoardOperationToken(
  operations: VisualAssetOperationReceipt[],
  inputHash: string
): string | undefined {
  return [...operations]
    .filter(
      receipt =>
        receipt.kind === "generate_views" &&
        receipt.inputHash === inputHash &&
        !receipt.token.includes(":view:") &&
        (receipt.status === "failed" || receipt.status === "unknown")
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .find(receipt =>
      operations.some(
        child =>
          child.inputHash === inputHash &&
          child.token.startsWith(`${receipt.token}:view:`)
      )
    )?.token;
}

/** Recover a failed single-view retry without buying that view again after reload. */
export function recoverableVisualAssetViewOperationToken(
  operations: VisualAssetOperationReceipt[],
  inputHash: string,
  role: VisualAssetViewRole
): string | undefined {
  return [...operations]
    .filter(
      receipt =>
        receipt.kind === "generate_views" &&
        receipt.inputHash === inputHash &&
        !receipt.token.includes(":view:") &&
        (receipt.status === "failed" || receipt.status === "unknown")
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .find(receipt =>
      operations.some(
        child =>
          child.token === `${receipt.token}:view:${role}` &&
          child.inputHash === inputHash
      )
    )?.token;
}

export type StoryVisualAssets = {
  schemaVersion: typeof STORY_VISUAL_ASSETS_SCHEMA_VERSION;
  legacyMigrationVersion: number;
  assets: StoryVisualAsset[];
  proposals: ShotVisualAssetBindingProposal[];
  bindings: ShotVisualAssetBinding[];
  operations: VisualAssetOperationReceipt[];
};

const REQUIRED_VIEW_ROLES: Record<VisualAssetKind, VisualAssetViewRole[]> = {
  character: ["front", "profile", "back", "identity-detail"],
  pet: ["front", "profile", "back", "identity-detail"],
  scene: ["establishing", "reverse", "side", "top"],
  style: [
    "character-sample",
    "scene-sample",
    "object-sample",
    "closeup-sample",
  ],
};

const REFERENCE_ROLE_BY_KIND: Record<VisualAssetKind, VisualAssetReferenceRole> = {
  character: "character-identity",
  pet: "pet-identity",
  scene: "scene-space",
  style: "style-language",
};

export function visualAssetReferenceRoleFor(
  kind: VisualAssetKind
): VisualAssetReferenceRole {
  return REFERENCE_ROLE_BY_KIND[kind];
}

export function requiredVisualAssetViewRoles(
  kind: VisualAssetKind
): VisualAssetViewRole[] {
  return [...REQUIRED_VIEW_ROLES[kind]];
}

export function emptyStoryVisualAssets(): StoryVisualAssets {
  return {
    schemaVersion: STORY_VISUAL_ASSETS_SCHEMA_VERSION,
    legacyMigrationVersion: 0,
    assets: [],
    proposals: [],
    bindings: [],
    operations: [],
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown, max = 6000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanId(value: unknown): string {
  return cleanString(value, 160);
}

function cleanTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

function cleanPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function cleanStringList(value: unknown, maxItems = 100): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(item => cleanString(item)).filter(Boolean))
  ).slice(0, maxItems);
}

function cleanImageIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map(cleanPositiveInteger)
        .filter((item): item is number => item !== undefined)
    )
  ).slice(0, 100);
}

function normalizeReferences(
  value: unknown,
  kind: VisualAssetKind,
  legacyImageIds: unknown
): VisualAssetReference[] {
  const expectedRole = visualAssetReferenceRoleFor(kind);
  if (!Array.isArray(value)) {
    return cleanImageIds(legacyImageIds).slice(0, 12).map(imageId => ({
      imageId,
      role: expectedRole,
    }));
  }
  const seen = new Set<number>();
  return value.flatMap(item => {
    const obj = recordOf(item);
    const imageId = cleanPositiveInteger(obj.imageId);
    if (!imageId || obj.role !== expectedRole || seen.has(imageId)) return [];
    seen.add(imageId);
    return [{ imageId, role: expectedRole }];
  }).slice(0, 12);
}

function normalizeKind(value: unknown): VisualAssetKind | undefined {
  return VISUAL_ASSET_KINDS.includes(value as VisualAssetKind)
    ? (value as VisualAssetKind)
    : undefined;
}

export function emptyVisualAssetFacts(
  kind: VisualAssetKind
): VisualAssetFixedFacts {
  if (kind === "character") {
    return { kind, face: "", hair: "", outfit: "", accessories: [] };
  }
  if (kind === "pet") {
    return {
      kind,
      species: "",
      face: "",
      coat: "",
      body: "",
      distinctiveFeatures: [],
      accessories: [],
    };
  }
  if (kind === "scene") {
    return { kind, geometry: [], materials: [], fixedProps: [] };
  }
  return {
    kind,
    medium: [],
    brushwork: [],
    formLanguage: [],
    colorLanguage: [],
    forbidden: [],
  };
}

function normalizeFacts(
  value: unknown,
  kind: VisualAssetKind
): VisualAssetFixedFacts {
  const obj = recordOf(value);
  if (obj.kind !== kind) return emptyVisualAssetFacts(kind);
  if (kind === "character") {
    return {
      kind,
      face: cleanString(obj.face),
      hair: cleanString(obj.hair),
      outfit: cleanString(obj.outfit),
      accessories: cleanStringList(obj.accessories),
    };
  }
  if (kind === "pet") {
    return {
      kind,
      species: cleanString(obj.species),
      face: cleanString(obj.face),
      coat: cleanString(obj.coat),
      body: cleanString(obj.body),
      distinctiveFeatures: cleanStringList(obj.distinctiveFeatures),
      accessories: cleanStringList(obj.accessories),
    };
  }
  if (kind === "scene") {
    return {
      kind,
      geometry: cleanStringList(obj.geometry),
      materials: cleanStringList(obj.materials),
      fixedProps: cleanStringList(obj.fixedProps),
    };
  }
  return {
    kind,
    medium: cleanStringList(obj.medium),
    brushwork: cleanStringList(obj.brushwork),
    formLanguage: cleanStringList(obj.formLanguage),
    colorLanguage: cleanStringList(obj.colorLanguage),
    forbidden: cleanStringList(obj.forbidden),
  };
}

export function visualAssetFixedFactsAreComplete(facts: VisualAssetFixedFacts): boolean {
  if (facts.kind === "character") {
    return Boolean(facts.face && facts.hair && facts.outfit);
  }
  if (facts.kind === "pet") {
    return Boolean(facts.species && facts.face && facts.coat && facts.body);
  }
  if (facts.kind === "scene") {
    return facts.geometry.length > 0 && facts.materials.length > 0;
  }
  return (
    facts.medium.length > 0 &&
    facts.brushwork.length > 0 &&
    facts.formLanguage.length > 0 &&
    facts.colorLanguage.length > 0
  );
}

function normalizeConflict(value: unknown): VisualAssetConflict | undefined {
  const obj = recordOf(value);
  const field = cleanString(obj.field, 160);
  const descriptions = cleanStringList(obj.descriptions, 20);
  if (!field || descriptions.length < 2) return undefined;
  const resolution = cleanString(obj.resolution);
  return {
    field,
    descriptions,
    sourceImageIds: cleanImageIds(obj.sourceImageIds),
    ...(resolution ? { resolution } : {}),
  };
}

function normalizeView(
  value: unknown,
  kind: VisualAssetKind
): VisualAssetView | undefined {
  const obj = recordOf(value);
  const id = cleanId(obj.id);
  const imageId = cleanPositiveInteger(obj.imageId);
  const allowedRoles = REQUIRED_VIEW_ROLES[kind];
  const role = allowedRoles.includes(obj.role as VisualAssetViewRole)
    ? (obj.role as VisualAssetViewRole)
    : undefined;
  if (!id || !imageId || !role) return undefined;
  const status: VisualAssetViewStatus =
    obj.status === "pass" ||
    obj.status === "fail" ||
    obj.status === "unknown"
      ? obj.status
      : "pending";
  const failureReason = cleanString(obj.failureReason);
  return {
    id,
    role,
    imageId,
    status,
    ...(failureReason ? { failureReason } : {}),
  };
}

function viewsAreComplete(
  kind: VisualAssetKind,
  views: VisualAssetView[]
): boolean {
  return REQUIRED_VIEW_ROLES[kind].every(role =>
    views.some(view => view.role === role && view.status === "pass")
  );
}

export function isVisualAssetVersionLockable(
  kind: VisualAssetKind,
  version: Pick<
    VisualAssetVersion,
    "fixedFacts" | "conflicts" | "boardImageId" | "views"
  >
): boolean {
  return (
    version.fixedFacts.kind === kind &&
    visualAssetFixedFactsAreComplete(version.fixedFacts) &&
    version.conflicts.every(conflict => Boolean(conflict.resolution)) &&
    Boolean(version.boardImageId) &&
    viewsAreComplete(kind, version.views)
  );
}

function normalizeVersion(
  value: unknown,
  kind: VisualAssetKind
): VisualAssetVersion | undefined {
  const obj = recordOf(value);
  const id = cleanId(obj.id);
  const versionNumber = cleanPositiveInteger(obj.version);
  if (!id || !versionNumber) return undefined;
  const conflicts = Array.isArray(obj.conflicts)
    ? obj.conflicts
        .map(normalizeConflict)
        .filter((item): item is VisualAssetConflict => Boolean(item))
    : [];
  const viewIds = new Set<string>();
  const viewRoles = new Set<VisualAssetViewRole>();
  const views = (Array.isArray(obj.views) ? obj.views : [])
    .map(item => normalizeView(item, kind))
    .filter((item): item is VisualAssetView => {
      if (!item || viewIds.has(item.id) || viewRoles.has(item.role)) return false;
      viewIds.add(item.id);
      viewRoles.add(item.role);
      return true;
    });
  const boardImageId = cleanPositiveInteger(obj.boardImageId);
  const fixedFacts = normalizeFacts(obj.fixedFacts, kind);
  const requestedStatus: VisualAssetVersionStatus =
    obj.status === "generating_views" ||
    obj.status === "review" ||
    obj.status === "locked" ||
    obj.status === "superseded"
      ? obj.status
      : "draft";
  const lockable = isVisualAssetVersionLockable(kind, {
    fixedFacts,
    conflicts,
    boardImageId,
    views,
  });
  const status: VisualAssetVersionStatus =
    (requestedStatus === "locked" || requestedStatus === "superseded") &&
    !lockable
      ? views.length > 0
        ? "review"
        : "draft"
      : requestedStatus;
  const lockedAt = cleanTimestamp(obj.lockedAt);
  return {
    id,
    version: versionNumber,
    status,
    references: normalizeReferences(obj.references, kind, obj.referenceImageIds),
    legacyReferenceIds: cleanStringList(obj.legacyReferenceIds),
    fixedFacts,
    allowedVariations: cleanStringList(obj.allowedVariations),
    conflicts,
    ...(boardImageId ? { boardImageId } : {}),
    views,
    createdAt: cleanTimestamp(obj.createdAt),
    ...((status === "locked" || status === "superseded") && lockedAt
      ? { lockedAt }
      : {}),
  };
}

function normalizeAsset(value: unknown): StoryVisualAsset | undefined {
  const obj = recordOf(value);
  const id = cleanId(obj.id);
  const kind = normalizeKind(obj.kind);
  const name = cleanString(obj.name, 240);
  if (!id || !kind || !name) return undefined;
  const versionIds = new Set<string>();
  const versionNumbers = new Set<number>();
  const versions = (Array.isArray(obj.versions) ? obj.versions : [])
    .map(item => normalizeVersion(item, kind))
    .filter((item): item is VisualAssetVersion => {
      if (
        !item ||
        versionIds.has(item.id) ||
        versionNumbers.has(item.version)
      ) {
        return false;
      }
      versionIds.add(item.id);
      versionNumbers.add(item.version);
      return true;
    });
  const requestedCurrentVersionId = cleanId(obj.currentVersionId);
  const currentVersion = versions.find(
    version =>
      version.id === requestedCurrentVersionId && version.status === "locked"
  );
  return {
    id,
    kind,
    name,
    versions,
    ...(currentVersion ? { currentVersionId: currentVersion.id } : {}),
    createdAt: cleanTimestamp(obj.createdAt),
    updatedAt: cleanTimestamp(obj.updatedAt),
  };
}

function versionRefIsValid(
  value: unknown,
  expectedKind: VisualAssetKind,
  assetsById: Map<string, StoryVisualAsset>
): value is VisualAssetVersionRef {
  const obj = recordOf(value);
  const assetId = cleanId(obj.assetId);
  const versionId = cleanId(obj.versionId);
  const asset = assetsById.get(assetId);
  if (!asset || asset.kind !== expectedKind) return false;
  return asset.versions.some(
    version =>
      version.id === versionId &&
      (version.status === "locked" || version.status === "superseded")
  );
}

function normalizeSelection(
  value: unknown,
  assetsById: Map<string, StoryVisualAsset>
): ShotVisualAssetSelection {
  const obj = recordOf(value);
  const selection: ShotVisualAssetSelection = {};
  for (const kind of VISUAL_ASSET_KINDS) {
    if (versionRefIsValid(obj[kind], kind, assetsById)) {
      selection[kind] = {
        assetId: cleanId(recordOf(obj[kind]).assetId),
        versionId: cleanId(recordOf(obj[kind]).versionId),
      };
    }
  }
  return selection;
}

function hasSelection(value: ShotVisualAssetSelection): boolean {
  return VISUAL_ASSET_KINDS.some(kind => Boolean(value[kind]));
}

function normalizeBinding(
  value: unknown,
  assetsById: Map<string, StoryVisualAsset>
): ShotVisualAssetBinding | undefined {
  const obj = recordOf(value);
  const stableShotId = normalizeShotIdentity(cleanString(obj.stableShotId, 96));
  const selection = normalizeSelection(obj, assetsById);
  if (!stableShotId || !hasSelection(selection)) return undefined;
  const sourceProposalId = cleanId(obj.sourceProposalId);
  return {
    stableShotId,
    ...selection,
    confirmedAt: cleanTimestamp(obj.confirmedAt),
    ...(sourceProposalId ? { sourceProposalId } : {}),
  };
}

function normalizeProposal(
  value: unknown,
  assetsById: Map<string, StoryVisualAsset>
): ShotVisualAssetBindingProposal | undefined {
  const obj = recordOf(value);
  const id = cleanId(obj.id);
  const stableShotId = normalizeShotIdentity(cleanString(obj.stableShotId, 96));
  const selections = normalizeSelection(obj.selections, assetsById);
  if (!id || !stableShotId || !hasSelection(selections)) return undefined;
  const rationaleObj = recordOf(obj.rationale);
  const rationale: Partial<Record<VisualAssetKind, string>> = {};
  for (const kind of VISUAL_ASSET_KINDS) {
    const text = cleanString(rationaleObj[kind], 1000);
    if (text) rationale[kind] = text;
  }
  const status =
    obj.status === "confirmed" ||
    obj.status === "rejected" ||
    obj.status === "stale"
      ? obj.status
      : "pending";
  const assetSetFingerprint = cleanString(obj.assetSetFingerprint, 240);
  const conflicts = (Array.isArray(obj.conflicts) ? obj.conflicts : []).flatMap(
    value => {
      const conflict = recordOf(value);
      const kind = normalizeKind(conflict.kind);
      const field = cleanString(conflict.field, 160);
      const assetFact = cleanString(conflict.assetFact, 1000);
      const shotRequest = cleanString(conflict.shotRequest, 1000);
      return kind && field && assetFact && shotRequest
        ? [{ kind, field, assetFact, shotRequest }]
        : [];
    }
  );
  return {
    id,
    stableShotId,
    selections,
    rationale,
    conflicts,
    status,
    ...(assetSetFingerprint ? { assetSetFingerprint } : {}),
    createdAt: cleanTimestamp(obj.createdAt),
  };
}

/** Stable fingerprint used to invalidate proposals after an asset-version change. */
export function visualAssetSetFingerprint(assets: StoryVisualAsset[]): string {
  const source = assets
    .map(asset => `${asset.id}:${asset.kind}:${asset.currentVersionId ?? ""}`)
    .sort()
    .join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `vas-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeOperation(value: unknown): VisualAssetOperationReceipt | undefined {
  const obj = recordOf(value);
  const token = cleanId(obj.token);
  const kinds: VisualAssetOperationReceipt["kind"][] = [
    "analyze",
    "generate_views",
    "lock",
    "bind",
    "generate_shot",
  ];
  if (!token || !kinds.includes(obj.kind as VisualAssetOperationReceipt["kind"])) {
    return undefined;
  }
  const status: VisualAssetOperationReceipt["status"] =
    obj.status === "submitted" ||
    obj.status === "succeeded" ||
    obj.status === "failed" ||
    obj.status === "unknown"
      ? obj.status
      : "claimed";
  const optional = {
    providerTaskId: cleanString(obj.providerTaskId, 240),
    inputHash: cleanString(obj.inputHash, 240),
    resultId: cleanString(obj.resultId, 240),
    error: cleanString(obj.error, 2000),
  };
  return {
    token,
    kind: obj.kind as VisualAssetOperationReceipt["kind"],
    status,
    createdAt: cleanTimestamp(obj.createdAt),
    updatedAt: cleanTimestamp(obj.updatedAt),
    ...(optional.providerTaskId ? { providerTaskId: optional.providerTaskId } : {}),
    ...(optional.inputHash ? { inputHash: optional.inputHash } : {}),
    ...(optional.resultId ? { resultId: optional.resultId } : {}),
    ...(optional.error ? { error: optional.error } : {}),
  };
}

function legacyDraftVersion(input: {
  id: string;
  kind: VisualAssetKind;
  imageIds?: number[];
  referenceIds?: string[];
  fixedFacts?: VisualAssetFixedFacts;
  createdAt: number;
}): VisualAssetVersion {
  return {
    id: `${input.id}-v1`,
    version: 1,
    status: "draft",
    references: (input.imageIds ?? []).map(imageId => ({
      imageId,
      role: visualAssetReferenceRoleFor(input.kind),
    })),
    legacyReferenceIds: input.referenceIds ?? [],
    fixedFacts: input.fixedFacts ?? emptyVisualAssetFacts(input.kind),
    allowedVariations: ["景别", "机位", "动作", "表情", "光线"],
    conflicts: [],
    views: [],
    createdAt: input.createdAt,
  };
}

function legacyDraftAssets(value: unknown): StoryVisualAsset[] {
  const direction = normalizeStoryArtDirection(value) as StoryArtDirection;
  const draftReferences = visualAssetDraftReferencesOf(direction);
  const createdAt = direction.updatedAt;
  const assets: StoryVisualAsset[] = [];
  const character = draftReferences.character;
  if (character) {
    const id = "legacy-character";
    assets.push({
      id,
      kind: "character",
      name: character.label || "旧人物参考",
      versions: [
        legacyDraftVersion({
          id,
          kind: "character",
          imageIds: character.assetId ? [character.assetId] : [],
          referenceIds: [character.id],
          createdAt,
        }),
      ],
      createdAt,
      updatedAt: createdAt,
    });
  }
  draftReferences.scenes.forEach((reference, index) => {
      const id = `legacy-scene-${index + 1}`;
      assets.push({
        id,
        kind: "scene",
        name: reference.label || `旧场景参考 ${index + 1}`,
        versions: [
          legacyDraftVersion({
            id,
            kind: "scene",
            imageIds: reference.assetId ? [reference.assetId] : [],
            referenceIds: [reference.id],
            createdAt,
          }),
        ],
        createdAt,
        updatedAt: createdAt,
      });
    });
  const styleReferences = draftReferences.styles;
  if (direction.recipe || styleReferences.length > 0) {
    const id = "legacy-style";
    const recipe = direction.recipe;
    assets.push({
      id,
      kind: "style",
      name: "旧故事美术风格",
      versions: [
        legacyDraftVersion({
          id,
          kind: "style",
          imageIds: styleReferences.flatMap(reference =>
            reference.assetId ? [reference.assetId] : []
          ),
          referenceIds: styleReferences.map(reference => reference.id),
          fixedFacts: {
            kind: "style",
            medium: recipe?.style ?? [],
            brushwork: recipe?.material ?? [],
            formLanguage: recipe?.composition ?? [],
            colorLanguage: recipe?.palette ?? [],
            forbidden: recipe?.negative ?? [],
          },
          createdAt,
        }),
      ],
      createdAt,
      updatedAt: createdAt,
    });
  }
  return assets;
}

export function findVisualAssetVersion(
  aggregate: StoryVisualAssets,
  ref: VisualAssetVersionRef
): { asset: StoryVisualAsset; version: VisualAssetVersion } | undefined {
  const asset = aggregate.assets.find(item => item.id === ref.assetId);
  const version = asset?.versions.find(item => item.id === ref.versionId);
  return asset && version ? { asset, version } : undefined;
}

export function normalizeStoryVisualAssets(
  value: unknown,
  options: { legacyArtDirection?: unknown } = {}
): StoryVisualAssets {
  const obj = recordOf(value);
  const assetIds = new Set<string>();
  const assets = (Array.isArray(obj.assets) ? obj.assets : [])
    .map(normalizeAsset)
    .filter((item): item is StoryVisualAsset => {
      if (!item || assetIds.has(item.id)) return false;
      assetIds.add(item.id);
      return true;
    });
  const requestedMigrationVersion =
    typeof obj.legacyMigrationVersion === "number" &&
    Number.isInteger(obj.legacyMigrationVersion) &&
    obj.legacyMigrationVersion >= 0
      ? obj.legacyMigrationVersion
      : 0;
  if (
    requestedMigrationVersion < STORY_VISUAL_ASSETS_LEGACY_MIGRATION_VERSION &&
    options.legacyArtDirection !== undefined
  ) {
    for (const asset of legacyDraftAssets(options.legacyArtDirection)) {
      if (!assetIds.has(asset.id)) {
        assets.push(asset);
        assetIds.add(asset.id);
      }
    }
  }
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  const bindingShots = new Set<string>();
  const bindings = (Array.isArray(obj.bindings) ? obj.bindings : [])
    .map(item => normalizeBinding(item, assetsById))
    .filter((item): item is ShotVisualAssetBinding => {
      if (!item || bindingShots.has(item.stableShotId)) return false;
      bindingShots.add(item.stableShotId);
      return true;
    });
  const proposalIds = new Set<string>();
  const proposals = (Array.isArray(obj.proposals) ? obj.proposals : [])
    .map(item => normalizeProposal(item, assetsById))
    .filter((item): item is ShotVisualAssetBindingProposal => {
      if (!item || proposalIds.has(item.id)) return false;
      proposalIds.add(item.id);
      return true;
    });
  const operationTokens = new Set<string>();
  const operations = (Array.isArray(obj.operations) ? obj.operations : [])
    .map(normalizeOperation)
    .filter((item): item is VisualAssetOperationReceipt => {
      if (!item || operationTokens.has(item.token)) return false;
      operationTokens.add(item.token);
      return true;
    })
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_VISUAL_ASSET_OPERATION_RECEIPTS);
  return {
    schemaVersion: STORY_VISUAL_ASSETS_SCHEMA_VERSION,
    legacyMigrationVersion:
      options.legacyArtDirection !== undefined
        ? STORY_VISUAL_ASSETS_LEGACY_MIGRATION_VERSION
        : requestedMigrationVersion,
    assets,
    proposals,
    bindings,
    operations,
  };
}
