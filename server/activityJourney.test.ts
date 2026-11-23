import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/mysql2";
import { ACTIVITY_VISIT_HEADER, activityBounds, activitySignal, activityWindow } from "../shared/activityJourney";
import { aggregateActivity, activityReportCsv, type ReportEvent } from "./services/activityJourneyReport";
import { activityWebVisit, readActivityWebVisit } from "./services/activityJourneyContext";
import { readActivityReport, recordGenerationResolved, recordGenerationSubmitted, recordVideoAvailability } from "./repositories/activityJourney";
import { getDb } from "./repositories/runtime";

vi.mock("./repositories/runtime", () => ({ getDb: vi.fn() }));

const bounds = activityBounds("2026-11-22", "2026-11-22");
const makeEvent = (input: Partial<ReportEvent>): ReportEvent => ({
  platform: "web", category: "unclassified", userId: 1,
  eventName: "generation.submitted", result: "none", subjectKind: "image",
  subjectRef: null, visitKey: "synthetic-visit", attemptKey: "synthetic-task",
  occurredAtMs: bounds.start, ...input,
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("synthetic activity cohort", () => {
  it("uses half-open Beijing dates and obtains cross-midnight outcomes from the same attempt", () => {
    expect(new Date(bounds.start).toISOString()).toBe("2026-11-21T16:00:00.000Z");
    expect(new Date(bounds.end).toISOString()).toBe("2026-11-22T16:00:00.000Z");
    const events = [
      makeEvent({ eventName: "creation.entered", attemptKey: null, subjectKind: null }),
      makeEvent({}),
      makeEvent({}),
      makeEvent({ attemptKey: "second", occurredAtMs: bounds.end }),
      makeEvent({ eventName: "generation.resolved", result: "succeeded", subjectRef: 3, occurredAtMs: bounds.end + 1 }),
      makeEvent({ eventName: "generation.resolved", result: "succeeded", subjectRef: 4, occurredAtMs: bounds.end + 1 }),
      makeEvent({ eventName: "result.opened", subjectRef: 3, occurredAtMs: bounds.end + 2 }),
      makeEvent({ eventName: "result.opened", subjectRef: 4, occurredAtMs: bounds.end + 3 }),
      makeEvent({ eventName: "generation.submitted", attemptKey: "too-early", occurredAtMs: bounds.start - 1 }),
      makeEvent({ userId: 2, platform: "unknown", category: "test" }),
    ];
    const rows = aggregateActivity(events, bounds.start, bounds.end);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({
      enteredAccounts: 1, entries: 1, enteredThenSubmittedAccounts: 1,
      enteredThenSubmittedAttempts: 2, submittedAttempts: 1, succeededAttempts: 1,
      openedAttempts: 1, entryToSubmitAccountRate: 1, successAttemptRate: 1,
    });
    expect(rows.find(row => row.platform === "unknown" && row.category === "test")?.submittedAttempts).toBe(1);
  });

  it("attributes cross-midnight entry conversion to the recorded account and tab only", () => {
    const events = [
      makeEvent({ eventName: "creation.entered", attemptKey: null, subjectKind: null, occurredAtMs: bounds.end - 1 }),
      makeEvent({ attemptKey: "same-tab", occurredAtMs: bounds.end }),
      makeEvent({ attemptKey: "different-tab", visitKey: "other-tab", occurredAtMs: bounds.end }),
      makeEvent({ attemptKey: "different-account", userId: 2, occurredAtMs: bounds.end }),
      makeEvent({ attemptKey: "before-entry", occurredAtMs: bounds.end - 2 }),
    ];
    expect(aggregateActivity(events, bounds.start, bounds.end)[0]).toMatchObject({
      enteredAccounts: 1, enteredThenSubmittedAccounts: 1,
      enteredThenSubmittedAttempts: 1, submittedAttempts: 1,
    });
  });

  it.each([
    ["2026-11-22T23:15:00.000+08:00", "2026-11-22T23:15:00.000+08:00"],
    ["2026-12-23T00:00:00.000+08:00", "2026-12-22T23:59:59.999+08:00"],
  ])("queries through the earlier inclusive cutoff at %s", async (now, cutoff) => {
    const query = vi.fn(async (_query: { sql: string }, _params: unknown[]) => [[], []]);
    const db = drizzle({ client: { query } as unknown as ReturnType<typeof drizzle>["$client"] });
    vi.mocked(getDb).mockResolvedValueOnce(db);
    const report = await readActivityReport({ from: "2026-11-22", through: "2026-11-22" }, Date.parse(now));
    expect(report.observedThrough).toBe(cutoff);
    const cohort = query.mock.calls.find(([request]) => request.sql.includes("left join"));
    expect(cohort?.[0].sql).toMatch(/`occurredAtMs` <= \?/);
    expect(cohort?.[1]).toContain(Date.parse(cutoff));
  });

  it("does not count another task or account as a view and keeps pending, cancel, timeout and unknown separate", () => {
    const events = [
      ...["ok", "bad", "cancel", "slow", "unknown", "pending"].map(attemptKey => makeEvent({ attemptKey })),
      ...([
        ["ok", "succeeded"], ["bad", "failed"], ["cancel", "cancelled"],
        ["slow", "timeout"], ["unknown", "unknown"], ["cancel", "timeout"],
      ] as const).map(([attemptKey, result], index) => makeEvent({
        eventName: "generation.resolved", attemptKey, result,
        subjectRef: result === "succeeded" ? 3 : null, occurredAtMs: bounds.start + index + 1,
      })),
      makeEvent({ eventName: "result.opened", attemptKey: "ok", userId: 2, subjectRef: 3, occurredAtMs: bounds.end }),
      makeEvent({ eventName: "result.opened", attemptKey: "ok", subjectRef: 9, occurredAtMs: bounds.end }),
      makeEvent({ eventName: "result.opened", attemptKey: "ok", subjectRef: 3, occurredAtMs: bounds.start }),
    ];
    const rows = aggregateActivity(events, bounds.start, bounds.end, { platform: "web", category: "unclassified" });
    expect(rows).toEqual([expect.objectContaining({
      submittedAccounts: 1, submittedAttempts: 6, succeededAttempts: 1, failedAttempts: 1,
      cancelledAttempts: 1, timeoutAttempts: 1, unknownAttempts: 1, pendingAttempts: 1,
      openedAttempts: 0, successAttemptRate: 1 / 6, resolvedSuccessAttemptRate: 0.5,
      successToOpenAttemptRate: 0, entryToSubmitAccountRate: null,
    })]);
    const csv = activityReportCsv({
      schemaVersion: 2, enabled: false, firstRecordedAt: null, observedThrough: "2026-11-23T00:00:00.000+08:00",
      from: "2026-11-22", through: "2026-11-22", rows,
    });
    expect(csv).toContain("submittedAttempts");
    expect(csv).not.toMatch(/userId|visitKey|subjectRef|attemptKey|synthetic-task/);
  });
});

it("closes the event and query schemas to unknown values, identifiers and wide windows", () => {
  expect(activitySignal.safeParse({ eventName: "generation.resolved" }).success).toBe(false);
  expect(activitySignal.safeParse({ eventName: "creation.entered", platform: "web" }).success).toBe(false);
  expect(activitySignal.safeParse({ eventName: "result.opened", subjectKind: "image", subjectRef: 1, userId: 4 }).success).toBe(false);
  expect(activityWindow.safeParse({ from: "2026-10-01", through: "2026-11-22" }).success).toBe(false);
  expect(activityWindow.safeParse({ from: "2026-11-23", through: "2026-11-22" }).success).toBe(false);
});

it("attributes an authenticated same-origin website mutation only while enabled", () => {
  const origin = "https://synthetic.example";
  vi.stubEnv("APP_ORIGIN", origin);
  const headers = { origin, "sec-fetch-site": "same-origin", [ACTIVITY_VISIT_HEADER]: randomUUID() };
  expect(readActivityWebVisit(4, headers)).toBeUndefined();
  vi.stubEnv("ACTIVITY_JOURNEY_ENABLED", "true");
  expect(readActivityWebVisit(4, headers)).toMatchObject({ userId: 4, visitKey: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(readActivityWebVisit(4, { ...headers, origin: "https://synthetic-mini.example" })).toBeUndefined();
  expect(readActivityWebVisit(4, { ...headers, "sec-fetch-site": "cross-site" })).toBeUndefined();
  expect(readActivityWebVisit(4, { ...headers, [ACTIVITY_VISIT_HEADER]: "synthetic text" })).toBeUndefined();
  expect(readActivityWebVisit(undefined, headers)).toBeUndefined();
});

it("makes zero storage calls while disabled and swallows analytics failure without logging raw errors", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const failure = new Error("synthetic raw database error");
  vi.mocked(getDb).mockRejectedValue(failure);
  const action = () => activityWebVisit.run({ userId: 4, visitKey: "synthetic" }, () =>
    recordGenerationSubmitted(4, "image", "uuid"));
  await expect(action()).resolves.toBeUndefined();
  expect(getDb).not.toHaveBeenCalled();
  vi.stubEnv("ACTIVITY_JOURNEY_ENABLED", "true");
  await expect(action()).resolves.toBeUndefined();
  await expect(recordGenerationResolved(4, "image", "uuid", "failed")).resolves.toBeUndefined();
  await expect(recordVideoAvailability(null)).resolves.toBeUndefined();
  expect(getDb).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls).toEqual(Array.from({ length: 2 }, () => ["[activity-journey] event write unavailable"]));
});
