import {
  WechatMailboxReceipt,
  type WechatMailboxReceiptValue,
} from "./WechatMailboxReceipt";
import { MailboxPartPicker } from "./MailboxPartPicker";
import { STUDIO_ASSISTANT_CHANGED } from "@shared/studioAssistant";
import { useEffect, useRef, useState } from "react";
import { Mail, RefreshCw, Send, UserMinus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useUiLanguage, useUiText } from "@/features/uiLanguage/UiLanguage";
import type { ShareBackNotice } from "@shared/shareBackInbox";
import { inventoryText, changeText } from "./mailboxPresentation";
import { LegacyMailbox } from "./LegacyMailbox";
const button =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[var(--panel-border)] px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export function StoryMailbox({
  open,
  initialSection,
  onOpenChange,
  userId,
  currentStoryId,
  onOpenStory,
  shareBacks,
  onContactChange,
  nativeReceipt,
  onDraftChange,
}: {
  onDraftChange?: (
    draft: import("@shared/studioAssistant").StudioUiContext["mailboxDraft"]
  ) => void;
  nativeReceipt?: WechatMailboxReceiptValue | null;
  onContactChange?: (id: string | null) => void;
  open: boolean;
  initialSection: string | null;
  onOpenChange: (open: boolean) => void;
  userId: number | undefined;
  currentStoryId: number | null;
  onOpenStory: (id: number, versionId?: string) => void;
  shareBacks: ShareBackNotice[];
}) {
  const t = useUiText();
  return (
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        id="story-mailbox"
        className="flex h-[min(820px,85dvh)] w-[94vw] flex-col overflow-hidden p-0 sm:max-w-5xl lg:left-auto lg:right-4 lg:top-16 lg:w-[min(900px,calc(100vw_-_400px))] lg:translate-x-0 lg:translate-y-0"
        onInteractOutside={event => event.preventDefault()}
      >
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t("邮箱")}
          </DialogTitle>
          <DialogDescription>
            {t("把故事寄给朋友，一起看见它的变化。")}
          </DialogDescription>
        </DialogHeader>
        {open && userId ? (
          <MailboxContents
            key={`${userId}:${initialSection}:${nativeReceipt?.id ?? ""}`}
            nativeReceipt={nativeReceipt}
            onDraftChange={onDraftChange}
            initialSection={initialSection}
            onContactChange={onContactChange}
            currentStoryId={currentStoryId}
            shareBacks={shareBacks}
            onOpenStory={(id, versionId) => {
              onOpenChange(false);
              onOpenStory(id, versionId);
            }}
          />
        ) : (
          <p className="p-6">{t("请先登录")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function MailboxContents({
  initialSection,
  currentStoryId,
  onOpenStory,
  shareBacks,
  onContactChange,
  nativeReceipt,
  onDraftChange,
}: {
  onDraftChange?: (
    draft: import("@shared/studioAssistant").StudioUiContext["mailboxDraft"]
  ) => void;
  nativeReceipt?: WechatMailboxReceiptValue | null;
  onContactChange?: (id: string | null) => void;
  currentStoryId: number | null;
  initialSection?: string | null;
  onOpenStory: (id: number, versionId?: string) => void;
  shareBacks: ShareBackNotice[];
}) {
  const t = useUiText(),
    { language } = useUiLanguage(),
    utils = trpc.useUtils();
  const contacts = trpc.storyMailbox.contacts.useQuery(undefined, {
    retry: false,
    refetchInterval: 15000,
  });
  const [selection, setSelection] = useState<string | null>(
      initialSection ?? null
    ),
    [compose, setCompose] = useState(false),
    [remove, setRemove] = useState(false);
  const [destination, setDestination] = useState<"web" | "wechat">("web"),
    [receipt, setReceipt] = useState(nativeReceipt ?? null);
  const nativeStatus = trpc.storyMailbox.nativeStatus.useQuery(undefined, {
    enabled: compose,
    retry: false,
  });
  const nativeCreate = trpc.storyMailbox.nativeCreate.useMutation({
    retry: false,
  });
  const [partial, setPartial] = useState(false),
    [partKeys, setPartKeys] = useState<string[]>([]);
  const contentSelection =
    partial && partKeys.length
      ? { version: 1 as const, keys: partKeys }
      : undefined;
  const [storyId, setStoryId] = useState(currentStoryId ?? 0),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    onDraftChange?.(
      compose && storyId > 0
        ? { storyId, destination, partial, selection: contentSelection }
        : null
    );
  }, [compose, storyId, destination, partial, partKeys, onDraftChange]);
  useEffect(() => () => onDraftChange?.(null), [onDraftChange]);
  const [cursor, setCursor] = useState<
      { at: string; id: string } | undefined
    >(),
    [refreshing, setRefreshing] = useState(false);
  const selected = contacts.data?.find(c => c.id === selection),
    contactId = selected?.id ?? "";
  useEffect(() => {
    onContactChange?.(contactId || null);
    return () => onContactChange?.(null);
  }, [contactId, onContactChange]);
  useEffect(() => {
    const changed = () => {
      void utils.storyMailbox.contacts.refetch();
      if (contactId) {
        void utils.storyMailbox.history.invalidate({ contactId });
        void utils.storyMailbox.threads.invalidate({ contactId });
      }
    };
    window.addEventListener(STUDIO_ASSISTANT_CHANGED, changed);
    return () => window.removeEventListener(STUDIO_ASSISTANT_CHANGED, changed);
  }, [contactId, utils]);

  const history = trpc.storyMailbox.history.useQuery(
    { contactId, cursor },
    { enabled: Boolean(selected), retry: false, refetchInterval: 15000 }
  );
  const threads = trpc.storyMailbox.threads.useQuery(
    { contactId },
    { enabled: Boolean(selected) && !selected?.removed, retry: false }
  );
  const stories = trpc.storyMailbox.stories.useQuery(undefined, {
    enabled: compose,
    retry: false,
  });
  const parts = trpc.storyMailbox.parts.useQuery(
    { storyId },
    { enabled: compose && partial && storyId > 0, retry: false }
  );
  const preview = trpc.storyMailbox.preview.useQuery(
    { storyId, selection: contentSelection },
    {
      enabled: compose && storyId > 0 && (!partial || partKeys.length > 0),
      retry: false,
      staleTime: 0,
    }
  );
  const send = trpc.storyMailbox.send.useMutation({ retry: false }),
    receive = trpc.storyMailbox.receive.useMutation({ retry: false }),
    removeContact = trpc.storyMailbox.removeContact.useMutation({
      retry: false,
    });
  const sendAttempt = useRef<{ key: string; id: string } | null>(null),
    inFlight = useRef(false);
  const busy =
    nativeCreate.isPending ||
    send.isPending ||
    receive.isPending ||
    removeContact.isPending;
  const unreadIds = (history.data?.entries ?? [])
    .filter(e => e.unread)
    .map(e => e.id)
    .join(",");
  useEffect(() => {
    if (!contactId || !unreadIds) return;
    void utils.client.storyMailbox.markRead
      .mutate({ contactId, entryIds: unreadIds.split(",") })
      .then(() => utils.storyMailbox.contacts.refetch())
      .catch(() => {});
  }, [contactId, unreadIds, utils]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const threadIds = (threads.data ?? []).map(t => t.id).join(",");
  async function invalidate() {
    await Promise.all([
      utils.storyMailbox.history.invalidate({ contactId }),
      utils.storyMailbox.contacts.refetch(),
      utils.storyMailbox.threads.invalidate({ contactId }),
    ]);
  }
  // Poll only explicitly shared threads. Cancellation prevents a closed/contact-switched
  // panel from rendering stale results; the server serializes refresh with removal.
  useEffect(() => {
    if (!selected || selected.removed || !threadIds) return;
    let stopped = false,
      running = false;
    async function tick() {
      if (stopped || running || document.hidden) return;
      running = true;
      setRefreshing(true);
      try {
        for (const id of threadIds.split(",")) {
          if (stopped) return;
          await utils.client.storyMailbox.refresh.mutate({ threadId: id });
        }
        if (!stopped)
          await utils.storyMailbox.history.invalidate({ contactId });
      } catch {
        if (!stopped)
          setError(t("部分更新暂时无法读取，旧来稿仍保留。请稍后刷新。"));
      } finally {
        running = false;
        if (!stopped) setRefreshing(false);
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 15000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [contactId, selected?.removed, threadIds, utils, t]);
  function choose(id: string) {
    if (inFlight.current || busy) return;
    setRefreshing(false);
    setSelection(id);
    setCursor(undefined);
    setCompose(false);
    setRemove(false);
    setError("");
  }
  async function submit() {
    if (
      (destination === "web" && (!selected || selected.removed)) ||
      !preview.data ||
      (partial && !partKeys.length) ||
      preview.isFetching ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setError("");
    const key = JSON.stringify([
      contactId,
      storyId,
      note,
      preview.data.fingerprint,
      contentSelection,
      destination,
    ]);
    if (sendAttempt.current?.key !== key)
      sendAttempt.current = { key, id: crypto.randomUUID() };
    try {
      if (destination === "wechat") {
        const result = await nativeCreate.mutateAsync({
          storyId,
          selection: contentSelection,
          fingerprint: preview.data.fingerprint,
          requestId: sendAttempt.current.id,
        });
        if (alive.current) {
          setReceipt(result);
          setCompose(false);
        }
        sendAttempt.current = null;
        return;
      }
      await send.mutateAsync({
        contactId,
        storyId,
        note,
        fingerprint: preview.data.fingerprint,
        selection: contentSelection,
        requestId: sendAttempt.current.id,
      });
      setCompose(false);
      setNote("");
      setCursor(undefined);
      sendAttempt.current = null;
      await invalidate();
    } catch (e) {
      setError(t("发送未完成，请重试。故事已变化时，请先重新预览。"));
      if ((e as { data?: { code?: string } }).data?.code === "CONFLICT") {
        if (destination === "wechat") sendAttempt.current = null;
        void preview.refetch();
      }
    } finally {
      inFlight.current = false;
    }
  }
  async function accept(id: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError("");
    try {
      const result = await receive.mutateAsync({ entryId: id });
      await invalidate();
      if (alive.current) onOpenStory(result.storyId);
    } catch {
      setError(t("接收未完成，原有作品保留，请重试。"));
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[220px_minmax(0,1fr)]">
      <nav
        aria-label={t("故事联系人")}
        className="max-h-44 overflow-y-auto border-b bg-muted/20 p-3 sm:max-h-none sm:border-b-0 sm:border-r"
      >
        <button
          type="button"
          className={`${button} mb-3 w-full justify-start`}
          disabled={busy}
          onClick={() => {
            setCompose(true);
            setError("");
            setReceipt(null);
          }}
        >
          <Send className="h-4 w-4" />
          {t("发送故事")}
        </button>
        <button
          type="button"
          disabled={busy}
          className={`${button} mb-4 w-full justify-start ${selection === "legacy" ? "bg-muted" : ""}`}
          onClick={() => choose("legacy")}
        >
          {t("已有来稿")}
          {shareBacks.length ? ` (${shareBacks.length})` : ""}
        </button>
        <p className="mb-2 px-2 text-xs text-muted-foreground">
          {t("故事联系人")}
        </p>
        {contacts.isPending ? (
          <p role="status" className="p-2 text-sm">
            {t("正在读取…")}
          </p>
        ) : null}
        {contacts.isError ? (
          <button className={button} onClick={() => void contacts.refetch()}>
            {t("重新读取联系人")}
          </button>
        ) : null}
        {contacts.data?.map(person => (
          <button
            type="button"
            disabled={busy}
            key={person.id}
            aria-current={selection === person.id ? "page" : undefined}
            className={`mb-1 flex min-h-12 w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${selection === person.id ? "bg-muted font-medium" : ""}`}
            onClick={() => choose(person.id)}
          >
            <span className="min-w-0 break-words">
              {person.name}
              {person.removed ? (
                <span className="block text-xs font-normal text-muted-foreground">
                  {t("已停止联系")}
                </span>
              ) : null}
            </span>
            {person.unread ? (
              <span
                className="ml-2 text-xs"
                aria-label={t("{0} 条未读", [person.unread])}
              >
                {person.unread}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <section className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7">
        {compose ? (
          <form
            className="mb-6 space-y-4 rounded-md border p-4"
            onSubmit={e => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="block text-sm">
              {t("选择故事")}
              <select
                className="mt-2 w-full rounded-md border bg-background p-2"
                value={storyId}
                onChange={e => {
                  setStoryId(Number(e.target.value));
                  setPartKeys([]);
                }}
                disabled={busy}
              >
                <option value={0}>{t("请选择故事")}</option>
                {stories.data?.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("发送内容")}
              <select
                className="mt-2 w-full rounded-md border bg-background p-2"
                disabled={busy}
                value={partial ? "selected" : "all"}
                onChange={e => {
                  setPartial(e.target.value === "selected");
                  setPartKeys([]);
                }}
              >
                <option value="all">{t("完整故事")}</option>
                <option value="selected">{t("选择部分内容")}</option>
              </select>
            </label>
            {partial && storyId > 0 ? (
              <>
                {parts.isError ? (
                  <button
                    type="button"
                    className={button}
                    onClick={() => void parts.refetch()}
                  >
                    {t("重新读取内容")}
                  </button>
                ) : (
                  <MailboxPartPicker
                    parts={parts.data ?? []}
                    value={partKeys}
                    onChange={setPartKeys}
                    disabled={busy || parts.isFetching}
                    continuous={destination === "web"}
                  />
                )}
              </>
            ) : null}
            {stories.isError ? (
              <p role="alert" className="text-sm">
                {t("故事列表暂时无法读取，请重试。")}
              </p>
            ) : null}
            {storyId > 0 && preview.isFetching ? (
              <p role="status" className="text-sm">
                {t("正在核对故事内容…")}
              </p>
            ) : null}
            {preview.error ? (
              <p role="alert" className="text-sm">
                {t("无法完整发送这篇故事，请检查素材是否就绪后重试。")}
              </p>
            ) : null}
            {preview.data && (!partial || partKeys.length > 0) ? (
              <div className="text-sm">
                <p className="font-medium">{t("本次包含")}</p>
                <p className="mt-1 leading-6">
                  {inventoryText(preview.data.inventory, t)}
                </p>
              </div>
            ) : null}
            <label className="block text-sm">
              {t("发送到")}
              <select
                className="mt-2 w-full rounded-md border bg-background p-2"
                value={destination}
                disabled={busy}
                onChange={e => {
                  setDestination(e.target.value as "web" | "wechat");
                  setReceipt(null);
                }}
              >
                <option value="web">{t("网页联系人")}</option>
                <option value="wechat">{t("我的微信小程序")}</option>
              </select>
            </label>
            {destination === "web" ? (
              <label className="block text-sm">
                {t("收件人")}
                <select
                  className="mt-2 w-full rounded-md border bg-background p-2"
                  value={contactId}
                  disabled={busy}
                  onChange={e => setSelection(e.target.value)}
                >
                  <option value="">{t("选择一位朋友")}</option>
                  {contacts.data
                    ?.filter(c => !c.removed)
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <p className="text-sm leading-6">
                {t(
                  nativeStatus.data?.enabled
                    ? nativeStatus.data.bound
                      ? "已关联小程序接收身份。扫码确认后保存到自己的账号，再由你选择微信好友。"
                      : "先用本人的微信扫码关联接收身份；原有账号、故事和余额不变。"
                    : "小程序接收尚未启用，原有网页发送仍可使用。"
                )}
              </p>
            )}
            {destination === "web" && (
              <label className="block text-sm">
                {t("附言")}
                <textarea
                  className="mt-2 min-h-20 w-full rounded-md border bg-background p-2"
                  maxLength={2000}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              {t(
                destination === "wechat"
                  ? "小程序接收的是本次所选内容的独立副本。其他内容保持私密；后续修改需要再次发送。"
                  : partial
                    ? "只共享勾选部分及其后续修改。其他段落、新增内容、旧版本和剪辑线保持私密。"
                    : "发送已保存的内容及现有版本。对方接收后可独立编辑，双方继续共享保存后的变化，直到移除联系。"
              )}
            </p>
            <button
              type="submit"
              className={button}
              disabled={
                busy ||
                (destination === "web"
                  ? !selected || selected.removed
                  : !nativeStatus.data?.enabled) ||
                (partial && !partKeys.length) ||
                !preview.data ||
                preview.isFetching ||
                preview.isError ||
                storyId <= 0
              }
            >
              {t(
                busy
                  ? "正在发送…"
                  : destination === "wechat"
                    ? "准备小程序接收二维码"
                    : "确认发送"
              )}
            </button>
          </form>
        ) : null}
        {receipt ? <WechatMailboxReceipt value={receipt} /> : null}
        {!selected && error ? (
          <p role="alert" className="my-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {selection === "legacy" ? (
          <LegacyMailbox shareBacks={shareBacks} onOpenStory={onOpenStory} />
        ) : !selected ? (
          <div className="flex min-h-64 flex-col justify-center space-y-3">
            <h3 className="text-xl">{t("让故事有来有往")}</h3>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              {t(
                contacts.data?.length
                  ? "选择一位朋友，查看来往或发送故事。"
                  : "还没有已连接的朋友。先把故事分享链接发给对方，对方接收后会出现在这里。"
              )}
            </p>
          </div>
        ) : (
          <>
            <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-medium">{selected.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    selected.removed
                      ? "后续修改不再共享，之前的来稿与作品保留。"
                      : "已共享故事保存后的变化会显示在这里。"
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy || selected.removed}
                  onClick={() => {
                    setCompose(!compose);
                    setError("");
                  }}
                >
                  <Send className="h-4 w-4" />
                  {t("发送故事")}
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy || selected.removed}
                  aria-label={t("移除联系人")}
                  onClick={() => setRemove(true)}
                >
                  <UserMinus className="h-4 w-4" />
                </button>
              </div>
            </header>
            {remove ? (
              <div
                className="mb-5 space-y-3 rounded-md border p-4"
                role="alert"
              >
                <p className="text-sm">
                  {t(
                    "移除后，双方停止共享后续修改；已经收到的故事和来往记录保留。"
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className={button}
                    onClick={() =>
                      void removeContact
                        .mutateAsync({ contactId })
                        .then(async () => {
                          setRemove(false);
                          setCompose(false);
                          await invalidate();
                        })
                        .catch(() => setError(t("移除未完成，请重试。")))
                    }
                  >
                    {t("停止联系")}
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => setRemove(false)}
                  >
                    {t("取消")}
                  </button>
                </div>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="mb-4 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-medium">{t("来往记录")}</h4>
              <button
                type="button"
                className={button}
                disabled={refreshing || selected.removed}
                onClick={() => {
                  setError("");
                  void Promise.all(
                    (threads.data ?? []).map(th =>
                      utils.client.storyMailbox.refresh.mutate({
                        threadId: th.id,
                      })
                    )
                  )
                    .then(() => invalidate())
                    .catch(() =>
                      setError(
                        t("部分更新暂时无法读取，旧来稿仍保留。请稍后刷新。")
                      )
                    );
                }}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                />
                {t("刷新")}
              </button>
            </div>
            {history.isPending ? <p role="status">{t("正在读取…")}</p> : null}
            {history.isError ? (
              <p role="alert">{t("来往记录暂时无法读取，请重试。")}</p>
            ) : null}
            {history.data && !history.data.entries.length ? (
              <p className="py-8 text-sm text-muted-foreground">
                {t("还没有来往，发送一篇故事开始。")}
              </p>
            ) : null}
            <ol className="divide-y">
              {history.data?.entries.map(entry => (
                <li key={entry.id} className="space-y-2 py-5">
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {entry.authorName} ·{" "}
                      {t(
                        entry.kind === "received"
                          ? "接收了故事"
                          : entry.kind === "updated"
                            ? "更新了故事"
                            : "发送了故事"
                      )}
                    </span>
                    <time dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleString(
                        language === "zh" ? "zh-CN" : language
                      )}
                    </time>
                  </div>
                  <h5 className="break-words font-medium">{entry.title}</h5>
                  {entry.note ? (
                    <p className="whitespace-pre-wrap text-sm">{entry.note}</p>
                  ) : null}
                  {entry.changes.length ? (
                    <ul className="space-y-1 text-sm">
                      {entry.changes.map((change, i) => (
                        <li key={i}>{changeText(change, t)}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="text-xs leading-5 text-muted-foreground">
                    {inventoryText(entry.inventory, t)}
                  </p>
                  {entry.mine && entry.ownStoryId ? (
                    <button
                      type="button"
                      className={button}
                      onClick={() => onOpenStory(entry.ownStoryId!)}
                    >
                      {t("打开我的故事")}
                    </button>
                  ) : entry.receivedStoryId ? (
                    <button
                      type="button"
                      className={button}
                      onClick={() => onOpenStory(entry.receivedStoryId!)}
                    >
                      {t("打开已接收版本")}
                    </button>
                  ) : entry.kind !== "received" ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "接收为独立故事，保留自己的原稿；接收后的修改会共享给这位朋友。"
                        )}
                      </p>
                      <button
                        type="button"
                        className={button}
                        disabled={busy || selected.removed}
                        onClick={() => void accept(entry.id)}
                      >
                        {t(receive.isPending ? "正在接收…" : "接收这个版本")}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            <div className="mt-4 flex gap-2">
              {cursor ? (
                <button className={button} onClick={() => setCursor(undefined)}>
                  {t("最新记录")}
                </button>
              ) : null}
              {history.data?.nextCursor ? (
                <button
                  className={button}
                  onClick={() => setCursor(history.data!.nextCursor!)}
                >
                  {t("更早记录")}
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
