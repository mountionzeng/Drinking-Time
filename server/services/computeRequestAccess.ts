import { AsyncLocalStorage } from "node:async_hooks";
import { TRPCError } from "@trpc/server";
import { canFundComputeRequest } from "./computeLedger";

export class ComputeAccessError extends TRPCError {}

type ComputePrincipal = {
  userId: number | null;
  reservedOperations: Set<string>;
};
const principal = new AsyncLocalStorage<ComputePrincipal>();

/** Identity comes from authenticated server context, never request parameters. */
export function withComputeUser<T>(userId: number | null, run: () => T): T {
  return principal.run({ userId, reservedOperations: new Set() }, run);
}

/** Called only after the ledger has atomically reserved this user's money. */
export function noteComputeReservation(
  userId: number,
  operationId: string
): void {
  const current = principal.getStore();
  if (current?.userId === userId) current.reservedOperations.add(operationId);
}

/**
 * Last check before provider submission, including fallbacks and retries.
 * This admission check does not replace per-operation reservation/settlement.
 * Reading existing assets and polling an already submitted task remain free.
 */
export async function assertComputeRequestAccess(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const current = principal.getStore();
  if (!current?.userId || !Number.isSafeInteger(current.userId)) {
    throw new ComputeAccessError({
      code: "UNAUTHORIZED",
      message: "请先登录再使用 AI 功能。",
    });
  }
  let allowed = false;
  try {
    allowed = await canFundComputeRequest(
      current.userId,
      current.reservedOperations
    );
  } catch {
    throw new ComputeAccessError({
      code: "SERVICE_UNAVAILABLE",
      message: "暂时无法核对算力余额，请稍后再试。",
    });
  }
  if (!allowed) {
    throw new ComputeAccessError({
      code: "FORBIDDEN",
      message: "算力余额不足，无法调用 AI。你仍可查看和手工编辑已有内容。",
    });
  }
}

type FetchInput = string | URL | Request;
export function guardComputeFetch<I extends FetchInput, R>(
  fetcher: (input: I, init?: RequestInit) => Promise<R>
): (input: I, init?: RequestInit) => Promise<R> {
  return async (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (method !== "GET" && method !== "HEAD")
      await assertComputeRequestAccess();
    return fetcher(input, init);
  };
}
