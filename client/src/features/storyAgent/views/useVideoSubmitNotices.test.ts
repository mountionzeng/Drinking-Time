import { beforeEach, afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ accountId: 48 as number | null, state: undefined as any, effects: [] as Array<() => void> }));
vi.mock("react", () => ({
  useState: (init: () => unknown) => {
    h.state ??= init();
    return [h.state, (update: any) => { h.state = typeof update === "function" ? update(h.state) : update; }];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => h.effects.push(effect),
}));
vi.mock("../spine/storySpine", () => ({ useStorySpine: (select: (state: { accountId: number | null }) => unknown) => select({ accountId: h.accountId }) }));
import { useVideoSubmitNotices } from "./useVideoSubmitNotices";
import { readVideoSubmitNotices } from "./videoSubmitNotice";

beforeEach(() => {
  h.accountId = 48; h.state = undefined; h.effects = [];
  const values = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
});
afterEach(() => vi.unstubAllGlobals());

it("hides the former account immediately and binds delayed responses to their submitter", () => {
  const a = useVideoSubmitNotices(); h.effects.pop()!();
  a.recordVideoSubmitNotice("1:s3", "A private error");
  expect(useVideoSubmitNotices().videoSubmitNotices).toHaveLength(1);
  h.accountId = 49;
  const b = useVideoSubmitNotices();
  expect(b.videoSubmitNotices).toEqual([]);
  h.effects.pop()!();
  b.recordVideoSubmitNotice("1:s3", "B private error");
  a.recordVideoSubmitNotice("1:s4", "A late response");
  expect(useVideoSubmitNotices().videoSubmitNotices).toEqual([{ key: "1:s3", reason: "B private error" }]);
  expect(readVideoSubmitNotices(48, window.sessionStorage)).toHaveLength(2);
  a.recordVideoSubmitNotice("1:s3", null);
  expect(useVideoSubmitNotices().videoSubmitNotices).toEqual([{ key: "1:s3", reason: "B private error" }]);
  h.accountId = null;
  expect(useVideoSubmitNotices().videoSubmitNotices).toEqual([]);
});
