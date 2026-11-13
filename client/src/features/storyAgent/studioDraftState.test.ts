import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  scope: { accountId: 1, storyScopeEpoch: 1 },
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => void) => m.effects.push(effect),
}));
vi.mock("./spine/storySpine", () => ({
  storySpineStore: { getState: () => m.scope },
}));
import { hasPendingStudioDraft, useStudioDraftState } from "./studioDraftState";
let cleanup: Array<() => void>;
beforeEach(() => {
  m.effects = [];
  cleanup = [];
  m.scope = { accountId: 1, storyScopeEpoch: 1 };
});
afterEach(() => cleanup.forEach(fn => fn()));
const mount = (story: number | null, pending: boolean) => {
  useStudioDraftState(story, pending);
  const dispose = m.effects.pop()!();
  if (dispose) cleanup.push(dispose);
  return dispose as () => void;
};
it("tracks all editors and never confuses account, story or scope", () => {
  const first = mount(7, true);
  mount(7, false);
  expect(hasPendingStudioDraft(1, 7, 1)).toBe(true);
  expect(hasPendingStudioDraft(2, 7, 1)).toBe(false);
  expect(hasPendingStudioDraft(1, 8, 1)).toBe(false);
  expect(hasPendingStudioDraft(1, 7, 2)).toBe(false);
  first();
  expect(hasPendingStudioDraft(1, 7, 1)).toBe(false);
});
it("ignores unsaved new story identities and cleans up on editor departure", () => {
  mount(null, true);
  mount(-1, true);
  expect(hasPendingStudioDraft(1, -1, 1)).toBe(false);
  const dispose = mount(7, true);
  dispose();
  expect(hasPendingStudioDraft(1, 7, 1)).toBe(false);
});
