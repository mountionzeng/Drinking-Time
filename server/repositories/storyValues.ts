/** Persistence operations for storyValues. Local and MySQL behavior share this boundary. */
import { StoryBody } from "../../drizzle/schema";

export function emptyBody(): StoryBody {
  return { cards: [], characters: [], shots: [] };
}

export function persistedStoryBodyRevision(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const revision = (body as Record<string, unknown>)._revision;
  return typeof revision === "number" &&
    Number.isInteger(revision) &&
    revision >= 0
    ? revision
    : 0;
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function revisionOf(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const value = (body as Record<string, unknown>)._revision;
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}
