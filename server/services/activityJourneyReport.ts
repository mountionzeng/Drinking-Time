import {
  ACTIVITY_EVENTS, ACTIVITY_KINDS, ACTIVITY_PLATFORMS, ACTIVITY_RESULTS, type ActivityWindow,
} from "../../shared/activityJourney";
import { adminUserCategories, type AdminUserCategory } from "../../shared/adminUsers";

type Source = typeof ACTIVITY_PLATFORMS[number];
type Result = typeof ACTIVITY_RESULTS[number];
export type ReportEvent = {
  userId: number;
  platform: Source;
  category: AdminUserCategory;
  eventName: typeof ACTIVITY_EVENTS[number];
  result: Result;
  subjectKind: typeof ACTIVITY_KINDS[number] | null;
  subjectRef: number | null;
  visitKey: string | null;
  attemptKey: string | null;
  occurredAtMs: number;
};

export function aggregateActivity(
  events: ReportEvent[], start: number, end: number,
  filter: Pick<ActivityWindow, "platform" | "category"> = {},
) {
  const platforms = filter.platform ? [filter.platform] : ACTIVITY_PLATFORMS;
  const categories = filter.category ? [filter.category] : adminUserCategories;
  const byGroup = new Map<string, ReportEvent[]>();
  for (const event of events) {
    const key = event.platform + ":" + event.category;
    const group = byGroup.get(key) ?? [];
    group.push(event);
    byGroup.set(key, group);
  }
  return platforms.flatMap(platform => categories.map(category => ({
    platform, category, ...countGroup(byGroup.get(platform + ":" + category) ?? [], start, end),
  })));
}

function countGroup(events: ReportEvent[], start: number, end: number) {
  const visits = new Map<string, number>();
  const entered = new Set<number>();
  const submitted = new Set<number>();
  const fromEntry = new Set<number>();
  const succeeded = new Set<number>();
  const failed = new Set<number>();
  const opened = new Set<number>();
  const attempts = new Map<string, ReportEvent>();
  const entryCohortAttempts = new Set<string>();
  const submissions: ReportEvent[] = [];
  const laterEvents = new Map<string, ReportEvent[]>();
  for (const row of events) {
    const inCohort = row.occurredAtMs >= start && row.occurredAtMs < end;
    if (row.eventName === "creation.entered" && inCohort && row.visitKey) {
      entered.add(row.userId);
      const key = row.userId + ":" + row.visitKey;
      visits.set(key, Math.min(visits.get(key) ?? Infinity, row.occurredAtMs));
    } else if (row.attemptKey) {
      const key = row.userId + ":" + row.attemptKey;
      if (row.eventName === "generation.submitted") {
        submissions.push(row);
        if (inCohort) {
          const previous = attempts.get(key);
          if (!previous || previous.occurredAtMs > row.occurredAtMs) attempts.set(key, row);
        }
      } else if (row.eventName === "generation.resolved" || row.eventName === "result.opened") {
        const group = laterEvents.get(key) ?? [];
        group.push(row);
        laterEvents.set(key, group);
      }
    }
  }

  for (const row of submissions) {
    const entry = visits.get(row.userId + ":" + row.visitKey);
    if (entry !== undefined && entry <= row.occurredAtMs) {
      fromEntry.add(row.userId);
      entryCohortAttempts.add(row.userId + ":" + row.attemptKey);
    }
  }

  const outcomes = { succeeded: 0, failed: 0, cancelled: 0, timeout: 0, unknown: 0, pending: 0 };
  let imageAttempts = 0;
  let videoAttempts = 0;
  let openedAttempts = 0;
  for (const [key, attempt] of attempts) {
    submitted.add(attempt.userId);
    if (attempt.subjectKind === "image") imageAttempts++;
    if (attempt.subjectKind === "video") videoAttempts++;
    const evidence = (laterEvents.get(key) ?? []).filter(row =>
      row.occurredAtMs >= attempt.occurredAtMs && row.subjectKind === attempt.subjectKind);
    const resolved = evidence.filter(row => row.eventName === "generation.resolved");
    const successes = resolved.filter(row => row.result === "succeeded" && row.subjectRef !== null);
    if (successes.length) {
      outcomes.succeeded++;
      succeeded.add(attempt.userId);
      if (evidence.some(row => row.eventName === "result.opened" &&
          successes.some(result => row.subjectRef === result.subjectRef && row.occurredAtMs >= result.occurredAtMs))) {
        openedAttempts++;
        opened.add(attempt.userId);
      }
      continue;
    }
    const terminal = resolved.filter(row => row.result === "failed" || row.result === "cancelled");
    const latest = (terminal.length ? terminal : resolved).sort((a, b) => b.occurredAtMs - a.occurredAtMs ||
      ACTIVITY_RESULTS.indexOf(b.result) - ACTIVITY_RESULTS.indexOf(a.result))[0]?.result;
    if (latest === "failed" || latest === "cancelled" || latest === "timeout" || latest === "unknown") {
      outcomes[latest]++;
      if (latest === "failed") failed.add(attempt.userId);
    } else {
      outcomes.pending++;
    }
  }

  return {
    enteredAccounts: entered.size, entries: visits.size,
    enteredThenSubmittedAccounts: fromEntry.size, enteredThenSubmittedAttempts: entryCohortAttempts.size,
    submittedAccounts: submitted.size, submittedAttempts: attempts.size, imageAttempts, videoAttempts,
    succeededAccounts: succeeded.size, succeededAttempts: outcomes.succeeded,
    failedAccounts: failed.size, failedAttempts: outcomes.failed,
    cancelledAttempts: outcomes.cancelled, timeoutAttempts: outcomes.timeout,
    unknownAttempts: outcomes.unknown, pendingAttempts: outcomes.pending,
    openedAccounts: opened.size, openedAttempts,
    entryToSubmitAccountRate: rate(fromEntry.size, entered.size),
    successAttemptRate: rate(outcomes.succeeded, attempts.size),
    resolvedSuccessAttemptRate: rate(outcomes.succeeded, outcomes.succeeded + outcomes.failed),
    successToOpenAttemptRate: rate(openedAttempts, outcomes.succeeded),
  };
}

function rate(count: number, denominator: number) {
  return denominator ? count / denominator : null;
}

export function activityReportCsv(report: {
  schemaVersion: number; from: string; through: string; observedThrough: string;
  firstRecordedAt: string | null; enabled: boolean; rows: ReturnType<typeof aggregateActivity>;
}) {
  const { rows, ...metadata } = report;
  // All values are server-defined enums, validated dates, numbers or booleans.
  const body = rows.map(row => ({ ...metadata, ...row }));
  return [Object.keys(body[0]).join(","), ...body.map(row => Object.values(row).join(","))].join("\r\n") + "\r\n";
}
