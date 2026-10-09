import type { QueryClient } from "@tanstack/react-query";

/** Both failed and successful paid operations can change holds or settle costs. */
export function refreshComputeAfterMutation(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: [["computeAccount", "balance"]],
  });
  void queryClient.invalidateQueries({
    queryKey: [["computeAccount", "statement"]],
  });
}
