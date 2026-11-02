/** Only local workspace/share destinations survive a single URL decode. */
export function allowedLoginReturnPath(
  candidate: string | null | undefined
): "/wechat-import" | "/m" | `/m?captureShare=${string}` | `/m?captureId=${string}` | "/chapter/claim" | `/s/${string}` | `/p/${string}` | null {
  if (candidate === "/wechat-import") return candidate;
  if (candidate === "/m") return candidate;
  if (candidate && /^\/m\?capture(?:Share|Id)=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate))
    return candidate as `/m?captureShare=${string}` | `/m?captureId=${string}`;
  if (candidate === "/chapter/claim") return candidate;
  if (
    candidate?.length === 39 &&
    /^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      candidate
    )
  )
    return candidate as `/p/${string}`;
  return candidate?.length === 46 && /^\/s\/[A-Za-z0-9_-]{43}$/.test(candidate)
    ? (candidate as `/s/${string}`)
    : null;
}
