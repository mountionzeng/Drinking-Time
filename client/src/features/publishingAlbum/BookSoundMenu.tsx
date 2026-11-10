import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BOOK_MUSIC_OPEN } from "./BookMusicInsert";
import { bookAudioText } from "@shared/bookAudioBlock";
import {
  BOOK_NARRATION_VOICES,
  type BookNarrationVoiceGender,
} from "@shared/bookNarrationVoice";
import type { ManuscriptKind } from "@shared/bookWorkflow";
import { formatComputeQuote } from "@shared/computeMoney";
import { prepareMountedBook } from "@/features/bookVideo/bookPreparation";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { awaitMediaTask } from "@/lib/mediaTaskPolling";

export function BookSoundMenu({
  storyId,
  chapterId,
  kind,
  disabled,
  onInsert,
}: {
  storyId: number;
  chapterId: number;
  kind: ManuscriptKind;
  disabled: boolean;
  onInsert(texts: string[]): Promise<void>;
}) {
  const _ui = useUiText();
  const [open, setOpen] = useState(false),
    [narration, setNarration] = useState(false),
    [error, setError] = useState("");
  const label = kind === "storyboard" ? _ui("台词") : _ui("有声书");
  const details = useRef<HTMLDetailsElement>(null);
  async function choose(type: "music" | "narration") {
    if (details.current) details.current.open = false;
    const start = storySpineStore.getState();
    setError("");
    try {
      await prepareMountedBook(storyId, start.accountId);
      const now = storySpineStore.getState();
      if (
        now.activeStoryId !== storyId ||
        now.accountId !== start.accountId ||
        now.storyScopeEpoch !== start.storyScopeEpoch
      )
        return;
      if (type === "music")
        window.dispatchEvent(
          new CustomEvent(BOOK_MUSIC_OPEN, {
            detail: { storyId, wholeBook: true },
          })
        );
      else {
        setNarration(true);
        setOpen(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : _ui("书稿未保存"));
    }
  }
  return (
    // The book canvas extends upward for its block tools; keep this entry above that hit area.
    <div className="relative z-30 text-sm">
      <details ref={details} className="relative w-fit">
        <summary
          aria-disabled={disabled}
          className="cursor-pointer list-none py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={event => {
            if (disabled) event.preventDefault();
          }}
        >
          {_ui("＋ 添加声音")}
        </summary>
        <div className="absolute left-0 z-20 mt-1 grid min-w-36 rounded-md border bg-background p-1 shadow-sm">
          <button
            type="button"
            aria-label={_ui("背景音乐")}
            disabled={disabled}
            className="rounded px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => void choose("music")}
          >
            {_ui("背景音乐")}
          </button>
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            className="rounded px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => void choose("narration")}
          >
            {label}
          </button>
        </div>
      </details>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {open && narration && (
        <WholeBookNarration
          storyId={storyId}
          chapterId={chapterId}
          kind={kind}
          onInsert={onInsert}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
function WholeBookNarration({
  storyId,
  chapterId,
  kind,
  onInsert,
  onClose,
}: {
  storyId: number;
  chapterId: number;
  kind: ManuscriptKind;
  onInsert(texts: string[]): Promise<void>;
  onClose(): void;
}) {
  const _ui = useUiText();
  const scope = useRef(storySpineStore.getState());
  const label = kind === "storyboard" ? _ui("台词") : _ui("有声书");
  const target = {
    storyId,
    chapterId,
    moduleId: "whole-book",
    wholeBook: { kind, dialogueOnly: kind === "storyboard" },
  };
  const utils = trpc.useUtils();
  const query = trpc.bookMedia.wholeSoundSource.useQuery(target, {
    retry: false,
  });
  const price = trpc.bookMedia.quoteNarration.useMutation({ retry: false });
  const generate = trpc.timelineMedia.generateNarrationCandidate.useMutation({
    retry: false,
  });
  const [voice, setVoice] = useState<BookNarrationVoiceGender>("female");
  const [quotes, setQuotes] = useState<
    Array<Awaited<ReturnType<typeof price.mutateAsync>>>
  >([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const lock = useRef(false);
  const fingerprint = useRef("");
  const assertCurrent = () => {
    const now = storySpineStore.getState();
    if (
      now.accountId !== scope.current.accountId ||
      now.activeStoryId !== storyId ||
      now.storyScopeEpoch !== scope.current.storyScopeEpoch
    )
      throw new Error(_ui("已切换作品，声音保留在原作品仓库中"));
  };
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      assertCurrent();
      await prepareMountedBook(storyId, scope.current.accountId);
      assertCurrent();
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : _ui("声音操作未完成"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const storageKey = (hash: string) =>
    `dt:whole-book-narration:${scope.current.accountId}:${storyId}:${kind}:${voice}:${hash}`;
  return (
    <Dialog
      open
      onOpenChange={value => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{_ui("添加{0}", [label])}</DialogTitle>
          <DialogDescription>
            {kind === "storyboard"
              ? _ui("按整本分镜顺序朗读已标记的台词，画面和动作说明不参与。")
              : _ui("按整本书的章节顺序朗读，图片和已有声音不参与。")}
            {_ui("长文会自动分段，统一确认费用。")}
          </DialogDescription>
        </DialogHeader>
        {query.isLoading && <p>{_ui("正在读取整本书…")}</p>}
        {query.error && <p role="alert">{query.error.message}</p>}
        {query.data && (
          <>
            <p className="text-xs text-muted-foreground">
              {_ui("共 {0} 字 · {1} 段声音", [
                query.data.text.length,
                query.data.segments.length,
              ])}
            </p>
            <div
              aria-label={_ui("整书朗读原文")}
              className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border p-3 text-sm"
            >
              {query.data.text}
            </div>
          </>
        )}
        <label className="text-sm">
          {_ui("朗读声音")}
          <select
            aria-label={_ui("朗读声音")}
            className="ml-3 rounded border bg-background p-2"
            value={voice}
            disabled={busy || submitted}
            onChange={event => {
              setVoice(event.target.value as BookNarrationVoiceGender);
              setQuotes([]);
            }}
          >
            {Object.entries(BOOK_NARRATION_VOICES).map(([value, preset]) => (
              <option key={value} value={value}>
                {_ui(preset.label)}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-40"
          disabled={busy || submitted || !query.data}
          onClick={() =>
            void run(async () => {
              const fresh = await utils.bookMedia.wholeSoundSource.fetch(
                target,
                { staleTime: 0 }
              );
              assertCurrent();
              fingerprint.current = fresh.fingerprint;
              const previous = localStorage.getItem(
                storageKey(fresh.fingerprint)
              );
              if (previous) {
                setSubmitted(true);
                throw new Error(
                  _ui(
                    "这份书稿的朗读已提交，请到声音仓库核对已有结果，避免重复生成。"
                  )
                );
              }
              const result = await Promise.all(
                fresh.segments.map((_, segment) =>
                  price.mutateAsync({
                    ...target,
                    voiceGender: voice,
                    wholeBook: { ...target.wholeBook, segment },
                  })
                )
              );
              assertCurrent();
              setQuotes(result);
            })
          }
        >
          {busy ? _ui("正在处理…") : _ui("查看整书朗读费用")}
        </button>
        {quotes.length > 0 && (
          <button
            className="rounded-md bg-[var(--nayin-accent)] px-3 py-2 text-sm text-white disabled:opacity-40"
            disabled={busy || submitted}
            onClick={() =>
              void run(async () => {
                const fresh = await utils.bookMedia.wholeSoundSource.fetch(
                  target,
                  { staleTime: 0 }
                );
                if (fresh.fingerprint !== fingerprint.current) {
                  setQuotes([]);
                  throw new Error(_ui("书稿已修改，请重新查看费用"));
                }
                assertCurrent();
                const operation = {
                  editorSessionEpoch: crypto.randomUUID(),
                  operationId: `book-${storyId}-${fresh.fingerprint.slice(0, 40)}-${voice}`,
                };
                localStorage.setItem(
                  storageKey(fresh.fingerprint),
                  JSON.stringify({ operation, startedAt: Date.now() })
                );
                setSubmitted(true);
                const sounds: string[] = [];
                for (const [i, quote] of quotes.entries()) {
                  assertCurrent();
                  // Quotes expire quickly; renew the same source/voice without increasing the approved price.
                  const renewed = await price.mutateAsync({
                    ...target,
                    voiceGender: voice,
                    wholeBook: { ...target.wholeBook, segment: i },
                  });
                  if (
                    renewed.textRevision !== quote.textRevision ||
                    renewed.estimatedCny !== quote.estimatedCny ||
                    renewed.voice !== quote.voice
                  )
                    throw new Error(_ui("书稿已修改，请重新查看费用"));
                  const result = await awaitMediaTask(
                    await generate.mutateAsync({
                      storyId,
                      operation: {
                        ...operation,
                        operationId: `${operation.operationId}-${i}`,
                      },
                      subtitleCueId: renewed.subtitleCueId,
                      quoteToken: renewed.quoteToken,
                    }),
                    mediaTaskId =>
                      utils.timelineMedia.mediaTaskStatus.fetch(
                        { mediaTaskId },
                        { staleTime: 0 }
                      )
                  );
                  if (result.status !== "candidate-ready")
                    throw new Error(
                      _ui(
                        "部分声音尚未确认，已完成的声音保留在仓库，请先核对任务和费用，暂勿重复提交。"
                      )
                    );
                  sounds.push(
                    bookAudioText(
                      storyId,
                      result.candidate.assetId,
                      `${label} ${i + 1}`,
                      "narration"
                    )
                  );
                }
                assertCurrent();
                await prepareMountedBook(storyId, scope.current.accountId);
                const latest = await utils.bookMedia.wholeSoundSource.fetch(
                  target,
                  { staleTime: 0 }
                );
                if (latest.fingerprint !== fingerprint.current)
                  throw new Error(
                    _ui(
                      "声音已生成，期间书稿有新修改；声音保留在仓库，请核对后插入。"
                    )
                  );
                assertCurrent();
                await onInsert(sounds);
                await utils.timelineMedia.audioAssetLibrary.invalidate({
                  storyId,
                });
                onClose();
              })
            }
          >
            {_ui("确认生成整书{0} · {1}", [
              label,
              formatComputeQuote(
                quotes.reduce((sum, quote) => sum + quote.estimatedCny, 0)
              ).replace("算力", _ui("算力")),
            ])}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
