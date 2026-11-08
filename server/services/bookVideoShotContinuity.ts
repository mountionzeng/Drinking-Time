import type { PublishingVideoStoryboardShot } from "../../shared/publishingVideoStoryboard";

type Shot = PublishingVideoStoryboardShot;
const lines = (shot: Shot) =>
  new Set(
    shot.scriptText
      .split("\n")
      .map(text => text.replace(/[*#]/g, "").trim())
      .filter(text => text.length >= 8)
  );

/** Match only mutual, unique source ownership. Display order alone is never identity. */
export function matchBookVideoShots(next: Shot[], previous: Shot[]) {
  const result = new Map<string, Shot>();
  const used = new Set<string>();
  const match = (predicate: (a: Shot, b: Shot) => boolean) => {
    const candidates = next
      .filter(a => !result.has(a.draftShotId))
      .map(a => ({
        a,
        matches: previous.filter(
          b => !used.has(b.draftShotId) && predicate(a, b)
        ),
      }));
    for (const { a, matches } of candidates) {
      if (
        matches.length !== 1 ||
        candidates.filter(c => c.matches.includes(matches[0])).length !== 1
      )
        continue;
      result.set(a.draftShotId, matches[0]);
      used.add(matches[0].draftShotId);
    }
  };
  match(
    (a, b) =>
      a.draftShotId === b.draftShotId &&
      (a.sourceModuleIds?.length && b.sourceModuleIds?.length
        ? a.sourceModuleIds.some(id => b.sourceModuleIds!.includes(id))
        : !a.draftShotId.startsWith("book-scene-") ||
          [...lines(a)].some(text => lines(b).has(text)))
  );
  match((a, b) =>
    Boolean(a.sourceModuleIds?.some(id => b.sourceModuleIds?.includes(id)))
  );
  // Older saved previews predate module provenance. Exact retained source lines
  // can bridge the transition, but reused captions / split or merged shots cannot.
  match(
    (a, b) =>
      !a.supplementReason &&
      !b.supplementReason &&
      (!a.sourceModuleIds?.length || !b.sourceModuleIds?.length) &&
      [...lines(a)].some(text => lines(b).has(text))
  );
  return result;
}

function params(value: unknown): Record<string, any> {
  try {
    const result = typeof value === "string" ? JSON.parse(value) : value;
    return result && typeof result === "object" && !Array.isArray(result)
      ? result
      : {};
  } catch {
    return {};
  }
}

/** Keep user frame choices; update book references without resurrecting removals. */
export function inheritBookFrameParameters(
  current: unknown,
  baseline: unknown,
  generated: unknown
) {
  const old = params(current),
    before = params(baseline),
    next = params(generated);
  const ids = (value: unknown): number[] =>
    Array.isArray(value)
      ? value.filter(id => Number.isSafeInteger(id) && id > 0)
      : [];
  const beforeRefs = ids(before.referenceFrameImageIds),
    nextRefs = ids(next.referenceFrameImageIds);
  const currentRefs = Array.isArray(old.referenceFrameImageIds)
    ? ids(old.referenceFrameImageIds)
    : beforeRefs;
  const references = [
    ...new Set([
      ...currentRefs.filter(
        id => !beforeRefs.includes(id) || nextRefs.includes(id)
      ),
      ...nextRefs.filter(id => !beforeRefs.includes(id)),
    ]),
  ];
  return JSON.stringify({
    ...next,
    ...old,
    referenceFrameImageIds: references,
    storyboardFrameRoles: {
      ...params(next.storyboardFrameRoles),
      ...params(old.storyboardFrameRoles),
      referenceImageIds: references,
    },
  });
}
