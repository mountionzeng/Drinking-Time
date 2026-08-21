/**
 * 对话框的图片引用篮子 —— 图生图的入口。
 *
 * 素材仓库的缩略图、故事版的缩略图、时间轴上的图片 clip、本地上传入库的图，
 * 背后都是 generated_images 的同一行（ImageAsset.id）。所以引用只需要存
 * imageId + imageUrl：从哪个面板加进来的都一样，不必给每个面板各做一套。
 *
 * 上限 4 = 服务端 302 /v1/images/edits 能吃下的 1 张底图 + 3 张参考图
 * （server/services/imageGen.ts 的 contextSources 截断在 3）。超出这个数
 * 多加的图会被服务端悄悄丢掉，而提示词里还在说「图5」，所以在这里就挡住。
 */

/** 底图 1 张 + 上下文 3 张，和服务端 referenceContextImageUrls 的 max(3) 对齐。 */
export const MAX_CHAT_IMAGE_REFS = 4;

export type ChatImageRef = {
  /** generated_images.id —— 所有面板共用的同一个身份。 */
  imageId: number;
  imageUrl: string;
  /** 缩略图下的来源说明，如「0102 首帧」「待归类」。只用于展示和提示词标注。 */
  label: string;
};

export type ChatImageRefChange = {
  refs: ChatImageRef[];
  /** 没能加进去时的原因，直接拿去 toast。 */
  rejected?: string;
};

function sameImage(a: ChatImageRef, imageId: number): boolean {
  return a.imageId === imageId;
}

export function hasChatImageRef(
  refs: readonly ChatImageRef[],
  imageId: number
): boolean {
  return refs.some(ref => sameImage(ref, imageId));
}

export function addChatImageRef(
  refs: readonly ChatImageRef[],
  ref: ChatImageRef
): ChatImageRefChange {
  if (!Number.isInteger(ref.imageId) || ref.imageId <= 0) {
    return { refs: [...refs], rejected: "这张图还没有入库，先等它保存完" };
  }
  if (!ref.imageUrl.trim()) {
    return { refs: [...refs], rejected: "这张图的地址丢了，无法作为参考" };
  }
  if (hasChatImageRef(refs, ref.imageId)) return { refs: [...refs] };
  if (refs.length >= MAX_CHAT_IMAGE_REFS) {
    return {
      refs: [...refs],
      rejected: `一次最多引用 ${MAX_CHAT_IMAGE_REFS} 张图，先去掉一张`,
    };
  }
  return { refs: [...refs, ref] };
}

export function removeChatImageRef(
  refs: readonly ChatImageRef[],
  imageId: number
): ChatImageRef[] {
  return refs.filter(ref => !sameImage(ref, imageId));
}

export function toggleChatImageRef(
  refs: readonly ChatImageRef[],
  ref: ChatImageRef
): ChatImageRefChange {
  if (hasChatImageRef(refs, ref.imageId)) {
    return { refs: removeChatImageRef(refs, ref.imageId) };
  }
  return addChatImageRef(refs, ref);
}

/**
 * 把某张图提成底图（图1）。底图是 302 编辑端点真正在改的那张，画幅和整体
 * 构图从它继承，所以必须让用户能改，而不是按点击顺序碰运气。
 */
export function promoteChatImageRefToBase(
  refs: readonly ChatImageRef[],
  imageId: number
): ChatImageRef[] {
  const target = refs.find(ref => sameImage(ref, imageId));
  if (!target) return [...refs];
  return [target, ...refs.filter(ref => !sameImage(ref, imageId))];
}

/** 提示词和界面上的图号：底图永远是图1，和实际发送顺序严格对应。 */
export function chatImageRefRole(index: number): string {
  return index === 0 ? "图1（底图）" : `图${index + 1}`;
}

export type ChatImageRemixRequest = {
  /** 底图 URL，对应服务端 referenceImageUrl。 */
  referenceImageUrl: string;
  /** 其余参考图，对应服务端 referenceContextImageUrls（最多 3 张）。 */
  referenceContextImageUrls: string[];
  /** 用户原话，一字不改地送到图片模型。 */
  explicitInstruction: string;
  /** 逐张说明图号与来源的清单，作为 prompt 主体。 */
  prompt: string;
};

/**
 * 图生图的参考图清单。
 *
 * 和故事版那份 storyboardReferenceManifest 的关键区别：那份把上下文图的职责
 * 写死成「只借质感和服装，严禁搬场景构图」，服务的是前后镜头不跳戏。这里的
 * 职责由用户原话决定 —— 「取这张的光，取那张的姿势」—— 所以清单只声明图号
 * 和来源，不预设每张图该贡献什么，剩下的交给用户那句话。
 */
export function buildChatImageRemixManifest(input: {
  refs: readonly ChatImageRef[];
  instruction: string;
}): string {
  const instruction = input.instruction.trim();
  const lines = input.refs.map(
    (ref, index) =>
      `${chatImageRefRole(index)}＝${ref.label}（图片 #${ref.imageId}）`
  );
  return [
    "参考图清单（按顺序对应发给你的图片）：",
    ...lines,
    "",
    "用户要求（原话，严格执行）：",
    instruction,
    "",
    "只按上面这句话决定从每张图里取什么。用户没有点名的图，不要主动搬它的构图、场景、人物或配色。",
    "画幅和整体构图以图1为基准，除非用户明确要求改构图。",
    "输出一张完整的新画面，不要拼贴、不要做成对比图或分格图。",
  ].join("\n");
}

export function buildChatImageRemixRequest(input: {
  refs: readonly ChatImageRef[];
  instruction: string;
}): ChatImageRemixRequest | { error: string } {
  const instruction = input.instruction.trim();
  if (input.refs.length === 0) return { error: "先选中至少一张图再说要改什么" };
  if (!instruction) return { error: "说一句要怎么改，比如「用第一张的光」" };
  const [base, ...rest] = input.refs;
  return {
    referenceImageUrl: base.imageUrl,
    referenceContextImageUrls: rest
      .slice(0, MAX_CHAT_IMAGE_REFS - 1)
      .map(ref => ref.imageUrl),
    explicitInstruction: instruction,
    prompt: buildChatImageRemixManifest({ refs: input.refs, instruction }),
  };
}
