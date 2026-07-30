export type LocalEditingChatCommand =
  | { type: "undo" }
  | { type: "capabilities" };

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
