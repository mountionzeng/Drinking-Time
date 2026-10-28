import { useCallback, useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import type { ModuleDocument } from "@shared/sharedLayout";
import {
  chapterLayoutProblem,
  type StoredChapterBlocks,
} from "@shared/chapterStore";
import { chapterLocalImages } from "./chapterLocalImages";
import { ChapterSaveQueue } from "./chapterSaveQueue";

export type Chapter = inferRouterOutputs<AppRouter>["chapters"]["list"][number];
export type ChapterEdit = {
  layout: ModuleDocument | null;
  settings: StoredChapterBlocks["settings"];
  media?: Pick<
    StoredChapterBlocks,
    "coverKey" | "bodyTextureKey" | "illustrations"
  >;
};

/** Mounted only behind the server's enabled flag. No platform draft is ever written here. */
export function useChapters(storyId: number, releaseCleanText?: (latest: Chapter) => boolean) {
  const utils = trpc.useUtils();
  const list = trpc.chapters.list.useQuery(
    { storyId },
    { retry: false, refetchOnWindowFocus: false }
  );
  const save = trpc.chapters.save.useMutation();
  const [openId, setOpenId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const id = Number(new URLSearchParams(window.location.search).get("chapterId"));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [externalVersion, setExternalVersion] = useState<number | null>(null);
  const releaseText = useRef(releaseCleanText);
  releaseText.current = releaseCleanText;
  const chapters = list.data ?? [];
  const selected =
    chapters.find(chapter => chapter.id === openId) ?? chapters[0] ?? null;
  const detail = trpc.chapters.get.useQuery(
    { chapterId: selected?.id ?? 0 },
    {
      enabled: Boolean(selected),
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const active =
    selected && detail.data?.chapter.id === selected.id ? detail.data.chapter : null;
  const queue = useRef<{
    id: number;
    queue: ChapterSaveQueue<ChapterEdit>;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mutate = useRef(save.mutateAsync);
  mutate.current = save.mutateAsync;
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!queue.current?.queue.dirty) return;
    setSaving(true);
    try {
      await queue.current.queue.flush();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存失败";
      setError(message);
      throw cause;
    } finally {
      setSaving(false);
    }
  }, []);
  const change = useCallback(
    (id: number, edit: ChapterEdit) => {
      if (queue.current?.id !== id) return;
      let problem: string | null;
      try { problem = chapterLayoutProblem(chapterLocalImages(edit).layout); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "图片无法保存"); return; }
      if (problem) {
        setError(problem);
        return;
      }
      setError("");
      queue.current.queue.enqueue(edit);
      if (!queue.current.queue.dirty) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush().catch(() => {});
      }, 1500);
    },
    [flush]
  );
  useEffect(() => {
    if (!active) return;
    const id = active.id;
    queue.current = {
      id,
      queue: new ChapterSaveQueue<ChapterEdit>(
        active.version,
        {
          layout: active.layout,
          settings: active.blocks.settings,
          media: {
            coverKey: active.blocks.coverKey,
            bodyTextureKey: active.blocks.bodyTextureKey,
            illustrations: active.blocks.illustrations,
          },
        },
        async (edit, version) => {
          const saved = await mutate.current({
            chapterId: id,
            expectedVersion: version,
            ...chapterLocalImages(edit),
            autosave: true,
          });
          utils.chapters.list.setData({ storyId }, rows =>
            rows?.map(row => (row.id === id ? saved : row))
          );
          return saved.version;
        }
      ),
    };
    setError("");
    return () => {
      clearTimeout(timer.current);
      queue.current = null;
    };
  }, [active?.id, epoch]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (queue.current?.queue.dirty || error) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [error]);
  useEffect(() => {
    if (!active) return;
    let disposed = false, checking = false;
    const id = active.id;
    setExternalVersion(null);
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        // Read outside the mounted query cache: a dirty editor must not silently acquire a newer save token.
        const fresh = await utils.client.chapters.get.query({ chapterId: id });
        if (disposed || queue.current?.id !== id || fresh.chapter.version <= queue.current.queue.version) return;
        setExternalVersion(fresh.chapter.version);
        // A newer version is offered explicitly, even when the editor is clean.
        // Never advance the save token or remount the editor before the user compares it.
      } catch { /* Offline checks never discard the local manuscript or interrupt writing. */ }
      finally { checking = false; }
    };
    const visible = () => { void check(); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const interval = setInterval(visible, 15000);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [active?.id, epoch, storyId]);
  async function refresh() {
    const fresh = await detail.refetch();
    if (fresh.error) throw fresh.error;
    await utils.chapters.list.invalidate({ storyId });
    setEpoch(value => value + 1);
    setExternalVersion(null);
  }
  return {
    chapters,
    active,
    imageUrls: detail.data?.imageUrls ?? {},
    error,
    saving,
    epoch,
    externalVersion,
    loading: list.isLoading || (Boolean(selected) && detail.isLoading),
    queryError: list.error?.message ?? detail.error?.message,
    change,
    flush,
    refresh,
    version: () => queue.current?.queue.version ?? active?.version ?? 1,
    open: async (id: number) => {
      await flush();
      setOpenId(id);
    },
    saveText: async (draft: { title: string; body: string; changeNote?: string; autosave?: boolean; writingStyle?: StoredChapterBlocks["writingStyle"] }, comparedVersion?: number) => {
      if (!active) throw new Error("请先选择章节");
      await flush();
      const saved = await mutate.current({ chapterId: active.id,
        expectedVersion: comparedVersion ?? queue.current?.queue.version ?? active.version, ...draft });
      if (queue.current?.id === active.id) queue.current.queue.version = saved.version;
      utils.chapters.get.setData({ chapterId: active.id }, previous => previous ? {...previous,chapter:saved} : previous);
      utils.chapters.list.setData({storyId}, rows=>rows?.map(row=>row.id===saved.id?saved:row));
      setExternalVersion(null);
      return saved;
    },
    acceptLatest: async (expectedVersion: number) => {
      if (!active) throw new Error("故事暂不可用");
      const fresh = await utils.client.chapters.get.query({ chapterId: active.id });
      if (fresh.chapter.version !== expectedVersion) throw new Error("对比期间又有新版本，请重新查看更新后接收。");
      if (queue.current?.queue.dirty || releaseText.current?.(fresh.chapter) === false) throw new Error("当前文字尚未保存，请保留草稿并重新对比。");
      utils.chapters.get.setData({ chapterId: active.id }, fresh);
      utils.chapters.list.setData({ storyId }, rows => rows?.map(row => row.id === active.id ? fresh.chapter : row));
      setExternalVersion(null);
      setEpoch(value => value + 1);
    },
    reloadList: () => utils.chapters.list.invalidate({ storyId }),
  };
}
