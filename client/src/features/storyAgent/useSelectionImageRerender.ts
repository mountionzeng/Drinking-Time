import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { selectionEditKind } from "@shared/selectionContext";
import type { SelectionState } from "./types";
import type { StoryboardImageRerenderRunner } from "./StoryAgentContext";

/** The mounted storyboard owns generation; chat owns the selected-image intent. */
export function useSelectionImageRerender(activeStoryId: number | null) {
  const runnerRef = useRef<StoryboardImageRerenderRunner | null>(null);
  const registerImageRerenderRunner = useCallback(
    (runner: StoryboardImageRerenderRunner) => {
      runnerRef.current = runner;
      return () => {
        if (runnerRef.current === runner) runnerRef.current = null;
      };
    },
    []
  );
  const rerenderSelectionImage = useCallback<StoryboardImageRerenderRunner>(
    async request => {
      const issue =
        request.storyId == null || request.storyId !== activeStoryId
          ? "这条改图操作属于另一个故事，请重新选择图片"
          : !runnerRef.current
            ? "故事版看板还没有准备好，请稍后再试"
            : null;
      if (issue) {
        toast.error(issue);
        return { status: "error", message: issue };
      }
      return runnerRef.current!(request);
    },
    [activeStoryId]
  );
  return { registerImageRerenderRunner, rerenderSelectionImage };
}

/** Interpret first: acknowledgement, questions and unchanged prompts never submit image work. */
export async function renderSelectionRevision(input: {
  selection: SelectionState;
  storyId: number | null;
  instruction: string;
  result: { isApprovalOnly: boolean; modifiedFullText: string };
  originalText: string;
  render: StoryboardImageRerenderRunner;
}) {
  const { selection, result, storyId } = input;
  if (
    selectionEditKind(selection) !== "image" ||
    !selection.imageId ||
    !selection.stableShotId ||
    !selection.shotNo ||
    storyId == null ||
    result.isApprovalOnly ||
    !result.modifiedFullText.trim() ||
    result.modifiedFullText === input.originalText
  )
    return null;
  return input.render({
    storyId,
    stableShotId: selection.stableShotId,
    shotNo: selection.shotNo,
    cueCode: selection.cueCode ?? null,
    imageId: selection.imageId,
    instruction: input.instruction,
  });
}
