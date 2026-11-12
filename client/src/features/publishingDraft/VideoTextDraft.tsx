import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import {
  prepareMountedBook,
  refreshPreparedBook,
} from "@/features/bookVideo/bookPreparation";
import { writingModuleTexts } from "@shared/bookWritingStyle";
import type { ConversionDraft } from "@shared/bookWorkflow";

const button = "rounded-md border px-3 py-2 text-sm disabled:opacity-40";
export function VideoTextDraft({
  storyId,
  request,
  method = "rewrite",
  blocked,
  onDone,
}: {
  storyId: number;
  request: string;
  method?: "rewrite" | "local-transcript";
  blocked: boolean;
  onDone(): void;
}) {
  const _ui = useUiText(),
    utils = trpc.useUtils();
  const origin = useRef(storySpineStore.getState()),
    alive = useRef(true),
    lock = useRef(false);
  const token = useRef<{ key: string; id: string } | null>(null);
  const [quote, setQuote] = useState<Awaited<
    ReturnType<typeof quoteMutation.mutateAsync>
  > | null>(null);
  const [quoteRequest, setQuoteRequest] = useState("");
  const [draft, setDraft] = useState<ConversionDraft | null>(null);
  const [edited, setEdited] = useState<{
    key: string;
    texts: string[][];
  } | null>(null);
  const edit = trpc.bookWorkflow.edit.useMutation({ retry: false });
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const quoteMutation = trpc.bookWorkflow.quoteVideoText.useMutation({
    retry: false,
  });
  const generate = trpc.bookWorkflow.generateVideoText.useMutation({
    retry: false,
  });
  const adopt = trpc.bookWorkflow.adopt.useMutation({ retry: false });
  const history = trpc.bookWorkflow.get.useQuery(
    { storyId },
    {
      refetchInterval: q =>
        q.state.data?.state.conversions.some(
          d =>
            d.source.kind === "video" &&
            d.status === "generating" &&
            Date.now() - d.createdAt < 15 * 60_000
        )
          ? 2500
          : false,
    }
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = () => {
    const s = storySpineStore.getState();
    return (
      alive.current &&
      s.accountId === origin.current.accountId &&
      s.activeStoryId === storyId &&
      s.storyScopeEpoch === origin.current.storyScopeEpoch
    );
  };
  const persisted = [...(history.data?.state.conversions ?? [])]
    .reverse()
    .find(
      d =>
        d.source.kind === "video" &&
        d.target === "text" &&
        d.request === request.trim() &&
        (d.videoTextMethod ?? "rewrite") === method &&
        d.status !== "adopted"
    );
  const matchingDraft =
    draft?.request === request.trim() &&
    (draft.videoTextMethod ?? "rewrite") === method
      ? draft
      : null;
  const quoteMatches = Boolean(
    quote && quoteRequest === request.trim() && quote.method === method
  );
  const savedDraft =
    matchingDraft &&
    history.data?.state.conversions.find(d => d.id === matchingDraft.id);
  const preview = matchingDraft
    ? savedDraft && savedDraft.revision >= matchingDraft.revision
      ? savedDraft
      : matchingDraft
    : persisted;
  const previewKey = preview ? `${preview.id}:${preview.revision}` : "";
  const previewTexts =
    preview?.chapters?.map(c =>
      writingModuleTexts(c.blocks.body, c.blocks.writingStyle)
    ) ?? [];
  const displayedTexts =
    edited?.key === previewKey ? edited.texts : previewTexts;
  const uncertain =
    method !== "local-transcript" &&
    history.data?.state.conversions.some(
      d =>
        d.source.kind === "video" &&
        (d.submissionUncertain ||
          /submission outcome unknown|reconciliation required/.test(
            d.error ?? ""
          ))
    );
  const generating =
    preview?.status === "generating" &&
    Date.now() - preview.createdAt < 15 * 60_000;
  const busy = running || generating;
  async function run(action: () => Promise<void>) {
    if (lock.current || blocked || !current()) return;
    lock.current = true;
    setRunning(true);
    setError("");
    try {
      await prepareMountedBook(storyId, origin.current.accountId);
      if (current()) await action();
    } catch (e) {
      if (current())
        setError(
          e instanceof Error ? e.message : _ui("操作未完成，原稿已保留")
        );
    } finally {
      lock.current = false;
      if (current()) setRunning(false);
    }
  }
  async function prepare() {
    await run(async () => {
      const value = await quoteMutation.mutateAsync({
        storyId,
        request: request.trim(),
        method,
      });
      if (current()) {
        setQuote(value);
        setQuoteRequest(request.trim());
      }
    });
  }
  async function submit() {
    if (!quote || !quoteMatches) return;
    await run(async () => {
      const key = quote.quoteFingerprint;
      if (token.current?.key !== key)
        token.current = { key, id: crypto.randomUUID() };
      const result = await generate.mutateAsync({
        storyId,
        request: request.trim(),
        method,
        id: token.current.id,
        quoteFingerprint: key,
      });
      if (!current()) return;
      setDraft(result);
      setQuote(null);
      await history.refetch();
      if (result.status === "failed")
        setError(result.error ?? _ui("视频转文字未完成"));
      if (result.status !== "generating") token.current = null;
    });
  }
  async function accept() {
    if (!preview) return;
    await run(async () => {
      let accepted = preview;
      if (
        edited?.key === previewKey &&
        JSON.stringify(edited.texts) !== JSON.stringify(previewTexts)
      ) {
        accepted = await edit.mutateAsync({
          storyId,
          id: preview.id,
          revision: preview.revision,
          texts: edited.texts,
        });
        if (!current()) return;
        setDraft(accepted);
        setEdited(null);
      }
      await adopt.mutateAsync({
        storyId,
        id: accepted.id,
        revision: accepted.revision,
      });
      if (!current()) return;
      await utils.chapters.list.invalidate({ storyId });
      const chapters = await utils.chapters.list.fetch({
        storyId,
        kind: "text",
      });
      await Promise.all(
        chapters.map(c => utils.chapters.get.invalidate({ chapterId: c.id }))
      );
      if (!current()) return;
      await refreshPreparedBook(storyId, origin.current.accountId, chapters);
      await utils.bookWorkflow.get.invalidate({ storyId });
      if (!current()) return;
      window.dispatchEvent(
        new CustomEvent("dt:select-manuscript", {
          detail: {
            storyId,
            accountId: origin.current.accountId,
            kind: "text",
          },
        })
      );
      onDone();
    });
  }
  return (
    <div className="space-y-3" data-testid="video-text-draft">
      <p className="text-sm text-muted-foreground">
        {_ui(
          method === "local-transcript"
            ? "优先读取字幕，没有字幕时转写旁白；0 算力。预览中可直接校对，采用后保存为文字版本。"
            : "读取当前视频的声音和画面，按你的要求整理文字；原视频和旧书稿保留。"
        )}
      </p>
      {busy && (
        <p role="status" className="text-sm">
          {_ui("正在读取视频并整理文字，你可以继续聊天，结果会保存在版本中。")}
        </p>
      )}
      {quote && quoteMatches && (
        <div className="rounded-md border p-3 text-sm" role="status">
          <p>
            {_ui("本次最多")} {String(quote.estimatedCompute)} {_ui("算力")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {quote.method === "local-transcript" ? (
              _ui("本地原文读取")
            ) : (
              <>
                {quote.providerLabel} · {quote.model} · {quote.frameCount}{" "}
                {_ui("张视频抽帧和本地音轨转写")}
              </>
            )}
          </p>
        </div>
      )}
      {preview?.chapters && (
        <div
          className="max-h-72 space-y-3 overflow-y-auto rounded-md border p-3"
          aria-label={_ui("文字预览")}
        >
          {preview.chapters.map((c, i) => (
            <section key={i}>
              <h3 className="font-medium">{c.title}</h3>
              {displayedTexts[i]?.map((text, j) => (
                <textarea
                  key={j}
                  aria-label={_ui("第 {0} 章 · 第 {1} 段", [i + 1, j + 1])}
                  value={text}
                  rows={Math.min(8, Math.max(2, text.split("\n").length))}
                  disabled={busy || blocked}
                  className="w-full resize-y rounded border bg-transparent p-2 text-sm"
                  onChange={event => {
                    const next = displayedTexts.map(row => [...row]);
                    next[i][j] = event.target.value;
                    setEdited({ key: previewKey, texts: next });
                  }}
                />
              ))}
            </section>
          ))}
        </div>
      )}
      {(uncertain || error || preview?.error) && (
        <p role="alert" className="text-sm text-destructive">
          {uncertain
            ? _ui(
                "视频转文字响应中断，结果和费用待核对；未产生新文字，请勿重复提交。"
              )
            : error || preview?.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {preview?.chapters &&
        preview.request === request.trim() &&
        (preview.videoTextMethod ?? "rewrite") === method ? (
          <button
            className={`${button} bg-[var(--nayin-accent)] text-white`}
            disabled={busy || blocked}
            onClick={() => void accept()}
          >
            {_ui("采用文字新版本 / Use text version")}
          </button>
        ) : (
          <button
            className={button}
            disabled={busy || blocked || Boolean(uncertain) || !request.trim()}
            onClick={() => void (quoteMatches ? submit() : prepare())}
          >
            {busy
              ? _ui("正在整理…")
              : quoteMatches
                ? _ui("确认生成 / Confirm generation")
                : _ui("生成文字 / Generate text")}
          </button>
        )}
      </div>
    </div>
  );
}
