import {
  selectionEditKind,
  selectionReadiness,
  type SelectionContext,
} from "@shared/selectionContext";

export type SelectionSubmissionRoute =
  | { kind: "ordinary-chat" }
  | { kind: "attachments" }
  | { kind: "text-edit"; selection: SelectionContext }
  | { kind: "image-edit"; selection: SelectionContext }
  | { kind: "image-region-edit"; selection: SelectionContext }
  | { kind: "editing-command"; selection: SelectionContext }
  | { kind: "blocked"; reason: string; clearSelection: boolean };

export function routeSelectionSubmission(input: {
  selection: SelectionContext | null | undefined;
  activeStoryId: number | null | undefined;
  pendingMediaCount: number;
}): SelectionSubmissionRoute {
  if (!input.selection) {
    return input.pendingMediaCount > 0
      ? { kind: "attachments" }
      : { kind: "ordinary-chat" };
  }
  if (input.pendingMediaCount > 0) {
    return {
      kind: "blocked",
      reason: "当前已有明确选区，请先取消选区或移除待发送素材",
      clearSelection: false,
    };
  }

  const selection = input.selection;
  const editKind = selectionEditKind(selection);
  if (
    editKind === "other" &&
    (selection.sourceType === "animatic-video" ||
      selection.sourceType === "timeline-range")
  ) {
    if (
      selection.storyId == null ||
      input.activeStoryId == null ||
      selection.storyId !== input.activeStoryId
    ) {
      return {
        kind: "blocked",
        reason: "这个剪辑选区已经失效，请重新选择",
        clearSelection: true,
      };
    }
    return { kind: "editing-command", selection };
  }

  const readiness = selectionReadiness(selection, input.activeStoryId);
  if (readiness.status !== "executable") {
    return {
      kind: "blocked",
      reason: readiness.reason,
      clearSelection: readiness.status === "stale",
    };
  }
  if (readiness.kind === "text") return { kind: "text-edit", selection };
  if (readiness.kind === "image") return { kind: "image-edit", selection };
  return { kind: "image-region-edit", selection };
}
