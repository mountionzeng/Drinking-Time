import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Download, ImagePlus, Loader2, Type } from "lucide-react";
import { toast } from "sonner";

import type { PublishingDraftState, PublishingStoryVersion } from "../../../../shared/publishingDraft";
import type { PublishingAlbumTypographyLayout } from "../../../../shared/publishingAlbum";
import { trpc } from "@/lib/trpc";
import { PublishingAlbumTypographyEditor } from "./PublishingAlbumTypographyEditor";
import {
  downloadPublishingAlbumBlob,
  exportPublishingAlbum,
  preparePublishingAlbumExportPage,
  renderPublishingAlbumPagePng,
} from "./publishingAlbumExport";

type AlbumQuote = {
  quoteId: string;
  storyId: number;
  versionId: string;
  pageId: string;
  provider: "midjourney" | "gpt-image";
  inputHash: string;
  currency: "CNY";
  estimatedCny: number;
  candidateCount: number;
  expiresAt: number;
};

function token(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;
}

export function PublishingAlbumWorkspace({
  storyId,
  version,
  coverAvailable,
  onPublishingChange,
  onBackToDraft,
  onOpenCoverStudio,
}: {
  storyId: number;
  version: PublishingStoryVersion;
  coverAvailable: boolean;
  onPublishingChange(publishing: PublishingDraftState): void;
  onBackToDraft(): void;
  onOpenCoverStudio(): void;
}) {
  const utils = trpc.useUtils();
  const albumQuery = trpc.publishingDraft.readAlbum.useQuery({ storyId, versionId: version.versionId }, { retry: false });
  const updateTextMut = trpc.publishingDraft.updateAlbumPageText.useMutation();
  const saveTypographyMut = trpc.publishingDraft.saveAlbumPageTypography.useMutation();
  const quoteMut = trpc.publishingDraft.quoteAlbumPageBackground.useMutation();
  const generateMut = trpc.publishingDraft.generateAlbumPageBackground.useMutation();
  const adoptMut = trpc.publishingDraft.adoptAlbumPageBackground.useMutation();
  const album = albumQuery.data?.album ?? version.album;
  const [pageId, setPageId] = useState<string | null>(album?.pages[0]?.pageId ?? null);
  const page = album?.pages.find(candidate => candidate.pageId === pageId) ?? album?.pages[0] ?? null;
  const [text, setText] = useState(page?.text ?? "");
  const [quote, setQuote] = useState<AlbumQuote | null>(null);
  const [feedback, setFeedback] = useState("");
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const recoveredOperationRef = useRef<string | null>(null);
  const assets = useMemo(() => new Map((albumQuery.data?.assets ?? []).map(asset => [asset.id, asset])), [albumQuery.data?.assets]);
  const adoptedAsset = page?.adoptedBackgroundAssetId ? assets.get(page.adoptedBackgroundAssetId) ?? null : null;
  const pageTextDirty = Boolean(page && text !== page.text);

  useEffect(() => {
    setPageId(album?.pages[0]?.pageId ?? null);
    setQuote(null);
    recoveredOperationRef.current = null;
  }, [storyId, version.versionId]);
  useEffect(() => {
    setText(page?.text ?? "");
    setQuote(null);
  }, [page?.pageId, page?.text]);

  useEffect(() => {
    const generation = page?.backgroundGeneration;
    if (
      !generation || generation.status === "completed" || !generation.taskId ||
      recoveredOperationRef.current === generation.operationToken
    ) return;
    recoveredOperationRef.current = generation.operationToken;
    void generateMut.mutateAsync({
      storyId, versionId: version.versionId, pageId: page.pageId,
      operationToken: generation.operationToken,
    }).then(() => albumQuery.refetch()).catch(() => undefined);
  }, [page?.backgroundGeneration?.operationToken, page?.backgroundGeneration?.status, page?.backgroundGeneration?.taskId, page?.pageId, storyId, version.versionId]);

  if (!album || !page) {
    return (
      <section className="grid h-full place-items-center p-6" aria-label="画册工作区空状态">
        <div className="text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /><p className="mt-2 text-sm">正在建立画册页面…</p></div>
      </section>
    );
  }

  const refresh = async () => {
    await albumQuery.refetch();
    await utils.publishingDraft.read.invalidate({ storyId });
  };
  const saveText = async () => {
    try {
      const result = await updateTextMut.mutateAsync({
        storyId, versionId: version.versionId, pageId: page.pageId,
        text, baseTextRevision: page.textRevision, operationToken: token("album-text"),
      });
      onPublishingChange(result.publishing);
      await refresh();
      toast.success("这一页文字已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文字保存失败，本地内容仍保留");
    }
  };
  const saveTypography = async (typography: PublishingAlbumTypographyLayout) => {
    try {
      const result = await saveTypographyMut.mutateAsync({
        storyId, versionId: version.versionId, pageId: page.pageId,
        typography, baseTextRevision: page.textRevision,
        baseTypographyRevision: page.typographyRevision,
        operationToken: token("album-typography"),
      });
      onPublishingChange(result.publishing);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "排版保存冲突；当前笔画仍保留，请刷新后重试");
      throw error;
    }
  };
  const requestQuote = async () => {
    if (pageTextDirty) {
      toast.error("请先保存这一页文字，再按最新文字生成底图");
      return;
    }
    try {
      const result = await quoteMut.mutateAsync({
        storyId, versionId: version.versionId, pageId: page.pageId,
        provider: "midjourney", feedback: feedback.trim() || undefined,
      });
      setQuote(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "底图报价失败");
    }
  };
  const confirmGeneration = async () => {
    if (!quote) return;
    try {
      const result = await generateMut.mutateAsync({
        storyId, versionId: version.versionId, pageId: page.pageId,
        provider: quote.provider, feedback: feedback.trim() || undefined,
        operationToken: token("album-background"), confirmation: quote,
      });
      setQuote(null);
      if (result.status === "error") toast.error(result.error);
      else toast.success("底图候选已生成；采用前不会改变这一页");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "底图生成失败；不会自动重复付费");
    }
  };
  const adopt = async (assetId: number) => {
    try {
      const result = await adoptMut.mutateAsync({
        storyId, versionId: version.versionId, pageId: page.pageId,
        assetId, baseBackgroundRevision: page.backgroundRevision,
        operationToken: token("album-adopt"),
      });
      onPublishingChange(result.publishing);
      await refresh();
      toast.success("已采用这张底图");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "底图采用失败");
    }
  };
  const exportPages = async (wholeAlbum: boolean) => {
    if (pageTextDirty) {
      toast.error("请先保存这一页文字，再导出画册");
      return;
    }
    const targets = wholeAlbum ? album.pages : [page];
    try {
      const prepared = await Promise.all(targets.map(async target => {
        const asset = target.adoptedBackgroundAssetId ? assets.get(target.adoptedBackgroundAssetId) : null;
        if (!asset || !target.typography) throw new Error(`第 ${target.ordinal} 页还没有采用底图或保存排版`);
        return preparePublishingAlbumExportPage({
          pageId: target.pageId, ordinal: target.ordinal, text: target.text,
          backgroundUrl: asset.imageUrl, typography: target.typography,
        });
      }));
      if (!wholeAlbum) {
        const blob = await renderPublishingAlbumPagePng({ page: prepared[0]! });
        downloadPublishingAlbumBlob(blob, `画册-${String(page.ordinal).padStart(2, "0")}.png`);
      } else {
        const results = await exportPublishingAlbum({
          pages: prepared, filenamePrefix: "画册",
          onProgress: (completed, total) => setExportProgress(`${completed}/${total}`),
        });
        results.forEach(result => downloadPublishingAlbumBlob(result.blob, result.filename));
      }
      toast.success(wholeAlbum ? "整套画册已按页码导出" : "当前页已导出");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "画册导出失败");
    } finally {
      setExportProgress(null);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--nayin-surface-dim)]/45" aria-label="静态画册工作区" data-story-panel="publishing-album">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--panel-border)] px-4 py-3">
        <nav className="flex items-center gap-1" aria-label="发布工作区子导航">
          <button type="button" onClick={onBackToDraft} className="rounded-lg px-3 py-2 text-xs hover:bg-muted"><ArrowLeft className="mr-1 inline h-4 w-4" />正文</button>
          <button type="button" onClick={onOpenCoverStudio} className="rounded-lg px-3 py-2 text-xs hover:bg-muted">封面</button>
          <button type="button" aria-current="page" className="rounded-lg bg-[var(--nayin-glow)] px-3 py-2 text-xs font-medium">画册</button>
        </nav>
        <div className="flex gap-2">
          <button type="button" onClick={() => void exportPages(false)} disabled={pageTextDirty} className="rounded-lg border border-[var(--panel-border)] px-3 py-2 text-xs disabled:opacity-40"><Download className="mr-1 inline h-4 w-4" />导出本页</button>
          <button type="button" onClick={() => void exportPages(true)} disabled={pageTextDirty} className="rounded-lg border border-[var(--panel-border)] px-3 py-2 text-xs disabled:opacity-40"><Download className="mr-1 inline h-4 w-4" />{exportProgress ? `导出 ${exportProgress}` : "导出整册"}</button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[104px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-[var(--panel-border)] p-2" aria-label="画册页面列表">
          {album.pages.map(candidate => {
            const selected = candidate.pageId === page.pageId;
            const asset = candidate.adoptedBackgroundAssetId ? assets.get(candidate.adoptedBackgroundAssetId) : null;
            return (
              <button
                key={candidate.pageId}
                type="button"
                onClick={() => setPageId(candidate.pageId)}
                aria-current={selected ? "page" : undefined}
                className={`mb-2 w-full rounded-lg border p-1 text-left ${selected ? "border-[var(--nayin-accent)]" : "border-[var(--panel-border)]"}`}
              >
                <div className="aspect-[3/4] overflow-hidden rounded bg-muted">{asset ? <img src={asset.imageUrl} alt="" className="h-full w-full object-cover" /> : null}</div>
                <span className="mt-1 block text-center text-[10px]">第 {candidate.ordinal} 页{candidate.typography ? " · 已排版" : ""}</span>
              </button>
            );
          })}
        </aside>
        <main className="min-w-0 overflow-y-auto p-4">
          <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <PublishingAlbumTypographyEditor
              key={`${version.versionId}:${page.pageId}`}
              text={text}
              backgroundUrl={adoptedAsset?.imageUrl ?? null}
              initialLayout={page.typography}
              artDirectionTags={albumQuery.data?.artDirectionTags ?? []}
              saving={saveTypographyMut.isPending}
              saveBlocked={pageTextDirty}
              onSave={saveTypography}
            />
            <div className="space-y-4">
              <section className="rounded-xl border border-[var(--panel-border)] bg-background/70 p-3">
                <h2 className="text-sm font-medium">第 {page.ordinal} 页文字</h2>
                <textarea
                  value={text}
                  onChange={event => setText(event.target.value)}
                  maxLength={2_000}
                  rows={7}
                  aria-label={`第 ${page.ordinal} 页文字`}
                  className="mt-2 w-full resize-y rounded-lg border border-[var(--panel-border)] bg-background px-3 py-2 text-sm leading-6"
                />
                <button type="button" onClick={() => void saveText()} disabled={text === page.text || updateTextMut.isPending} className="mt-2 rounded-lg bg-[var(--nayin-accent)] px-3 py-2 text-xs text-[var(--background)] disabled:opacity-40">
                  <Check className="mr-1 inline h-4 w-4" />保存文字
                </button>
              </section>

              <section className="rounded-xl border border-[var(--panel-border)] bg-background/70 p-3">
                <h2 className="text-sm font-medium">无字底图</h2>
                {!coverAvailable ? (
                  <div className="mt-2 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-800">
                    当前版本还没有正式采用封面。你仍可编辑文字；采用封面后才能生成继承其风格的底图。
                    <button type="button" onClick={onOpenCoverStudio} className="mt-2 block underline">返回封面工作室</button>
                  </div>
                ) : null}
                <textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={2_000} rows={2} placeholder="可选：这一页希望更安静、留白靠左……" className="mt-2 w-full rounded-lg border border-[var(--panel-border)] bg-background px-3 py-2 text-xs" />
                {quote ? (
                  <div className="mt-2 rounded-lg border border-[var(--nayin-accent)] p-3 text-xs">
                    本次会生成 {quote.candidateCount} 张候选，预计 ¥{quote.estimatedCny.toFixed(2)}。候选不会自动采用。
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => setQuote(null)} className="rounded px-2 py-1">取消</button>
                      <button type="button" onClick={() => void confirmGeneration()} className="rounded bg-[var(--nayin-accent)] px-2 py-1 text-[var(--background)]">确认付费生成</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => void requestQuote()} disabled={!coverAvailable || pageTextDirty || quoteMut.isPending || generateMut.isPending} className="mt-2 rounded-lg border border-[var(--panel-border)] px-3 py-2 text-xs disabled:opacity-40">
                    {quoteMut.isPending || generateMut.isPending ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1 inline h-4 w-4" />}生成底图
                  </button>
                )}
                {page.backgroundGeneration && page.backgroundGeneration.status !== "completed" ? (
                  <p className="mt-2 text-[11px] text-muted-foreground" role="status">任务状态：{page.backgroundGeneration.status}；已有任务编号时只恢复原任务，不会自动重提。</p>
                ) : null}
              </section>

              {page.backgroundRounds.length > 0 ? (
                <section className="rounded-xl border border-[var(--panel-border)] bg-background/70 p-3">
                  <h2 className="text-sm font-medium">底图候选</h2>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {page.backgroundRounds.flatMap(round => round.assetIds.map(assetId => {
                      const asset = assets.get(assetId);
                      if (!asset) return null;
                      const flagged = round.qualityFlaggedAssetIds.includes(assetId);
                      return (
                        <button key={assetId} type="button" onClick={() => void adopt(assetId)} className="relative overflow-hidden rounded-lg border border-[var(--panel-border)] text-left">
                          <img src={asset.imageUrl} alt={`第 ${page.ordinal} 页底图候选`} className="aspect-[3/4] w-full object-cover" />
                          <span className="block px-2 py-1 text-[10px]">{page.adoptedBackgroundAssetId === assetId ? "已采用" : "采用这张"}{flagged ? " · 疑似含字" : ""}{round.stale ? " · 旧输入" : ""}</span>
                        </button>
                      );
                    }))}
                  </div>
                </section>
              ) : null}
              <p className="text-[11px] text-muted-foreground"><Type className="mr-1 inline h-3 w-3" />文字始终是可编辑产品层，不由图片模型生成。</p>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
