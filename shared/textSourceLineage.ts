import { z } from "zod";

export const textSourceSnapshotSchema = z.union([
  z.object({
    textDraftId: z.string().min(1),
    contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({ kind: z.literal("legacy_unknown") }),
]);
export type TextSourceSnapshot = z.infer<typeof textSourceSnapshotSchema>;
export type KnownTextSource = Extract<
  TextSourceSnapshot,
  { textDraftId: string }
>;
export function normalizeTextSource(value: unknown): TextSourceSnapshot {
  if (value == null) return { kind: "legacy_unknown" };
  return textSourceSnapshotSchema.parse(value);
}
export const textSourceStateSchema = z.object({
  current: textSourceSnapshotSchema.nullable(),
  receipts: z.record(
    z.string(),
    z.object({
      requestHash: z.string(),
      revision: z.number(),
      source: textSourceSnapshotSchema,
    })
  ),
});
export function readTextSourceState(value: unknown) {
  return value == null
    ? { current: null, receipts: {} }
    : textSourceStateSchema.parse(value);
}
export type TextSourceTargetKind =
  | "publishing"
  | "finishedProduct"
  | "timeline"
  | "storyboard";
export type TextSourceImpactItem = {
  targetKind: TextSourceTargetKind;
  targetId: string;
  label: string;
  source: TextSourceSnapshot;
  group: "stale" | "current" | "legacy_unknown";
  revision: number;
};
