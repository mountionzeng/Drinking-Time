export type VisualEditOperationRef = Readonly<{
  editorSessionEpoch: string;
  operationId: string;
}>;
type VisualEditReceiptBase = VisualEditOperationRef &
  Readonly<{
    storyId: number;
    status: "available" | "consumed";
    order: number;
  }>;

export type TimelineVisualEditReceipt = VisualEditReceiptBase &
  Readonly<{
    /** Optional only for compatibility with receipts issued before aggregate edits existed. */
    kind?: "timeline";
    beforeTimelineVersion: number;
    afterTimelineVersion: number;
  }>;

export type AggregateVisualEditReceipt = VisualEditReceiptBase &
  Readonly<{
    kind: "aggregate";
    beforeStoryRevision: number;
    afterStoryRevision: number;
    beforeTimelineVersion: number;
    afterTimelineVersion: number;
  }>;

export type VisualEditReceipt =
  | TimelineVisualEditReceipt
  | AggregateVisualEditReceipt;
