import { allowedLoginReturnPath } from "@shared/loginReturnPath";
export type MobileReturnPath = "/m" | `/s/${string}`;

const RETURN_PARAMETER = "returnTo";

export function readMobileReturnPath(search: string): MobileReturnPath | null {
  const values = new URLSearchParams(search).getAll(RETURN_PARAMETER);
  return values.length === 1 ? allowedLoginReturnPath(values[0]) : null;
}

export function mobileLoginHref(candidate: string): string {
  const returnPath = allowedLoginReturnPath(candidate);
  if (!returnPath) return "/login";
  return `/login?${RETURN_PARAMETER}=${encodeURIComponent(returnPath)}`;
}

/**
 * 登录后去哪。
 *
 * `returnTo` 只认 `/m` 与合法的故事分享路径；没有它时用调用方给的 fallback。
 * fallback 默认 `/editing` 是为了让这个函数保持纯粹、可单测；
 * 真正的调用方传的是 `rootWorkspacePath()`，这样直接打开 /login 的手机
 * 登录完会落到 /m，而不是掉进电脑版工作室。
 */
export function resolvePostLoginDestination(
  candidate: string | null | undefined,
  fallback: MobileReturnPath | "/editing" = "/editing"
): MobileReturnPath | "/editing" {
  return allowedLoginReturnPath(candidate) ?? fallback;
}
