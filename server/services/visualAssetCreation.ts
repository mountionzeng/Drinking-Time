import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";

import { estimateStoryboardMaskedEditCost } from "../../shared/imageRenderCost";
import {
  VISUAL_ASSET_IMAGE_SHOT_NO,
  visualAssetFixedFactsAreComplete,
  type StoryVisualAsset,
  type VisualAssetConflict,
  type VisualAssetFixedFacts,
  type VisualAssetKind,
  type VisualAssetVersion,
  type VisualAssetView,
} from "../../shared/visualAssets";
import { parseJsonLoose } from "../_core/llmJson";
import { ENV } from "../_core/env";
import {
  createGeneratedImage,
  getGeneratedImageById,
} from "../db";
import {
  editImage,
  resume302GptImageTask,
  storeImageBytes,
  type ImageGenOptions,
  type ImageGenResult,
} from "./imageGen";
import { materializeImageInput } from "./imageAssets";
import { renderViaGate } from "./renderGate";
import {
  getStoryVisualAssets,
  saveVisualAssetVersionAnalysis,
  upsertVisualAssetOperation,
  VisualAssetNotFoundError,
  VisualAssetValidationError,
} from "./visualAssetPersistence";
import { getStoryRevision } from "./storySync";
import { invokeVisionJson } from "./visionChannel";
import {
  canonicalBoardLayoutSummary,
  inspectCanonicalBoardStructure,
  type VisualAssetBoardStructureResult,
} from "./visualAssetBoardStructure";

export type VisualAssetCanonicalBoardQuote = {
  quoteId: string;
  storyId: number;
  assetId: string;
  versionId: string;
  inputHash: string;
  currency: "CNY";
  estimatedCny: number;
  /** 需要付费生成的视角数量；标准板由这些视角在服务端合成。 */
  candidateCount: number;
  expiresAt: number;
};

type CreationDependencies = {
  now: () => number;
  getImage: typeof getGeneratedImageById;
  createImage: typeof createGeneratedImage;
  materialize: typeof materializeImageInput;
  vision: typeof invokeVisionJson;
  edit: typeof editImage;
  resume: typeof resume302GptImageTask;
  storeBytes: typeof storeImageBytes;
  inspectStructure: typeof inspectCanonicalBoardStructure;
};

const defaultDependencies: CreationDependencies = {
  now: Date.now,
  getImage: getGeneratedImageById,
  createImage: createGeneratedImage,
  materialize: materializeImageInput,
  vision: invokeVisionJson,
  edit: editImage,
  resume: resume302GptImageTask,
  storeBytes: storeImageBytes,
  inspectStructure: inspectCanonicalBoardStructure,
};

function dependenciesOf(
  overrides?: Partial<CreationDependencies>
): CreationDependencies {
  return { ...defaultDependencies, ...overrides };
}

function quoteKey(): string {
  const key = ENV.cookieSecret || ENV.api302Key;
  if (!key && ENV.isProduction) {
    throw new Error("服务器未配置视觉资产报价签名密钥");
  }
  return key || "local-visual-asset-quote-key";
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function signQuote(
  quote: Omit<VisualAssetCanonicalBoardQuote, "quoteId">
): string {
  return createHmac("sha256", quoteKey())
    .update(JSON.stringify(quote))
    .digest("hex");
}

function quoteSignatureIsValid(quote: VisualAssetCanonicalBoardQuote): boolean {
  const { quoteId: _quoteId, ...unsigned } = quote;
  const expected = Buffer.from(signQuote(unsigned), "hex");
  const actual = Buffer.from(quote.quoteId, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function strings(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim().slice(0, 1000))
        .filter(Boolean)
    )
  ).slice(0, limit);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 6000) : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseFacts(value: unknown, kind: VisualAssetKind): VisualAssetFixedFacts {
  const obj = record(value);
  if (kind === "character") {
    return {
      kind,
      face: stringValue(obj.face),
      hair: stringValue(obj.hair),
      outfit: stringValue(obj.outfit),
      accessories: strings(obj.accessories),
    };
  }
  if (kind === "scene") {
    return {
      kind,
      geometry: strings(obj.geometry),
      materials: strings(obj.materials),
      fixedProps: strings(obj.fixedProps),
    };
  }
  return {
    kind,
    medium: strings(obj.medium),
    brushwork: strings(obj.brushwork),
    formLanguage: strings(obj.formLanguage),
    colorLanguage: strings(obj.colorLanguage),
    forbidden: strings(obj.forbidden),
  };
}

function parseConflicts(value: unknown): VisualAssetConflict[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const obj = record(item);
    const field = stringValue(obj.field).slice(0, 160);
    const descriptions = strings(obj.descriptions);
    const sourceImageIds = Array.isArray(obj.sourceImageIds)
      ? obj.sourceImageIds.filter(
          (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0
        )
      : [];
    return field && descriptions.length >= 2
      ? [{ field, descriptions, sourceImageIds }]
      : [];
  });
}

function analysisSystemPrompt(kind: VisualAssetKind): string {
  const contract =
    kind === "character"
      ? '{"fixedFacts":{"face":"","hair":"","outfit":"","accessories":[]},"allowedVariations":[],"conflicts":[{"field":"hair","descriptions":["",""],"sourceImageIds":[1,2]}]}'
      : kind === "scene"
        ? '{"fixedFacts":{"geometry":[],"materials":[],"fixedProps":[]},"allowedVariations":[],"conflicts":[{"field":"geometry","descriptions":["",""],"sourceImageIds":[1,2]}]}'
        : '{"fixedFacts":{"medium":[],"brushwork":[],"formLanguage":[],"colorLanguage":[],"forbidden":[]},"allowedVariations":[],"conflicts":[{"field":"medium","descriptions":["",""],"sourceImageIds":[1,2]}]}';
  return [
    `你是视觉资产分析员。本次只分析${kind === "character" ? "人物固定造型" : kind === "scene" ? "场景固定事实" : "美术风格语言"}。`,
    "即使图片同时出现人物、场景和画风，也禁止提取本次类型以外的控制事实。",
    kind === "character"
      ? "景别、机位、动作、表情、视线和光线变化属于允许变化，不得列为冲突；只有人物身份/脸型五官、发型结构、服装款式颜色或固定配件本身不一致时才列冲突。"
      : "只把固定事实本身不一致列为冲突；视角、构图、景别和光线变化不得列为冲突。",
    "多图内容冲突时必须列出冲突，禁止平均、猜测或随机选一边。",
    "sourceImageIds 必须使用用户文字中给出的真实图片 ID。",
    `严格返回 JSON：${contract}`,
  ].join("\n");
}

function findAssetVersion(
  assets: StoryVisualAsset[],
  assetId: string,
  versionId: string
): { asset: StoryVisualAsset; version: VisualAssetVersion } {
  const asset = assets.find(item => item.id === assetId);
  const version = asset?.versions.find(item => item.id === versionId);
  if (!asset || !version) throw new VisualAssetNotFoundError(assetId, versionId);
  return { asset, version };
}

async function ownedReferenceInputs(input: {
  storyId: number;
  userId: number;
  version: VisualAssetVersion;
  dependencies: CreationDependencies;
}): Promise<Array<{ id: number; imageUrl: string; materialized: string }>> {
  const rows = [];
  for (const imageId of input.version.referenceImageIds) {
    const image = await input.dependencies.getImage(imageId);
    if (
      !image ||
      image.storyId !== input.storyId ||
      image.userId !== input.userId ||
      !image.imageUrl
    ) {
      throw new VisualAssetValidationError(`参考图片 #${imageId} 不属于当前 Story 或已不可用`);
    }
    let materialized: string;
    try {
      materialized = await input.dependencies.materialize(image.imageUrl);
    } catch (error) {
      throw new VisualAssetValidationError(
        `参考图片 #${imageId} 读取失败：${error instanceof Error ? error.message : "未知错误"}`
      );
    }
    rows.push({ id: image.id, imageUrl: image.imageUrl, materialized });
  }
  if (rows.length === 0) throw new VisualAssetValidationError("资产没有可用参考图");
  return rows;
}

// 实测 1024px 人物图会撞上视觉网关约 63–75 秒的连接上限；768px
// 三图参考板可在上限前完成，并保留足够的人物造型细节。
const ANALYSIS_BOARD_MAX_EDGE = 768;
const SINGLE_REFERENCE_EDGE = 512;

function materializedImageBytes(value: string): Buffer | null {
  const match = value.match(
    /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i
  );
  if (!match?.[1]) return null;
  return Buffer.from(match[1].replace(/\s/g, ""), "base64");
}

async function analysisReferenceInput(
  references: Array<{ id: number; materialized: string }>
): Promise<{ imageUrls: string[]; description: string }> {
  const decoded = references.map(reference => materializedImageBytes(reference.materialized));
  if (decoded.some(bytes => !bytes)) {
    return {
      imageUrls: references.map(reference => reference.materialized),
      description: references.map(reference => `图片 ID ${reference.id}`).join("、"),
    };
  }

  const columns = references.length === 1
    ? 1
    : Math.min(4, Math.ceil(Math.sqrt(references.length)));
  const rows = Math.ceil(references.length / columns);
  const cellEdge = references.length === 1
    ? SINGLE_REFERENCE_EDGE
    : Math.floor(ANALYSIS_BOARD_MAX_EDGE / columns);
  const cells = await Promise.all(
    decoded.map(bytes =>
      sharp(bytes!)
        .rotate()
        .resize(cellEdge, cellEdge, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255 },
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer()
    )
  );
  const board = await sharp({
    create: {
      width: columns * cellEdge,
      height: rows * cellEdge,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(
      cells.map((bytes, index) => ({
        input: bytes,
        left: (index % columns) * cellEdge,
        top: Math.floor(index / columns) * cellEdge,
      }))
    )
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  return {
    imageUrls: [`data:image/jpeg;base64,${board.toString("base64")}`],
    description: references
      .map((reference, index) => `第 ${index + 1} 格=图片 ID ${reference.id}`)
      .join("；"),
  };
}

export async function analyzeVisualAssetVersion(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  operationToken: string;
  assetId: string;
  versionId: string;
  dependencies?: Partial<CreationDependencies>;
}) {
  const dependencies = dependenciesOf(input.dependencies);
  const current = await getStoryVisualAssets(input);
  const priorReceipt = current.aggregate.operations.find(
    receipt => receipt.token === input.operationToken
  );
  if (priorReceipt?.status === "succeeded") {
    return {
      status: "ok" as const,
      revision: getStoryRevision(current.story.body),
      aggregate: current.aggregate,
      replayed: true,
      modelLabel: "receipt-replay",
    };
  }
  if (getStoryRevision(current.story.body) !== input.expectedRevision) {
    throw new VisualAssetValidationError("资产已更新，请刷新后重新分析");
  }
  const { asset, version } = findAssetVersion(
    current.aggregate.assets,
    input.assetId,
    input.versionId
  );
  if (version.status === "locked" || version.status === "superseded") {
    throw new VisualAssetValidationError("锁定版本不可重新分析");
  }
  const references = await ownedReferenceInputs({ ...input, version, dependencies });
  const preparedReferences = await analysisReferenceInput(references);
  const vision = await dependencies.vision({
    system: analysisSystemPrompt(asset.kind),
    userText: `资产名称：${asset.name}\n参考板位置：${preparedReferences.description}\n按从左到右、从上到下的格子顺序读取；只提取本次资产类型的固定事实。`,
    imageUrls: preparedReferences.imageUrls,
    maxTokens: 2000,
    // 真实网关在高像素输入下约 63–75 秒断开。参考板把视觉预算限制在
    // 768px 内；每家仍保留 70 秒，且总链为备用 302 留出完整窗口。
    attemptTimeoutMs: 70_000,
    timeoutMs: 145_000,
  });
  const parsed = parseJsonLoose<Record<string, unknown>>(vision.text);
  const fixedFacts = parseFacts(parsed.fixedFacts, asset.kind);
  if (!visualAssetFixedFactsAreComplete(fixedFacts)) {
    throw new VisualAssetValidationError("视觉分析没有返回完整的固定事实");
  }
  // Vision can take more than a minute. During that time the editor may save
  // unrelated Story fields and advance the whole-Story revision. Rebase the
  // completed analysis onto the latest server body, but only while the exact
  // immutable asset version we analyzed is still present and editable.
  const latest = await getStoryVisualAssets(input);
  const latestTarget = findAssetVersion(
    latest.aggregate.assets,
    input.assetId,
    input.versionId
  );
  if (
    latestTarget.asset.kind !== asset.kind ||
    JSON.stringify(latestTarget.version.referenceImageIds) !==
      JSON.stringify(version.referenceImageIds)
  ) {
    throw new VisualAssetValidationError("资产参考图已更新，请重新分析");
  }
  if (
    latestTarget.version.status === "locked" ||
    latestTarget.version.status === "superseded"
  ) {
    throw new VisualAssetValidationError("锁定版本不可重新分析");
  }
  const saved = await saveVisualAssetVersionAnalysis({
    storyId: input.storyId,
    userId: input.userId,
    expectedRevision: getStoryRevision(latest.story.body),
    operationToken: input.operationToken,
    operationKind: "analyze",
    assetId: input.assetId,
    versionId: input.versionId,
    fixedFacts,
    allowedVariations: strings(parsed.allowedVariations),
    conflicts: parseConflicts(parsed.conflicts),
    views: [],
    now: dependencies.now(),
  });
  return {
    status: "ok" as const,
    revision: getStoryRevision(saved.story.body),
    aggregate: saved.aggregate,
    replayed: saved.replayed,
    modelLabel: vision.modelLabel,
  };
}
// ── 分视角生成 + 服务端合板 ──
//
// 2026-08-21 两次真实付费换来的结论：
//   1) 用第一张人物参考照当 gpt-image 的编辑底图 → 模型死守那张照片的单人构图，
//      prompt 要三栏也没用，只重绘出一张四分之三侧身肖像。
//   2) 改用程序生成的灰色三人形布局模板当底图 → 模型把灰色剪影当成目标画风，
//      产出一张没有任何身份特征的灰色正面头像，比第一次更差。
// edit 模式下底图同时支配构图和画风，所以「一次生成一整张多格标准板」这条路作废。
//
// 现在的做法：每次只让模型画一个视角（单主体单视角是它擅长的），底图用真实参考图
// 保身份，多格构图交给服务端用 sharp 确定性合成。构图由代码保证，视觉质检只需要
// 确认内容对不对，不再需要指望模型自己排版。
/** 合板算法或视角拆分变更时必须 +1：它进 inputHash，会让旧报价失效并要求用户重新确认费用。 */
export const CANONICAL_BOARD_COMPOSITION_VERSION = 5;

const BOARD_CELL_EDGE = 512;

/** 真正需要付费生成的视角；其余角色由已生成结果派生。 */
const GENERATED_VIEW_ROLES: Record<VisualAssetKind, VisualAssetView["role"][]> = {
  // identity-detail 必须真生成，不能从正面图裁。
  // 全身图一格只有 512px，脸只剩几十像素，裁出来等于把糊脸放大——锁不住五官，
  // 而它同时还是下游镜头出图的身份锚点（REPRESENTATIVE_ROLE），糊在这里全链路都糊。
  character: ["front", "profile", "back", "identity-detail"],
  scene: ["establishing", "reverse", "side", "top"],
  style: ["character-sample", "scene-sample", "object-sample", "closeup-sample"],
};

export function generatedVisualAssetViewRoles(
  kind: VisualAssetKind
): VisualAssetView["role"][] {
  return [...GENERATED_VIEW_ROLES[kind]];
}

const VIEW_BRIEF: Record<VisualAssetView["role"], string> = {
  front:
    "严格正面全身站姿：人物正对镜头，自然站立，双臂自然下垂不遮挡身体轮廓。",
  profile:
    "严格 90° 正侧面全身站姿：人物完全侧对镜头，只看得到一侧脸颊和耳朵，鼻尖指向画面一侧。绝不能是四分之三侧身，也不能有任何回头看镜头的动作。",
  back:
    "严格背面全身站姿：人物完全背对镜头站立。**看不到脸、看不到任何五官、看不到下巴轮廓**，只看得到后脑、后颈、后背和服装背面。禁止回头、禁止侧脸、禁止露出半张脸。画面要清楚交代后脑发型的形状和服装背面的结构（开口、系带、拉链、裙摆背面）。",
  "identity-detail":
    "正面头部特写：只画头部与肩线，脸正对镜头，五官清晰充满画面。要求看得清眼型、眉形、鼻梁与鼻头、唇形、脸型轮廓、颧骨高度和发际线，以及刘海与鬓角的走向。中性表情，不要夸张情绪，不要手部入画。",
  establishing: "主视角全景：交代空间整体几何、主要陈设与它们的相对关系。",
  reverse: "反向视角：站在主视角对面看同一空间，几何与固定陈设必须完全一致。",
  side: "侧向视角：从侧面 90° 看同一空间。",
  top: "正交俯视：从正上方垂直看同一空间的平面布局。",
  "character-sample": "人物样例：用这套美术风格画一个人物。",
  "scene-sample": "场景样例：用这套美术风格画一处场景。",
  "object-sample": "物件样例：用这套美术风格画一件静物。",
  "closeup-sample": "近景细节样例：用这套美术风格画一处材质近景。",
};

function referenceRole(kind: VisualAssetKind): string {
  return kind === "character"
    ? "人物身份参考，只提供脸、发型、服饰和固定配件"
    : kind === "scene"
      ? "场景参考，只提供空间几何、材质和固定陈设"
      : "风格参考，只提供媒介、笔触、造型与色彩语言";
}

function viewPrompt(
  asset: StoryVisualAsset,
  version: VisualAssetVersion,
  role: VisualAssetView["role"],
  referenceCount: number,
  instruction?: string
): string {
  const facts = JSON.stringify(version.fixedFacts);
  // 底图是真实参考图，模型会本能地保留它的构图；必须逐张写清楚它只负责身份。
  const inputContract =
    referenceCount > 0
      ? [
          `图 1 是${referenceRole(asset.kind)}。禁止沿用它的构图、机位、景别、姿势和背景——只取${
            asset.kind === "character" ? "身份与造型" : "固定事实"
          }。`,
          ...(referenceCount > 1
            ? [`图 2–${referenceCount} 是同一对象的补充参考，作用与图 1 相同。`]
            : []),
        ]
      : [];
  return [
    `为视觉资产“${asset.name}”单独绘制一个标准视角。`,
    ...inputContract,
    `本次只画这一个视角：${VIEW_BRIEF[role]}`,
    `不可改变的固定事实：${facts}`,
    // 参考图都是半身肖像，edit 模式会把它们的取景一起带过来（2026-08-21 第三次付费事故）。
    // 全身要求必须写得比「全身」两个字更硬，把镜头距离和留白一起指定死。
    ...(asset.kind === "character"
      ? [
          "取景：全身远景。从头顶到鞋底必须完整出现在画面里，脚和鞋子必须可见。头顶上方和鞋底下方各留出明显空白。这是一张站姿全身图，不是半身像、不是胸像、不是七分身，绝对不能在膝盖、大腿或腰部截断。",
          "人物站在画面正中，全身占画面高度的约 80%，相机与人物保持整个人入画的距离。",
          "画面里只能有一个人物。背景是完全平整的中性浅灰色影棚背景，没有墙面、没有墙角、没有柱子、没有家具、没有道具、没有地平线、没有阴影分割线。",
          "禁止坐姿、禁止倚靠、禁止蹲姿——三个视角都必须是同一个直立站姿。",
        ]
      : ["纯净中性背景，主体完整居中。"]),
    "禁止任何文字、标签、数字、边框、分隔线、签名、水印和说明图标。",
    "这一张只能是单一视角，禁止自行拼成多格、三视图、对比图或分镜。",
    // 用户的定向修改意见排在最后，压过上面的通用措辞，但压不过固定事实。
    ...(instruction ? [`本次额外要求（不得违反上面的固定事实）：${instruction}`] : []),
  ].join("\n");
}

async function generationInput(input: {
  storyId: number;
  userId: number;
  assetId: string;
  versionId: string;
  instruction?: string;
  dependencies: CreationDependencies;
}) {
  const current = await getStoryVisualAssets(input);
  const { asset, version } = findAssetVersion(
    current.aggregate.assets,
    input.assetId,
    input.versionId
  );
  if (version.status === "locked" || version.status === "superseded") {
    throw new VisualAssetValidationError("锁定版本不可重新生成标准视图");
  }
  if (!visualAssetFixedFactsAreComplete(version.fixedFacts)) {
    throw new VisualAssetValidationError("请先完成参考图分析");
  }
  if (version.conflicts.some(conflict => !conflict.resolution)) {
    throw new VisualAssetValidationError("参考图冲突尚未处理，不能生成标准视图");
  }
  const references = await ownedReferenceInputs({ ...input, version });
  const roles = generatedVisualAssetViewRoles(asset.kind);
  const instruction = input.instruction?.trim() || undefined;
  const prompts = new Map(
    roles.map(role => [
      role,
      viewPrompt(asset, version, role, references.length, instruction),
    ])
  );
  const inputHash = hash({
    storyId: input.storyId,
    assetId: asset.id,
    versionId: version.id,
    kind: asset.kind,
    referenceImageIds: version.referenceImageIds,
    fixedFacts: version.fixedFacts,
    compositionVersion: CANONICAL_BOARD_COMPOSITION_VERSION,
    prompts: roles.map(role => prompts.get(role)),
  });
  return { current, asset, version, references, roles, prompts, inputHash };
}

export async function quoteVisualAssetCanonicalBoard(input: {
  storyId: number;
  userId: number;
  assetId: string;
  versionId: string;
  instruction?: string;
  dependencies?: Partial<CreationDependencies>;
}): Promise<VisualAssetCanonicalBoardQuote> {
  const dependencies = dependenciesOf(input.dependencies);
  const resolved = await generationInput({ ...input, dependencies });
  const estimate = estimateStoryboardMaskedEditCost();
  // 每个视角都是一次独立付费调用，报价必须是总额而不是单次价。
  const candidateCount = resolved.roles.length;
  const unsigned = {
    storyId: input.storyId,
    assetId: input.assetId,
    versionId: input.versionId,
    inputHash: resolved.inputHash,
    currency: estimate.currency,
    estimatedCny: Number((estimate.estimatedCny * candidateCount).toFixed(4)),
    candidateCount,
    expiresAt: dependencies.now() + 10 * 60_000,
  };
  return { ...unsigned, quoteId: signQuote(unsigned) };
}

async function bytesFromImageInput(value: string): Promise<Buffer> {
  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    if (comma < 0) throw new Error("图片 data URL 不合法");
    return Buffer.from(
      value.slice(comma + 1),
      value.slice(0, comma).includes(";base64") ? "base64" : "utf8"
    );
  }
  const response = await fetch(value);
  if (!response.ok) throw new Error(`图片读取失败 HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * 把已生成的单视角图确定性地拼成标准板。
 *
 * 构图由这里保证，不再指望模型排版：人物是横向一行，场景与风格是 2×2。
 * 每格用 contain 缩放，绝不裁掉全身人物的头或脚。
 */
async function composeCanonicalBoard(input: {
  kind: VisualAssetKind;
  views: Buffer[];
  storeBytes: typeof storeImageBytes;
}): Promise<{ imageUrl: string; imageKey?: string }> {
  const columns = input.kind === "character" ? input.views.length : 2;
  const rows = Math.ceil(input.views.length / columns);
  const cells = await Promise.all(
    input.views.map(bytes =>
      sharp(bytes)
        .resize(BOARD_CELL_EDGE, BOARD_CELL_EDGE, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255 },
        })
        .png()
        .toBuffer()
    )
  );
  const png = await sharp({
    create: {
      width: BOARD_CELL_EDGE * columns,
      height: BOARD_CELL_EDGE * rows,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(
      cells.map((cell, index) => ({
        input: cell,
        left: (index % columns) * BOARD_CELL_EDGE,
        top: Math.floor(index / columns) * BOARD_CELL_EDGE,
      }))
    )
    .png()
    .toBuffer();
  const stored = await input.storeBytes(png, "image/png");
  if (stored.status !== "ok" || !stored.imageUrl) {
    throw new Error(stored.message || "标准板合成失败");
  }
  return {
    imageUrl: stored.imageUrl,
    ...(stored.imageKey ? { imageKey: stored.imageKey } : {}),
  };
}

function generationOptions(
  identityBase: string,
  contextReferences: string[],
  onAccepted: (taskId: string) => Promise<void>
): ImageGenOptions {
  return {
    provider: "gpt-image",
    aspectRatio: "1:1",
    fidelity: "final",
    requireInputImage: true,
    // 底图必须是真实参考图。edit 模式下底图同时决定画风和身份，
    // 中性占位图会被模型当成目标画风（2026-08-21 第二次付费事故）。
    referenceImageUrl: identityBase,
    referenceContextImageUrls: contextReferences,
    primaryReferenceLock: false,
    // 标准视角要改机位、朝向、景别和背景，必须走会重构画面的 gpt-image 编辑端点。
    // 只有一张参考图时 editImage 默认会掉回 FLUX Kontext，那条路改不动构图。
    preferStructuralEdit: true,
    onProviderTaskAccepted: onAccepted,
  };
}

type RenderedView = { role: VisualAssetView["role"]; id: number; bytes: Buffer };

type CanonicalBoardResult =
  | { status: "confirmation_required"; quote: VisualAssetCanonicalBoardQuote }
  | {
      status: "ok";
      boardImageId: number;
      viewImageIds: number[];
      operationToken: string;
      structure: {
        verdict: VisualAssetBoardStructureResult["verdict"];
        reason: string;
        modelLabel: string;
      };
    }
  | { status: "error"; error: string; operationToken: string };

type ResolvedGenerationInput = Awaited<ReturnType<typeof generationInput>>;

/** 单视角重生成的报价签名要绑定角色，否则「背面」的确认能被拿去买「正面」。 */
function viewInputHash(resolved: ResolvedGenerationInput, role: VisualAssetView["role"]): string {
  return hash({ base: resolved.inputHash, role });
}

/**
 * 付费生成一个标准视角。
 *
 * 回执按 `${主token}:view:${role}` 分开记：中途失败重试时，已经付过钱的视角
 * 凭回执直接复用，不会把整组视角重新买一遍。
 */
async function renderOneView(input: {
  storyId: number;
  userId: number;
  operationToken: string;
  viewToken: string;
  role: VisualAssetView["role"];
  prompt: string;
  identityBase: string;
  contextReferences: string[];
  resumeTaskId?: string;
  resolved: ResolvedGenerationInput;
  dependencies: CreationDependencies;
}): Promise<RenderedView | { status: "error"; error: string; operationToken: string }> {
  const { dependencies, resolved, role } = input;
  const onAccepted = async (taskId: string) => {
    await upsertVisualAssetOperation({
      storyId: input.storyId,
      userId: input.userId,
      token: input.viewToken,
      kind: "generate_views",
      status: "submitted",
      providerTaskId: taskId,
      inputHash: resolved.inputHash,
      now: dependencies.now(),
    });
  };
  await upsertVisualAssetOperation({
    storyId: input.storyId,
    userId: input.userId,
    token: input.viewToken,
    kind: "generate_views",
    status: "claimed",
    inputHash: resolved.inputHash,
    now: dependencies.now(),
  });
  const options = generationOptions(
    input.identityBase,
    input.contextReferences,
    onAccepted
  );
  let generated: ImageGenResult;
  if (input.resumeTaskId) {
    generated = await dependencies.resume(input.resumeTaskId, options);
  } else {
    // 必须走 editImage 而不是 generateImage。
    // 2026-08-21：generateImage 只要带 referenceImageUrl 就在入口处被 flux-kontext-pro
    // 截走，而 Kontext 是「保留其余部分」的指令式局部编辑模型——让它转身、改取景、
    // 换背景，正好是它被设计成不做的事。四次付费都卡在这里。
    // editImage 在有多张参考图时走 302 gpt-image 多图编辑端点，愿意按提示词重构画面。
    generated = await renderViaGate(
      {
        prompt: input.prompt,
        storyId: input.storyId,
        referenceImages: [input.identityBase, ...input.contextReferences],
        outputPurpose: "image-edit",
        referencePolicy:
          resolved.asset.kind === "character"
            ? "preserve-identity"
            : resolved.asset.kind === "scene"
              ? "preserve-composition"
              : "style-only",
        authoredBrief: true,
        longPrompt: true,
        userInstructions: ["固定事实优先于所有生成性美术建议"],
      },
      gated => dependencies.edit(input.identityBase, gated, options)
    );
  }
  if (generated.status !== "ok" || !generated.imageUrl) {
    const uncertain = generated.submissionUncertain || Boolean(generated.providerTaskId);
    const message = generated.message || `${role} 标准视角生成失败`;
    await upsertVisualAssetOperation({
      storyId: input.storyId,
      userId: input.userId,
      token: input.viewToken,
      kind: "generate_views",
      status: uncertain ? "unknown" : "failed",
      providerTaskId: generated.providerTaskId,
      inputHash: resolved.inputHash,
      error: message,
      now: dependencies.now(),
    });
    await upsertVisualAssetOperation({
      storyId: input.storyId,
      userId: input.userId,
      token: input.operationToken,
      kind: "generate_views",
      status: uncertain ? "unknown" : "failed",
      inputHash: resolved.inputHash,
      error: message,
      now: dependencies.now(),
    });
    return { status: "error", error: message, operationToken: input.operationToken };
  }
  const row = await dependencies.createImage({
    projectId: null,
    storyId: input.storyId,
    userId: input.userId,
    shotNo: VISUAL_ASSET_IMAGE_SHOT_NO,
    shotIdentity: null,
    imageKey: generated.imageKey ?? null,
    imageUrl: generated.imageUrl,
    prompt: input.prompt,
    promptCompilationId: null,
    generationType: "initial",
    parentImageId: resolved.version.referenceImageIds[0] ?? null,
    isCurrent: false,
    maskKey: null,
  });
  await upsertVisualAssetOperation({
    storyId: input.storyId,
    userId: input.userId,
    token: input.viewToken,
    kind: "generate_views",
    status: "succeeded",
    providerTaskId: generated.providerTaskId,
    inputHash: resolved.inputHash,
    resultId: String(row.id),
    now: dependencies.now(),
  });
  return {
    role,
    id: row.id,
    bytes: await bytesFromImageInput(await dependencies.materialize(generated.imageUrl)),
  };
}

/**
 * 合板、派生身份细节、跑结构质检、落库。
 *
 * 整组生成和单视角重生成共用这一段：只要拿到全部生成视角的图，收尾逻辑就完全一样。
 */
async function finalizeCanonicalBoard(input: {
  storyId: number;
  userId: number;
  assetId: string;
  versionId: string;
  operationToken: string;
  resolved: ResolvedGenerationInput;
  renderedRows: RenderedView[];
  dependencies: CreationDependencies;
}): Promise<CanonicalBoardResult> {
  const { dependencies, resolved, renderedRows } = input;
  try {
    const board = await composeCanonicalBoard({
      kind: resolved.asset.kind,
      views: renderedRows.map(item => item.bytes),
      storeBytes: dependencies.storeBytes,
    });
    const boardRow = await dependencies.createImage({
      projectId: null,
      storyId: input.storyId,
      userId: input.userId,
      shotNo: VISUAL_ASSET_IMAGE_SHOT_NO,
      shotIdentity: null,
      imageKey: board.imageKey ?? null,
      imageUrl: board.imageUrl,
      prompt: `${resolved.asset.name} 标准板（服务端合成）：${canonicalBoardLayoutSummary(
        resolved.asset.kind
      )}`,
      promptCompilationId: null,
      generationType: "initial",
      parentImageId: renderedRows[0]?.id ?? null,
      isCurrent: false,
      maskKey: null,
    });
    const viewRows = [...renderedRows.map(item => ({ role: item.role, id: item.id }))];
    // 构图现在由服务端保证，但内容仍然只能由视觉模型确认：
    // 三个视角是不是真的正面/严格侧面/背面、是不是同一个人、是不是都全身。
    // 质检超时或解析失败一律 unknown，锁定入口保持关闭。
    const structure = await dependencies.inspectStructure({
      kind: resolved.asset.kind,
      boardImageUrl: await dependencies.materialize(board.imageUrl),
      fixedFacts: resolved.version.fixedFacts,
    });
    const viewStatus: VisualAssetView["status"] =
      structure.verdict === "pass"
        ? "pass"
        : structure.verdict === "fail"
          ? "fail"
          : "unknown";
    const latest = await getStoryVisualAssets(input);
    const views: VisualAssetView[] = viewRows.map(item => ({
      id: `${input.versionId}-${item.role}`,
      role: item.role,
      imageId: item.id,
      status: viewStatus,
      ...(viewStatus === "pass" ? {} : { failureReason: structure.reason }),
    }));
    await saveVisualAssetVersionAnalysis({
      storyId: input.storyId,
      userId: input.userId,
      expectedRevision: getStoryRevision(latest.story.body),
      operationToken: `${input.operationToken}:attach`,
      assetId: input.assetId,
      versionId: input.versionId,
      fixedFacts: resolved.version.fixedFacts,
      allowedVariations: resolved.version.allowedVariations,
      conflicts: resolved.version.conflicts,
      boardImageId: boardRow.id,
      views,
      now: dependencies.now(),
    });
    await upsertVisualAssetOperation({
      storyId: input.storyId,
      userId: input.userId,
      token: input.operationToken,
      kind: "generate_views",
      status: "succeeded",
      inputHash: resolved.inputHash,
      resultId: input.versionId,
      now: dependencies.now(),
    });
    return {
      status: "ok",
      boardImageId: boardRow.id,
      viewImageIds: viewRows.map(item => item.id),
      operationToken: input.operationToken,
      structure: {
        verdict: structure.verdict,
        reason: structure.reason,
        modelLabel: structure.modelLabel,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "标准板合成或入库失败";
    await upsertVisualAssetOperation({
      storyId: input.storyId,
      userId: input.userId,
      token: input.operationToken,
      kind: "generate_views",
      status: "failed",
      inputHash: resolved.inputHash,
      error: message,
      now: dependencies.now(),
    });
    return { status: "error", error: message, operationToken: input.operationToken };
  }
}

function replayFromStoredViews(
  latestVersion: VisualAssetVersion,
  kind: VisualAssetKind,
  operationToken: string
): CanonicalBoardResult | null {
  if (!latestVersion.boardImageId || latestVersion.views.length === 0) return null;
  // 回执重放不重新付费，也不重新质检：直接如实回放已存的结构结论，
  // 不能因为「上次买过」就把不合格的板子说成通过。
  const stored = latestVersion.views;
  const verdict = stored.every(view => view.status === "pass")
    ? "pass"
    : stored.some(view => view.status === "fail")
      ? "fail"
      : "unknown";
  return {
    status: "ok",
    boardImageId: latestVersion.boardImageId,
    viewImageIds: stored.map(view => view.imageId),
    operationToken,
    structure: {
      verdict,
      reason:
        stored.find(view => view.failureReason)?.failureReason ??
        (verdict === "pass"
          ? `标准板结构质检通过：${canonicalBoardLayoutSummary(kind)}`
          : "标准板结构未确认"),
      modelLabel: "receipt-replay",
    },
  };
}

function confirmationIsValid(
  confirmation: VisualAssetCanonicalBoardQuote | undefined,
  expected: { storyId: number; assetId: string; versionId: string; inputHash: string },
  now: number
): boolean {
  return Boolean(
    confirmation &&
      quoteSignatureIsValid(confirmation) &&
      confirmation.expiresAt >= now &&
      confirmation.inputHash === expected.inputHash &&
      confirmation.storyId === expected.storyId &&
      confirmation.assetId === expected.assetId &&
      confirmation.versionId === expected.versionId
  );
}

export async function generateVisualAssetCanonicalBoard(input: {
  storyId: number;
  userId: number;
  assetId: string;
  versionId: string;
  operationToken: string;
  confirmation?: VisualAssetCanonicalBoardQuote;
  instruction?: string;
  dependencies?: Partial<CreationDependencies>;
}): Promise<CanonicalBoardResult> {
  const dependencies = dependenciesOf(input.dependencies);
  const resolved = await generationInput({ ...input, dependencies });
  const existing = resolved.current.aggregate.operations.find(
    receipt => receipt.token === input.operationToken
  );
  if (existing?.status === "succeeded" && existing.resultId === input.versionId) {
    const latest = await getStoryVisualAssets(input);
    const latestVersion = findAssetVersion(
      latest.aggregate.assets,
      input.assetId,
      input.versionId
    ).version;
    const replay = replayFromStoredViews(
      latestVersion,
      resolved.asset.kind,
      input.operationToken
    );
    if (replay) return replay;
  }
  const quote = await quoteVisualAssetCanonicalBoard({ ...input, dependencies });
  if (
    !confirmationIsValid(
      input.confirmation,
      { ...input, inputHash: resolved.inputHash },
      dependencies.now()
    )
  ) {
    return { status: "confirmation_required", quote };
  }
  const identityBase = resolved.references[0]?.materialized;
  if (!identityBase) {
    return {
      status: "error",
      error: "资产没有可用参考图，无法生成标准视图",
      operationToken: input.operationToken,
    };
  }
  const contextReferences = resolved.references
    .slice(1)
    .map(reference => reference.materialized);

  const renderedRows: RenderedView[] = [];
  for (const role of resolved.roles) {
    const viewToken = `${input.operationToken}:view:${role}`;
    const before = await getStoryVisualAssets(input);
    const viewReceipt = before.aggregate.operations.find(
      receipt => receipt.token === viewToken
    );
    if (viewReceipt?.status === "succeeded" && viewReceipt.resultId) {
      const reused = await dependencies.getImage(Number(viewReceipt.resultId));
      if (reused?.imageUrl) {
        renderedRows.push({
          role,
          id: reused.id,
          bytes: await bytesFromImageInput(await dependencies.materialize(reused.imageUrl)),
        });
        continue;
      }
    }
    if (viewReceipt && !viewReceipt.providerTaskId && viewReceipt.status === "unknown") {
      return {
        status: "error",
        error: `${role} 视角上次提交状态不明且没有供应商任务号，系统不会自动重复购买`,
        operationToken: input.operationToken,
      };
    }
    const rendered = await renderOneView({
      storyId: input.storyId,
      userId: input.userId,
      operationToken: input.operationToken,
      viewToken,
      role,
      prompt: resolved.prompts.get(role)!,
      identityBase,
      contextReferences,
      ...(viewReceipt?.providerTaskId ? { resumeTaskId: viewReceipt.providerTaskId } : {}),
      resolved,
      dependencies,
    });
    if ("status" in rendered) return rendered;
    renderedRows.push(rendered);
  }

  return finalizeCanonicalBoard({ ...input, resolved, renderedRows, dependencies });
}

export async function quoteVisualAssetView(input: {
  storyId: number;
  userId: number;
  assetId: string;
  versionId: string;
  role: VisualAssetView["role"];
  instruction?: string;
  dependencies?: Partial<CreationDependencies>;
}): Promise<VisualAssetCanonicalBoardQuote> {
  const dependencies = dependenciesOf(input.dependencies);
  const resolved = await generationInput({ ...input, dependencies });
  if (!resolved.roles.includes(input.role)) {
    throw new VisualAssetValidationError(`${input.role} 不是需要生成的标准视角`);
  }
  const estimate = estimateStoryboardMaskedEditCost();
  const unsigned = {
    storyId: input.storyId,
    assetId: input.assetId,
    versionId: input.versionId,
    inputHash: viewInputHash(resolved, input.role),
    currency: estimate.currency,
    estimatedCny: estimate.estimatedCny,
    candidateCount: 1,
    expiresAt: dependencies.now() + 10 * 60_000,
  };
  return { ...unsigned, quoteId: signQuote(unsigned) };
}

/**
 * 只重新生成一个标准视角，其余视角沿用已付费的结果。
 *
 * 用于 prompt 调优：整组重生成一次是 N × 单价，单视角迭代只花一次的钱。
 * 其余视角直接读版本里已存的视图图片，重新合板后再跑一次结构质检。
 */
export async function regenerateVisualAssetView(input: {
  storyId: number;
  userId: number;
  assetId: string;
  versionId: string;
  role: VisualAssetView["role"];
  operationToken: string;
  confirmation?: VisualAssetCanonicalBoardQuote;
  instruction?: string;
  dependencies?: Partial<CreationDependencies>;
}): Promise<CanonicalBoardResult> {
  const dependencies = dependenciesOf(input.dependencies);
  const resolved = await generationInput({ ...input, dependencies });
  if (!resolved.roles.includes(input.role)) {
    return {
      status: "error",
      error: `${input.role} 不是需要生成的标准视角`,
      operationToken: input.operationToken,
    };
  }
  const existing = resolved.current.aggregate.operations.find(
    receipt => receipt.token === input.operationToken
  );
  if (existing?.status === "succeeded" && existing.resultId === input.versionId) {
    const replay = replayFromStoredViews(
      resolved.version,
      resolved.asset.kind,
      input.operationToken
    );
    if (replay) return replay;
  }
  const quote = await quoteVisualAssetView({ ...input, dependencies });
  if (
    !confirmationIsValid(
      input.confirmation,
      { ...input, inputHash: viewInputHash(resolved, input.role) },
      dependencies.now()
    )
  ) {
    return { status: "confirmation_required", quote };
  }
  const identityBase = resolved.references[0]?.materialized;
  if (!identityBase) {
    return {
      status: "error",
      error: "资产没有可用参考图，无法生成标准视图",
      operationToken: input.operationToken,
    };
  }
  const contextReferences = resolved.references
    .slice(1)
    .map(reference => reference.materialized);

  const renderedRows: RenderedView[] = [];
  for (const role of resolved.roles) {
    if (role === input.role) {
      const viewToken = `${input.operationToken}:view:${role}`;
      const viewReceipt = resolved.current.aggregate.operations.find(
        receipt => receipt.token === viewToken
      );
      // 图已经买到手、但合板或落库那一步失败时，重试必须复用这张图。
      // 少了这一支，同一个 token 重试会把同一个视角再买一遍（2026-08-21 实测踩到）。
      if (viewReceipt?.status === "succeeded" && viewReceipt.resultId) {
        const reused = await dependencies.getImage(Number(viewReceipt.resultId));
        if (reused?.imageUrl) {
          renderedRows.push({
            role,
            id: reused.id,
            bytes: await bytesFromImageInput(
              await dependencies.materialize(reused.imageUrl)
            ),
          });
          continue;
        }
      }
      if (viewReceipt && !viewReceipt.providerTaskId && viewReceipt.status === "unknown") {
        return {
          status: "error",
          error: `${role} 视角上次提交状态不明且没有供应商任务号，系统不会自动重复购买`,
          operationToken: input.operationToken,
        };
      }
      const rendered = await renderOneView({
        storyId: input.storyId,
        userId: input.userId,
        operationToken: input.operationToken,
        viewToken,
        role,
        prompt: resolved.prompts.get(role)!,
        identityBase,
        contextReferences,
        ...(viewReceipt?.providerTaskId ? { resumeTaskId: viewReceipt.providerTaskId } : {}),
        resolved,
        dependencies,
      });
      if ("status" in rendered) return rendered;
      renderedRows.push(rendered);
      continue;
    }
    // 其余视角沿用版本里已付费的图片，一分钱都不再花。
    const stored = resolved.version.views.find(view => view.role === role);
    if (!stored) {
      return {
        status: "error",
        error: `版本里还没有 ${role} 视角，请先完整生成一次标准板`,
        operationToken: input.operationToken,
      };
    }
    const image = await dependencies.getImage(stored.imageId);
    if (!image?.imageUrl) {
      return {
        status: "error",
        error: `${role} 视角的图片 #${stored.imageId} 已不可用`,
        operationToken: input.operationToken,
      };
    }
    renderedRows.push({
      role,
      id: image.id,
      bytes: await bytesFromImageInput(await dependencies.materialize(image.imageUrl)),
    });
  }

  return finalizeCanonicalBoard({ ...input, resolved, renderedRows, dependencies });
}
