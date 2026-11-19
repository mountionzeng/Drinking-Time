import { projectVisualClips, visualTrackId, type VisualEditDocument } from "./visualClipModel";
import { visualObjectRefFromClip, visualObjectRefKey, type VisualObjectRef } from "./visualObject";
import { deleteStoryShotAggregate, deleteVisualObjectReference } from "./visualObjectOperations";

/** Validate the entire selection before planning one atomic write. */
export function deleteVisualObjectBatch(input: {
  shots: Record<string, unknown>[];
  document: VisualEditDocument;
  objects: readonly VisualObjectRef[];
  visualLayer: number;
}) {
  const fail = (message: string) => ({ status: "error" as const, message });
  if (!input.objects.length || input.objects.length > 500) return fail("请选择 1–500 个画面");
  const keys = input.objects.map(visualObjectRefKey);
  if (new Set(keys).size !== keys.length) return fail("选区包含重复画面，请重新选择");
  const clips = projectVisualClips(input.document);
  for (const key of keys) {
    const clip = clips.find(clip => {
      const ref = visualObjectRefFromClip(clip);
      return ref && visualObjectRefKey(ref) === key;
    });
    if (!clip || clip.trackId !== visualTrackId(input.visualLayer))
      return fail("所选画面已删除或换层，请重新选择后删除");
  }
  let aggregate = { shots: input.shots, document: input.document };
  // Remove narrow references before deleting owners (which may reparent clips).
  for (const object of input.objects.filter(object => object.type !== "story-shot")) {
    const result = deleteVisualObjectReference({ document: aggregate.document, object });
    if (result.status === "error") return fail(result.message);
    aggregate = { ...aggregate, document: result.document };
  }
  for (const object of input.objects) {
    if (object.type !== "story-shot") continue;
    const result = deleteStoryShotAggregate({ aggregate, stableShotId: object.stableShotId });
    if (result.status === "error") return fail(result.message);
    aggregate = result.aggregate;
  }
  return { status: "ok" as const, aggregate };
}
