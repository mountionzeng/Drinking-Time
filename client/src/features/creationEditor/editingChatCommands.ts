export type LocalEditingChatCommand =
  | { type: "undo" }
  | { type: "capabilities" };

export type CreationFlowFocus = "memory" | "publishing" | "images" | "storyboard" | "editing" | "origin";
export function parseCreationFlowFocus(text: string): CreationFlowFocus | null {
  const value = text.trim().replace(/[。！!]/g, "");
  if (/^(返回|回到|打开|去)(记忆|记忆仓库)$/.test(value)) return "memory";
  if (/^(返回|回到|打开|去)(文字|文章|文字区|文字历史)$/.test(value)) return "publishing";
  if (/^(返回|回到|打开|去)分镜$/.test(value)) return "storyboard";
  if (/^(返回|回到|打开|去)(图像|图片区|图像区)$/.test(value)) return "images";
  if (/^(返回|回到|打开|去)(视频|视频区|时间线|图像和声音)$/.test(value)) return "editing";
  if (/^(回到|返回)(刚才|原来)(的)?(位置|环节|工作区)$/.test(value)) return "origin";
  return null;
}

export function shouldDeferStoryboardImageCommand(input: {
  sourceType?: string;
  appliedCount: number;
  hasProposal: boolean;
}): boolean {
  return (
    input.sourceType === "storyboard-image" &&
    input.appliedCount === 0 &&
    !input.hasProposal
  );
}

function compactInstruction(instruction: string): string {
  return instruction
    .trim()
    .replace(/[，。！？!?；;、]/g, "")
    .replace(/\s+/g, "");
}

export function parseLocalEditingChatCommand(
  instruction: string
): LocalEditingChatCommand | null {
  const compact = compactInstruction(instruction);
  if (
    /^(?:撤销|撤回|上一步|回到上一步|恢复上一步|取消上一步(?:修改|操作|剪辑)?|取消刚才(?:的)?(?:修改|操作|剪辑)?|把刚才(?:的)?(?:修改|操作|剪辑)?改回来|改回刚才(?:的)?样子)$/.test(
      compact
    )
  ) {
    return { type: "undo" };
  }
  if (
    /^(?:你能做什么|这里能做什么|聊天框能做什么|可以怎么剪|能改什么|支持哪些剪辑(?:功能|操作)?|剪辑功能有哪些)$/.test(
      compact
    )
  ) {
    return { type: "capabilities" };
  }
  return null;
}
