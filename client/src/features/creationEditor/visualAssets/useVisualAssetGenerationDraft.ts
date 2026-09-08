import { useEffect, useState } from "react";

type Draft = { instructions: Record<string, string>; topViews: Record<string, boolean> };
const empty = (): Draft => ({ instructions: {}, topViews: {} });
const key = (storyId: number) => `visual-asset-generation-draft:${storyId}`;

export function readVisualAssetGenerationDraft(storyId: number | null): Draft {
  if (storyId == null || typeof localStorage === "undefined") return empty();
  try {
    const value = JSON.parse(localStorage.getItem(key(storyId)) ?? "{}");
    const draft = empty();
    for (const [id, instruction] of Object.entries(value?.instructions ?? {})) {
      if (typeof instruction === "string") draft.instructions[id] = instruction.slice(0, 2000);
    }
    for (const [id, include] of Object.entries(value?.topViews ?? {})) {
      if (typeof include === "boolean") draft.topViews[id] = include;
    }
    return draft;
  } catch { return empty(); }
}

/** Local, story-scoped composer draft, never authority for facts, quotes or adoption. */
export function useVisualAssetGenerationDraft(storyId: number | null) {
  const [state, setState] = useState(() => ({ storyId, ...readVisualAssetGenerationDraft(storyId) }));
  useEffect(() => {
    setState({ storyId, ...readVisualAssetGenerationDraft(storyId) });
  }, [storyId]);
  useEffect(() => {
    if (storyId == null || state.storyId !== storyId) return;
    try { localStorage.setItem(key(storyId), JSON.stringify(state)); } catch { /* private mode */ }
  }, [state, storyId]);
  const current = state.storyId === storyId ? state : empty();
  return {
    ...current,
    setInstructions: (update: (previous: Draft["instructions"]) => Draft["instructions"]) =>
      setState(previous => ({ ...previous, instructions: update(previous.instructions) })),
    setTopViews: (update: (previous: Draft["topViews"]) => Draft["topViews"]) =>
      setState(previous => ({ ...previous, topViews: update(previous.topViews) })),
  };
}
