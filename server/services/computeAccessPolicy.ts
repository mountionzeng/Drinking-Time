/** Local-only, server-only compute policy. */
export function isLocalUnlimitedCompute(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.NODE_ENV === "development" &&
    env.LOCAL_COMPUTE_UNLIMITED === "true"
  );
}
