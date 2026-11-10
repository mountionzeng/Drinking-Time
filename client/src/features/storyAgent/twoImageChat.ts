import type { ChatImageRef } from "./chatImageRefs";

const SELECTED_SHOT_REFERENCE = "当前镜头已选画面（美术参考）";

export function selectedImageFrameRole(text: string): "first" | "last" | "reference" | null {
  const match = /^(?:把这张(?:图片|图)?|将这张(?:图片|图)?|这张(?:图片|图)?|把它|将它|它)?\s*(?:设为|设置为|作为|用作|变成)\s*(首帧|尾帧|参考帧|中间参考)[。！!\s]*$/.exec(text.trim());
  return match ? match[1] === "首帧" ? "first" : match[1] === "尾帧" ? "last" : "reference" : null;
}

export function rejectsBothImageCandidates(text: string) {
  return /^(?:都不要|两张都不要|都不用|不要这两张|reject both|neither)(?:[，,。.!！\s]|$)/i.test(text.trim());
}

/** An established scene is the composition base unless the user names another base. */
export function orderTwoImageReferences(refs: readonly ChatImageRef[], instruction: string) {
  const explicitBase = /(?:第\s*[一二三123]\s*张(?:图)?|图\s*[123]).{0,12}(?:底图|基底|作为基础)|(?:use|make)\s+(?:the\s+)?(?:first|second|third)\s+(?:image|picture)\s+as\s+(?:the\s+)?base/i.test(instruction);
  const index = explicitBase ? -1 : refs.findIndex(ref => ref.label === SELECTED_SHOT_REFERENCE);
  if (index < 0) return { refs: [...refs], lockedBase: false };
  return { refs: [refs[index], ...refs.filter((_, i) => i !== index)], lockedBase: true };
}

/** Explicit replies only: ordinary conversation must never approve a purchase or adopt media. */
export function twoImageReply(text: string, state: "confirming" | "done") {
  const value = text.trim().replace(/[。.!！]+$/u, "");
  if (state === "confirming") {
    if (/^(确认|确认生成|生成|好的|可以|yes|confirm|generate)$/i.test(value))
      return { kind: "confirm" as const };
    if (/^(取消|先不|不生成|cancel|no)$/i.test(value))
      return { kind: "cancel" as const };
    return null;
  }
  if (rejectsBothImageCandidates(value) && /^(?:都不要|两张都不要|都不用|不要这两张|reject both|neither)$/i.test(value))
    return { kind: "cancel" as const };
  if (
    /^(ok|好的|可以|都要|两张都用|两张都放入|两张都加入|use both|add both)$/i.test(
      value
    )
  )
    return { kind: "adopt" as const, indices: [0, 1] };
  const english = value.match(/^(?:use|adopt|add)\s+(?:image\s*)?([12])$/i);
  if (english)
    return { kind: "adopt" as const, indices: [Number(english[1]) - 1] };
  const match = value.match(
    /^(?:(?:用|采用|选择|加入|放入|use|adopt|add)\s*)?(?:第\s*)?([12一二])\s*(?:张|幅|image)?\s*(?:放入|加入|采用|就好|即可|到镜头)?$/i
  );
  if (
    match &&
    (/(?:用|采用|选择|加入|放入|use|adopt|add|就好|即可)/i.test(value) || /^第\s*[12一二]\s*[张幅]$/.test(value))
  )
    return {
      kind: "adopt" as const,
      indices: [/[1一]/.test(match[1]) ? 0 : 1],
    };
  return null;
}

/** Each request is submitted once; failed or uncertain results are never retried automatically. */
export async function generateTwoImageCandidates<T>(
  generate: (index: number) => Promise<T>
) {
  const results = await Promise.allSettled([generate(0), generate(1)]);
  return {
    candidates: results.flatMap(result =>
      result.status === "fulfilled" ? [result.value] : []
    ),
    failures: results.filter(result => result.status === "rejected").length,
  };
}

export function twoImageInstruction(instruction: string, index: number, lockedBase = false) {
  const placement = lockedBase
    ? "图1是当前镜头的完整画面。保留画幅、主体、界面和物件之间的相对位置、比例与构图；不要擅自裁切、平移、缩放或重新布局。其他参考图用于用户指定的造型和表情；用户明确要求的动作和位置变化优先。"
    : "按用户指定的底图和参考顺序处理；未要求的主体位置和构图保持一致。";
  return `${instruction}\n\n请生成第 ${index + 1} 张独立完整画面。若用户描述了前后变化，第 1 张呈现开端，第 2 张呈现后续状态；否则提供不同的构图选择。${placement}不要拼贴或分格。`;
}
