type Take = { id: number; status: string; videoUrl?: string | null; durationSec?: number | null };

/** Watch the existing video refresh loop; this never submits or re-purchases. */
export async function completeChatVideo(input: {
  takeId: number; label: string; current: () => boolean; read: () => Take | undefined;
  confirm: (take: Take) => Promise<boolean>; adopt: (take: Take) => Promise<void>;
  wait?: () => Promise<void>; now?: () => number; timeoutMs?: number;
}) {
  const now = input.now ?? Date.now;
  const start = now();
  const wait = input.wait ?? (() => new Promise(resolve => setTimeout(resolve, 1000)));
  while (input.current() && now() - start < (input.timeoutMs ?? 10 * 60_000)) {
    const take = input.read();
    if (take?.id === input.takeId && take.status === "available" && take.videoUrl) {
      const accepted = await input.confirm(take);
      if (!input.current()) return "视频已保留在原故事仓库，未放入镜头。";
      if (!accepted) return `视频 Take ${take.id} 已保存在仓库，尚未放入第 ${input.label} 镜。`;
      await input.adopt(take);
      return `视频 Take ${take.id} 已放入第 ${input.label} 镜和对应剪辑位置，所有版本已保存在仓库。`;
    }
    if (take?.id === input.takeId && ["failed", "unusable", "cancelled"].includes(take.status))
      return `视频 Take ${take.id} 未生成成功，任务记录已保留，没有重复提交。`;
    if (take?.id === input.takeId && ["timeout", "unfollowable"].includes(take.status))
      return `视频 Take ${take.id} 暂时无法确认结果，任务记录已保留；请在仓库核对，没有重复提交。`;
    await wait();
  }
  return `视频 Take ${input.takeId} 仍在原任务中，完成后可从仓库查看；没有重复生成或自动放入镜头。`;
}
