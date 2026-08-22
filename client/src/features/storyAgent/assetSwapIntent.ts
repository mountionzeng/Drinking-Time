import type { VisualAssetKind } from "@shared/visualAssets";

/**
 * 「把这张图里的人换成素材里的那个人物」——选中一张镜头画面，在聊天框里点名用
 * 素材库里已锁定的视觉资产重画这一镜。
 *
 * 这条路只改**这一镜的画面**，不改资产本身。资产的固定造型（人物的
 * face/hair/outfit/accessories、场景的 geometry/materials/fixedProps、
 * 风格的 medium/brushwork/...）是所有已绑定镜头共用的契约，改它要走
 * visualAssets.amendFixedFacts 并整套重出，不在这里。
 *
 * 判定不交给模型：说错一次的代价是「正面光脚、侧面背面穿鞋」那种资产报废，
 * 所以这里只做保守的字面匹配，认不出就不提案，让用户自己去资产面板。
 */

/**
 * 三类资产各自的说法，分两档。
 *
 * 先匹配明确档，都不中再看宽松档：宽松档只有单字（「图里的人」要读成人物），
 * 但单字会误伤——「个人风格」里的「人」不是人物。所以明确档必须先跑完，
 * 让「风格」先把这句认走。
 */
const KIND_WORDS: Record<VisualAssetKind, readonly string[]> = {
  character: ["人物", "角色", "主角", "女主", "男主"],
  scene: ["场景", "地点", "环境"],
  style: ["风格", "画风", "调性"],
};

const LOOSE_KIND_WORDS: Record<VisualAssetKind, readonly string[]> = {
  character: ["人"],
  scene: ["景"],
  style: [],
};

/** 指向素材库的说法。没有这类词就不算「换成素材里的」，避免把普通改图误判。 */
const LIBRARY_WORDS = [
  "素材",
  "资产",
  "素材库",
  "素材仓库",
  "资产库",
  "标准板",
  "标准视图",
] as const;

/** 表示「换成 / 用它」的动作词。 */
const SWAP_WORDS = [
  "换成",
  "改成",
  "替换",
  "换为",
  "改为",
  "用素材",
  "用资产",
  "统一成",
  "对齐",
  "保持一致",
] as const;

export type AssetSwapCandidate = {
  assetId: string;
  versionId: string;
  kind: VisualAssetKind;
  assetName: string;
  /** 版本序号，用来在卡上写「版本 2」。 */
  versionLabel: string;
};

export type AssetSwapIntent =
  | { status: "none" }
  | {
      status: "ambiguous";
      kind: VisualAssetKind;
      candidates: AssetSwapCandidate[];
    }
  | { status: "ready"; kind: VisualAssetKind; asset: AssetSwapCandidate };

function mentions(text: string, words: readonly string[]): boolean {
  return words.some(word => text.includes(word));
}

/** 用户点名的是哪一类资产；没点名就返回 null。 */
export function detectAssetSwapKind(
  instruction: string
): VisualAssetKind | null {
  const text = instruction.trim();
  if (!text) return null;
  for (const kind of ["character", "scene", "style"] as const) {
    if (mentions(text, KIND_WORDS[kind])) return kind;
  }
  for (const kind of ["character", "scene", "style"] as const) {
    if (mentions(text, LOOSE_KIND_WORDS[kind])) return kind;
  }
  return null;
}

/**
 * 资产可以就叫「人物」「场景」——这种名字和类别词完全重合，在句子里出现
 * 不代表用户点了它的名。拿它做消歧会把「换成素材里的人物」误判成点名，
 * 于是在有多个人物资产时替用户瞎选一个。
 */
function isDistinctiveName(name: string, kind: VisualAssetKind): boolean {
  const generic = [...KIND_WORDS[kind], ...LOOSE_KIND_WORDS[kind]];
  return name.trim().length > 0 && !generic.includes(name.trim());
}

/**
 * 判定这句话是不是「用素材库里的资产重画这一镜」。
 *
 * 三个条件都要满足：指向素材库、点名了资产类别、有替换动作。少一个就当普通改图 ——
 * 「把她的裙子改长一点」不该触发绑定，那是改资产的固定造型，是另一条路。
 */
export function detectAssetSwapIntent(input: {
  instruction: string;
  /** 只传已锁定版本的资产：没锁定的绑不上，也不该出现在提案里。 */
  lockedAssets: readonly AssetSwapCandidate[];
}): AssetSwapIntent {
  const text = input.instruction.trim();
  if (!text) return { status: "none" };
  if (!mentions(text, LIBRARY_WORDS)) return { status: "none" };
  if (!mentions(text, SWAP_WORDS)) return { status: "none" };
  const kind = detectAssetSwapKind(text);
  if (!kind) return { status: "none" };

  const matches = input.lockedAssets.filter(asset => asset.kind === kind);
  if (matches.length === 0) return { status: "none" };
  if (matches.length === 1) {
    return { status: "ready", kind, asset: matches[0]! };
  }
  // 点名了名字就用名字消歧，否则交回用户选，不替他猜。
  // 只认有辨识度的名字：叫「人物」的资产不能靠「人物」两个字被选中。
  const named = matches.filter(
    asset =>
      isDistinctiveName(asset.assetName, kind) && text.includes(asset.assetName)
  );
  if (named.length === 1) return { status: "ready", kind, asset: named[0]! };
  return { status: "ambiguous", kind, candidates: matches };
}

export function assetKindLabel(kind: VisualAssetKind): string {
  if (kind === "character") return "人物";
  if (kind === "scene") return "场景";
  return "风格";
}

export type AssetSwapProposal = {
  kind: VisualAssetKind;
  asset: AssetSwapCandidate;
  stableShotId: string;
  /** 选区带过来的镜号；generateForMobile 靠它解析这一镜绑定的资产。 */
  shotNo: number | null;
  shotLabel: string;
  /** 被选中的那张图；重渲以它为视觉基底。 */
  imageId: number | null;
  instruction: string;
  estimatedCny: number;
  /** 这一镜此前是否已经绑过同一个资产版本；已绑过就只需要重渲。 */
  alreadyBound: boolean;
};

/**
 * 提案卡的正文。必须说清楚两件事，否则用户会以为只改这一次：
 * 绑定是**持续生效**的，以及这一步要花多少钱。
 */
export function describeAssetSwapProposal(proposal: AssetSwapProposal): string {
  const kindLabel = assetKindLabel(proposal.kind);
  const lines = [
    `${proposal.shotLabel}：把画面里的${kindLabel}换成素材库的「${proposal.asset.assetName} · ${proposal.asset.versionLabel}」。`,
  ];
  if (proposal.alreadyBound) {
    lines.push(
      `这一镜已经绑定了这个${kindLabel}资产，本次只重新生成画面，不改绑定。`
    );
  } else {
    lines.push(
      `确认后会把这个${kindLabel}资产绑定到${proposal.shotLabel}——以后这一镜每次出图都用它，不只是这一次。`
    );
  }
  lines.push(
    `资产的固定造型不会被改动；要改造型本身（比如换服装、换发型），得去资产面板改固定事实，那会让所有已绑镜头重出。`,
    `预计人民币 ¥${proposal.estimatedCny.toFixed(2)}；确认后才会提交 302 并产生费用。新候选先进素材仓库，点结果上的「用这张」才会替换这一镜的当前画面。`
  );
  return lines.join("\n");
}

/**
 * 绑定之后这一镜的重渲提示词。
 *
 * 关键约束：**不能再描述被绑定那一维的身份**。服务端一致性闸门
 * （visualAssetGenerationContext 的 textConflicts）看到「改成/换成/替换」
 * 加上「人物/发型/服饰/场景/画风」这类词就判定「镜头文字要求改变已锁定的事实」，
 * 整单拒绝且不出图。用户那句「把人换成素材里的人物」已经由绑定本身执行掉了，
 * 再原样送进提示词只会把自己挡在门外。
 */
export function buildAssetSwapRenderPrompt(
  proposal: AssetSwapProposal
): string {
  const kindLabel = assetKindLabel(proposal.kind);
  return [
    `${proposal.shotLabel}：重新生成这一镜的画面。`,
    `${kindLabel}以这一镜已绑定的资产为准，不要另行描述。`,
    `地点、构图、机位、景别和光线沿用这一镜现有画面，不要改动。`,
  ].join("\n");
}
