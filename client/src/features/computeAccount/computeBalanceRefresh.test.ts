import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { refreshComputeAfterMutation } from "./computeBalanceRefresh";

it("refetches active balances after settlement and invalidates cached statements", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = [["computeAccount", "balance"], {type: "query"}];
  const statementKey = [["computeAccount", "statement"], {type: "query"}];
  const reader = vi.fn(async () => ({availableMinor: 5_000_000}));
  client.setQueryData(queryKey, {availableMinor: 10_000_000});
  client.setQueryData(statementKey, []);
  const observer = new QueryObserver(client, {queryKey, queryFn: reader, staleTime: Infinity});
  const unsubscribe = observer.subscribe(() => {});
  try {
    refreshComputeAfterMutation(client);
    await vi.waitFor(() => expect(client.getQueryData(queryKey)).toEqual({availableMinor: 5_000_000}));
    expect(client.getQueryState(statementKey)?.isInvalidated).toBe(true);
  } finally { unsubscribe(); client.clear(); }
});
