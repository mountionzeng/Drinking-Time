import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { useDesktopWritingSession } from "@/features/writingCompanion/desktopWritingSession";
import { prepareMountedBook } from "@/features/bookVideo/bookPreparation";
import {
  STUDIO_CREATE_EVENT,
  type StudioCreateRequest,
} from "./StudioCreateMenu";
import type { ConversionDraft } from "@shared/bookWorkflow";
import { writingModuleTexts } from "@shared/bookWritingStyle";
import { readBookImage } from "@shared/bookImageBlock";
import { readBookAudio } from "@shared/bookAudioBlock";

const button = "rounded-md border px-3 py-2 text-sm disabled:opacity-40";
const isGenerating = (draft: ConversionDraft) =>
  draft.status === "generating" &&
  Date.now() - draft.createdAt < 15 * 60 * 1000;
export function FilmVersionDraft({
  storyId,
  request,
  blocked,
  onDone,
  target = "storyboard",
}: {
  target?: "text" | "storyboard";
  storyId: number;
  request: string;
  blocked: boolean;
  onDone(): void;
}) {
  const _ui = useUiText();
  const utils = trpc.useUtils();
  const query = trpc.bookWorkflow.get.useQuery(
    { storyId },
    {
      refetchInterval: q =>
        q.state.data?.state.conversions.some(isGenerating) ? 3000 : false,
    }
  );
  const generate = trpc.bookWorkflow.generateFilm.useMutation({ retry: false });
  const adopt = trpc.bookWorkflow.adopt.useMutation({ retry: false });
  const propose = trpc.bookVideo.propose.useMutation({ retry: false });
  const [draft, setDraft] = useState<ConversionDraft | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const lock = useRef(false);
  const token = useRef<{ key: string; id: string } | null>(null);
  const origin = useRef(storySpineStore.getState());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => {
    const now = storySpineStore.getState(),
      start = origin.current;
    if (
      !mounted.current ||
      now.activeStoryId !== storyId ||
      now.accountId !== start.accountId ||
      now.storyScopeEpoch !== start.storyScopeEpoch
    )
      throw new Error(_ui("已切换故事，请回到原故事查看生成结果。"));
  };
  const pending = [...(query.data?.state.conversions ?? [])]
    .reverse()
    .find(
      d =>
        d.target === target &&
        (d.status === "review" ||
          isGenerating(d) ||
          (d.status === "adopted" &&
            d.adoptedId === query.data?.state.current[target]))
    );
  const preview = draft
    ? (query.data?.state.conversions.find(d => d.id === draft.id) ?? draft)
    : pending;
  const needsRegeneration = Boolean(
    preview && request.trim() && request.trim() !== preview.request.trim()
  );
  const busy = running || Boolean(preview && isGenerating(preview));
  async function run(task: () => Promise<void>) {
    if (lock.current || blocked) return;
    lock.current = true;
    setRunning(true);
    setError("");
    try {
      current();
      await prepareMountedBook(storyId, origin.current.accountId);
      current();
      await task();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : _ui("操作未完成，原稿已保留")
      );
    } finally {
      lock.current = false;
      setRunning(false);
    }
  }
  async function generateDraft() {
    await run(async () => {
      const scope = storySpineStore.getState();
      const conversation = scope.messages
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
      const writing = useDesktopWritingSession.getState().session;
      const chapterId =
        writing?.storyId === storyId && writing.accountId === scope.accountId
          ? Number(writing.getSnapshot().scope?.match(/:chapter:(\d+)/)?.[1]) ||
            undefined
          : undefined;
      const key = JSON.stringify({ request, conversation, chapterId });
      if (token.current?.key !== key)
        token.current = { key, id: crypto.randomUUID() };
      const result = await generate.mutateAsync({
        storyId,
        id: token.current.id,
        chapterId,
        request,
        conversation,
        target,
      });
      current();
      setDraft(result);
      // Keep the request ID only while the result is uncertain or still running.
      // A deliberate regeneration after a completed preview must create a new draft.
      if (result.status !== "generating") token.current = null;
      await query.refetch();
      if (result.status === "failed") {
        token.current = null;
        throw new Error(result.error || _ui("分镜未生成，请重试"));
      }
    });
  }
  async function continueFilm() {
    if (!preview) return;
    await run(async () => {
      const version = await adopt.mutateAsync({
        storyId,
        id: preview.id,
        revision: preview.revision,
      });
      current();
      await utils.chapters.list.invalidate({ storyId });
      const chapters = await utils.chapters.list.fetch({ storyId, kind: target });
      current();
      await Promise.all(chapters.map(chapter =>
        utils.chapters.get.invalidate({ chapterId: chapter.id })
      ));
      current();
      window.dispatchEvent(
        new CustomEvent("dt:select-manuscript", {
          detail: {
            storyId,
            accountId: origin.current.accountId,
            kind: target,
          },
        })
      );
      if (target === "text") {
        onDone();
        return;
      }
      // Same stable token recovers a proposal after a dropped response without another model call.
      const record = await propose.mutateAsync({
        storyId,
        id: `film-${preview.id}`,
        versionId: origin.current.publishing.activeVersionId ?? "v1",
        request:
          preview.request ||
          "按已确认分镜制作影片；未说明的用途、受众和平台请向我确认。",
        layout: {
          body: version.chapters.map(c => c.blocks.body).join("\n\n"),
          illustrations: [],
        },
      });
      current();
      await utils.bookVideo.list.invalidate({ storyId });
      current();
      window.dispatchEvent(
        new CustomEvent<StudioCreateRequest>(STUDIO_CREATE_EVENT, {
          detail: {
            id: crypto.randomUUID(),
            storyId,
            kind: "video",
            instruction: preview.request,
            videoRecordId: record.id,
          },
        })
      );
      onDone();
    });
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {target === "text"
          ? _ui("将分镜改写成文字，原分镜和旧版本会保留。")
          : _ui(
              "先把书稿和聊天整理成可拍摄的分镜，确认后继续编排视频素材。旧版本会保留。"
            )}
      </p>
      {preview?.chapters && (
        <div
          className="max-h-64 space-y-3 overflow-y-auto rounded-md border p-3"
          aria-label={target === "text" ? _ui("文字预览") : _ui("分镜预览")}
        >
          {preview.chapters.map((chapter, i) => (
            <section key={i}>
              <h3 className="font-medium">{chapter.title}</h3>
              {writingModuleTexts(
                chapter.blocks.body,
                chapter.blocks.writingStyle
              ).map((text, j) => (
                <p key={j} className="whitespace-pre-wrap py-1 text-sm">
                  {readBookImage(text)
                    ? _ui("沿用原图")
                    : readBookAudio(text)
                      ? _ui("沿用原声音素材")
                      : text}
                </p>
              ))}
            </section>
          ))}
        </div>
      )}
      {(error || preview?.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || preview?.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          className={button}
          disabled={busy || blocked || query.isLoading || query.isError}
          onClick={() => void generateDraft()}
        >
          {busy
            ? _ui("正在整理…")
            : preview?.chapters
              ? _ui("按新想法重新生成")
              : target === "text"
                ? _ui("生成文字")
                : _ui("生成分镜")}
        </button>
        {preview?.chapters && (
          <button
            className={`${button} bg-[var(--nayin-accent)] text-white`}
            disabled={busy || blocked || needsRegeneration}
            onClick={() => void continueFilm()}
          >
            {target === "text" ? _ui("确认文字新版本") : _ui("确认分镜并继续")}
          </button>
        )}
      </div>
    </div>
  );
}
