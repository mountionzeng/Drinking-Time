import { Copy, Loader2, RefreshCw, Save } from "lucide-react";
import React, { type Ref, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMobileDocument } from "./useMobileDocument";

export type MobileDocumentController = ReturnType<typeof useMobileDocument>;

async function copyDocumentText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") throw new Error("当前环境无法复制");
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制失败");
}

function documentStatus(controller: MobileDocumentController): string {
  const status = controller.state?.status;
  switch (status) {
    case "clean":
      return "与服务器一致";
    case "dirty":
      return "有未保存修改";
    case "saving":
      return "正在保存…";
    case "saved":
      return "已保存，可在电脑继续";
    case "failed":
      return "保存失败，正文仍保留在本机";
    case "uncertain":
      return "无法确认是否保存，正文仍保留在本机";
    case "conflict":
      return "发现其他设备上的新正文，请先处理冲突";
    default:
      return "";
  }
}

export function MobileDocumentConflictDetails({
  localBody,
  latestBody,
  onCopyLocal,
  onLoadLatest,
  copyButtonRef,
}: {
  localBody: string;
  latestBody: string | null;
  onCopyLocal: () => void;
  onLoadLatest: () => void;
  copyButtonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="min-h-0 space-y-3">
      <section aria-labelledby="mobile-local-document-heading">
        <h3
          id="mobile-local-document-heading"
          className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground"
        >
          我在手机上的正文
        </h3>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-amber-700/20 bg-amber-50 p-3 font-sans text-sm leading-5 text-amber-950">
          {localBody || "（空白正文）"}
        </pre>
      </section>
      <section aria-labelledby="mobile-latest-document-heading">
        <h3
          id="mobile-latest-document-heading"
          className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground"
        >
          服务器上的最新正文
        </h3>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/60 p-3 font-sans text-sm leading-5 text-foreground">
          {latestBody ?? "暂时无法读取最新正文"}
        </pre>
      </section>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          ref={copyButtonRef}
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={onCopyLocal}
        >
          <Copy aria-hidden="true" />
          复制我的正文
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="min-h-11"
          disabled={latestBody === null}
          onClick={onLoadLatest}
        >
          载入最新正文
        </Button>
      </div>
    </div>
  );
}

export function MobileDocumentView({
  controller,
  storyTitle,
  suppressConflictDialog = false,
}: {
  controller: MobileDocumentController;
  storyTitle: string;
  suppressConflictDialog?: boolean;
}) {
  const [announcement, setAnnouncement] = useState("");
  const [dismissedConflictId, setDismissedConflictId] = useState<string | null>(
    null
  );
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const conflict = controller.state?.conflict ?? null;
  const conflictId = useMemo(() => {
    if (!conflict) return null;
    const latest = conflict.latestDocument;
    return [
      controller.state?.storyId,
      controller.state?.recovery?.scopeKey,
      latest?.versionId ?? "missing",
      latest?.bodyRevision ?? "missing",
      conflict.localBody.length,
    ].join(":");
  }, [conflict, controller.state?.recovery?.scopeKey, controller.state?.storyId]);
  const conflictOpen =
    !suppressConflictDialog &&
    conflict !== null &&
    conflictId !== null &&
    conflictId !== dismissedConflictId;

  if (controller.loadState === "loading") {
    return (
      <section
        aria-label={`${storyTitle}的正文`}
        className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        正在读取正文…
      </section>
    );
  }

  if (controller.loadState === "error" || !controller.state) {
    return (
      <section
        aria-label={`${storyTitle}的正文`}
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <p className="text-sm text-destructive">
          {controller.loadError || "正文加载失败"}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void controller.retryLoad()}
        >
          <RefreshCw aria-hidden="true" />
          重试正文
        </Button>
      </section>
    );
  }

  const statusText = documentStatus(controller);
  const latestBody = conflict?.latestDocument?.body ?? null;

  return (
    <section
      aria-label={`${storyTitle}的正文`}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 px-3 pt-3">
        <textarea
          aria-label="正文内容"
          className="h-full min-h-0 w-full resize-none overflow-y-auto rounded-2xl border border-border/80 bg-background/90 px-4 py-4 font-serif text-base leading-7 text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:bg-muted/55 disabled:text-muted-foreground"
          disabled={controller.state.status === "conflict"}
          placeholder="在这里继续正文…"
          spellCheck={false}
          value={controller.state.body}
          onChange={event => controller.editBody(event.target.value)}
        />
      </div>

      <div className="mobile-workspace-composer shrink-0 px-3 pt-3">
        <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-border/80 bg-background/95 p-2 pl-4 shadow-[0_-8px_28px_-24px_rgba(0,0,0,0.45)] backdrop-blur">
          <p
            className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {controller.state.error || statusText}
          </p>
          {controller.state.status === "conflict" ? (
            <Button
              type="button"
              className="min-h-11 rounded-xl"
              onClick={() => setDismissedConflictId(null)}
            >
              处理冲突
            </Button>
          ) : (
            <Button
              type="button"
              className="min-h-11 rounded-xl"
              disabled={!controller.canSave}
              onClick={() => void controller.save()}
            >
              {controller.isSaving ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Save aria-hidden="true" />
              )}
              保存正文
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={conflictOpen}
        onOpenChange={open => {
          if (!open) setDismissedConflictId(conflictId);
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:max-w-lg"
          showCloseButton={false}
          onOpenAutoFocus={event => {
            event.preventDefault();
            copyButtonRef.current?.focus();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>正文出现版本冲突</DialogTitle>
            <DialogDescription>
              其他设备上的正文已经变化。手机内容不会覆盖它，请先复制恢复或载入最新版。
            </DialogDescription>
          </DialogHeader>
          {conflict ? (
            <MobileDocumentConflictDetails
              copyButtonRef={copyButtonRef}
              latestBody={latestBody}
              localBody={conflict.localBody}
              onCopyLocal={() => {
                void copyDocumentText(conflict.localBody)
                  .then(() => setAnnouncement("手机正文已复制"))
                  .catch(() => setAnnouncement("复制失败，请长按正文复制"));
              }}
              onLoadLatest={() => {
                controller.discard();
                setDismissedConflictId(conflictId);
                setAnnouncement("已载入服务器上的最新正文");
              }}
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => setDismissedConflictId(conflictId)}
            >
              暂不处理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
