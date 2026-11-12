import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import {
  renderJobResult, restoreRenderJobs, watchWarehouseRenders,
  type WarehouseRenderJob,
} from "./warehouseRenderActivity";

/** Keep receipts across a refresh, scoped to the signed-in account. No prompt/quote is stored. */
export function useWarehouseRenderActivity(
  accountId: number | undefined,
  storyId: number | null,
  onStart: (job: WarehouseRenderJob) => void,
) {
  const client = useQueryClient();
  const utils = trpc.useUtils();
  const [snapshot, setSnapshot] = useState<{ accountId?: number; jobs: WarehouseRenderJob[] }>({ jobs: [] });
  const jobsRef = useRef<WarehouseRenderJob[]>([]);
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const publishRef = useRef<(jobs: WarehouseRenderJob[]) => void>(() => {});

  useEffect(() => {
    const key = `dt:warehouse-renders:${accountId}`;
    let jobs: WarehouseRenderJob[] = [];
    if (accountId) {
      try { jobs = restoreRenderJobs(localStorage.getItem(key)); } catch { /* Storage may be disabled. */ }
    }
    const publish = (next: WarehouseRenderJob[]) => {
      jobsRef.current = next.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).slice(-50);
      setSnapshot({ accountId, jobs: jobsRef.current });
      if (accountId) {
        try { localStorage.setItem(key, JSON.stringify(jobsRef.current)); } catch { /* Keep in memory. */ }
      }
    };
    publishRef.current = publish;
    publish(jobs);
    if (!accountId) return;
    return watchWarehouseRenders(client, (job, started) => {
      const previous = jobsRef.current.find(j => j.id === job.id);
      job.shotId ??= previous?.shotId;
      if (started && !job.shotId) {
        const mutation = client.getMutationCache().getAll().find(m => `render:${m.state.submittedAt}:${m.mutationId}` === job.id);
        const variables = mutation?.state.variables as { shotNo?: number } | undefined;
        const spine = storySpineStore.getState();
        const shot = spine.activeStoryId === job.storyId ? spine.storyShots.find(s => s.shotNo === variables?.shotNo) : undefined;
        job.shotId = shot?.stableShotId ?? shot?.shotIdentity;
      }
      publish([...jobsRef.current.filter(j => j.id !== job.id), job]);
      if (started) onStartRef.current(job);
      if (job.state === "ready" || job.state === "failed") {
        // Refresh only this story. Finishing a background job must not switch the editor.
        void utils.storyAgent.storyMaterialState.invalidate({ storyId: job.storyId });
        void utils.timelineMedia.audioAssetLibrary.invalidate({ storyId: job.storyId });
        void utils.storyAgent.chatImageRevisions.invalidate({ storyId: job.storyId });
      }
    });
  }, [accountId, client, utils]);

  const jobs = snapshot.accountId === accountId
    ? snapshot.jobs.filter(j => j.storyId === storyId) : [];
  const needsPolling = jobs.some(j => j.state === "rendering" || j.state === "ready" || (j.state === "unknown" && (j.mediaTaskId || j.imageTaskId || j.requestId || j.takeId || j.compositionId)));
  useEffect(() => {
    if (!accountId || !storyId || !needsPolling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = jobsRef.current.filter(j => j.storyId === storyId && j.state !== "failed");
      try {
        const [materialRead, audioRead, revisionsRead] = await Promise.allSettled([
          utils.storyAgent.storyMaterialState.fetch({ storyId }),
          utils.timelineMedia.audioAssetLibrary.fetch({ storyId }),
          utils.storyAgent.chatImageRevisions.fetch({ storyId }),
        ]);
        const material = materialRead.status === "fulfilled" ? materialRead.value : undefined;
        const audio = audioRead.status === "fulfilled" ? audioRead.value : [];
        const revisions = revisionsRead.status === "fulfilled" ? revisionsRead.value : [];
        const takes = [...(material?.shots.flatMap(s => s.videoTakes) ?? []), ...(material?.unassignedVideoTakes ?? [])];
        const images = [...(material?.warehouseImages ?? []), ...(material?.shots.flatMap(s => s.imageVersions) ?? [])];
        const updates = await Promise.allSettled(current.map(async job => {
          let next = job;
          if (job.imageTaskId) {
            const view = await utils.storyAgent.imageTaskStatus.fetch({ imageTaskId: job.imageTaskId });
            if (view.storyId === storyId) next = renderJobResult(job, view);
          }
          if (job.compositionId) {
            const history = await utils.bookMedia.compositionHistory.fetch({ storyId });
            const task = history.find(t => t.id === job.compositionId);
            if (task) next = renderJobResult(job, task);
          }
          if (job.mediaTaskId) {
            const view = await utils.timelineMedia.mediaTaskStatus.fetch({ mediaTaskId: job.mediaTaskId });
            if (view.state === "done") next = renderJobResult(job, view.result);
            else next = { ...job, state: view.state === "pending" ? "rendering" as const : "unknown" as const };
          }
          if (job.requestId) {
            const revision = revisions.find(r => r.requestId === job.requestId);
            if (revision) next = renderJobResult(job, revision);
            else {
              // Non-chat renders use the same saved story receipts, without a chat revision.
              const story = await utils.storyAgent.storyGet.fetch({ id: storyId });
              const body = story?.body as Record<string, unknown> | undefined;
              const receipts = [body?.storyboardImageTasks, body?.bookModuleImageTasks].flatMap(value => Array.isArray(value) ? value : []);
              const receipt = receipts.find(r => r?.requestId === job.requestId);
              if (receipt) next = renderJobResult(job, receipt.status === "succeeded" && receipt.result ? receipt.result : receipt);
            }
          }
          const take = takes.find(t => t.id === next.takeId);
          if (take) next = renderJobResult(next, { take });
          // Remove a placeholder only when its saved asset is actually present.
          const visible = next.kind === "image" ? images.some(i => i.id === next.assetId)
            : next.kind === "audio" ? audio.some(a => a.id === next.assetId)
              : Boolean(take?.videoUrl && take.status === "available");
          const libraryRead = next.kind === "audio" ? audioRead : materialRead;
          if (next.state === "ready" && (visible || (libraryRead.status === "fulfilled" && job.state === "ready" && !next.assetId && !next.takeId))) return { before: job, after: null };
          // A completed request without an asset reference cannot spin indefinitely.
          if (Date.now() - job.startedAt > 35 * 60_000 && next.state === "rendering") next = { ...next, state: "unknown" };
          return { before: job, after: next };
        }));
        if (stopped) return;
        let next = jobsRef.current;
        for (const result of updates) {
          // A missing/failed receipt must not block another render's completion.
          if (result.status !== "fulfilled") continue;
          const update = result.value;
          // Do not overwrite a mutation that finished while these reads were in flight.
          if (next.find(j => j.id === update.before.id) !== update.before) continue;
          next = next.filter(j => j.id !== update.before.id);
          if (update.after) next = [...next, update.after];
        }
        next = next.map(j => j.storyId === storyId && j.state === "rendering" && Date.now() - j.startedAt > 35 * 60_000 ? { ...j, state: "unknown" as const } : j);
        if (JSON.stringify(next) !== JSON.stringify(jobsRef.current)) publishRef.current(next);
      } catch {
        // A failed status read is not proof of a failed render. Stop indefinite spinners.
        if (!stopped) publishRef.current(jobsRef.current.map(j =>
          j.storyId === storyId && j.state === "rendering" && Date.now() - j.startedAt > 35 * 60_000 ? { ...j, state: "unknown" } : j));
      }
      if (!stopped) timer = setTimeout(poll, jobsRef.current.some(j => j.storyId === storyId && (j.state === "rendering" || j.state === "ready")) ? 3000 : 15000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [accountId, storyId, needsPolling, utils]);
  return jobs;
}
