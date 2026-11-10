import { trpc } from "@/lib/trpc";
import { parseArtPreviewChat } from "@shared/artPreview";
import { estimateStoryboardImageCost } from "@shared/imageRenderCost";
import { formatComputeQuote } from "@shared/computeMoney";
import { storySpineStore } from "./spine/storySpine";
import { askMediaChatConfirmation, withMediaChatSession } from "./mediaChatSession";

export function useArtPreviewChat() {
  const plan = trpc.artSystems.previewPlan.useMutation();
  const choose = trpc.artSystems.previewChoose.useMutation();
  const generate = trpc.storyAgent.generateForMobile.useMutation();
  const utils = trpc.useUtils();
  return async (storyId: number, instruction: string) => {
    const command = parseArtPreviewChat(instruction);
    if (!command) return null;
    try {
      if (command.kind === "choose") {
        const chosen = await choose.mutateAsync({ storyId, shotNo: command.shotNo, ordinal: command.ordinal, version: command.version });
        await Promise.all([utils.artSystems.previewRead.invalidate({ storyId }), utils.storyAgent.storyMaterialState.invalidate({ storyId }), utils.storyAgent.storyImages.invalidate({ storyId })]);
        return { handled: true as const, reply: `已将示意方案 V${chosen.version} 的第 ${chosen.label} 镜、第 ${command.ordinal} 张放入对应镜头，图片 #${chosen.imageId}。其余候选和旧版本保留在仓库。` };
      }
      if (command.kind === "show") {
        await utils.artSystems.previewRead.invalidate({ storyId });
        return { handled: true as const, reply: "示意图会在下方按镜头展示。可直接说“第 2 镜用第 3 张”；历史方案可带上 V 版本号。已受理的任务继续取回，不会重复生成。" };
      }
      const reply = await withMediaChatSession(storyId, async () => {
        const scope = storySpineStore.getState();
        const current = () => {
          const state = storySpineStore.getState();
          return state.activeStoryId === storyId && state.storyScopeEpoch === scope.storyScopeEpoch && state.storyLoadEpoch === scope.storyLoadEpoch;
        };
        const batch = await plan.mutateAsync({ storyId, instruction, imageId: command.imageId, operationToken: crypto.randomUUID() });
        await utils.artSystems.previewRead.invalidate({ storyId });
        if (!current()) return "示意方案已保存到原故事，尚未提交图片。";
        const accepted = await askMediaChatConfirmation({ storyId, kind: "cost",
          text: `以图片 #${batch.baselineImageId} 的效果为参考，为 ${batch.shots.length} 个镜头各生成 4 张示意候选，共 ${batch.shots.length * 4} 张，预计 ${formatComputeQuote(batch.estimatedCny)}。\n${batch.musicContext}\n各镜头按自己的台词和意图变化，图片先在对话里供你选择，尚不放入正式镜头。` });
        if (!accepted || !current()) return `示意方案 V${batch.version} 已保存，已取消图片生成，未提交媒体任务。`;
        let next = 0, completed = 0, acceptedJobs = 0;
        const failures: string[] = [];
        const worker = async () => {
          while (current() && next < batch.shots.length) {
            const shot = batch.shots[next++];
            try {
              const result = await generate.mutateAsync({ storyId, shotNo: shot.shotNo, previewBatchId: batch.id,
                costConfirmation: { accepted: true, estimatedCny: estimateStoryboardImageCost().estimatedCny } });
              await utils.artSystems.previewRead.invalidate({ storyId });
              if (result.status === "ok") completed++;
              else if ("providerTaskId" in result && result.providerTaskId) {
                // The durable gallery follows receipts. Release the conversation
                // after submission so users can choose early results or keep talking.
                acceptedJobs++;
              } else failures.push(`${shot.label}：${result.error}`);
            } catch (error) { failures.push(`${shot.label}：${error instanceof Error ? error.message : "任务尚未完成"}`); }
            await utils.artSystems.previewRead.invalidate({ storyId });
          }
        };
        await Promise.all([worker(), worker()]);
        await utils.storyAgent.storyMaterialState.invalidate({ storyId });
        return `示意方案 V${batch.version}：${completed}/${batch.shots.length} 个镜头的候选已取回，${acceptedJobs} 个镜头正在生成，结果会逐镜出现在对话和仓库中。\n有结果后可直接说“第 2 镜用第 3 张”。未选择的图片不会进入正式镜头。${next < batch.shots.length ? `\n切换故事后已停止后续提交，${batch.shots.length - next} 个镜头尚未提交。` : ""}${failures.length ? `\n${failures.join("\n")}。没有自动重试购买。` : ""}`;
      });
      return { handled: true as const, reply };
    } catch (error) {
      return { handled: true as const, reply: `示意流程尚未完成：${error instanceof Error ? error.message : "请稍后查看"}。已有方案和素材保留。` };
    }
  };
}
