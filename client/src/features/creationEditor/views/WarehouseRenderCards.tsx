import { RetryImageButton } from "@/features/storyAgent/views/RetryImageButton";
import { useState } from "react";
import { FeedbackDialog } from "@/features/computeAccount/FeedbackDialog";
import { WarehousePreviewRetry } from "./WarehousePreviewRetry";
import { Check, CircleAlert, Image, Loader2, Music2, Video } from "lucide-react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import type { WarehouseRenderJob } from "../warehouseRenderActivity";
import type { CreationEditorShot } from "../types";
import { displayShotCode } from "@shared/shotIdentity";

export function WarehouseRenderCards({ jobs, shots, inline = false, onReference }: {
  jobs: readonly WarehouseRenderJob[];
  shots: readonly CreationEditorShot[];
  inline?: boolean;
  onReference?: (id: number, stableShotId?: string) => void;
}) {
  const ui = useUiText();
  const [retrying, setRetrying] = useState<{ job: WarehouseRenderJob; label: string } | null>(null);
  const [issue, setIssue] = useState<{ title: string; content: string } | null>(null);
  function report(label: string, count: number) {
    // This board is public. Only include the display number, media type and attempt count.
    setIssue({ title: ui("{0}渲染失败", [label]), content: ui("我在素材仓库查看{0}时看到了生成失败。", [label]) +
      (count > 1 ? ui("已有 {0} 次失败记录。", [count]) : "") });
    setRetrying(null);
  }
  if (!jobs.length) return null;
  return <div className={inline ? "contents" : "mb-1.5 flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar"} aria-label={ui("生成任务 / Renders")}>
    {jobs.map(job => {
      const Icon = job.kind === "image" ? Image : job.kind === "video" ? Video : Music2;
      const shot = shots.find(s => (s.stableShotId ?? s.shotIdentity) === job.shotId);
      const kind = ui(job.kind === "image" ? "图片" : job.kind === "video" ? "视频" : "声音");
      const name = `${shot ? ui("第 {0} 镜", [displayShotCode(shot)]) : ui("新素材")} · ${kind}`;
      const status = ui(job.state === "rendering" ? "生成中 / Generating" : job.state === "unknown" ? "状态待确认 / Checking" : job.state === "failed" ? "生成失败 / Failed" : "已生成 / Ready");
      const id = job.assetId;
      const photo = <img src={job.url} alt={name} className="h-full w-full object-contain" />;
      return <article key={job.id} data-render-state={job.state} className="w-[128px] max-w-full shrink-0 overflow-hidden rounded-md bg-muted/40" aria-label={`${name} · ${status}`}>
        <div className="relative flex h-[84px] items-center justify-center text-primary">
          {job.state === "ready" && job.url ? job.kind === "image" ? (id && onReference ? <button type="button" aria-label={ui("编辑图片 / Edit image {0}", [id])} className="h-full w-full" onClick={() => onReference(id, job.shotId)}>{photo}</button> : photo)
            : job.kind === "video" ? <video src={job.url} aria-label={name} controls preload="metadata" className="h-full w-full" />
              : <audio src={job.url} aria-label={name} controls preload="none" className="h-8 w-full" />
            : job.state === "failed" && job.error ? <p className="line-clamp-5 px-2 text-[11px] leading-tight text-muted-foreground" title={job.error}>{job.error}</p>
            : <><Icon className="size-6 opacity-60" aria-hidden="true" />
              {job.state === "rendering" ? <Loader2 className="absolute right-2 top-2 size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : job.state === "ready" ? <Check className="absolute right-2 top-2 size-3.5" aria-hidden="true" />
                  : <CircleAlert className="absolute right-2 top-2 size-3.5 text-muted-foreground" aria-hidden="true" />}</>}
        </div>
        <p className="truncate px-1.5 text-[10px] leading-4" title={name}>{name}</p>
        <p role="status" className="px-1.5 pb-1 text-[10px] leading-4 text-muted-foreground">{status}</p>
        {job.state === "failed" && <div className="space-y-1 px-1.5 pb-1.5">
          {job.retry ? <RetryImageButton offer={job.retry} /> : job.previewRetry ?
            <button type="button" className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
              onClick={() => setRetrying({ job, label: name })}>{ui("重新渲染")}</button> :
            <p className="text-[10px] text-muted-foreground">{ui("原参数无法重试，可反馈此问题。")}</p>}
          <button type="button" className="block text-[11px] text-primary underline underline-offset-2"
            onClick={() => report(name, job.failureCount ?? 1)}>{(job.failureCount ?? 0) > 1 ? ui("已失败 {0} 次 · 反馈问题", [job.failureCount]) : ui("反馈问题")}</button>
        </div>}
      </article>;
    })}
    {retrying && <WarehousePreviewRetry job={retrying.job} label={retrying.label} onClose={() => setRetrying(null)}
      onReport={() => report(retrying.label, retrying.job.failureCount ?? 1)} />}
    {issue && <FeedbackDialog issue={issue} onDismiss={() => setIssue(null)} />}
  </div>;
}
