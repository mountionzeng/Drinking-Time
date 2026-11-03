import { decideStaleRelease, INFERENCE_STALE_MS, isMediaOperationType, type StaleDecision, type StaleEvidence } from "../../shared/computeStaleRelease";

/** Off by default. When off nothing here runs and every original path behaves as before. */
export function computeStaleReleaseEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.COMPUTE_STALE_RELEASE_ENABLED === "1";
}

type Op = { id: number; operationId: string; operationType: string; status: string; userId: number; storyId: number | null; maxCostMinor: number; createdAt: Date };
type Attempt = { status: string; providerTaskId?: string | null; costMinor?: number | null; usage?: unknown };

export type StaleReleaseDeps = {
  now?: () => Date;
  listOpen: (createdBefore: Date, afterId: number, limit: number) => Promise<Op[]>;
  holdActive: (operationId: string) => Promise<boolean>;
  attempts: (operationId: string) => Promise<Attempt[]>;
  audioAssetStored: (op: Op) => Promise<boolean>;
  settleAtQuote: (operationId: string, reason: string) => Promise<unknown>;
  settleVerified: (operationId: string, costMinor: number, reason: string) => Promise<unknown>;
  release: (operationId: string, reason: string) => Promise<unknown>;
  log: (msg: string, extra: Record<string, unknown>) => void;
};

const str = (v: unknown) => typeof v === "string" && v.length > 0;

export function evidenceFromAttempts(op: Op, attempts: Attempt[], assetStored: boolean): StaleEvidence {
  const media = isMediaOperationType(op.operationType);
  let storedOutput = assetStored, outputUnstored = false, taskInFlight = false;
  let verifiedCostMinor: number | null = null;
  for (const a of attempts) {
    const u = (a.usage && typeof a.usage === "object" ? a.usage : {}) as Record<string, unknown>;
    if (str(u.audioUrl) || str(u.videoUrl)) storedOutput = true; // receipt URL already in the ledger, replayable
    else if (str(u.providerAudioUrl) || str(u.providerImageUrl) || str(u.providerVideoUrl)) outputUnstored = true;
    if (a.status === "succeeded") {
      if (media) outputUnstored = true; // provider says done but no stored asset found
      else { storedOutput = true; verifiedCostMinor = Math.max(verifiedCostMinor ?? 0, Number(a.costMinor ?? 0)); }
    }
    if (str(a.providerTaskId) && (a.status === "submitted" || a.status === "task_known")) taskInFlight = true;
  }
  return { storedOutput, outputUnstored, taskInFlight, verifiedCostMinor };
}

const manualLogged = new Set<string>();

/** One bounded pass. Returns the next keyset cursor (0 = wrapped). */
export async function sweepStaleReservations(deps: StaleReleaseDeps, afterId = 0, limit = 50) {
  const now = (deps.now ?? (() => new Date()))();
  const ops = await deps.listOpen(new Date(now.getTime() - INFERENCE_STALE_MS), afterId, limit);
  const results: { operationId: string; decision: StaleDecision }[] = [];
  for (const op of ops) {
    try {
      const [holdActive, attempts, assetStored] = await Promise.all([
        deps.holdActive(op.operationId), deps.attempts(op.operationId), deps.audioAssetStored(op),
      ]);
      const decision = decideStaleRelease({
        status: op.status, operationType: op.operationType, createdAt: op.createdAt, now, holdActive,
        evidence: evidenceFromAttempts(op, attempts, assetStored),
      });
      results.push({ operationId: op.operationId, decision });
      if (decision.action === "skip") continue;
      const extra = { operationId: op.operationId, operationType: op.operationType, userId: op.userId, status: op.status, reason: decision.reason };
      if (decision.action === "manual") {
        if (!manualLogged.has(op.operationId)) { manualLogged.add(op.operationId); deps.log("[stale-release] manual", extra); }
        continue;
      }
      if (decision.action === "release") await deps.release(op.operationId, decision.reason);
      else if (isMediaOperationType(op.operationType) || decision.verifiedCostMinor == null) await deps.settleAtQuote(op.operationId, decision.reason);
      else await deps.settleVerified(op.operationId, decision.verifiedCostMinor, decision.reason);
      deps.log(`[stale-release] ${decision.action}`, extra);
    } catch (error) {
      deps.log("[stale-release] item failed", { operationId: op.operationId, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { next: ops.length === limit ? ops[ops.length - 1].id : 0, results };
}

export async function defaultStaleReleaseDeps(): Promise<StaleReleaseDeps> {
  const [repo, ledger, assets] = await Promise.all([
    import("../repositories/computeLedger"), import("./computeLedger"), import("./storyAudioAssets"),
  ]);
  return {
    listOpen: (before, afterId, limit) => repo.listStaleOpenOperations(before, afterId, limit) as Promise<Op[]>,
    holdActive: async id => !!(await repo.findActiveCreditHold(id)),
    attempts: id => ledger.listOperationProviderAttempts(id) as Promise<Attempt[]>,
    audioAssetStored: async op => {
      if (!op.storyId || !(op.operationType.startsWith("audio.") || op.operationType.startsWith("tts.") || op.operationType === "media.voice")) return false;
      const asset = await assets.findReusableReadyStoryAudioAsset({ scope: { storyId: op.storyId, userId: op.userId }, sourceKind: "tts", sourceKey: op.operationId });
      return !!asset;
    },
    settleAtQuote: async (operationId, reason) => {
      const op = await repo.findBillingOperation(operationId);
      if (!op) return;
      return ledger.settleOperation({ operationId, outcome: { kind: "succeeded", verifiedCostMinor: Number(op.maxCostMinor) }, reason });
    },
    settleVerified: (operationId, costMinor, reason) => ledger.settleOperation({ operationId, outcome: { kind: "succeeded", verifiedCostMinor: costMinor }, reason }),
    release: (operationId, reason) => ledger.settleOperation({ operationId, outcome: { kind: "not_charged_failure" }, reason }),
    log: (msg, extra) => console.warn(msg, extra),
  };
}

export function startComputeStaleRelease(intervalMs = 60_000): () => void {
  if (!computeStaleReleaseEnabled()) return () => {};
  let running = false, cursor = 0;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void defaultStaleReleaseDeps()
      .then(deps => sweepStaleReservations(deps, cursor))
      .then(r => { cursor = r.next; })
      .catch(error => console.warn("[stale-release] unavailable", error instanceof Error ? error.message : error))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
