import { nanoid } from "nanoid";

import {
  visualAssetSetFingerprint,
  type ShotVisualAssetBindingProposal,
  type ShotVisualAssetSelection,
  type StoryVisualAsset,
  type VisualAssetBindingConflict,
  type VisualAssetKind,
} from "../../shared/visualAssets";
import { normalizeShotIdentity } from "../../shared/shotIdentity";
import { runJsonAgent } from "./agentRuntime";
import {
  getStoryVisualAssets,
  saveVisualAssetBindingProposals,
  VisualAssetValidationError,
} from "./visualAssetPersistence";
import { getStoryRevision } from "./storySync";

type AssociationDependencies = {
  runAgent: typeof runJsonAgent;
  now: () => number;
};

const defaultDependencies: AssociationDependencies = {
  runAgent: runJsonAgent,
  now: Date.now,
};

type RawBinding = {
  stableShotId?: unknown;
  characterAssetId?: unknown;
  sceneAssetId?: unknown;
  styleAssetId?: unknown;
  rationale?: unknown;
  conflicts?: unknown;
};

type RawPayload = { bindings?: RawBinding[] };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 1000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function storyShots(body: unknown): Array<{
  stableShotId: string;
  content: string;
}> {
  const obj = record(body);
  const rows = Array.isArray(obj.shots) ? obj.shots : [];
  return rows.flatMap(raw => {
    const shot = record(raw);
    const stableShotId =
      normalizeShotIdentity(shot.stableShotId) ??
      normalizeShotIdentity(shot.shotIdentity);
    if (!stableShotId) return [];
    const content = [
      shot.subject,
      shot.action,
      shot.dialogue,
      shot.location,
      shot.timeLight,
      shot.styleRef,
      shot.imagePrompt,
      shot.promptDraft,
    ]
      .map(value => text(value, 2000))
      .filter(Boolean)
      .join("；");
    return [{ stableShotId, content }];
  });
}

function currentLockedAssets(assets: StoryVisualAsset[]) {
  return assets.flatMap(asset => {
    const version = asset.versions.find(
      item => item.id === asset.currentVersionId && item.status === "locked"
    );
    return version ? [{ asset, version }] : [];
  });
}

function systemPrompt(): string {
  return [
    "你是 Story 视觉资产绑定助手。根据镜头内容和已经锁定的资产，为每个镜头提出人物、场景和美术风格绑定建议。",
    "只能使用输入中列出的 assetId，禁止发明资产或版本。每镜最多一个主要人物、一个场景和一个风格。",
    "建议只是待确认提案，不能假定它已经生效。",
    "如果镜头文字要求改变资产固定事实（例如短发变长发、红外套变白衬衫、房间布局改变、媒介改变），必须写入 conflicts，不能暗中选一边。",
    "严格返回 JSON：",
    '{"bindings":[{"stableShotId":"","characterAssetId":"","sceneAssetId":"","styleAssetId":"","rationale":{"character":"","scene":"","style":""},"conflicts":[{"kind":"character","field":"hair","assetFact":"短发","shotRequest":"长发"}]}]}',
    "没有适合资产的维度省略对应 assetId；不要为了填满而乱绑。",
  ].join("\n");
}

function versionSelection(
  rawAssetId: unknown,
  kind: VisualAssetKind,
  assets: ReturnType<typeof currentLockedAssets>
) {
  const assetId = text(rawAssetId, 160);
  const hit = assets.find(item => item.asset.id === assetId && item.asset.kind === kind);
  return hit
    ? { assetId: hit.asset.id, versionId: hit.version.id }
    : undefined;
}

function normalizeConflicts(value: unknown): VisualAssetBindingConflict[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(raw => {
    const item = record(raw);
    const kind =
      item.kind === "character" || item.kind === "scene" || item.kind === "style"
        ? item.kind
        : undefined;
    const field = text(item.field, 160);
    const assetFact = text(item.assetFact);
    const shotRequest = text(item.shotRequest);
    return kind && field && assetFact && shotRequest
      ? [{ kind, field, assetFact, shotRequest }]
      : [];
  });
}

export async function proposeVisualAssetAssociations(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  dependencies?: Partial<AssociationDependencies>;
}) {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const current = await getStoryVisualAssets(input);
  const receipt = current.aggregate.operations.find(
    item => item.token === input.operationToken
  );
  if (receipt?.status === "succeeded") {
    return {
      status: "ok" as const,
      revision: getStoryRevision(current.story.body),
      proposals: current.aggregate.proposals,
      modelLabel: "receipt-replay",
      replayed: true,
    };
  }
  if (getStoryRevision(current.story.body) !== input.expectedRevision) {
    throw new VisualAssetValidationError("Story 已更新，请刷新后重新生成绑定建议");
  }
  const shots = storyShots(current.story.body);
  if (shots.length === 0) throw new VisualAssetValidationError("当前 Story 没有可绑定镜头");
  const assets = currentLockedAssets(current.aggregate.assets);
  if (assets.length === 0) throw new VisualAssetValidationError("请先锁定至少一个视觉资产");
  const fingerprint = visualAssetSetFingerprint(current.aggregate.assets);
  const message = JSON.stringify({
    shots,
    lockedAssets: assets.map(({ asset, version }) => ({
      assetId: asset.id,
      versionId: version.id,
      kind: asset.kind,
      name: asset.name,
      fixedFacts: version.fixedFacts,
    })),
    existingConfirmedBindings: current.aggregate.bindings,
  });
  const response = await dependencies.runAgent<RawPayload>({
    systemPrompt: systemPrompt(),
    message,
    maxTokens: 5000,
    fallback: () => ({ bindings: [] }),
  });
  const shotIds = new Set(shots.map(shot => shot.stableShotId));
  const seenShots = new Set<string>();
  const proposals: ShotVisualAssetBindingProposal[] = [];
  for (const raw of Array.isArray(response.parsed.bindings)
    ? response.parsed.bindings
    : []) {
    const stableShotId = normalizeShotIdentity(raw.stableShotId);
    if (!stableShotId || !shotIds.has(stableShotId) || seenShots.has(stableShotId)) continue;
    const selections: ShotVisualAssetSelection = {};
    const character = versionSelection(raw.characterAssetId, "character", assets);
    const scene = versionSelection(raw.sceneAssetId, "scene", assets);
    const style = versionSelection(raw.styleAssetId, "style", assets);
    if (character) selections.character = character;
    if (scene) selections.scene = scene;
    if (style) selections.style = style;
    if (!character && !scene && !style) continue;
    const rationaleRaw = record(raw.rationale);
    const rationale: Partial<Record<VisualAssetKind, string>> = {};
    for (const kind of ["character", "scene", "style"] as const) {
      const reason = text(rationaleRaw[kind]);
      if (reason) rationale[kind] = reason;
    }
    seenShots.add(stableShotId);
    proposals.push({
      id: `vap_${nanoid(12)}`,
      stableShotId,
      selections,
      rationale,
      conflicts: normalizeConflicts(raw.conflicts),
      status: "pending",
      assetSetFingerprint: fingerprint,
      createdAt: dependencies.now(),
    });
  }
  const saved = await saveVisualAssetBindingProposals({
    storyId: input.storyId,
    userId: input.userId,
    expectedRevision: input.expectedRevision,
    operationToken: input.operationToken,
    proposals,
    now: dependencies.now(),
  });
  return {
    status: "ok" as const,
    revision: getStoryRevision(saved.story.body),
    proposals: saved.aggregate.proposals,
    modelLabel: response.modelLabel,
    replayed: saved.replayed,
  };
}
