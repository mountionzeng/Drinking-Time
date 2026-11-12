import type { Mutation, QueryClient } from "@tanstack/react-query";

export type WarehouseRenderJob = {
  id: string;
  storyId: number;
  shotId?: string;
  kind: "image" | "audio" | "video";
  state: "rendering" | "unknown" | "failed" | "ready";
  startedAt: number;
  requestId?: string;
  imageTaskId?: string;
  compositionId?: string;
  mediaTaskId?: string;
  takeId?: number;
  assetId?: number;
  url?: string;
};

// Only production mutations. Quotes, chat, imports, adoption and polling are not renders.
const producers: Record<string, WarehouseRenderJob["kind"]> = {
  "storyAgent.generateForMobile": "image",
  "storyAgent.gradeVideoLuminance": "video",
  "storyAgent.gradeVideoRegion": "video",
  "creationAgent.inpaint": "image",
  "bookMedia.generateComposition": "image",
  "creationAgent.generateShotVideo": "video",
  "creationAgent.submitStartEndShotVideo": "video",
  "bookMedia.video": "video",
  "timelineMedia.generateSceneAudio": "audio",
  "timelineMedia.generateNarrationCandidate": "audio",
  "storyAgent.generateStoryShotVoice": "audio",
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? v as Record<string, unknown> : {};
const positive = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined;
const string = (v: unknown) => typeof v === "string" && v.length > 0 ? v : undefined;

export function renderJobFromMutation(mutation: Pick<Mutation, "mutationId" | "options" | "state">): WarehouseRenderJob | null {
  const path = mutation.options.mutationKey?.[0];
  const kind = producers[Array.isArray(path) ? path.join(".") : String(path)];
  const input = record(mutation.state.variables);
  const storyId = positive(input.storyId);
  if (!kind || !storyId || mutation.state.status === "idle") return null;
  const job: WarehouseRenderJob = {
    id: `render:${mutation.state.submittedAt}:${mutation.mutationId}`,
    storyId, kind, state: "rendering", startedAt: mutation.state.submittedAt,
    shotId: string(input.conversationShotId) ?? string(input.stableShotId) ?? string(input.shotIdentity),
    requestId: string(input.shotImageRequestId) ?? string(record(input.moduleTarget).requestId),
  };
  // A network failure does not prove the provider stopped. Never offer an automatic retry.
  if (mutation.state.status === "error") return { ...job, state: "unknown" };
  return mutation.state.status === "success" ? renderJobResult(job, mutation.state.data) : job;
}

export function renderJobResult(job: WarehouseRenderJob, value: unknown): WarehouseRenderJob {
  const result = record(value);
  const take = record(result.take);
  const candidate = record(result.candidate);
  const asset = record(result.asset);
  const first = record(Array.isArray(result.candidates) ? result.candidates[0] : undefined);
  const state = take.status ?? result.status;
  const next = {
    ...job,
    mediaTaskId: string(result.mediaTaskId) ?? job.mediaTaskId,
    imageTaskId: string(result.imageTaskId) ?? job.imageTaskId,
    compositionId: result.composition ? string(result.id) : job.compositionId,
    takeId: positive(take.id) ?? positive(result.takeId) ?? job.takeId,
    assetId: positive(result.imageId) ?? positive(result.assetId) ?? positive(candidate.assetId) ?? positive(asset.id) ?? positive(first.imageId) ?? job.assetId,
    url: string(take.videoUrl) ?? string(result.videoUrl) ?? string(result.imageUrl) ?? string(result.audioUrl) ?? string(candidate.audioUrl) ?? string(asset.audioUrl) ?? string(first.imageUrl) ?? job.url,
  };
  // Some legacy image APIs return HTTP success + status:error for accepted work.
  if (result.pending === true || (result.providerTaskId && ["error", "accepted"].includes(String(state)))) {
    return { ...next, state: next.imageTaskId || next.requestId || next.compositionId ? "rendering" : "unknown" };
  }
  if (result.submissionUncertain === true || (typeof result.error === "string" && result.error.startsWith("配音结果待确认"))) return { ...next, state: "unknown" };
  if (["error", "failed", "timeout"].includes(String(state))) return { ...next, state: "failed" };
  if (["submission-unknown", "submission_unknown", "unknown", "missing"].includes(String(state))) return { ...next, state: "unknown" };
  if (["submitted", "submitting", "processing", "pending", "accepted", "preparing"].includes(String(state))) return { ...next, state: "rendering" };
  if (next.takeId && result.videoUrl) return { ...next, state: "ready" };
  if (["ok", "ready", "candidate-ready", "succeeded", "available", "recovered"].includes(String(state))) return { ...next, state: "ready" };
  return { ...next, state: "unknown" };
}

export function restoreRenderJobs(raw: string | null, now = Date.now()): WarehouseRenderJob[] {
  try {
    const values: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(values)) return [];
    return values.filter((j): j is WarehouseRenderJob => {
      const r = record(j);
      return typeof r.id === "string" && Boolean(positive(r.storyId)) &&
        ["image", "audio", "video"].includes(String(r.kind)) &&
        ["rendering", "unknown", "failed", "ready"].includes(String(r.state)) &&
        typeof r.startedAt === "number" && now - r.startedAt < 24 * 60 * 60_000;
    }).slice(-50).map(j => ({ ...j, state: j.state === "rendering" ? "unknown" : j.state }));
  } catch { return []; }
}

/** Observe existing requests; this never submits, retries, adopts, or changes a timeline. */
export function watchWarehouseRenders(
  client: QueryClient,
  onJob: (job: WarehouseRenderJob, started: boolean) => void,
) {
  const observed = new Set<number>();
  return client.getMutationCache().subscribe(event => {
    if (event.type !== "updated" || !["pending", "success", "error"].includes(event.action.type)) return;
    if (event.action.type === "pending") observed.add(event.mutation.mutationId);
    // A previous account's late response must not enter a newly subscribed account.
    if (!observed.has(event.mutation.mutationId)) return;
    const job = renderJobFromMutation(event.mutation);
    if (job) onJob(job, event.action.type === "pending");
    if (event.action.type !== "pending") observed.delete(event.mutation.mutationId);
  });
}
