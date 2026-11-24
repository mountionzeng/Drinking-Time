import { z } from "zod";
import { objectRegionSchema, objectTargetsSchema } from "./shotObjectTargets";
import { fromYuan, toYuan } from "./computeMoney";
import { findVisualAssetVersion, normalizeStoryVisualAssets } from "./visualAssets";

const detail = z.string().trim().max(220);
export const sceneLayoutSchema = z.object({
  observed: z.string().max(600),
  regions: z.array(objectRegionSchema).max(8).optional(),
  people: z.array(z.object({
    role: detail.min(1), count: detail, clothing: detail, position: detail,
    action: detail, target: detail, gaze: detail,
  })).max(20),
  objects: z.array(z.object({ name: detail.min(1), position: detail })).max(30),
  omit: z.array(detail).max(12),
  uncertain: z.array(detail).max(12),
});
export type SceneLayout = z.infer<typeof sceneLayoutSchema>;
export const sceneAllowanceSchema = z.object({
  stableShotId: z.string().min(1).max(128), imageId: z.number().int().positive().optional(),
  localTargets: objectTargetsSchema.optional(),
  key: z.string().length(64), estimatedCny: z.number().finite().nonnegative(),
});
export type SceneAllowance = z.infer<typeof sceneAllowanceSchema>;
export const sceneRenderTotal = (imageCny: number, readingCny = 0) => toYuan(fromYuan(imageCny) + fromYuan(readingCny));

/** Only the intended arrangement is rendered. Observations may describe a mistake in the source. */
export function sceneLayoutText(layout: SceneLayout) {
  return [
    ...layout.people.map(p => [p.role, p.count, p.clothing, p.position, p.action,
      p.target && `动作对象：${p.target}`, p.gaze && `视线：${p.gaze}`].filter(Boolean).join("，")),
    ...layout.objects.map(o => [o.name, o.position].filter(Boolean).join("，")),
    layout.omit.length ? "不入画：" + layout.omit.join("、") : "",
  ].filter(Boolean).join("\n");
}

export type ShotSceneRecord = {
  stableShotId: string;
  confirmed?: string;
  localSources?: Array<{ sourceKey: string; layout: SceneLayout }>;
  sources?: Array<{ sourceKey: string; requestKey: string; quoteKey: string; layout: SceneLayout }>;
  reading?: { key: string; attempt: string; startedAt: number; status: "reading" | "ready" | "failed"; layout?: SceneLayout; authFailed?: boolean; providerError?: "insufficient_quota" };
};
export function sceneRecords(body: Record<string, unknown>): ShotSceneRecord[] {
  return Array.isArray(body.shotSceneDirections) ? body.shotSceneDirections : [];
}
export function confirmedShotScene(body: Record<string, unknown>, shot: Record<string, unknown>) {
  const id = shot.stableShotId || shot.shotIdentity;
  return sceneRecords(body).find(row => row.stableShotId === id)?.confirmed ?? "";
}
export function shotSceneFacts(body: Record<string, unknown>, shot: Record<string, unknown>) {
  const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
  const id = text(shot.stableShotId) || text(shot.shotIdentity);
  const confirmed = confirmedShotScene(body, shot);
  const aggregate = normalizeStoryVisualAssets(body.visualAssets, { legacyArtDirection: body.artDirection ?? {} });
  const binding = aggregate.bindings.find(b => b.stableShotId === id);
  const facts: string[] = [];
  for (const kind of ["character", "pet", "scene"] as const) {
    const ref = binding?.[kind];
    const item = ref && findVisualAssetVersion(aggregate, ref);
    if (!item || !["locked", "superseded"].includes(item.version.status)) continue;
    const f = item.version.fixedFacts;
    const values = Object.entries(f).filter(([key]) => key !== "kind").flatMap(([, value]) => Array.isArray(value) ? value : [value]).filter(Boolean);
    if (values.length) facts.push([item.asset.name, ...values].join("，"));
  }
  return [confirmed, ...facts, ...[shot.characterReference, shot.wardrobeReference, shot.hairReference,
    !confirmed && shot.performance, shot.sceneReference].map(text)].filter(Boolean).join("\n");
}
