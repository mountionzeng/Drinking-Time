import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { openMobileCompanion } from "./mobileMemoryFollowup";
import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const editSchema = z.object({
  kind: z.enum(["memory", "text"]),
  id: z.string(),
  token: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  baseTitle: z.string(),
  baseContent: z.string(),
  tags: z.array(z.string()).default([]),
});
export type MobileEditSession = z.infer<typeof editSchema>;
export type MobileEditSeed = Pick<
  MobileEditSession,
  "kind" | "id" | "title" | "content"
> & { tags?: string[] };

export function useMobileSyncedEditor(userId: number, storyId: number) {
  const key = `dt:mobile:revision:v1:${userId}:${storyId}`;
  const [draft, setDraft] = useState<MobileEditSession | null>(() => {
    try {
      return editSchema.parse(JSON.parse(localStorage.getItem(key) || "null"));
    } catch {
      return null;
    }
  });
  const [storageError, setStorageError] = useState(false);
  const update = (next: MobileEditSession | null) => {
    setDraft(next);
    try {
      if (next) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  return {
    draft,
    update,
    storageError,
    open: (seed: MobileEditSeed) =>
      update({
        ...seed,
        token: crypto.randomUUID(),
        baseTitle: seed.title,
        baseContent: seed.content,
        tags: seed.tags ?? [],
      }),
  };
}

export function MobileSyncedEditor({
  storyId,
  editor,
  onTextSaved,
}: {
  storyId: number;
  editor: ReturnType<typeof useMobileSyncedEditor>;
  onTextSaved: (versionId: string) => void;
}) {
  const t = useUiText();

  const { draft, update } = editor;
  const utils = trpc.useUtils();
  const reviseText = trpc.textDrafts.revise.useMutation({ retry: false });
  const reviseMemory = trpc.memoryWarehouse.revise.useMutation({
    retry: false,
  });
  const [error, setError] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft !== null]);
  useEffect(() => {
    setError("");
    setDiscarding(false);
  }, [draft?.id]);
  if (!draft) return null;
  const dirty =
    draft.title !== draft.baseTitle || draft.content !== draft.baseContent;
  const close = () => {
    if (lock.current) return;
    if (dirty && !discarding) {
      setDiscarding(true);
      return;
    }
    update(null);
  };
  const save = async () => {
    if (lock.current || !draft.title.trim() || !draft.content.trim()) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      if (draft.kind === "text") {
        // The source is immutable; reading the latest history only sets the append CAS.
        const latest = await utils.textDrafts.read.fetch({ storyId });
        const result = await reviseText.mutateAsync({
          storyId,
          versionId: draft.id,
          operationToken: draft.token,
          expectedRevision: latest.revision,
          content: {
            title: draft.title,
            body: draft.content,
            tags: draft.tags,
          },
        });
        utils.textDrafts.read.setData({ storyId }, result.history);
        onTextSaved(result.versionId);
      } else {
        await reviseMemory.mutateAsync({
          storyId,
          id: draft.id,
          revisionId: draft.token,
          expectedTitle: draft.baseTitle,
          expectedContent: draft.baseContent,
          title: draft.title,
          content: draft.content,
        });
        void utils.memoryWarehouse.forStory.invalidate({ storyId });
        void utils.memoryWarehouse.list.invalidate();
      }
      update(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "未保存成功，修改仍保留，请重试。"
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(90dvh,850px)] max-w-[calc(100%-1rem)] flex-col gap-3 p-4 sm:max-w-2xl"
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => {
          event.preventDefault();
          close();
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle>
            {draft.kind === "memory" ? t("编辑记忆") : t("编辑文字稿")}
          </DialogTitle>
          <DialogDescription>
            {draft.kind === "memory"
              ? t("保存为修订记忆，原文保留在归档中。")
              : t("保存为新的文字版本，旧稿保留。")}
            {t("电脑端也能看到。")}
          </DialogDescription>
        </DialogHeader>
        <label className="sr-only" htmlFor="mobile-edit-title">
          {t("标题")}
        </label>
        <input
          id="mobile-edit-title"
          className="min-h-11 rounded-lg border bg-background px-3"
          value={draft.title}
          maxLength={draft.kind === "memory" ? 120 : 160}
          disabled={saving}
          onChange={event => {
            setDiscarding(false);
            update({ ...draft, title: event.target.value });
          }}
        />
        <label className="sr-only" htmlFor="mobile-edit-content">
          {t("内容")}
        </label>
        <textarea
          ref={bodyRef}
          id="mobile-edit-content"
          className="min-h-0 flex-1 resize-none rounded-lg border bg-background p-3 font-serif text-base leading-8"
          value={draft.content}
          maxLength={draft.kind === "memory" ? 12000 : 20000}
          disabled={saving}
          onChange={event => {
            setDiscarding(false);
            update({ ...draft, content: event.target.value });
          }}
        />
        {editor.storageError && (
          <p role="alert" className="text-sm text-destructive">
            {t("本机无法保留草稿，请先复制内容再离开。")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {discarding && (
          <p className="text-sm text-muted-foreground">
            {t("还有未保存修改，再点一次将放弃。")}
          </p>
        )}
        <div className="flex shrink-0 justify-between gap-3">
          <Button variant="ghost" disabled={saving} onClick={close}>
            {discarding ? t("确认放弃") : t("取消")}
          </Button>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              const start = bodyRef.current?.selectionStart ?? 0;
              const end = bodyRef.current?.selectionEnd ?? 0;
              openMobileCompanion({
                storyId,
                id: `${draft.kind}:${draft.id}`,
                kind: draft.kind,
                origin: "note",
                title: draft.title,
                content: draft.content,
                ...(draft.kind === "text"
                  ? {
                      text: {
                        content: {
                          title: draft.title,
                          body: draft.content,
                          tags: draft.tags,
                        },
                        parentId: draft.id,
                        cursor: start,
                        ...(end > start ? { selection: { start, end } } : {}),
                      },
                    }
                  : {}),
              });
            }}
          >
            {t("小忆")}
          </Button>
          <Button
            disabled={
              saving || !dirty || !draft.title.trim() || !draft.content.trim()
            }
            onClick={() => void save()}
          >
            {saving ? t("正在保存…") : t("保存修改")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
