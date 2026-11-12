import { useMutationState } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import type { VideoTakeAsset } from "@shared/videoAsset";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

type Shot = { stableShotId?: string | null; shotIdentity?: string | null; shotNo: number };
export function chatVideoTasks(takes: VideoTakeAsset[], stableShotId?: string | null) {
  return takes.filter(t => (!stableShotId || t.stableShotId === stableShotId) && t.provider !== "manual" && t.provider !== "local-import")
    .sort((a, b) => b.id - a.id).slice(0, 6);
}

/** Read saved takes, so refresh and a different selected shot cannot lose results. */
export function ChatVideoTasks({ storyId, shots, stableShotId }: { storyId: number; shots: Shot[]; stableShotId?: string | null }) {
  const { language } = useUiLanguage();
  const en = language === "en";
  const query = trpc.storyAgent.storyVideoAssets.useQuery({ storyId }, { refetchInterval: 3000 });
  const pending = useMutationState({ filters: { status: "pending" }, select: mutation => {
    const path = mutation.options.mutationKey?.[0];
    const name = Array.isArray(path) ? path.join(".") : String(path);
    const variables = mutation.state.variables as { storyId?: number; shotNo?: number; stableShotId?: string; takeId?: number } | undefined;
    const target = variables?.stableShotId ?? shots.find(s => s.shotNo === variables?.shotNo)?.stableShotId
      ?? query.data?.find(t => t.id === variables?.takeId)?.stableShotId;
    return (!stableShotId || target === stableShotId) && variables?.storyId === storyId && ["storyAgent.gradeVideoLuminance", "storyAgent.gradeVideoRegion", "creationAgent.generateShotVideo", "creationAgent.submitStartEndShotVideo"].includes(name) ? variables : null;
  } }).filter(Boolean);
  const takes = chatVideoTasks(query.data ?? [], stableShotId);
  if (!pending.length && !takes.length) return null;
  return <section aria-label={en ? "Video versions" : "视频版本 / Video versions"} className="space-y-3 py-2">
    {pending.length > 0 && <p role="status" className="text-xs text-muted-foreground">{en ? "Preparing video. You can keep chatting." : "正在处理视频，你可以继续输入。"}</p>}
    {takes.map((take, index) => {
      const shot = shots.find(s => (s.stableShotId ?? s.shotIdentity) === take.stableShotId);
      const label = shot ? String(shot.shotNo).padStart(2, "0") : "?";
      const running = take.status === "processing" || take.status === "submitted";
      const stale = running && Date.now() - Date.parse(take.updatedAt) > 35 * 60_000;
      const ready = take.status === "available" && take.videoUrl;
      const card = <article key={take.id} className="rounded-lg border border-border p-3 text-xs space-y-2" aria-label={`${en ? "Shot" : "第"} ${label} · Take ${take.id}`}>
        <p>{en ? `Shot ${label}` : `第 ${label} 镜`} · Take {take.id}{take.durationSec ? ` · ${Number(take.durationSec.toFixed(2))}s` : ""}</p>
        {ready ? <><video src={take.videoUrl!} aria-label={`Take ${take.id}`} controls preload="metadata" className="max-h-48 w-full rounded object-contain" />
          <p>{take.isTimelineSelected ? (en ? "On the timeline. Previous versions stay in Warehouse." : "已放入镜头，旧版保留在仓库。") : en ? `Saved in Warehouse. Put it in shot ${label}? Reply “第 ${label} 镜采用视频 Take ${take.id}”.` : `已保存在仓库。放入第 ${label} 镜？回复“第 ${label} 镜采用视频 Take ${take.id}”，或继续说怎么改。`}</p></>
          : <p role="status">{running && !stale ? (en ? "Rendering · You can keep chatting" : "正在生成 · 可以继续聊天") : take.status === "failed" ? (en ? "Failed · No automatic retry" : "生成失败 · 未自动重试") : (en ? "Status pending · Original task retained" : "状态待确认 · 原任务已保留")}</p>}
      </article>;
      return index === 0 || running ? card : <details key={take.id} className="text-xs text-muted-foreground">
        <summary className="cursor-pointer py-1">{en ? "Shot" : "镜头"} {label} · Take {take.id} · {take.isTimelineSelected ? (en ? "On timeline" : "已采用") : en ? "Previous version" : "历史版本"}</summary>
        {card}
      </details>;
    })}
  </section>;
}
