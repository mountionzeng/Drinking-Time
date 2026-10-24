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
export function useChapters(storyId: number) {
  const utils = trpc.useUtils();
  const list = trpc.chapters.list.useQuery(
    { storyId },
    { retry: false, refetchOnWindowFocus: false }
  );
  const save = trpc.chapters.save.useMutation();
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [epoch, setEpoch] = useState(0);
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
  async function refresh() {
    const fresh = await detail.refetch();
    if (fresh.error) throw fresh.error;
    await utils.chapters.list.invalidate({ storyId });
    setEpoch(value => value + 1);
  }
  return {
    chapters,
    active,
    imageUrls: detail.data?.imageUrls ?? {},
    error,
    saving,
    epoch,
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
    reloadList: () => utils.chapters.list.invalidate({ storyId }),
  };
}
