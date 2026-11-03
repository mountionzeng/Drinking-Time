/** Shared rules for following a background image task from the browser. */
export const IMAGE_TASK_POLL_MS = 6_000;
export const COVER_POLL_MS = 8_000;
export const IMAGE_TASK_POLL_LIMIT_MS = 10 * 60_000;

/** A proxy timeout (504) or an HTML error page in place of JSON. The request may still be running. */
export function isGatewayTimeoutError(message: string) {
  return /Unexpected token '?<|<!DOCTYPE|<html|\b504\b|Gateway Time-?out|Bad Gateway|\b502\b|is not valid JSON/i.test(message);
}
export const GATEWAY_TIMEOUT_MESSAGE = "生成请求已发出，但网关等待超时。任务可能仍在后台生成，正在自动查询结果，请勿重复提交。";

/** Poll while the task is still running, for at most `limitMs` after polling began. */
export function shouldKeepPolling(status: string | undefined, startedAt: number | null, now = Date.now(), limitMs = IMAGE_TASK_POLL_LIMIT_MS) {
  if (status !== "accepted" && status !== "preparing") return false;
  return startedAt === null || now - startedAt < limitMs;
}
