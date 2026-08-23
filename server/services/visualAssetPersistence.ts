import { nanoid } from "nanoid";

import type {
  ShotVisualAssetBindingProposal,
  ShotVisualAssetSelection,
  StoryVisualAsset,
  StoryVisualAssets,
  VisualAssetConflict,
  VisualAssetFixedFacts,
  VisualAssetKind,
  VisualAssetOperationReceipt,
  VisualAssetVersion,
  VisualAssetView,
  VisualAssetViewRole,
  VisualAssetViewStatus,
} from "../../shared/visualAssets";
import {
  emptyStoryVisualAssets,
  isVisualAssetVersionLockable,
  requiredVisualAssetViewRoles,
  normalizeStoryVisualAssets,
  visualAssetSetFingerprint,
} from "../../shared/visualAssets";
import { normalizeShotIdentity } from "../../shared/shotIdentity";
import { getGeneratedImageById, getStoryById } from "../db";
import {
  persistPreparedStoryBody,
  type PersistedStory,
  StoryBodyOwnershipError,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import { getStoryRevision, prepareStoryBody } from "./storySync";

export class VisualAssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisualAssetValidationError";
  }
}

export class VisualAssetImageOwnershipError extends Error {
  constructor(readonly imageId: number) {
    super(`Image ${imageId} is not an available image owned by this Story`);
    this.name = "VisualAssetImageOwnershipError";
  }
}

export class VisualAssetNotFoundError extends Error {
  constructor(readonly assetId: string, readonly versionId?: string) {
    super(
      versionId
        ? `Visual asset ${assetId} version ${versionId} was not found`
        : `Visual asset ${assetId} was not found`
    );
    this.name = "VisualAssetNotFoundError";
  }
}

export class VisualAssetNotLockableError extends Error {
  constructor(readonly assetId: string, readonly versionId: string) {
    super(`Visual asset ${assetId} version ${versionId} is not lockable`);
    this.name = "VisualAssetNotLockableError";
  }
}

export type VisualAssetMutationResult = {
  story: PersistedStory;
  aggregate: StoryVisualAssets;
  replayed: boolean;
  resultId?: string;
};

type StoryRecord = Record<string, unknown>;

function storyBody(story: { body: unknown }): StoryRecord {
  return story.body && typeof story.body === "object" && !Array.isArray(story.body)
    ? (story.body as StoryRecord)
    : {};
}

export function visualAssetsFromStory(story: { body: unknown }): StoryVisualAssets {
  const body = storyBody(story);
  return normalizeStoryVisualAssets(body.visualAssets, {
    legacyArtDirection: body.artDirection ?? {},
  });
}

export async function getStoryVisualAssets(input: {
  storyId: number;
  userId: number;
}): Promise<{ story: PersistedStory; aggregate: StoryVisualAssets }> {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new StoryBodyOwnershipError(input.storyId);
  return { story, aggregate: visualAssetsFromStory(story) };
}

function assertOperationToken(value: string): string {
  const token = value.trim();
  if (!token || token.length > 160) {
    throw new VisualAssetValidationError("operation token 不合法");
  }
  return token;
}

function operationReceipt(input: {
  token: string;
  kind: VisualAssetOperationReceipt["kind"];
  now: number;
  resultId?: string;
}): VisualAssetOperationReceipt {
  return {
    token: input.token,
    kind: input.kind,
    status: "succeeded",
    createdAt: input.now,
    updatedAt: input.now,
    ...(input.resultId ? { resultId: input.resultId } : {}),
  };
}

async function mutateVisualAssets(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  operationKind: VisualAssetOperationReceipt["kind"];
  now?: number;
  mutate: (
    aggregate: StoryVisualAssets,
    story: PersistedStory,
    now: number
  ) =>
    | { aggregate: StoryVisualAssets; resultId?: string }
    | Promise<{ aggregate: StoryVisualAssets; resultId?: string }>;
}): Promise<VisualAssetMutationResult> {
  const operationToken = assertOperationToken(input.operationToken);
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new StoryBodyOwnershipError(input.storyId);
  const aggregate = visualAssetsFromStory(story);
  const existingReceipt = aggregate.operations.find(
    receipt => receipt.token === operationToken
  );
  if (existingReceipt) {
    return {
      story,
      aggregate,
      replayed: true,
      ...(existingReceipt.resultId ? { resultId: existingReceipt.resultId } : {}),
    };
  }
  const actualRevision = getStoryRevision(story.body);
  if (actualRevision !== input.expectedRevision) {
    throw new StoryBodyRevisionConflictError(
      input.storyId,
      input.expectedRevision,
      story
    );
  }
  const now = input.now ?? Date.now();
  const mutation = await input.mutate(aggregate, story, now);
  const nextAggregate = normalizeStoryVisualAssets({
    ...mutation.aggregate,
    legacyMigrationVersion: 1,
    operations: [
      ...mutation.aggregate.operations,
      operationReceipt({
        token: operationToken,
        kind: input.operationKind,
        now,
        resultId: mutation.resultId,
      }),
    ],
  });
  const body = storyBody(story);
  const nextBody = prepareStoryBody(
    { ...body, visualAssets: nextAggregate },
    actualRevision + 1
  );
  const saved = await persistPreparedStoryBody({
    storyId: input.storyId,
    userId: input.userId,
    expectedRevision: actualRevision,
    body: nextBody,
  });
  return {
    story: saved,
    aggregate: nextAggregate,
    replayed: false,
    ...(mutation.resultId ? { resultId: mutation.resultId } : {}),
  };
}

async function assertOwnedReferenceImages(input: {
  storyId: number;
  userId: number;
  imageIds: number[];
}): Promise<number[]> {
  const imageIds = Array.from(new Set(input.imageIds));
  if (imageIds.length === 0 || imageIds.length > 12) {
    throw new VisualAssetValidationError("参考图数量必须为 1–12 张");
  }
  for (const imageId of imageIds) {
    if (!Number.isInteger(imageId) || imageId <= 0) {
      throw new VisualAssetImageOwnershipError(imageId);
    }
    const image = await getGeneratedImageById(imageId);
    if (
      !image ||
      image.storyId !== input.storyId ||
      image.userId !== input.userId ||
      typeof image.imageUrl !== "string" ||
      !image.imageUrl.trim()
    ) {
      throw new VisualAssetImageOwnershipError(imageId);
    }
  }
  return imageIds;
}

function emptyFacts(kind: VisualAssetKind): VisualAssetFixedFacts {
  if (kind === "character") {
    return { kind, face: "", hair: "", outfit: "", accessories: [] };
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

function allowedVariations(kind: VisualAssetKind): string[] {
  return kind === "character"
    ? ["景别", "机位", "动作", "表情", "光线"]
    : kind === "scene"
      ? ["景别", "机位", "人物动作", "光线"]
      : ["主体", "构图", "景别", "光线"];
}

export async function createVisualAssetDraft(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  kind: VisualAssetKind;
  name: string;
  referenceImageIds: number[];
  now?: number;
}): Promise<VisualAssetMutationResult> {
  const name = input.name.trim().slice(0, 240);
  if (!name) throw new VisualAssetValidationError("资产名称不能为空");
  return mutateVisualAssets({
    ...input,
    operationKind: "analyze",
    mutate: async (aggregate, _story, now) => {
      const referenceImageIds = await assertOwnedReferenceImages({
        storyId: input.storyId,
        userId: input.userId,
        imageIds: input.referenceImageIds,
      });
      const assetId = `va_${nanoid(12)}`;
      const versionId = `vav_${nanoid(12)}`;
      const asset: StoryVisualAsset = {
        id: assetId,
        kind: input.kind,
        name,
        versions: [
          {
            id: versionId,
            version: 1,
            status: "draft",
            referenceImageIds,
            legacyReferenceIds: [],
            fixedFacts: emptyFacts(input.kind),
            allowedVariations: allowedVariations(input.kind),
            conflicts: [],
            views: [],
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      return {
        aggregate: { ...aggregate, assets: [...aggregate.assets, asset] },
        resultId: assetId,
      };
    },
  });
}

export async function createVisualAssetVersion(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  referenceImageIds: number[];
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "analyze",
    mutate: async (aggregate, _story, now) => {
      const referenceImageIds = await assertOwnedReferenceImages({
        storyId: input.storyId,
        userId: input.userId,
        imageIds: input.referenceImageIds,
      });
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      if (!asset) throw new VisualAssetNotFoundError(input.assetId);
      const versionId = `vav_${nanoid(12)}`;
      const version = Math.max(0, ...asset.versions.map(item => item.version)) + 1;
      return {
        aggregate: {
          ...aggregate,
          assets: aggregate.assets.map(item =>
            item.id === asset.id
              ? {
                  ...item,
                  versions: [
                    ...item.versions,
                    {
                      id: versionId,
                      version,
                      status: "draft" as const,
                      referenceImageIds,
                      legacyReferenceIds: [],
                      fixedFacts: emptyFacts(item.kind),
                      allowedVariations: allowedVariations(item.kind),
                      conflicts: [],
                      views: [],
                      createdAt: now,
                    },
                  ],
                  updatedAt: now,
                }
              : item
          ),
        },
        resultId: versionId,
      };
    },
  });
}

export async function saveVisualAssetVersionAnalysis(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  versionId: string;
  fixedFacts: VisualAssetFixedFacts;
  allowedVariations: string[];
  conflicts: VisualAssetConflict[];
  boardImageId?: number;
  views: VisualAssetView[];
  operationKind?: VisualAssetOperationReceipt["kind"];
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: input.operationKind ?? "generate_views",
    mutate: async (aggregate, _story, now) => {
      let found = false;
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      if (!asset || !asset.versions.some(item => item.id === input.versionId)) {
        throw new VisualAssetNotFoundError(input.assetId, input.versionId);
      }
      if (asset.kind !== input.fixedFacts.kind) {
        throw new VisualAssetValidationError("固定事实类型与资产类型不一致");
      }
      const outputImageIds = [
        ...(input.boardImageId ? [input.boardImageId] : []),
        ...input.views.map(view => view.imageId),
      ];
      if (outputImageIds.length > 0) {
        await assertOwnedReferenceImages({
          storyId: input.storyId,
          userId: input.userId,
          imageIds: outputImageIds,
        });
      }
      const assets = aggregate.assets.map(asset => {
        if (asset.id !== input.assetId) return asset;
        const versions = asset.versions.map(version => {
          if (version.id !== input.versionId) return version;
          found = true;
          if (version.status === "locked" || version.status === "superseded") {
            throw new VisualAssetValidationError("锁定版本不可原地修改");
          }
          return {
            ...version,
            fixedFacts: input.fixedFacts,
            allowedVariations: input.allowedVariations,
            conflicts: input.conflicts,
            ...(input.boardImageId ? { boardImageId: input.boardImageId } : {}),
            views: input.views,
            status: "review" as const,
          };
        });
        return { ...asset, versions, updatedAt: now };
      });
      if (!found) throw new VisualAssetNotFoundError(input.assetId, input.versionId);
      return {
        aggregate: { ...aggregate, assets },
        resultId: input.versionId,
      };
    },
  });
}

export async function resolveVisualAssetVersionConflicts(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  versionId: string;
  resolutions: Array<{ field: string; resolution: string }>;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "analyze",
    mutate: (aggregate, _story, now) => {
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      const version = asset?.versions.find(item => item.id === input.versionId);
      if (!asset || !version) {
        throw new VisualAssetNotFoundError(input.assetId, input.versionId);
      }
      if (version.status === "locked" || version.status === "superseded") {
        throw new VisualAssetValidationError("锁定版本不可修改冲突裁决");
      }
      // 同一个字段可以有多条冲突（场景分析天然会在 fixedProps 上产出好几条），
      // 所以不能按字段名做 key —— 那样后一条会覆盖前一条，前面的永远匹配不上，
      // 场景和风格资产就彻底裁决不了。改为把每条裁决配给「描述对得上」的那条冲突，
      // 每条裁决只消费一次。
      const pending = input.resolutions.map(item => ({
        field: item.field.trim(),
        resolution: item.resolution.trim(),
        used: false,
      }));
      const conflicts = version.conflicts.map(conflict => {
        const currentFact = (version.fixedFacts as unknown as Record<string, unknown>)[
          conflict.field
        ];
        const allowedCurrentFacts =
          typeof currentFact === "string" ? [currentFact] : [];
        const match = pending.find(
          candidate =>
            !candidate.used &&
            candidate.field === conflict.field &&
            (conflict.descriptions.includes(candidate.resolution) ||
              allowedCurrentFacts.includes(candidate.resolution))
        );
        if (!match) {
          throw new VisualAssetValidationError(`请选择 ${conflict.field} 的权威描述`);
        }
        match.used = true;
        return { ...conflict, resolution: match.resolution };
      });
      const fixedFacts = { ...version.fixedFacts } as unknown as Record<string, unknown>;
      for (const conflict of conflicts) {
        const current = fixedFacts[conflict.field];
        if (!Array.isArray(current)) {
          fixedFacts[conflict.field] = conflict.resolution;
          continue;
        }
        // 数组字段（场景的 geometry/materials/fixedProps、风格的 medium/brushwork…）
        // 一条冲突只针对该字段里有争议的那一点，不是整份事实。
        // 早先这里写成 [resolution]，会把分析出来的整份清单塌成一句图片专属描述，
        // 多条同字段冲突还会互相覆盖 —— 人物资产没暴露是因为它的字段都是字符串。
        const rejected = new Set(
          conflict.descriptions.filter(item => item !== conflict.resolution)
        );
        const kept = current.filter(
          (item): item is string => typeof item === "string" && !rejected.has(item)
        );
        fixedFacts[conflict.field] = kept.includes(conflict.resolution)
          ? kept
          : [...kept, conflict.resolution];
      }
      const assets = aggregate.assets.map(item =>
        item.id !== asset.id
          ? item
          : {
              ...item,
              versions: item.versions.map(candidate =>
                candidate.id !== version.id
                  ? candidate
                  : {
                      ...candidate,
                      fixedFacts: fixedFacts as unknown as VisualAssetFixedFacts,
                      conflicts,
                    }
              ),
              updatedAt: now,
            }
      );
      return {
        aggregate: { ...aggregate, assets },
        resultId: version.id,
      };
    },
  });
}

/**
 * Record a human verdict on canonical views that were already generated.
 *
 * The structure gate runs at generation time, but a person looking at the real
 * pixels is the final authority. This is how a board that was wrongly written as
 * `pass` gets demoted without deleting the paid image evidence: demoting any
 * required role makes the version unlockable again.
 */
export async function recordVisualAssetViewReview(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  versionId: string;
  reviews: Array<{
    role: VisualAssetViewRole;
    status: VisualAssetViewStatus;
    failureReason?: string;
  }>;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "generate_views",
    mutate: (aggregate, _story, now) => {
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      const version = asset?.versions.find(item => item.id === input.versionId);
      if (!asset || !version) {
        throw new VisualAssetNotFoundError(input.assetId, input.versionId);
      }
      if (version.status === "locked" || version.status === "superseded") {
        throw new VisualAssetValidationError("锁定版本不可直接改判视图；请新建版本");
      }
      if (input.reviews.length === 0) {
        throw new VisualAssetValidationError("请至少提交一条视图判定");
      }
      const verdicts = new Map<VisualAssetViewRole, VisualAssetView>();
      for (const review of input.reviews) {
        const view = version.views.find(item => item.role === review.role);
        if (!view) {
          throw new VisualAssetValidationError(`版本中没有 ${review.role} 视图`);
        }
        if (verdicts.has(review.role)) {
          throw new VisualAssetValidationError(`${review.role} 视图重复判定`);
        }
        const reason = review.failureReason?.trim();
        // A non-pass verdict has to say what is wrong, so the UI can show the
        // reason instead of silently blocking the lock button.
        if (review.status !== "pass" && !reason) {
          throw new VisualAssetValidationError(`请说明 ${review.role} 视图不合格的原因`);
        }
        verdicts.set(review.role, {
          ...view,
          status: review.status,
          ...(review.status === "pass" || !reason ? {} : { failureReason: reason }),
        });
      }
      const views = version.views.map(view => verdicts.get(view.role) ?? view);
      const assets = aggregate.assets.map(item =>
        item.id !== asset.id
          ? item
          : {
              ...item,
              versions: item.versions.map(candidate =>
                candidate.id !== version.id ? candidate : { ...candidate, views }
              ),
              updatedAt: now,
            }
      );
      return {
        aggregate: { ...aggregate, assets },
        resultId: version.id,
      };
    },
  });
}

/**
 * 修改版本的固定造型字段。
 *
 * 固定事实是整套资产的契约——所有已绑定镜头的出图都按它走。改了它，现有标准视图
 * 就过期了（比如把「赤脚」写进 outfit 之后，旧视图里还穿着鞋），所以这里会把所有
 * 视图打回 fail 并说明原因，锁定入口随之关闭，直到重新生成为止。
 */
export async function amendVisualAssetFixedFacts(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  versionId: string;
  amendments: Array<{ field: string; value: string }>;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "analyze",
    mutate: (aggregate, _story, now) => {
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      const version = asset?.versions.find(item => item.id === input.versionId);
      if (!asset || !version) {
        throw new VisualAssetNotFoundError(input.assetId, input.versionId);
      }
      if (version.status === "locked" || version.status === "superseded") {
        throw new VisualAssetValidationError("锁定版本不可修改固定造型；请新建版本");
      }
      if (input.amendments.length === 0) {
        throw new VisualAssetValidationError("请至少提交一处固定造型修改");
      }
      const facts = { ...version.fixedFacts } as unknown as Record<string, unknown>;
      const touched: string[] = [];
      for (const amendment of input.amendments) {
        const field = amendment.field.trim();
        const value = amendment.value.trim();
        if (field === "kind") {
          throw new VisualAssetValidationError("不能修改资产类型");
        }
        if (!(field in facts)) {
          throw new VisualAssetValidationError(`${asset.kind} 资产没有 ${field} 这项固定事实`);
        }
        if (!value) {
          throw new VisualAssetValidationError(`${field} 的新值不能为空`);
        }
        const current = facts[field];
        facts[field] = Array.isArray(current) ? [value] : value;
        touched.push(field);
      }
      // 视图必须一起作废：留着旧图会让标准板和契约对不上，也会骗过锁定条件。
      const failureReason = `固定造型已修改（${touched.join("、")}），标准视图需要重新生成`;
      const views = version.views.map(view => ({
        ...view,
        status: "fail" as const,
        failureReason,
      }));
      const assets = aggregate.assets.map(item =>
        item.id !== asset.id
          ? item
          : {
              ...item,
              versions: item.versions.map(candidate =>
                candidate.id !== version.id
                  ? candidate
                  : {
                      ...candidate,
                      fixedFacts: facts as unknown as VisualAssetFixedFacts,
                      views,
                    }
              ),
              updatedAt: now,
            }
      );
      return {
        aggregate: { ...aggregate, assets },
        resultId: version.id,
      };
    },
  });
}

/**
 * 从一个已有版本派生新版本，继承仍然有效的标准视图。
 *
 * 用于「标准板要求变了，但已经买对的视角不该浪费」——例如给人物加一栏头部特写时，
 * 正面/侧面/背面三张全身图依然成立，只需要补买缺的那一栏。
 * 只继承 status 为 pass 的视图；源版本保持原状（锁定的仍然锁定，已绑镜头不受影响）。
 */
export async function forkVisualAssetVersion(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  sourceVersionId: string;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "analyze",
    mutate: (aggregate, _story, now) => {
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      const source = asset?.versions.find(item => item.id === input.sourceVersionId);
      if (!asset || !source) {
        throw new VisualAssetNotFoundError(input.assetId, input.sourceVersionId);
      }
      const versionId = `vav_${nanoid(12)}`;
      const versionNumber =
        Math.max(0, ...asset.versions.map(item => item.version)) + 1;
      const requiredRoles = new Set(requiredVisualAssetViewRoles(asset.kind));
      // 只带过来仍在要求内、且当初真的验收通过的视图。
      const views = source.views
        .filter(view => requiredRoles.has(view.role) && view.status === "pass")
        .map(view => ({ ...view, id: `${versionId}-${view.role}` }));
      const forked: VisualAssetVersion = {
        id: versionId,
        version: versionNumber,
        status: "review",
        referenceImageIds: [...source.referenceImageIds],
        legacyReferenceIds: [...(source.legacyReferenceIds ?? [])],
        fixedFacts: source.fixedFacts,
        allowedVariations: [...source.allowedVariations],
        conflicts: source.conflicts.map(conflict => ({ ...conflict })),
        views,
        createdAt: now,
        ...(source.boardImageId ? { boardImageId: source.boardImageId } : {}),
      };
      const assets = aggregate.assets.map(item =>
        item.id !== asset.id
          ? item
          : { ...item, versions: [...item.versions, forked], updatedAt: now }
      );
      return {
        aggregate: { ...aggregate, assets },
        resultId: versionId,
      };
    },
  });
}

/** 找出还在用某个资产/版本的镜头绑定；删除前必须先看这个。 */
function boundShotsFor(
  aggregate: StoryVisualAssets,
  match: (ref: { assetId: string; versionId: string }) => boolean
): string[] {
  const shots = new Set<string>();
  for (const binding of aggregate.bindings) {
    for (const kind of ["character", "scene", "style"] as const) {
      const ref = binding[kind];
      if (ref && match(ref)) shots.add(binding.stableShotId);
    }
  }
  return Array.from(shots);
}

/**
 * 删除一个资产版本。
 *
 * 只删版本记录，**绝不删生成的图片**——那些是真金白银买的，而且还是失败排查的证据；
 * 图片留在 Story 的图库里。还被镜头绑着的版本不能删，必须先解绑，
 * 否则那些镜头的生成快照会指向一个不存在的版本。
 */
export async function deleteVisualAssetVersion(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  versionId: string;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "analyze",
    mutate: (aggregate, _story, now) => {
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      const version = asset?.versions.find(item => item.id === input.versionId);
      if (!asset || !version) {
        throw new VisualAssetNotFoundError(input.assetId, input.versionId);
      }
      const bound = boundShotsFor(
        aggregate,
        ref => ref.assetId === input.assetId && ref.versionId === input.versionId
      );
      if (bound.length > 0) {
        throw new VisualAssetValidationError(
          `版本还被 ${bound.length} 个镜头绑定（${bound.slice(0, 3).join("、")}${
            bound.length > 3 ? " 等" : ""
          }），请先解绑再删除`
        );
      }
      const assets = aggregate.assets.map(item =>
        item.id !== asset.id
          ? item
          : {
              ...item,
              versions: item.versions.filter(item2 => item2.id !== version.id),
              updatedAt: now,
            }
      );
      return { aggregate: { ...aggregate, assets }, resultId: version.id };
    },
  });
}

/**
 * 删除整个资产（连同它的所有版本）。
 *
 * 同样只删记录不删图片。任何一个版本还被镜头绑着就拒绝，并说清是哪些镜头。
 */
export async function deleteVisualAsset(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "analyze",
    mutate: aggregate => {
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      if (!asset) throw new VisualAssetNotFoundError(input.assetId);
      const bound = boundShotsFor(aggregate, ref => ref.assetId === input.assetId);
      if (bound.length > 0) {
        throw new VisualAssetValidationError(
          `资产还被 ${bound.length} 个镜头绑定（${bound.slice(0, 3).join("、")}${
            bound.length > 3 ? " 等" : ""
          }），请先解绑再删除`
        );
      }
      return {
        aggregate: {
          ...aggregate,
          assets: aggregate.assets.filter(item => item.id !== asset.id),
          // 该资产的绑定建议一并作废，别留下指向不存在资产的提案。
          proposals: aggregate.proposals.filter(proposal =>
            !(["character", "scene", "style"] as const).some(
              kind => proposal.selections[kind]?.assetId === asset.id
            )
          ),
        },
        resultId: asset.id,
      };
    },
  });
}

/** Persist provider receipt state independently from the asset mutation itself. */
export async function upsertVisualAssetOperation(input: {
  storyId: number;
  userId: number;
  token: string;
  kind: VisualAssetOperationReceipt["kind"];
  status: VisualAssetOperationReceipt["status"];
  providerTaskId?: string;
  inputHash?: string;
  resultId?: string;
  error?: string;
  now?: number;
}): Promise<{ story: PersistedStory; aggregate: StoryVisualAssets }> {
  const token = assertOperationToken(input.token);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const story = await getStoryById(input.storyId, input.userId);
    if (!story) throw new StoryBodyOwnershipError(input.storyId);
    const aggregate = visualAssetsFromStory(story);
    const now = input.now ?? Date.now();
    const previous = aggregate.operations.find(receipt => receipt.token === token);
    const receipt: VisualAssetOperationReceipt = {
      token,
      kind: input.kind,
      status: input.status,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      ...(input.providerTaskId || previous?.providerTaskId
        ? { providerTaskId: input.providerTaskId ?? previous?.providerTaskId }
        : {}),
      ...(input.inputHash || previous?.inputHash
        ? { inputHash: input.inputHash ?? previous?.inputHash }
        : {}),
      ...(input.resultId || previous?.resultId
        ? { resultId: input.resultId ?? previous?.resultId }
        : {}),
      ...(input.error ? { error: input.error.slice(0, 2000) } : {}),
    };
    const nextAggregate = normalizeStoryVisualAssets({
      ...aggregate,
      legacyMigrationVersion: 1,
      operations: [
        ...aggregate.operations.filter(item => item.token !== token),
        receipt,
      ],
    });
    const revision = getStoryRevision(story.body);
    const nextBody = prepareStoryBody(
      { ...storyBody(story), visualAssets: nextAggregate },
      revision + 1
    );
    try {
      const saved = await persistPreparedStoryBody({
        storyId: input.storyId,
        userId: input.userId,
        expectedRevision: revision,
        body: nextBody,
      });
      return { story: saved, aggregate: nextAggregate };
    } catch (error) {
      if (error instanceof StoryBodyRevisionConflictError && attempt < 2) continue;
      throw error;
    }
  }
  throw new VisualAssetValidationError("视觉资产操作状态保存失败");
}

export async function lockVisualAssetVersion(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  versionId: string;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "lock",
    mutate: (aggregate, _story, now) => {
      const asset = aggregate.assets.find(item => item.id === input.assetId);
      const target = asset?.versions.find(item => item.id === input.versionId);
      if (!asset || !target) {
        throw new VisualAssetNotFoundError(input.assetId, input.versionId);
      }
      if (!isVisualAssetVersionLockable(asset.kind, target)) {
        throw new VisualAssetNotLockableError(input.assetId, input.versionId);
      }
      const assets = aggregate.assets.map(item =>
        item.id !== asset.id
          ? item
          : {
              ...item,
              currentVersionId: target.id,
              updatedAt: now,
              versions: item.versions.map(version =>
                version.id === target.id
                  ? { ...version, status: "locked" as const, lockedAt: now }
                  : version.status === "locked"
                    ? { ...version, status: "superseded" as const }
                    : version
              ),
            }
      );
      return {
        aggregate: { ...aggregate, assets },
        resultId: target.id,
      };
    },
  });
}

function storyHasShot(story: PersistedStory, stableShotId: string): boolean {
  const shots = storyBody(story).shots;
  return Array.isArray(shots)
    ? shots.some(raw => {
        const shot = raw && typeof raw === "object" ? (raw as StoryRecord) : {};
        return (
          normalizeShotIdentity(shot.stableShotId) === stableShotId ||
          normalizeShotIdentity(shot.shotIdentity) === stableShotId
        );
      })
    : false;
}

export async function confirmVisualAssetBinding(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  stableShotId: string;
  selections: ShotVisualAssetSelection;
  sourceProposalId?: string;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return confirmVisualAssetBindings({
    storyId: input.storyId,
    userId: input.userId,
    expectedRevision: input.expectedRevision,
    operationToken: input.operationToken,
    bindings: [
      {
        stableShotId: input.stableShotId,
        selections: input.selections,
        sourceProposalId: input.sourceProposalId,
      },
    ],
    now: input.now,
  });
}

export async function confirmVisualAssetBindings(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  bindings: Array<{
    stableShotId: string;
    selections: ShotVisualAssetSelection;
    sourceProposalId?: string;
  }>;
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "bind",
    mutate: (aggregate, story, now) => {
      if (input.bindings.length === 0) {
        throw new VisualAssetValidationError("没有需要确认的镜头绑定");
      }
      const nextBindings = [...aggregate.bindings];
      const confirmedProposalIds = new Set<string>();
      const currentFingerprint = visualAssetSetFingerprint(aggregate.assets);
      for (const requested of input.bindings) {
        const stableShotId = normalizeShotIdentity(requested.stableShotId);
        if (!stableShotId || !storyHasShot(story, stableShotId)) {
          throw new VisualAssetValidationError("镜头不存在或缺少稳定身份");
        }
        if (requested.sourceProposalId) {
          const proposal = aggregate.proposals.find(
            item => item.id === requested.sourceProposalId
          );
          if (!proposal || proposal.stableShotId !== stableShotId) {
            throw new VisualAssetValidationError("镜头绑定提案不存在或已失效");
          }
          if (
            proposal.assetSetFingerprint &&
            proposal.assetSetFingerprint !== currentFingerprint
          ) {
            throw new VisualAssetValidationError("资产版本已变化，请刷新绑定建议");
          }
          if (proposal.conflicts.length > 0) {
            throw new VisualAssetValidationError("镜头要求与资产固定事实冲突，不能确认");
          }
          confirmedProposalIds.add(proposal.id);
        }
        const next = normalizeStoryVisualAssets({
          ...aggregate,
          bindings: [
            ...nextBindings.filter(binding => binding.stableShotId !== stableShotId),
            {
              stableShotId,
              ...requested.selections,
              confirmedAt: now,
              ...(requested.sourceProposalId
                ? { sourceProposalId: requested.sourceProposalId }
                : {}),
            },
          ],
        }).bindings.find(binding => binding.stableShotId === stableShotId);
        if (!next) {
          throw new VisualAssetValidationError("资产版本无效或尚未锁定");
        }
        nextBindings.splice(
          0,
          nextBindings.length,
          ...nextBindings.filter(binding => binding.stableShotId !== stableShotId),
          next
        );
      }
      const candidate = normalizeStoryVisualAssets({
        ...aggregate,
        bindings: nextBindings,
        proposals: aggregate.proposals.map(proposal =>
          confirmedProposalIds.has(proposal.id)
            ? { ...proposal, status: "confirmed" as const }
            : proposal
        ),
      });
      return {
        aggregate: candidate,
        resultId: input.bindings[0]?.stableShotId,
      };
    },
  });
}

export async function saveVisualAssetBindingProposals(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  proposals: ShotVisualAssetBindingProposal[];
  now?: number;
}): Promise<VisualAssetMutationResult> {
  return mutateVisualAssets({
    ...input,
    operationKind: "bind",
    mutate: aggregate => {
      const candidate = normalizeStoryVisualAssets({
        ...aggregate,
        proposals: input.proposals,
      });
      if (candidate.proposals.length !== input.proposals.length) {
        throw new VisualAssetValidationError("镜头绑定提案包含无效资产版本");
      }
      return {
        aggregate: candidate,
        resultId: candidate.proposals[0]?.id,
      };
    },
  });
}

export function emptyVisualAssetStateForTesting(): StoryVisualAssets {
  return emptyStoryVisualAssets();
}
