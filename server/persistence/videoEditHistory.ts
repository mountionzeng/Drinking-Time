import {
  readVideoEditHistory,
  VIDEO_EDIT_HISTORY_LIMIT,
  type VideoEditRevision,
} from "../../shared/videoEditHistory";
import {
  decodeStoredStoryTimeline,
  type StoredStoryTimelinePayload,
} from "./storyTimelinePersistence";

function snapshot(
  version: number,
  savedAt: number,
  body: unknown,
  timeline: StoredStoryTimelinePayload
): VideoEditRevision {
  const { videoEditHistory: _history, videoMediaVersions: _mediaHistory, ...extensions } =
    timeline.extensions ?? {};
  if (_mediaHistory) extensions.videoMediaVersionRefs = {
    ...(_mediaHistory as import("../../shared/videoMediaVersions").VideoMediaVersions).current,
  };
  const shots =
    body &&
    typeof body === "object" &&
    "shots" in body &&
    Array.isArray(body.shots)
      ? body.shots
      : [];
  return JSON.parse(
    JSON.stringify({
      version,
      savedAt,
      shots,
      timeline: { ...timeline, extensions },
    })
  );
}

/** Called only while Story/Timeline locks are held, committed in the same CAS. */
export function appendVideoEditRevision(input: {
  currentValue: unknown;
  currentVersion: number;
  previousStoryBody: unknown;
  nextStoryBody: unknown;
  next: StoredStoryTimelinePayload;
  savedAt: number;
}): StoredStoryTimelinePayload {
  const current = decodeStoredStoryTimeline(input.currentValue ?? []);
  const previous = snapshot(
    input.currentVersion,
    input.savedAt,
    input.previousStoryBody,
    current
  );
  const next = snapshot(
    input.currentVersion + 1,
    input.savedAt,
    input.nextStoryBody,
    input.next
  );
  const history = readVideoEditHistory(current.extensions?.videoEditHistory);
  const unchanged =
    JSON.stringify([previous.shots, previous.timeline]) ===
    JSON.stringify([next.shots, next.timeline]);
  if (unchanged)
    return {
      ...input.next,
      extensions: {
        ...input.next.extensions,
        ...(current.extensions?.videoEditHistory
          ? { videoEditHistory: current.extensions.videoEditHistory }
          : {}),
      },
    };
  // Capture the pre-edit state even when a legacy writer last changed the timeline.
  const revisions = [...history];
  if (revisions.at(-1)?.version !== previous.version) revisions.push(previous);
  revisions.push(next);
  return {
    ...input.next,
    extensions: {
      ...input.next.extensions,
      videoEditHistory: {
        schemaVersion: 1,
        revisions: revisions.slice(-VIDEO_EDIT_HISTORY_LIMIT),
      },
    },
  };
}
