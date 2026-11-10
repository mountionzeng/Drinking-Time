import type { SelectionContext } from "@shared/selectionContext";
import { storyboardEditShouldFollowSelectionToShot } from "./storyboardEditRow";

type Selection = Pick<SelectionContext, "sourceType" | "stableShotId" | "storyId">;
type Shot = { stableShotId?: string | null; shotIdentity?: string | null; shotNo: number };

/** A chat selection is a navigation event, not a permanent playback constraint. */
export function createStoryboardSelectionFollow() {
  let followedSelection: Selection | null | undefined;
  let followedStoryId: number | null | undefined;
  return (selection: Selection | null, storyId: number | null, shots: readonly Shot[]): number | null => {
    if (selection === followedSelection && storyId === followedStoryId) return null;
    const eligible = selection && selection.storyId === storyId &&
      storyboardEditShouldFollowSelectionToShot(selection.sourceType) && selection.stableShotId;
    const shot = eligible
      ? shots.find(item => (item.stableShotId ?? item.shotIdentity) === selection.stableShotId)
      : undefined;
    // A newly inserted shot may arrive after its selection; wait until it is loaded.
    if (eligible && !shot) return null;
    followedSelection = selection;
    followedStoryId = storyId;
    return shot?.shotNo ?? null;
  };
}
