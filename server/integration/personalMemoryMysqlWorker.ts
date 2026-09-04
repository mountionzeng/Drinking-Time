import {
  appendEmotionDailyLetterVersion,
  capturePersonalMemoryEventStandalone,
  claimPersonalMemoryJobs,
  completePersonalMemoryExtractionJob,
  correctPersonalMemoryInsight,
  failPersonalMemoryJob,
  forgetPersonalMemoryInsightLineage,
  getPersonalMemoryPrivacyEpoch,
  getPersonalMemorySuppression,
  isPersonalMemoryEventSuppressed,
  listActivePersonalMemoryInsightCandidates,
  listEmotionDailyLetterVersions,
  listPersonalMemoryEvents,
  listPersonalMemoryInsightLineage,
  scrubPersonalMemoryEventAndRecompute,
} from "../services/personalMemoryPersistence";
import type {
  PersonalMemoryEventIdentity,
  PersonalMemoryInsightMutation,
  PersonalMemoryLetterPayload,
} from "../../shared/personalMemory";

type WorkerInput = {
  /** 让多个进程在同一个墙钟时刻同时冲进事务，制造真实竞争 */
  startAtMs?: number;
} & (
  | {
      action: "capture";
      identity: PersonalMemoryEventIdentity;
      occurredOn: string;
      occurredAt: string;
      storyId: number | null;
      operationId: string;
    }
  | { action: "listEvents"; userId: number }
  | {
      action: "timelinePage";
      userId: number;
      cursor: string | null;
      limit: number;
    }
  | { action: "resolveSource"; userId: number; eventId: number }
  | { action: "dayDetail"; userId: number; occurredOn: string }
  | {
      action: "appendLetter";
      userId: number;
      letterDate: string;
      actionId: string;
      trigger: "generated" | "reread";
      userMessage: string;
      expectedCurrentVersionNumber?: number;
    }
  | { action: "listVersions"; userId: number; letterDate: string }
  | { action: "claimJobs"; limit: number; leaseMs: number }
  | {
      action: "completeExtraction";
      jobId: number;
      leaseToken: string;
      userId: number;
      eventId: number;
      mutations: PersonalMemoryInsightMutation[];
    }
  | {
      action: "failJob";
      jobId: number;
      leaseToken: string;
      errorKind: string;
      permanent: boolean;
      nextAvailableAtMs?: number;
    }
  | {
      action: "correctInsight";
      userId: number;
      lineageKey: string | null;
      text: string;
    }
  | { action: "forgetInsight"; userId: number; lineageKey: string }
  | { action: "scrubEvent"; userId: number; eventId: number }
  | { action: "listInsightCandidates"; userId: number; limit: number }
  | { action: "listInsightLineage"; userId: number; lineageKey: string }
  | { action: "getSuppression"; userId: number; lineageKey: string }
  | { action: "isEventSuppressed"; userId: number; eventId: number }
  | { action: "getPrivacyEpoch"; userId: number }
);

function decodeInput(value: string | undefined): WorkerInput {
  if (!value) throw new Error("personal memory worker input is required");
  return JSON.parse(
    Buffer.from(value, "base64url").toString("utf8")
  ) as WorkerInput;
}

async function finish(payload: unknown, exitCode = 0): Promise<never> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(
      `MYSQL_WORKER_RESULT:${JSON.stringify(payload)}\n`,
      error => (error ? reject(error) : resolve())
    );
  });
  process.exit(exitCode);
}

function payloadFor(userMessage: string): PersonalMemoryLetterPayload {
  return {
    dailyReference: { todayDate: "2026-09-03" },
    analysisSeed: { userMessage },
    userMessage,
    profileRevision: null,
    almanac: null,
    selectedEvidence: [],
  };
}

try {
  const input = decodeInput(process.argv[2]);
  if (input.startAtMs) {
    const delay = input.startAtMs - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }

  if (input.action === "capture") {
    const result = await capturePersonalMemoryEventStandalone({
      identity: input.identity,
      occurredOn: input.occurredOn,
      occurredAt: input.occurredAt,
      snapshot: { excerpt: null, contentHash: null, display: null },
      storyId: input.storyId,
      job: { operationId: input.operationId, extractorVersion: "v1" },
    });
    await finish({ changed: result.changed, eventId: result.event.id });
  }

  if (input.action === "listEvents") {
    const events = await listPersonalMemoryEvents(input.userId, 200);
    await finish({
      count: events.length,
      actionIds: events.map(event => event.actionId),
    });
  }

  if (input.action === "timelinePage") {
    const { getPersonalMemoryTimelinePage } = await import(
      "../services/personalMemoryTimeline"
    );
    const page = await getPersonalMemoryTimelinePage({
      userId: input.userId,
      cursor: input.cursor,
      limit: input.limit,
    });
    await finish({
      ids: page.items.map(item => item.id),
      excerpts: page.items.map(item => item.excerpt),
      nextCursor: page.nextCursor,
    });
  }

  if (input.action === "resolveSource") {
    const { resolvePersonalMemoryEventSource } = await import(
      "../services/personalMemoryTimeline"
    );
    const resolved = await resolvePersonalMemoryEventSource({
      userId: input.userId,
      eventId: input.eventId,
    });
    await finish({ resolved });
  }

  if (input.action === "dayDetail") {
    const { getPersonalMemoryDayDetail } = await import(
      "../services/personalMemoryTimeline"
    );
    const detail = await getPersonalMemoryDayDetail({
      userId: input.userId,
      occurredOn: input.occurredOn,
    });
    await finish({ ids: detail.items.map(item => item.id) });
  }

  if (input.action === "appendLetter") {
    const result = await appendEmotionDailyLetterVersion({
      userId: input.userId,
      letterDate: input.letterDate,
      actionId: input.actionId,
      trigger: input.trigger,
      selectorVersion: "s1",
      promptVersion: "p1",
      modelVersion: "m1",
      privacyEpoch: 1,
      payload: payloadFor(input.userMessage),
      ...(input.expectedCurrentVersionNumber === undefined
        ? {}
        : { expectedCurrentVersionNumber: input.expectedCurrentVersionNumber }),
    });
    await finish(
      result
        ? {
            created: result.created,
            versionNumber: result.version.envelope.versionNumber,
            letterRevision: result.letter.revision,
            currentVersionId: result.letter.currentVersionId,
          }
        : { conflict: true }
    );
  }

  if (input.action === "listVersions") {
    const versions = await listEmotionDailyLetterVersions(
      input.userId,
      input.letterDate
    );
    await finish({
      count: versions.length,
      versionNumbers: versions.map(version => version.envelope.versionNumber),
    });
  }

  if (input.action === "claimJobs") {
    const jobs = await claimPersonalMemoryJobs({
      limit: input.limit,
      leaseMs: input.leaseMs,
    });
    await finish({
      count: jobs.length,
      jobs: jobs.map(job => ({
        id: job.id,
        leaseToken: job.leaseToken,
        attempts: job.attempts,
      })),
    });
  }

  if (input.action === "completeExtraction") {
    const result = await completePersonalMemoryExtractionJob({
      jobId: input.jobId,
      leaseToken: input.leaseToken,
      userId: input.userId,
      eventId: input.eventId,
      mutations: input.mutations,
    });
    await finish({
      jobClaimValid: result.jobClaimValid,
      discarded: result.discarded,
      applied: result.applied.map(a => ({
        outcome: a.outcome,
        insightId: a.insightId,
        lineageKey: a.lineageKey,
      })),
    });
  }

  if (input.action === "failJob") {
    const ok = await failPersonalMemoryJob({
      jobId: input.jobId,
      leaseToken: input.leaseToken,
      errorKind: input.errorKind,
      permanent: input.permanent,
      ...(input.nextAvailableAtMs === undefined
        ? {}
        : { nextAvailableAt: new Date(input.nextAvailableAtMs) }),
    });
    await finish({ ok });
  }

  if (input.action === "correctInsight") {
    const result = await correctPersonalMemoryInsight({
      userId: input.userId,
      lineageKey: input.lineageKey,
      category: "preference",
      text: input.text,
      scope: null,
      allowProactiveMention: false,
    });
    await finish(result);
  }

  if (input.action === "forgetInsight") {
    const result = await forgetPersonalMemoryInsightLineage(
      input.userId,
      input.lineageKey
    );
    await finish(result);
  }

  if (input.action === "scrubEvent") {
    const result = await scrubPersonalMemoryEventAndRecompute(
      input.userId,
      input.eventId
    );
    await finish(result);
  }

  if (input.action === "listInsightCandidates") {
    const rows = await listActivePersonalMemoryInsightCandidates(
      input.userId,
      input.limit
    );
    await finish({
      count: rows.length,
      rows: rows.map(row => ({
        id: row.id,
        lineageKey: row.lineageKey,
        revision: row.revision,
        state: row.state,
        text: row.text,
        confidence: row.confidence,
      })),
    });
  }

  if (input.action === "listInsightLineage") {
    const rows = await listPersonalMemoryInsightLineage(
      input.userId,
      input.lineageKey
    );
    await finish({
      count: rows.length,
      rows: rows.map(row => ({
        id: row.id,
        revision: row.revision,
        state: row.state,
        text: row.text,
        origin: row.origin,
        supersededByInsightId: row.supersededByInsightId,
      })),
    });
  }

  if (input.action === "getSuppression") {
    const row = await getPersonalMemorySuppression(
      input.userId,
      input.lineageKey
    );
    await finish({ exists: row !== null, suppressedEventIds: row?.suppressedEventIds ?? [] });
  }

  if (input.action === "isEventSuppressed") {
    const suppressed = await isPersonalMemoryEventSuppressed(
      input.userId,
      input.eventId
    );
    await finish({ suppressed });
  }

  if (input.action === "getPrivacyEpoch") {
    const epoch = await getPersonalMemoryPrivacyEpoch(input.userId);
    await finish({ epoch });
  }

  await finish({ error: "unknown action" }, 1);
} catch (error) {
  // 顺着 cause 链吐完整错误，而不是只报最外层 message。
  // drizzle 会把 mysql2 的错误包一层，只看外层就只能看到「Failed query: ...」，
  // 看不到 ER_DUP_ENTRY 这类真正有用的 code——2026-09-03 排查并发快照问题时，
  // 正是因为看不到它多花了一轮。
  const chain: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const e = current as { name?: string; code?: string; sqlMessage?: string; message?: string; cause?: unknown };
    chain.push(`${e.name ?? ""}|${e.code ?? ""}|${e.sqlMessage ?? e.message ?? ""}`);
    current = e.cause;
  }
  await finish({ error: chain.join(" << ") }, 1);
}
