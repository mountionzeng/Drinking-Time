import { Check, CircleAlert, Image, Loader2, Music2, Video } from "lucide-react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import type { WarehouseRenderJob } from "../warehouseRenderActivity";
import type { CreationEditorShot } from "../types";
import { displayShotCode } from "@shared/shotIdentity";

export function WarehouseRenderCards({ jobs, shots, inline = false }: {
  jobs: readonly WarehouseRenderJob[];
  shots: readonly CreationEditorShot[];
  inline?: boolean;
}) {
  const ui = useUiText();
  if (!jobs.length) return null;
  return <div className={inline ? "contents" : "mb-1.5 flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar"} aria-label={ui("生成任务 / Renders")}>
    {jobs.map(job => {
      const Icon = job.kind === "image" ? Image : job.kind === "video" ? Video : Music2;
      const shot = shots.find(s => (s.stableShotId ?? s.shotIdentity) === job.shotId);
      const kind = ui(job.kind === "image" ? "图片" : job.kind === "video" ? "视频" : "声音");
      const name = `${shot ? ui("第 {0} 镜", [displayShotCode(shot)]) : ui("新素材")} · ${kind}`;
      const status = ui(job.state === "rendering" ? "生成中 / Generating" : job.state === "unknown" ? "状态待确认 / Checking" : job.state === "failed" ? "生成失败 / Failed" : "已生成 / Ready");
      return <article key={job.id} data-render-state={job.state} className="w-[128px] max-w-full shrink-0 overflow-hidden rounded-md bg-muted/40" aria-label={`${name} · ${status}`}>
        <div className="relative flex h-[84px] items-center justify-center text-primary">
          {job.state === "ready" && job.url ? job.kind === "image" ? <img src={job.url} alt={name} className="h-full w-full object-contain" />
            : job.kind === "video" ? <video src={job.url} aria-label={name} controls preload="metadata" className="h-full w-full" />
              : <audio src={job.url} aria-label={name} controls preload="none" className="h-8 w-full" />
            : <><Icon className="size-6 opacity-60" aria-hidden="true" />
              {job.state === "rendering" ? <Loader2 className="absolute right-2 top-2 size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : job.state === "ready" ? <Check className="absolute right-2 top-2 size-3.5" aria-hidden="true" />
                  : <CircleAlert className="absolute right-2 top-2 size-3.5 text-muted-foreground" aria-hidden="true" />}</>}
        </div>
        <p className="truncate px-1.5 text-[10px] leading-4" title={name}>{name}</p>
        <p role="status" className="px-1.5 pb-1 text-[10px] leading-4 text-muted-foreground">{status}</p>
      </article>;
    })}
  </div>;
}
