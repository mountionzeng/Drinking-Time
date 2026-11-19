import { useEffect, useState } from "react";
import { WarehouseVideoSequenceDialog } from "@/features/creationEditor/views/WarehouseVideoSequenceDialog";
import { OPEN_REVIEWED_VIDEO, reviewedVideoEventIsCurrent, type ReviewedVideoEvent } from "../frameReviewVideoBridge";
import { storySpineStore } from "../spine/storySpine";

/** Reuses the paid-confirmation dialog; no separate generation button in chat. */
export function ReviewedVideoDialog() {
  const [request, setRequest] = useState<ReviewedVideoEvent | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<ReviewedVideoEvent>).detail;
      if (detail?.plan && reviewedVideoEventIsCurrent(detail)) setRequest(detail);
    };
    const unsubscribe = storySpineStore.subscribe(() => setRequest(current =>
      current && !reviewedVideoEventIsCurrent(current) ? null : current));
    window.addEventListener(OPEN_REVIEWED_VIDEO, open);
    return () => { unsubscribe(); window.removeEventListener(OPEN_REVIEWED_VIDEO, open); };
  }, []);
  if (!request || !reviewedVideoEventIsCurrent(request)) return null;
  const plan = request.plan;
  return <WarehouseVideoSequenceDialog key={plan.review.reviewId + ":" + plan.review.reviewRevision}
    storyId={plan.storyId} stableShotId={plan.stableShotId} shotNo={plan.shotNo}
    images={plan.images} reviewedPlan={plan} onClose={() => setRequest(null)} />;
}
