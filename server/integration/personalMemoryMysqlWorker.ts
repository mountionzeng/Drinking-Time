import {
  appendEmotionDailyLetterVersion,
  capturePersonalMemoryEventStandalone,
  listEmotionDailyLetterVersions,
  listPersonalMemoryEvents,
} from "../services/personalMemoryPersistence";
import type {
  PersonalMemoryEventIdentity,
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
      action: "appendLetter";
      userId: number;
      letterDate: string;
      actionId: string;
      trigger: "generated" | "reread";
      userMessage: string;
      expectedCurrentVersionNumber?: number;
    }
  | { action: "listVersions"; userId: number; letterDate: string }
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
