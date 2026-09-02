export type MobileReturnPath = "/m";

const MOBILE_RETURN_PATH: MobileReturnPath = "/m";
const RETURN_PARAMETER = "returnTo";

/**
 * This validator intentionally has a one-item allowlist. Its input must have
 * already gone through the browser's single URLSearchParams decode pass.
 * Percent signs are rejected so a second decode can never change the target.
 */
export function normalizeMobileReturnPath(
  candidate: string | null | undefined
): MobileReturnPath | null {
  if (!candidate || candidate.length > 16) return null;
  if (/[%\\\u0000-\u001f\u007f]/.test(candidate)) return null;
  if (candidate.startsWith("//") || candidate.includes("..")) return null;
  return candidate === MOBILE_RETURN_PATH ? MOBILE_RETURN_PATH : null;
}

export function readMobileReturnPath(search: string): MobileReturnPath | null {
  try {
    const params = new URLSearchParams(search);
    const values = params.getAll(RETURN_PARAMETER);
    if (values.length !== 1) return null;
    return normalizeMobileReturnPath(values[0]);
  } catch {
    return null;
  }
}

export function mobileLoginHref(candidate: string): string {
  const returnPath = normalizeMobileReturnPath(candidate);
  if (!returnPath) return "/login";
  return `/login?${RETURN_PARAMETER}=${encodeURIComponent(returnPath)}`;
}

export function resolvePostLoginDestination(
  candidate: string | null | undefined
): MobileReturnPath | "/editing" {
  return normalizeMobileReturnPath(candidate) ?? "/editing";
}
