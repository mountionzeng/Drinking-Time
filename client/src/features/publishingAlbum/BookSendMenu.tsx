import { useState } from "react";
import { Inbox, Link, Send, Undo2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

/** Opens the existing sharing flows; opening this menu never publishes anything. */
export function BookSendMenu({ disabled, onShare, delivery }: {
  disabled: boolean;
  onShare(): void;
  delivery?: { onCreateLink(): void; onInbox(): void; onReturn?: () => void };
}) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  const item = "flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  function choose(action: () => void) { if (!disabled) { setOpen(false); action(); } }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--nayin-accent)] px-5 py-2 text-sm font-semibold text-[var(--nayin-accent)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] focus-visible:ring-offset-2 disabled:opacity-40">
        <Send className="h-4 w-4" aria-hidden="true" />{t(disabled ? "正在准备…" : "发送")}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" side="top" className="w-56 p-1" aria-label={t("发送")}>
      <button type="button" disabled={disabled} className={item} onClick={() => choose(onShare)}><Link className="h-4 w-4" aria-hidden="true" />{t("分享文章")}</button>
      {delivery && <>
        <button type="button" disabled={disabled} className={item} onClick={() => choose(delivery.onCreateLink)}><Send className="h-4 w-4" aria-hidden="true" />{t("生成故事链接")}</button>
        {delivery.onReturn && <button type="button" disabled={disabled} className={item} onClick={() => choose(delivery.onReturn!)}><Undo2 className="h-4 w-4" aria-hidden="true" />{t("发回修改稿")}</button>}
        <button type="button" disabled={disabled} className={item} onClick={() => choose(delivery.onInbox)}><Inbox className="h-4 w-4" aria-hidden="true" />{t("收件箱")}</button>
      </>}
    </PopoverContent>
  </Popover>;
}
