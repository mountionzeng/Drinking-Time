import { useEffect, useRef } from "react";
import { storySpineStore } from "../spine/storySpine";
import { registerVisualProductionChat } from "../visualProductionChatBridge";
import { executeVisualProduction, type ProductionShot } from "./visualProductionWorkflow";
import type { MotionField } from "@shared/visualProductionChat";

type Input = {
  storyId?: number | null;
  shots: ProductionShot[];
  selectedShotNo?: number | null;
  referenceImageIds?: number[];
  save: (shot: ProductionShot, field: "promptDraft" | "videoPrompt", value: string) => Promise<void>;
  saveFields?: (shot: ProductionShot, fields: Partial<Record<MotionField, string>>) => Promise<void>;
  render: (shot: ProductionShot, kind: "image" | "video", instruction: string, referenceImageIds?: number[]) => Promise<string>;
  adopt: (shot: ProductionShot, asset: { imageId?: number; takeId?: number; timeline: boolean }) => Promise<void>;
};

export function useVisualProductionWorkflow(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    const storyId = input.storyId;
    if (!storyId) return;
    let mounted = true;
    const unregister = registerVisualProductionChat(storyId, request => {
      const scope = storySpineStore.getState();
      const captured = latest.current;
      return executeVisualProduction(request, {
        ...captured,
        isCurrent: () => mounted && latest.current.storyId === storyId &&
          storySpineStore.getState().activeStoryId === storyId &&
          storySpineStore.getState().storyScopeEpoch === scope.storyScopeEpoch &&
          storySpineStore.getState().storyLoadEpoch === scope.storyLoadEpoch,
      });
    });
    return () => { mounted = false; unregister(); };
  }, [input.storyId]);
}
