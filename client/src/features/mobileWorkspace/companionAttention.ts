export type CompanionAttention = "idle" | "listening" | "thinking";

/** Pending recovery/failure locks are not a live model request. */
export function companionAttention(
  open: boolean,
  pending: boolean
): CompanionAttention {
  return open ? (pending ? "thinking" : "listening") : "idle";
}
