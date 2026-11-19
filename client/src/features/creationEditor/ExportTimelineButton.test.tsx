import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ accountId: 48 as number | null, states: [] as any[], cursor: 0, effects: [] as Array<() => void>, mutate: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.states)) h.states[i] = initial;
    return [h.states[i], (next: any) => { h.states[i] = typeof next === "function" ? next(h.states[i]) : next; }];
  },
  useEffect: (effect: () => void) => { h.effects.push(effect); },
}));
vi.mock("@/lib/trpc", () => ({ trpc: { creationAgent: { exportTimeline: { useMutation: () => ({ mutateAsync: h.mutate }) } } } }));
vi.mock("@/features/nayin/NayinContext", () => ({ useNayin: () => ({ visualTheme: "default" }) }));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({ useUiText: () => (text: string) => text, useUiLanguage: () => ({ language: "en" }) }));
vi.mock("@/features/storyAgent/spine/storySpine", () => ({ useStorySpine: (select: any) => select({ accountId: h.accountId }) }));
import { ExportButton } from "./ExportTimelineButton";
import { readExportReceipt, exportReceiptKey } from "./exportReceipt";
function render(storyId = 1217, pendingStoryRequestId: number | null = null) {
  h.cursor = 0;
  return ExportButton({ storyId, pendingStoryRequestId });
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
const links = (tree: any) => nodes(tree).filter(n => n.type === "a");
beforeEach(() => {
  h.accountId = 48; h.states = []; h.cursor = 0; h.effects = []; h.mutate.mockReset();
  const data = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
});
afterEach(() => vi.unstubAllGlobals());
it("keeps late exports with the initiating account/story and restores their download after remount", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  h.mutate.mockReturnValue(pending);
  nodes(render()).find(n => n.type === "button").props.onClick();
  expect(h.mutate).toHaveBeenCalledWith({ storyId: 1217, fallbackToLatestTake: false });
  h.accountId = 49;
  expect(links(render())).toEqual([]);
  const receipt = { storyId: 1217, videoUrl: "/api/videos/export-1217-123.mp4", durationSec: 68, mediaDiagnostics: ["No picture"] };
  finish({ status: "success", ...receipt }); await pending; await Promise.resolve();
  expect(links(render())).toEqual([]);
  expect(readExportReceipt(window.sessionStorage, exportReceiptKey(48, 1217), 1217)).toEqual(receipt);
  h.accountId = 48;
  expect(links(render(1218))).toEqual([]);
  expect(links(render())).toHaveLength(2);
  h.states = []; h.effects = [];
  render(); h.effects.forEach(effect => effect());
  expect(links(render()).map(n => n.props.href)).toEqual([receipt.videoUrl, receipt.videoUrl]);
  expect(nodes(render(1217, 1218)).find(n => n.type === "button").props.disabled).toBe(true);
});
it("does not show a late failure on another account", async () => {
  let fail!: (error: Error) => void;
  const pending = new Promise((_resolve, reject) => { fail = reject; });
  h.mutate.mockReturnValue(pending);
  nodes(render()).find(n => n.type === "button").props.onClick();
  h.accountId = 49; render(); fail(new Error("Private source unavailable"));
  await pending.catch(() => {}); await Promise.resolve();
  expect(nodes(render()).some(n => n.props?.role === "alert")).toBe(false);
  h.accountId = 48;
  expect(nodes(render()).find(n => n.props?.role === "alert").props.children).toBe("Private source unavailable");
});
