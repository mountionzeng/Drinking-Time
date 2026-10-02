/** Only local workspace/share destinations survive a single URL decode. */
export function allowedLoginReturnPath(
  candidate: string | null | undefined
): "/m" | `/s/${string}` | null {
  if (candidate === "/m") return candidate;
  return candidate?.length === 46 && /^\/s\/[A-Za-z0-9_-]{43}$/.test(candidate)
    ? (candidate as `/s/${string}`)
    : null;
}
