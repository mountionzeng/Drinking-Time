import { useEffect, useRef } from "react";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

export function isWarehouseConnectionError(error: {message?: string} | null | undefined) {
  return /Failed to fetch|Load failed|NetworkError|network.*(?:failed|error)|ECONNREFUSED/i.test(error?.message ?? "");
}

/** Retry reads only while the warehouse is mounted; never resubmit media operations. */
export function WarehouseConnectionStatus({error, retry}: {
  error?: {message?: string} | null;
  retry: () => void;
}) {
  const {language} = useUiLanguage();
  const latestRetry = useRef(retry);
  latestRetry.current = retry;
  const disconnected = isWarehouseConnectionError(error);
  useEffect(() => {
    if (!disconnected) return;
    const timer = window.setInterval(() => latestRetry.current(), 10000);
    return () => window.clearInterval(timer);
  }, [disconnected]);
  if (!error) return null;
  return <p role="status" className="mb-2 text-xs text-destructive">
    {disconnected
      ? language === "en" ? "Connection lost. Reconnecting… Your existing media is kept." : "连接已断开，正在重新连接，现有素材保留。"
      : language === "en" ? "Some media could not be loaded. Reopen the warehouse to retry." : "部分素材暂未读到，请稍后重新打开仓库。"}
  </p>;
}
