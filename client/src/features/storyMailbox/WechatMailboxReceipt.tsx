import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
export type WechatMailboxReceiptValue = {
  id: string;
  confirmed: boolean;
  expiresAt: string;
  qrDataUrl: string | null;
};
export function WechatMailboxReceipt({
  value,
}: {
  value: WechatMailboxReceiptValue;
}) {
  const t = useUiText();
  const [expired, setExpired] = useState(
    () => Date.parse(value.expiresAt) <= Date.now()
  );
  useEffect(() => {
    setExpired(Date.parse(value.expiresAt) <= Date.now());
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(value.expiresAt) - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [value.expiresAt]);
  const poll = trpc.storyMailbox.nativePoll.useQuery(
    { id: value.id },
    {
      enabled: !value.confirmed && !expired,
      refetchInterval: query =>
        query.state.data?.confirmed || query.state.data?.expired ? false : 1500,
      retry: false,
    }
  );
  if (value.confirmed || poll.data?.confirmed)
    return (
      <p role="status" className="rounded-md border p-4 text-sm">
        {t(
          "已接收到你的小程序账号。可在“我的 → 网页寄来的故事”查看，再选择转给微信朋友。"
        )}
      </p>
    );
  if (expired || poll.data?.expired)
    return (
      <p role="status" className="text-sm">
        {t("接收二维码已过期，请重新准备。")}
      </p>
    );
  return (
    <div className="rounded-md border p-4 text-center">
      <p className="text-sm">
        {t("用本人的微信扫码，关联小程序接收身份并确认接收。")}
      </p>
      {value.qrDataUrl && (
        <img
          src={value.qrDataUrl}
          alt={t("小程序接收二维码")}
          className="mx-auto my-3 h-56 w-56 bg-white p-2"
        />
      )}
      <p className="text-xs text-muted-foreground">
        {t("接收后仅自己可见，不会自动发送给微信好友。")}
      </p>
      {poll.isError ? (
        <button
          type="button"
          className="mt-3 underline"
          onClick={() => void poll.refetch()}
        >
          {t("重新读取")}
        </button>
      ) : null}
    </div>
  );
}
