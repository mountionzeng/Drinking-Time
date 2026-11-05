import { useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Globe,
  Inbox,
  Link,
  MessageCircle,
  Send,
  Smartphone,
  Undo2,
} from "lucide-react";
import {
  PUBLISHING_PLATFORM_IDS,
  PUBLISHING_PLATFORM_REGISTRY,
  type PublishingPlatformId,
} from "@shared/publishingDraft";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

/** Opens the existing sharing flows; opening this menu never publishes anything. */
export function BookSendMenu({
  disabled,
  onShare,
  onPlatform,
  delivery,
}: {
  disabled: boolean;
  onShare(): void;
  onPlatform(platform: PublishingPlatformId): void;
  delivery?: { onCreateLink(): void; onInbox(): void; onReturn?: () => void };
}) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  const [otherPlatforms, setOtherPlatforms] = useState(false);
  const item =
    "flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  function choose(action: () => void) {
    if (!disabled) {
      setOpen(false);
      setOtherPlatforms(false);
      action();
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={value => {
        setOpen(value);
        if (!value) setOtherPlatforms(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--nayin-accent)] px-5 py-2 text-sm font-semibold text-[var(--nayin-accent)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] focus-visible:ring-offset-2 disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {t(disabled ? "正在准备…" : "发送")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-64 p-1"
        aria-label={t("发送")}
      >
        {otherPlatforms ? (
          <>
            <button
              type="button"
              className={item}
              onClick={() => setOtherPlatforms(false)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("返回")}
            </button>
            {PUBLISHING_PLATFORM_IDS.filter(
              platform => platform !== "wechat_moments"
            ).map(platform => (
              <button
                key={platform}
                type="button"
                disabled={disabled}
                className={item}
                onClick={() => choose(() => onPlatform(platform))}
              >
                <span className="flex-1">
                  {t(PUBLISHING_PLATFORM_REGISTRY[platform].label)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {PUBLISHING_PLATFORM_REGISTRY[platform].cover.aspectRatio}
                </span>
              </button>
            ))}
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled || !delivery}
              className={`${item} disabled:cursor-not-allowed disabled:opacity-50`}
              onClick={() => delivery && choose(delivery.onCreateLink)}
            >
              <Smartphone className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1">{t("小程序")}</span>
              {!delivery && <span className="text-xs">{t("暂未启用")}</span>}
            </button>
            <button
              type="button"
              disabled={disabled}
              className={item}
              onClick={() => choose(() => onPlatform("wechat_moments"))}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1">{t("朋友圈")}</span>
              <span className="text-xs text-muted-foreground">1:1</span>
            </button>
            <button
              type="button"
              disabled={disabled}
              className={item}
              onClick={() => setOtherPlatforms(true)}
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1">{t("其他平台")}</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={disabled}
              className={item}
              onClick={() => choose(onShare)}
            >
              <Link className="h-4 w-4" aria-hidden="true" />
              {t("分享文章链接")}
            </button>
            {delivery && (
              <>
                {delivery.onReturn && (
                  <button
                    type="button"
                    disabled={disabled}
                    className={item}
                    onClick={() => choose(delivery.onReturn!)}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden="true" />
                    {t("发回修改稿")}
                  </button>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  className={item}
                  onClick={() => choose(delivery.onInbox)}
                >
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                  {t("收件箱")}
                </button>
              </>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
