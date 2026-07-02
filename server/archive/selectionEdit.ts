import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { invokeAgent } from "../_core/agentChannel";
import type { SelectionContext } from "../../shared/selectionContext";

// ── 选中编辑（行内选区编辑）──────────────────────────────────

/** 对文本中选中片段执行 AI 编辑指令，返回替换后的完整文本 */
export async function handleSelectionEdit(params: {
  fullText: string;
  selectedText: string;
  instruction: string;
  selectionContext?: SelectionContext;
  projectId?: number;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ isApprovalOnly: boolean; modifiedFullText: string; reply: string }> {
  const isTextSelection =
    !params.selectionContext?.selection ||
    params.selectionContext.selection.kind === "text";
  const selectionSummary = describeSelectionContext(params.selectionContext);
  const systemPrompt = isTextSelection
    ? `你是一位文字编辑助手。用户会给你一段完整文本和其中被选中的片段，以及一条编辑指令。
请只修改选中的部分，保持其余文字不变，返回修改后的完整文本。

要求：
1. 仅修改选中片段，上下文保持一致
2. 遵循用户的编辑指令
3. 如果指令是确认/赞同性质的（如"好的"、"不错"），不做修改，isApprovalOnly 设为 true
4. 返回 JSON 格式：{"isApprovalOnly":false,"modifiedFullText":"修改后的完整文本","reply":"简短说明做了什么改动"}`
    : `你是小酌，一位会听用户说话、帮用户把故事做成画面和短片的创作伙伴。
用户现在不是在要求你改一段文字，而是在动态分镜/故事画面里框选了图片区域或视频时间段。

你会收到：
- 镜头上下文文本
- 用户框选对象的结构化元数据
- 用户想让你判断或修改的指令

要求：
1. 不要声称你已经真实看到了像素或视频内容；只能基于选区元数据和镜头上下文判断
2. 用小酌的自然语言回答：这个选区可以怎么用、可能要改什么、下一步适合做图生图/视频剪辑/提示词调整中的哪一种
3. 不要改写完整文本，modifiedFullText 必须原样返回完整文本，isApprovalOnly 设为 true
4. 返回 JSON 格式：{"isApprovalOnly":true,"modifiedFullText":"原完整文本","reply":"给用户的判断和建议"}`;

  const userMessage = `完整文本：
---
${params.fullText}
---

选中片段：
---
${params.selectedText}
---

${selectionSummary ? `选区上下文：\n---\n${selectionSummary}\n---\n\n` : ""}
编辑指令：${params.instruction}`;

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...(params.history ?? []).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: userMessage },
  ];

  const result = await invokeAgent(messages, 2048);
  const parsed = parseJsonLoose<{ isApprovalOnly: boolean; modifiedFullText: string; reply: string }>(result.text);
  if (parsed && typeof parsed.modifiedFullText === "string") {
    if (!isTextSelection) {
      return {
        isApprovalOnly: true,
        modifiedFullText: params.fullText,
        reply: parsed.reply || "我收到这个选区了，可以基于它继续判断下一步。",
      };
    }
    return parsed;
  }
  // 解析失败时回退：直接返回原文
  return {
    isApprovalOnly: !isTextSelection,
    modifiedFullText: params.fullText,
    reply: isTextSelection
      ? "未能解析 AI 返回结果，保留原文"
      : "我收到这个选区了，但这次没有整理出稳定建议。你可以换一种说法再问我。",
  };
}

function describeSelectionContext(selection?: SelectionContext): string {
  if (!selection) return "";
  const lines = [
    `来源：${selection.sourceType}:${selection.sourceId}`,
    selection.storyId != null ? `故事 ID：${selection.storyId}` : "",
    selection.stableShotId ? `稳定镜头 ID：${selection.stableShotId}` : "",
    selection.shotNo != null ? `镜号：SH${String(selection.shotNo).padStart(2, "0")}` : "",
    selection.materialStatus ? `素材状态：${selection.materialStatus}` : "",
    selection.objectVersion ? `对象版本：${selection.objectVersion}` : "",
    selection.imageId != null ? `图片 ID：${selection.imageId}` : "",
    selection.videoTakeId != null ? `视频 Take ID：${selection.videoTakeId}` : "",
    selection.rangeId != null ? `时间段 ID：${selection.rangeId}` : "",
    selection.selection ? `选区：${describeRegion(selection.selection)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function describeRegion(region: NonNullable<SelectionContext["selection"]>): string {
  if (region.kind === "text") {
    return `文字 ${region.start}-${region.end}`;
  }
  if (region.kind === "time") {
    return `视频时间 ${region.startSec.toFixed(2)}s-${region.endSec.toFixed(2)}s`;
  }
  return [
    "画面矩形",
    `x=${Math.round(region.x * 100)}%`,
    `y=${Math.round(region.y * 100)}%`,
    `宽=${Math.round(region.width * 100)}%`,
    `高=${Math.round(region.height * 100)}%`,
  ].join(" ");
}
