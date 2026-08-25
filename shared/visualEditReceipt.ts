export type VisualEditOperationRef = Readonly<{
  editorSessionEpoch: string;
  operationId: string;
}>;
export type VisualEditReceipt = VisualEditOperationRef &
  Readonly<{
    storyId: number;
    beforeTimelineVersion: number;
    afterTimelineVersion: number;
    status: "available" | "consumed";
    order: number;
  }>;
