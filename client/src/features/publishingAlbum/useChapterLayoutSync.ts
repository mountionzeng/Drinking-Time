import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ModuleDocument } from "@shared/sharedLayout";

const SAVE_DELAY_MS = 1500;

/**
 * Keeps the module layout of a story's first chapter on the server.
 * Does nothing while CHAPTER_PACKAGE_ENABLED is off. localStorage stays the
 * offline cache; this only adds the server copy and never overwrites silently:
 * a stale version stops saving and asks the user to reload.
 */
export function useChapterLayoutSync({
  storyId,
  title,
  body,
  document,
  onRemoteLayout,
}: {
  storyId: number;
  title: string;
  body: string;
  /** The layout currently on screen (the editor's live document or the applied one). */
  document: ModuleDocument | null;
  /** Called once with the server's layout when this device has none of its own. */
  onRemoteLayout(layout: ModuleDocument): void;
}) {
  const enabled = trpc.chapters.enabled.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const on = Boolean(enabled.data?.enabled) && storyId > 0;
  const utils = trpc.useUtils();
  const list = trpc.chapters.list.useQuery({ storyId }, { enabled: on, retry: false, refetchOnWindowFocus: false });
  const create = trpc.chapters.create.useMutation();
  const save = trpc.chapters.save.useMutation();
  const [conflict, setConflict] = useState(false);
  const created = useRef(false);
  const seeded = useRef(false);
  const version = useRef(0);
  const lastSaved = useRef<string | null>(null);
  const chapter = list.data?.[0] ?? null;

  useEffect(() => {
    if (!on || !list.data || list.data.length > 0 || created.current || !body.trim()) return;
    created.current = true;
    create.mutate(
      { storyId, title: title.trim() || "第 1 章", body },
      { onSuccess: () => void utils.chapters.list.invalidate({ storyId }) }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, list.data, storyId]);

  useEffect(() => {
    if (!chapter) return;
    version.current = chapter.version;
    if (seeded.current) return;
    seeded.current = true;
    if (chapter.layout) {
      lastSaved.current = JSON.stringify(chapter.layout);
      if (!document) onRemoteLayout(chapter.layout as ModuleDocument);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id]);

  useEffect(() => {
    if (!on || !chapter || !document || conflict) return;
    const serialized = JSON.stringify(document);
    if (serialized === lastSaved.current) return;
    const timer = setTimeout(() => {
      save.mutate(
        { chapterId: chapter.id, expectedVersion: version.current, layout: document },
        {
          onSuccess: saved => {
            version.current = saved.version;
            lastSaved.current = serialized;
          },
          onError: error => {
            if (error.data?.code === "CONFLICT") {
              setConflict(true);
              toast.error("这一章在别处已有新版本，已暂停保存。请刷新后再继续。");
            }
          },
        }
      );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, chapter?.id, document, conflict]);

  return { enabled: on, conflict };
}
