import { useEffect } from "react";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import type { StoryShot } from "../types";
import type { StoryboardImageRerenderRunner } from "../StoryAgentContext";
import { storyShotInsertIdentity } from "./storyboardReviewModel";
import { resolveStoryboardRerenderShotIndex } from "./storyboardImageRenderPlan";

export function useStoryboardImageRerenderRunner(input: {
  shots: StoryShot[];
  creationShots: CreationEditorShot[];
  register?: (runner: StoryboardImageRerenderRunner) => () => void;
  render: (
    shot: StoryShot,
    creationShot: CreationEditorShot | undefined,
    index: number,
    request: Parameters<StoryboardImageRerenderRunner>[0]
  ) => ReturnType<StoryboardImageRerenderRunner>;
}) {
  const { shots, creationShots, register, render } = input;
  useEffect(
    () =>
      register?.(async request => {
        const index = resolveStoryboardRerenderShotIndex(
          shots.map((shot, index) => ({
            stableShotId: storyShotInsertIdentity(shot, index),
            cueCode: shot.cueCode,
            shotNo: shot.shotNo,
          })),
          request
        );
        const shot = shots[index];
        if (!shot)
          return {
            status: "error",
            message: "这个镜头已经不在当前故事中，请重新选择",
          };
        const stableId = storyShotInsertIdentity(shot, index);
        const creationShot = creationShots.find(candidate =>
          stableId
            ? (candidate.stableShotId ?? candidate.shotIdentity) === stableId
            : candidate.shotNo === shot.shotNo
        );
        return render(shot, creationShot, index, request);
      }),
    [shots, creationShots, register, render]
  );
}
