import React, { useEffect, useState } from "react";
import { Clapperboard, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useNayin } from "@/features/nayin/NayinContext";
import { useUiLanguage, useUiText } from "@/features/uiLanguage/UiLanguage";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { resolveExportStoryId } from "@/pages/editingStudioWorkspace";
import { exportReceiptKey, readExportReceipt, saveExportReceipt, type ExportReceipt } from "./exportReceipt";

function storage() {
  try { return window.sessionStorage; } catch { return null; }
}

export function ExportButton({ storyId, pendingStoryRequestId }: { storyId: number | null; pendingStoryRequestId: number | null }) {
  const ui = useUiText();
  const { language } = useUiLanguage();
  const en = language === "en";
  const { visualTheme } = useNayin();
  const accountId = useStorySpine(state => state.accountId);
  const exportMut = trpc.creationAgent.exportTimeline.useMutation();
  const [exporting, setExporting] = useState(false);
  const [receipts, setReceipts] = useState<Record<string, ExportReceipt>>({});
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const exportStoryId = resolveExportStoryId(storyId, pendingStoryRequestId);
  const key = exportReceiptKey(accountId, exportStoryId);
  const receipt = key ? receipts[key] : undefined;
  useEffect(() => {
    const saved = readExportReceipt(storage(), key, exportStoryId);
    if (key && saved) setReceipts(current => ({ ...current, [key]: saved }));
  }, [key, exportStoryId]);

  const runExport = async () => {
    if (exportStoryId == null || key == null || exporting) return;
    setExporting(true); setError(null);
    try {
      const result = await exportMut.mutateAsync({ storyId: exportStoryId, fallbackToLatestTake: false });
      if (result.status === "error") throw new Error(result.error);
      const saved: ExportReceipt = { storyId: exportStoryId, videoUrl: result.videoUrl, durationSec: result.durationSec, mediaDiagnostics: result.mediaDiagnostics };
      saveExportReceipt(storage(), key, saved);
      setReceipts(current => ({ ...current, [key]: saved }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ui("导出失败");
      setError({ key, message });
    } finally { setExporting(false); }
  };
  return <div className="flex flex-col items-end gap-2">
    <button type="button" onClick={() => void runExport()} disabled={exporting || key == null}
      title={pendingStoryRequestId != null ? ui("正在打开另一篇故事") : exportStoryId == null ? ui("先打开一个故事再导出成片") : undefined}
      data-tour="export"
      className="shiguang-export-button inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-primary-foreground shadow-[0_6px_14px_-8px_var(--nayin-accent)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ background: "var(--nayin-accent)" }}>
      {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : visualTheme === "shiguang" ? <img src="/shiguang/nav-export-v2.svg" alt="" aria-hidden="true" className="shiguang-action-illustration" /> : <Clapperboard className="h-4 w-4" />}
      <span className="shiguang-nav-label">{exporting ? ui("合成中…") : ui("导出成片")}</span>
    </button>
    {receipt && <div className="max-w-xl text-right text-xs" role="status">
      <span className="text-muted-foreground">{en ? "Last export" : "上次导出"} · {receipt.durationSec}s · </span>
      <a className="underline focus-visible:outline" href={receipt.videoUrl} target="_blank" rel="noopener noreferrer">{en ? "View" : "查看成片 / View"}</a>
      <span> · </span><a className="underline focus-visible:outline" href={receipt.videoUrl} download>{en ? "Download" : "下载 / Download"}</a>
      {receipt.mediaDiagnostics?.map((message, i) => <p className="mt-1 font-medium text-foreground" key={i}>{message}</p>)}
    </div>}
    {error?.key === key && <p role="alert" className="max-w-xl text-sm text-destructive">{error.message}</p>}
  </div>;
}
