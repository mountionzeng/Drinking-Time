/**
 * The local developer server may exercise paid workflows without a prepaid
 * balance.  This is deliberately a server-only policy: a browser, a user id,
 * or an account role can never request it.
 *
 * It is an explicit opt-in and only the local, loopback-bound development
 * server may honor it. Staging, tests, previews and production-like runners
 * must continue to prove the normal balance gate.
 */
export function isLocalUnlimitedCompute(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.NODE_ENV === "development" &&
    env.LOCAL_COMPUTE_UNLIMITED === "true"
  );
}
