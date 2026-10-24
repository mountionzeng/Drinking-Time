/** Only local workspace/share destinations survive a single URL decode. */
export function allowedLoginReturnPath(
  candidate: string | null | undefined
): "/m" | "/chapter/claim" | `/s/${string}` | `/p/${string}` | null {
  if (candidate === "/m") return candidate;
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
