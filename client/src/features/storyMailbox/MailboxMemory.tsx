import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import type { MailboxEntry } from "@shared/storyMailbox";

type ComposeSource = {
  threadId: string;
  expectedVersion: number;
  markdown: string;
};

export function MailboxMemoryComposer({
  contactId,
  storyId,
  source,
  buttonClass,
  onCancel,
  onPublished,
}: {
  contactId: string;
  storyId: number;
  source?: ComposeSource;
  buttonClass: string;
  onCancel: () => void;
  onPublished: () => Promise<void>;
}) {
  const t = useUiText();
  const [markdown, setMarkdown] = useState(source?.markdown ?? "");
  const [error, setError] = useState("");
  const attempt = useRef<{ markdown: string; id: string } | null>(null);
  const locked = useRef(false);
  const publish = trpc.storyMailbox.publishMemory.useMutation({ retry: false });
  return (
    <form
      className="my-3 grid gap-2 rounded-md border p-3"
      onSubmit={async event => {
        event.preventDefault();
        if (locked.current || !markdown.trim()) return;
        locked.current = true;
        setError("");
        if (!attempt.current || attempt.current.markdown !== markdown)
          attempt.current = { markdown, id: crypto.randomUUID() };
        try {
          await publish.mutateAsync({
            contactId,
            storyId,
            markdown,
            ...(source
              ? {
                  threadId: source.threadId,
                  expectedVersion: source.expectedVersion,
                }
              : { requestId: attempt.current.id }),
          });
          await onPublished();
        } catch {
          setError(t("发布未完成。如果已有新版，请打开最新来信再修改。"));
        } finally {
          locked.current = false;
        }
      }}
    >
      <label className="grid gap-2 text-sm">
        {t("允许好友查看的 Markdown")}
        <textarea
          value={markdown}
          onChange={event => setMarkdown(event.target.value)}
          maxLength={12_000}
          rows={7}
          disabled={publish.isPending}
          className="w-full rounded-md border bg-background p-2 font-mono text-sm"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t("只发送这里的文字。你可以贴上要分享的段落和它的出处。")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className={buttonClass}
          disabled={!markdown.trim() || publish.isPending}
        >
          {t(source ? "发布笔记更新" : "确认分享笔记")}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={publish.isPending}
          onClick={onCancel}
        >
          {t("取消")}
        </button>
      </div>
    </form>
  );
}

export function MailboxMemoryEntry({
  entry,
  contactId,
  removed,
  busy,
  buttonClass,
  currentStoryId,
  onAdopt,
  onOpenStory,
  onPublished,
  onPreview,
}: {
  entry: MailboxEntry;
  contactId: string;
  removed: boolean;
  busy: boolean;
  buttonClass: string;
  currentStoryId: number | null;
  onAdopt: (id: string, storyId?: number) => void;
  onOpenStory: (id: number) => void;
  onPublished: () => Promise<void>;
  onPreview?: (entryId: string, open: boolean) => void;
}) {
  const t = useUiText();
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState(false);
  const version = trpc.storyMailbox.memoryVersion.useQuery(
    { entryId: entry.id },
    { enabled: opened, retry: false }
  );
  return (
    <details
      onToggle={event => {
        setOpened(event.currentTarget.open);
        if (!entry.mine) onPreview?.(entry.id, event.currentTarget.open);
      }}
      className="space-y-2"
    >
      <summary className="cursor-pointer text-sm text-foreground">
        {t(entry.kind === "sent" ? "查看共享笔记" : "查看笔记更新")}
        {version.data ? ` · V${version.data.version}` : ""}
      </summary>
      {version.isError && (
        <p role="alert">{t("笔记暂时无法读取，请稍后重试。")}</p>
      )}
      {opened && version.isPending && <p role="status">{t("正在读取…")}</p>}
      {version.data && (
        <>
          {version.data.version > 1 && (
            <div className="grid gap-1 text-sm">
              {version.data.removed.map(text => (
                <del key={text} className="break-words text-muted-foreground">
                  − {text}
                </del>
              ))}
              {version.data.added.map(text => (
                <p key={text} className="break-words">
                  + {text}
                </p>
              ))}
              {!version.data.removed.length && !version.data.added.length && (
                <p>{t("调整了行序或空行")}</p>
              )}
            </div>
          )}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm">
            {version.data.markdown}
          </pre>
          {entry.mine ? (
            entry.ownStoryId &&
            version.data.isLatest &&
            !removed &&
            (editing ? (
              <MailboxMemoryComposer
                contactId={contactId}
                storyId={entry.ownStoryId}
                source={{
                  threadId: entry.threadId,
                  expectedVersion: version.data.version,
                  markdown: version.data.markdown,
                }}
                buttonClass={buttonClass}
                onCancel={() => setEditing(false)}
                onPublished={async () => {
                  setEditing(false);
                  await onPublished();
                  void version.refetch();
                }}
              />
            ) : (
              <button
                type="button"
                className={buttonClass}
                onClick={() => setEditing(true)}
              >
                {t("编辑共享笔记")}
              </button>
            ))
          ) : entry.receivedStoryId ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => onOpenStory(entry.receivedStoryId!)}
            >
              {t("打开我的故事")}
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              {version.data.recipientStoryId == null &&
                currentStoryId != null &&
                currentStoryId > 0 && (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy || removed}
                    onClick={() => onAdopt(entry.id, currentStoryId)}
                  >
                    {t("采用到当前故事")}
                  </button>
                )}
              <button
                type="button"
                className={buttonClass}
                disabled={busy || removed}
                onClick={() => onAdopt(entry.id)}
              >
                {t(
                  version.data.recipientStoryId
                    ? "采用到我的故事"
                    : "采用并新建故事"
                )}
              </button>
            </div>
          )}
        </>
      )}
    </details>
  );
}
