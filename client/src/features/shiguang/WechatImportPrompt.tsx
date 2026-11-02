import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  hasPendingWechatStories,
  wechatPromptStorageKey,
} from "./wechatImportOffer";

export function WechatImportPromptContent({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  const _ui = useDesktopUiText();
  return (
    <>
      <DialogTitle>{_ui("要把小程序里的故事带过来吗？")}</DialogTitle>
      <DialogDescription className="leading-7">
        {_ui("这个微信账号在拾光家忆里有故事。你可以挑选要迁移的故事，在网页继续写；小程序原稿会保留。")}</DialogDescription>
      <p className="text-xs leading-6 text-muted-foreground">
        {_ui("也可以稍后从“我的 → 微信故事”进入。")}</p>
      <DialogFooter>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 rounded-md border px-4 text-sm hover:bg-muted"
        >
          {_ui("暂不迁移")}</button>
        <a
          href="/wechat-import"
          onClick={onDismiss}
          className="flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm text-primary-foreground"
        >
          {_ui("选择要迁移的故事")}</a>
      </DialogFooter>
    </>
  );
}

function AccountWechatImportPrompt({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const key = wechatPromptStorageKey(userId);
  useEffect(() => {
    let active = true;
    try {
      if (window.sessionStorage.getItem(key) === "dismissed") return;
    } catch {
      /* Optional UX preference. */
    }
    void hasPendingWechatStories(
      cursor => utils.wechatBookImport.list.fetch({ cursor }),
      () => active
    )
      .then(found => {
        if (active) setOpen(found);
      })
      .catch(() => {
        /* Unavailable import must never block a successful login or imply an empty account. */
      });
    return () => {
      active = false;
    };
  }, [key, utils]);
  function dismiss() {
    setOpen(false);
    try {
      window.sessionStorage.setItem(key, "dismissed");
    } catch {
      /* The current view still closes. */
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!value) dismiss();
      }}
    >
      <DialogContent>
        <WechatImportPromptContent onDismiss={dismiss} />
      </DialogContent>
    </Dialog>
  );
}

export default function WechatImportPrompt() {
  const { user } = useAuth();
  // Keying by owner also invalidates any late catalog result after account switching.
  return user?.loginMethod === "wechat" ? (
    <AccountWechatImportPrompt key={user.id} userId={user.id} />
  ) : null;
}
