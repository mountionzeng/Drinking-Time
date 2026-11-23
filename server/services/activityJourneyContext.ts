import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { ACTIVITY_VISIT_HEADER, activityVisitId } from "../../shared/activityJourney";

type WebVisit = { userId: number; visitKey: string };

export const activityWebVisit = new AsyncLocalStorage<WebVisit | undefined>();

export function activityKey(...parts: (string | number)[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function activityJourneyEnabled() {
  return process.env.ACTIVITY_JOURNEY_ENABLED === "true";
}

export function readActivityWebVisit(
  userId: number | undefined,
  headers: Record<string, string | string[] | undefined> | undefined,
): WebVisit | undefined {
  const origin = process.env.APP_ORIGIN?.replace(/\/$/, "");
  if (!activityJourneyEnabled() || !userId || !origin ||
      headers?.origin !== origin || headers["sec-fetch-site"] !== "same-origin") return;
  const visit = activityVisitId.safeParse(headers[ACTIVITY_VISIT_HEADER]);
  if (visit.success) return { userId, visitKey: activityKey(userId, visit.data) };
}
