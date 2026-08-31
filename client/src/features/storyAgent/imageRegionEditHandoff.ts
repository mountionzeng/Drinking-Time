import { useCallback, useRef } from "react";
import {
  selectionEditKind,
  type SelectionContext,
} from "@shared/selectionContext";

export type ImageRegionEditHandoffResult = {
  status: "success" | "error";
  message: string;
  stale?: boolean;
};

export type ImageRegionEditHandoffRunner = (request: {
  instruction: string;
  selection: SelectionContext;
}) => Promise<ImageRegionEditHandoffResult>;

export function useImageRegionEditHandoffRunner() {
  const runnerRef = useRef<ImageRegionEditHandoffRunner | null>(null);
  const register = useCallback((runner: ImageRegionEditHandoffRunner) => {
    runnerRef.current = runner;
    return () => {
      if (runnerRef.current === runner) runnerRef.current = null;
    };
  }, []);
  const run = useCallback(
    async (request: Parameters<ImageRegionEditHandoffRunner>[0]) => {
      if (!runnerRef.current) {
        throw new Error("Preview 局部编辑会话不可用，请重新确认图片区域");
      }
      return runnerRef.current(request);
    },
    []
  );
  return { register, run };
}

export async function handoffConfirmedImageRegion(input: {
  instruction: string;
  selection: SelectionContext;
  run: ImageRegionEditHandoffRunner;
  scopeIsCurrent: () => boolean;
  consumeStaleSelection: () => void;
}): Promise<null | { status: "abandoned" } | { status: "success"; message: string }> {
  if (selectionEditKind(input.selection) !== "image-region") return null;
  const outcome = await input.run({
    instruction: input.instruction,
    selection: input.selection,
  });
  if (outcome.status !== "success") {
    if (outcome.stale) input.consumeStaleSelection();
    throw new Error(outcome.message);
  }
  return input.scopeIsCurrent()
    ? { status: "success", message: outcome.message }
    : { status: "abandoned" };
}
