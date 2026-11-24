import React, { useEffect, useState } from "react";
import { Check, Clapperboard, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useNayin } from "@/features/nayin/NayinContext";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { resolveExportStoryId } from "@/pages/editingStudioWorkspace";
import { STORY_TIMELINE_FPS } from "@shared/storyMaterial";
import { VIDEO_TARGET_DIMENSIONS, type VideoTargetAspectRatio } from "@shared/videoConform";
import { exportReceiptKey, getExportWarnings, readExportReceipt, saveExportReceipt, type ExportReceipt } from "./exportReceipt";

const stages = [
  { id: "preparing", label: "检查剪辑与素材" },
  { id: "picture", label: "处理画面" },
  { id: "media", label: "合成音频与字幕" },
  { id: "file", label: "生成文件" },
] as const;

const ratios = [
  { value: "9:16", label: "竖屏" },
  { value: "16:9", label: "横屏" },
  { value: "1:1", label: "方形" },
] as const;

const fieldClass = "block h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const primaryClass = "bg-[var(--nayin-accent-dim)] text-primary-foreground hover:bg-[var(--nayin-accent-dim)] hover:brightness-95";

type Draft = {
  ratio?: VideoTargetAspectRatio;
  resolution: 720 | 1080;
  subtitleChoice: string;
};
const defaults: Draft = { resolution: 1080, subtitleChoice: "all" };

function storage() {
  try { return window.sessionStorage; } catch { return null; }
}

function ReceiptLinks({ receipt }: { receipt: ExportReceipt }) {
  const t = useUiText();
  return <>
    <a className="underline underline-offset-2 focus-visible:outline-2" href={receipt.videoUrl} target="_blank" rel="noopener noreferrer">{t("查看成片")}</a>
    <a className="underline underline-offset-2 focus-visible:outline-2" href={receipt.videoUrl} download>{t("下载")}</a>
  </>;
}

export function ExportButton({ storyId, pendingStoryRequestId }: { storyId: number | null; pendingStoryRequestId: number | null }) {
  const t = useUiText();
  const { visualTheme } = useNayin();
  const accountId = useStorySpine(state => state.accountId);
  const exportStoryId = resolveExportStoryId(storyId, pendingStoryRequestId);
  const key = exportReceiptKey(accountId, exportStoryId);
  const input = { storyId: exportStoryId ?? 0, accountId: accountId ?? 0 };
  const [panel, setPanel] = useState<{ key: string; view: "settings" | "job" | "warnings" } | null>(null);
  const [draft, setDraft] = useState(defaults);
  const [submitError, setSubmitError] = useState<{ key: string; message: string } | null>(null);
  const [receipts, setReceipts] = useState<Record<string, ExportReceipt>>({});
  const panelOpen = key !== null && panel?.key === key;
  const utils = trpc.useUtils();
  const start = trpc.creationAgent.startTimelineExport.useMutation();
  const settingsQuery = trpc.creationAgent.timelineExportSettings.useQuery(input, {
    enabled: panelOpen,
    refetchOnWindowFocus: false,
  });
  const statusQuery = trpc.creationAgent.timelineExportStatus.useQuery(input, {
    enabled: key !== null,
    refetchInterval: query => query.state.data?.status === "running" ? 1_000 : false,
    refetchIntervalInBackground: true,
  });
  const settings = settingsQuery.data;
  const job = statusQuery.data;
  const running = job?.status === "running";
  const showingJob = panelOpen && (running || panel.view === "job");
  const activeStage = job?.status === "running" || job?.status === "error"
    ? stages.findIndex(stage => stage.id === job.stage) : -1;
  const receipt = key ? receipts[key] : undefined;
  const showingWarnings = panelOpen && panel.view === "warnings";
  const warnings = getExportWarnings(receipt);
  const ratio = draft.ratio ?? settings?.aspectRatio ?? "9:16";
  const dimensions = VIDEO_TARGET_DIMENSIONS[ratio];
  const scale = draft.resolution / 1080;
  const subtitleChoice = draft.subtitleChoice === "all" || draft.subtitleChoice === "off" ||
    settings?.subtitleTracks.some(track => `track:${track.id}` === draft.subtitleChoice)
    ? draft.subtitleChoice : "all";

  useEffect(() => {
    const saved = readExportReceipt(storage(), key, exportStoryId);
    if (key && saved) setReceipts(current => ({ ...current, [key]: saved }));
  }, [key, exportStoryId]);

  useEffect(() => {
    if (!key || exportStoryId == null || job?.status !== "ok") return;
    const saved: ExportReceipt = {
      storyId: exportStoryId, videoUrl: job.videoUrl, durationSec: job.durationSec,
      mediaDiagnostics: job.mediaDiagnostics,
    };
    saveExportReceipt(storage(), key, saved);
    setReceipts(current => ({ ...current, [key]: saved }));
  }, [key, exportStoryId, job]);

  const openPanel = (open: boolean) => {
    if (!open) { setPanel(null); return; }
    if (!key) return;
    setDraft(defaults);
    setSubmitError(null);
    setPanel({ key, view: running || job?.status === "error" ? "job" : "settings" });
  };

  const runExport = async () => {
    if (!key || !settings || settings.totalFrames <= 0 || settingsQuery.isFetching || start.isPending || running) return;
    setSubmitError(null);
    try {
      const next = await start.mutateAsync({
        ...input, expectedRevision: settings.revision, targetAspectRatio: ratio, resolution: draft.resolution,
        ...(subtitleChoice === "all" ? {} : { subtitleTrackIds: subtitleChoice === "off" ? [] : [subtitleChoice.slice(6)] }),
      });
      utils.creationAgent.timelineExportStatus.setData(input, next);
      setPanel(current => current?.key === key ? { key, view: "job" } : current);
    } catch (cause) {
      setSubmitError({ key, message: cause instanceof Error ? cause.message : t("导出失败") });
      void statusQuery.refetch();
    }
  };

  const reviewAgain = () => {
    if (!key) return;
    setPanel({ key, view: "settings" });
    void settingsQuery.refetch();
  };

  return <div className="flex flex-col items-end gap-2">
    <Dialog open={panelOpen} onOpenChange={openPanel}>
      <DialogTrigger asChild>
        <button type="button" disabled={!key} data-tour="export"
          title={pendingStoryRequestId != null ? t("正在打开另一篇故事") : undefined}
          className="shiguang-export-button inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-primary-foreground shadow-[0_6px_14px_-8px_var(--nayin-accent)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "var(--nayin-accent)" }}>
          {running ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : visualTheme === "shiguang" ? <img src="/shiguang/nav-export-v2.svg" alt="" className="shiguang-action-illustration" /> : <Clapperboard className="h-4 w-4" />}
          <span className="shiguang-nav-label">{t(running ? "查看导出进度" : "导出成片")}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(showingWarnings ? "导出提醒" : showingJob ? "导出成片" : "确认导出设置")}</DialogTitle>
          <DialogDescription>
            {showingWarnings ? t("上次导出") : settings ? t("剪辑修订 {0} · {1} 秒", [settings.revision, (settings.totalFrames / STORY_TIMELINE_FPS).toFixed(1)]) : t("导出当前剪辑")}
          </DialogDescription>
        </DialogHeader>
        {showingWarnings ? <>
          <ul className="grid gap-2 text-sm text-muted-foreground">
            {warnings.map(message => <li key={message} className="break-words">{message}</li>)}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => openPanel(false)}>{t("关闭")}</Button>
          </DialogFooter>
        </> : showingJob ? <>
          {job?.status === "ok" ? <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><Check aria-hidden="true" className="size-4 text-[var(--nayin-accent)]" />{t("成片已生成")}</p>
            <div className="mt-2 flex gap-4 pl-6 text-sm"><ReceiptLinks receipt={{ storyId: input.storyId, ...job }} /></div>
            {getExportWarnings(job).length > 0 && <details className="mt-2 text-sm text-muted-foreground">
              <summary className="cursor-pointer">{t("导出提醒")}</summary>
              <ul className="mt-2 grid gap-2">
                {getExportWarnings(job).map(message => <li key={message} className="break-words">{message}</li>)}
              </ul>
            </details>}
          </div> : <>
            <ol className="grid gap-2 border-y border-border py-3" aria-label={t("导出进度")} aria-live="polite">
              {stages.map(({ id, label }, index) => <li key={id} aria-current={activeStage === index ? "step" : undefined} className={`flex items-center gap-3 text-sm ${activeStage === index ? "font-semibold" : "text-muted-foreground"}`}>
                <span className="grid size-5 place-items-center" aria-hidden="true">
                  {activeStage > index ? <Check className="size-4" /> : activeStage === index && running
                    ? <Loader2 className="size-4 motion-safe:animate-spin" />
                    : <span className="size-1.5 rounded-full bg-current" />}
                </span>
                {t(label)}
                {activeStage === index && job?.status === "error" ? <span className="text-destructive">{t("失败")}</span> : null}
              </li>)}
            </ol>
            {job?.status === "error" && <p role="alert" className="break-words text-sm text-destructive">{job.error}</p>}
            {statusQuery.isError && <p role="alert" className="text-sm text-destructive">{t("暂时无法读取导出进度")}</p>}
            {!job && !statusQuery.isFetching && !statusQuery.isError && <p role="alert" className="text-sm text-destructive">{t("导出任务已中断")}</p>}
          </>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => openPanel(false)}>{t(running ? "收起" : "关闭")}</Button>
            {statusQuery.isError && <Button type="button" variant="outline" onClick={() => void statusQuery.refetch()}>{t("刷新状态")}</Button>}
            {(!job || job.status === "error") && !statusQuery.isError && !statusQuery.isFetching &&
              <Button type="button" className={primaryClass} onClick={reviewAgain}>{t("重试")}</Button>}
          </DialogFooter>
        </> : <>
          {settings ? <div className="grid gap-4 border-y border-border py-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">{t("画幅")}
                <select className={fieldClass} value={ratio} onChange={event => setDraft({ ...draft, ratio: event.target.value as VideoTargetAspectRatio })}>
                  {ratios.map(option => <option key={option.value} value={option.value}>{t(option.label)} {option.value}</option>)}
                </select>
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">{t("分辨率")}
                <select className={fieldClass} value={draft.resolution} onChange={event => setDraft({ ...draft, resolution: event.target.value === "720" ? 720 : 1080 })}>
                  <option value={1080}>{dimensions.width} × {dimensions.height}</option>
                  <option value={720}>{Math.round(dimensions.width * 2 / 3)} × {Math.round(dimensions.height * 2 / 3)}</option>
                </select>
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">{t("字幕")}
              <select className={fieldClass} value={settings.subtitleTracks.length ? subtitleChoice : "off"} disabled={!settings.subtitleTracks.length} onChange={event => setDraft({ ...draft, subtitleChoice: event.target.value })}>
                {settings.subtitleTracks.length > 0 && <option value="all">{settings.subtitleTracks.length === 2 ? t("烧录双语字幕") : t("烧录全部字幕")}</option>}
                {settings.subtitleTracks.map((track, index) => <option key={track.id} value={`track:${track.id}`}>{track.name || t("字幕轨 {0}", [index + 1])}</option>)}
                <option value="off">{t("关闭字幕")}</option>
              </select>
            </label>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="font-medium">{t("声音")}</dt><dd className="text-muted-foreground">{t("沿用时间线混音")}</dd>
              <dt className="font-medium">{t("格式")}</dt><dd className="text-muted-foreground">MP4 · {Math.round(dimensions.width * scale)} × {Math.round(dimensions.height * scale)}</dd>
            </dl>
            <details className="text-sm">
              <summary className="w-fit cursor-pointer rounded text-muted-foreground focus-visible:outline-2">{t("高级设置")}</summary>
              <p className="mt-2 pl-4 text-muted-foreground">{STORY_TIMELINE_FPS} fps · H.264 · AAC</p>
            </details>
          </div> : <p role={settingsQuery.isFetching ? "status" : "alert"} className="text-sm text-muted-foreground">
            {t(settingsQuery.isFetching ? "正在读取剪辑…" : "无法读取当前剪辑")}
          </p>}
          {settings?.totalFrames === 0 && <p role="alert" className="text-sm text-muted-foreground">{t("时间轴上没有可导出的画面、字幕或声音")}</p>}
          {submitError?.key === key && <p role="alert" className="text-sm text-destructive">{submitError.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => openPanel(false)}>{t("取消")}</Button>
            <Button type="button" className={primaryClass} onClick={() => void runExport()}
              disabled={!settings?.totalFrames || settingsQuery.isFetching || start.isPending}>
              {start.isPending ? <Loader2 className="size-4 motion-safe:animate-spin" /> : null}
              {t(start.isPending ? "正在提交…" : "开始导出")}
            </Button>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
    {receipt && <div className="flex flex-wrap items-center justify-end gap-x-2 whitespace-nowrap text-right text-xs" role="status">
      <span className="text-muted-foreground">{t("上次导出")} · {receipt.durationSec}s</span>
      <ReceiptLinks receipt={receipt} />
      {key && warnings.length > 0 && <button type="button" title={t("导出提醒")} aria-label={t("导出提醒")}
        className="inline-flex size-4 items-center justify-center rounded text-amber-700 focus-visible:outline-2 dark:text-amber-300"
        onClick={() => setPanel({ key, view: "warnings" })}>
        <TriangleAlert aria-hidden="true" className="size-3.5" />
      </button>}
    </div>}
  </div>;
}
