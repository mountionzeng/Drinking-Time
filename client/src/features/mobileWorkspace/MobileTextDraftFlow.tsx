import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { MobileCreateMenu } from "./MobileCreateMenu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  TextDraftMessage,
  TextDraftVersion,
} from "@shared/textDraftHistory";
import { textDraftContentSchema } from "@shared/textDraftHistory";
import type { MemoryFollowupSource } from "./mobileMemoryFollowup";
import {
  mobileTextDraftRequest,
  mobileTextPreviewKey,
  type MobileTextPreview,
} from "./mobileTextDraftWorkflow";

const action =
  "min-h-11 rounded-lg px-3 text-sm text-primary disabled:opacity-40";

/** A single writing action in the existing chat. The preview is not a second conversation. */
export function MobileTextDraftFlow({
  userId,
  storyId,
  source,
  messages,
  instruction,
  disabled,
  onLocked,
  previewVersion,
  onTextSaved,
}: {
  userId: number;
  storyId: number;
  source?: MemoryFollowupSource;
  messages: TextDraftMessage[];
  instruction: string;
  disabled: boolean;
  onLocked?: (value: boolean) => void;
  previewVersion?: TextDraftVersion;
  onTextSaved?: (source: MemoryFollowupSource) => void;
}) {
  const t = useUiText();
  const utils = trpc.useUtils();
  const key = `${mobileTextPreviewKey(userId, storyId)}:${previewVersion?.id ?? "chat"}`;
  const [pending, setPending] = useState<MobileTextPreview | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      return saved &&
        typeof saved.token === "string" &&
        Number.isInteger(saved.publishingRevision) &&
        typeof saved.publishingVersionId === "string" &&
        (!saved.content ||
          textDraftContentSchema.safeParse(saved.content).success)
        ? saved
        : null;
    } catch {
      return null;
    }
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [canResubmit, setCanResubmit] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<{
    revision: number;
    versionId: string;
    title: string;
    body: string;
  } | null>(null);
  const [storageError, setStorageError] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const generate = trpc.textDrafts.generate.useMutation({ retry: false });
  const adopt = trpc.textDrafts.adopt.useMutation({ retry: false });
  const history = trpc.textDrafts.read.useQuery({ storyId }, { retry: false });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onLocked?.(busy || open);
    return () => onLocked?.(false);
  }, [busy, open, onLocked]);
  function remember(next: MobileTextPreview | null) {
    if (alive.current) setPending(next);
    try {
      if (next) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
      if (alive.current) setStorageError(false);
    } catch {
      if (alive.current) setStorageError(true);
    }
  }
  async function run(
    mode: "conversation" | "current-content" = "conversation"
  ) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    let submittedToken: string | null = null;
    try {
      const latest = await utils.textDrafts.read.fetch({ storyId });
      if (!alive.current) return;
      // An uncertain response is checked by the same token. Never purchase a replay.
      if (pending) {
        let version = latest.versions.find(
          v =>
            v.request.operationToken === pending.token ||
            v.id === pending.versionId
        );
        // A read proving no receipt enables an explicit retry of the exact same
        // request/token. Even a delayed original cannot buy a duplicate version.
        if (
          !version &&
          canResubmit &&
          pending.request?.storyId === storyId &&
          pending.request.operationToken === pending.token
        ) {
          submittedToken = pending.token;
          const recovered = await generate.mutateAsync(pending.request);
          if (alive.current)
            utils.textDrafts.read.setData({ storyId }, recovered);
          version = recovered.versions.find(v => v.id === pending.token);
          setCanResubmit(false);
        }
        if (version?.generated && version.status === "ready") {
          remember({
            ...pending,
            versionId: version.id,
            content:
              pending.content ?? version.adoption?.content ?? version.generated,
          });
          setSaved(Boolean(version.adoption));
          setOpen(true);
          return;
        }
        if (version?.status === "failed") {
          remember(null);
          throw new Error(
            version.error || "生成未完成，原文已保留。可以重新生成。"
          );
        }
        if (
          !version &&
          pending.request?.storyId === storyId &&
          pending.request.operationToken === pending.token
        ) {
          setCanResubmit(true);
          throw new Error(
            "还没有查询到这次生成，可以用原请求重试，已有版本不会重复生成。"
          );
        }
        throw new Error(
          "这次生成的结果尚未确认，请稍后检查，原文和聊天已保留。"
        );
      }
      const { publishing } = await utils.publishingDraft.read.fetch({
        storyId,
      });
      if (!alive.current) return;
      const baseline = {
        publishingRevision: publishing.revision,
        publishingVersionId: publishing.activeVersionId ?? "v1",
      };
      if (previewVersion?.generated) {
        remember({
          token: previewVersion.request.operationToken,
          versionId: previewVersion.id,
          ...baseline,
          content: previewVersion.adoption?.content ?? previewVersion.generated,
        });
        setSaved(Boolean(previewVersion.adoption));
        setOpen(true);
        return;
      }
      if (
        latest.versions.some(
          v => v.status === "generating" || v.status === "unknown"
        )
      )
        throw new Error("还有一版文字尚未确认完成，请先在文字历史中查看。");
      const token = crypto.randomUUID();
      const request = mobileTextDraftRequest({
        storyId,
        token,
        history: latest,
        publishing,
        source,
        messages,
        instruction,
        basisMode: mode,
      });
      const record: MobileTextPreview = {
        token,
        request,
        ...baseline,
        ...(source?.text?.versionId
          ? {
              baselineBody: source.text.content.body,
              baselineBodyRevision: source.text.bodyRevision,
            }
          : {}),
      };
      remember(record);
      submittedToken = token;
      const result = await generate.mutateAsync(request);
      if (alive.current) utils.textDrafts.read.setData({ storyId }, result);
      const version = result.versions.find(
        v => v.request.operationToken === token
      );
      if (version?.status === "failed") {
        remember(null);
        throw new Error(version.error || "生成未完成，原文已保留。");
      }
      if (!version?.generated || version.status !== "ready")
        throw new Error("结果尚未确认，请稍后检查生成结果。");
      remember({
        ...record,
        versionId: version.id,
        content: version.generated,
      });
      if (alive.current) setOpen(true);
    } catch (reason) {
      const code = (reason as { data?: { code?: string } })?.data?.code;
      if (
        submittedToken &&
        ["BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT"].includes(
          code ?? ""
        )
      ) {
        try {
          const latest = await utils.textDrafts.read.fetch({ storyId });
          if (
            !latest.versions.some(
              v => v.request.operationToken === submittedToken
            )
          )
            remember(null);
        } catch {
          /* unknown result stays recoverable */
        }
      }
      if (alive.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "暂未完成，原文和聊天已保留。"
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save(confirmedRevision?: number) {
    if (lock.current || !pending?.versionId || !pending.content) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setConflict(null);
    const expectedPublishingRevision =
      confirmedRevision ?? pending.publishingRevision;
    if (confirmedRevision !== undefined)
      remember({ ...pending, publishingRevision: confirmedRevision });
    try {
      const latest = await utils.textDrafts.read.fetch({ storyId });
      if (!alive.current) return;
      const result = await adopt.mutateAsync({
        storyId,
        versionId: pending.versionId,
        expectedRevision: latest.revision,
        expectedPublishingRevision,
        content: pending.content,
        feedback: "",
      });
      utils.textDrafts.read.setData({ storyId }, result.history);
      const platform = result.history.versions.find(
        v => v.id === pending.versionId
      )!.request.platform;
      const published = result.publishing.drafts[platform];
      if (source && published)
        onTextSaved?.({
          ...source,
          kind: "text",
          origin: "note",
          content: pending.content.body,
          text: {
            content: pending.content,
            parentId: pending.versionId,
            platform,
            versionId: result.publishing.activeVersionId ?? "v1",
            bodyRevision: published.bodyRevision ?? published.revision,
          },
        });
      // Only our unchanged editing buffer can be cleared by this adoption.
      window.dispatchEvent(
        new CustomEvent("dt:mobile-text-adopted", {
          detail: { storyId, ...pending },
        })
      );
      void utils.publishingDraft.readBody.invalidate({ storyId });
      void utils.publishingDraft.read.invalidate({ storyId });
      if (alive.current) setSaved(true);
      try {
        localStorage.removeItem(key);
      } catch {
        /* saved server-side */
      }
    } catch (reason) {
      // Adoption is idempotent. Read history after a lost response; never report a blind success.
      try {
        const latest = await utils.textDrafts.read.fetch({ storyId });
        const version = latest.versions.find(v => v.id === pending.versionId);
        if (
          version?.adoption &&
          JSON.stringify(version.adoption.content) ===
            JSON.stringify(pending.content)
        ) {
          utils.textDrafts.read.setData({ storyId }, latest);
          window.dispatchEvent(
            new CustomEvent("dt:mobile-text-adopted", {
              detail: { storyId, ...pending },
            })
          );
          void utils.publishingDraft.readBody.invalidate({ storyId });
          setSaved(true);
          localStorage.removeItem(key);
          return;
        }
      } catch {
        /* keep candidate and baseline */
      }
      try {
        const { publishing } = await utils.publishingDraft.read.fetch({
          storyId,
        });
        const latest = publishing.drafts[publishing.activePlatform]?.content;
        if (latest && publishing.revision !== expectedPublishingRevision)
          setConflict({
            revision: publishing.revision,
            versionId: publishing.activeVersionId ?? "v1",
            title: latest.title,
            body: latest.body,
          });
      } catch {
        /* candidate remains usable */
      }
      setError(
        reason instanceof Error
          ? reason.message
          : "未能确认保存，候选仍保留，请检查最新正文。"
      );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const candidate = pending?.content;
  return (
    <>
      <div className="shrink-0 px-4 pb-1 text-right">
        <button
          type="button"
          className={action}
          disabled={disabled || busy || history.isError || history.isLoading}
          onClick={() => {
            if (saved) {
              remember(null);
              setSaved(false);
            } else void run("conversation");
          }}
        >
          {busy ? (
            <Loader2
              aria-hidden="true"
              className="mr-1 inline size-3 animate-spin"
            />
          ) : null}
          {t(
            busy
              ? "正在处理…"
              : saved
                ? "继续修改"
                : pending
                  ? candidate
                    ? "查看新版本"
                    : canResubmit
                      ? "重试本次生成"
                      : "检查生成结果"
                  : previewVersion
                    ? "预览并保存"
                    : "生成新版本"
          )}
        </button>
        {!previewVersion && <MobileCreateMenu userId={userId} storyId={storyId}
          instruction={instruction} blocked={disabled || busy} />}
        {error && !open && (
          <p role="alert" className="text-left text-xs text-destructive">
            {error}
          </p>
        )}
        {history.isError && (
          <button className={action} onClick={() => void history.refetch()}>
            {t("重新读取文字历史")}
          </button>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={next => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="z-[80] flex h-[min(90dvh,850px)] max-w-[calc(100%-1rem)] flex-col gap-3 p-5 sm:max-w-2xl"
          onInteractOutside={e => e.preventDefault()}
          onOpenAutoFocus={e => {
            e.preventDefault();
            heading.current?.focus();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle ref={heading} tabIndex={-1}>
              {t(saved ? "已保存" : "新版本预览")}
            </DialogTitle>
            <DialogDescription>
              {t(
                saved
                  ? "电脑和手机都能看到，旧版本已保留。"
                  : "确认满意后再保存，原文仍保留。"
              )}
            </DialogDescription>
          </DialogHeader>
          {candidate && (
            <>
              <input
                aria-label={t("标题")}
                className="min-h-11 w-full border-0 bg-transparent font-serif text-xl outline-none"
                maxLength={160}
                value={candidate.title}
                readOnly={busy || saved}
                onChange={e =>
                  remember({
                    ...pending!,
                    content: { ...candidate, title: e.target.value },
                  })
                }
              />
              <textarea
                aria-label={t("新版本正文")}
                className="min-h-0 flex-1 resize-none border-0 bg-transparent font-serif text-base leading-8 outline-none"
                maxLength={20000}
                value={candidate.body}
                readOnly={busy || saved}
                onChange={e =>
                  remember({
                    ...pending!,
                    content: { ...candidate, body: e.target.value },
                  })
                }
              />
            </>
          )}
          {storageError && (
            <p role="alert" className="text-xs">
              {t("本机无法保留草稿，请先复制内容再离开。")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {conflict && (
            <div className="shrink-0 text-xs">
              <details>
                <summary className="min-h-8 cursor-pointer text-primary">
                  {t("查看其他位置保存的最新正文")}
                </summary>
                <p className="max-h-32 overflow-auto whitespace-pre-wrap leading-6">
                  {conflict.title}
                  {"\n"}
                  {conflict.body}
                </p>
              </details>
              {conflict.versionId === pending?.publishingVersionId && (
                <button
                  className={action}
                  disabled={busy}
                  onClick={() => void save(conflict.revision)}
                >
                  {t("已核对，保存这版")}
                </button>
              )}
            </div>
          )}
          <div className="flex shrink-0 items-center justify-between">
            <button
              type="button"
              className={action}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("返回")}
            </button>
            {saved ? (
              <span role="status" className="text-sm text-muted-foreground">
                {t("已保存")}
              </span>
            ) : (
              <button
                type="button"
                className={`${action} bg-primary text-primary-foreground`}
                disabled={busy || !candidate?.body.trim()}
                onClick={() => void save()}
              >
                {t(busy ? "正在保存…" : "保存新版本")}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
