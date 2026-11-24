import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  accountId: 48 as number | null,
  states: [] as any[],
  cursor: 0,
  effects: [] as Array<() => void>,
  jobs: new Map<string, any>(),
  mutate: vi.fn(),
  refetch: vi.fn(),
  settings: {
    revision: 71, totalFrames: 2058, aspectRatio: "9:16",
    subtitleTracks: [{ id: "en", name: "English" }, { id: "zh", name: "中文" }],
  },
}));
const scope = ({ accountId, storyId }: { accountId: number; storyId: number }) => `${accountId}:${storyId}`;
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.states)) h.states[i] = initial;
    return [h.states[i], (next: any) => { h.states[i] = typeof next === "function" ? next(h.states[i]) : next; }];
  },
  useEffect: (effect: () => void) => { h.effects.push(effect); },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ creationAgent: { timelineExportStatus: {
      setData: (input: Parameters<typeof scope>[0], data: unknown) => h.jobs.set(scope(input), data),
    } } }),
    creationAgent: {
      startTimelineExport: { useMutation: () => ({ mutateAsync: h.mutate }) },
      timelineExportStatus: { useQuery: (input: Parameters<typeof scope>[0]) => ({
        data: h.jobs.get(scope(input)), refetch: h.refetch,
      }) },
      timelineExportSettings: { useQuery: () => ({ data: h.settings, refetch: h.refetch }) },
    },
  },
}));
vi.mock("@/features/nayin/NayinContext", () => ({ useNayin: () => ({ visualTheme: "default" }) }));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({ useUiText: () => (text: string) => text }));
vi.mock("@/features/storyAgent/spine/storySpine", () => ({ useStorySpine: (select: any) => select({ accountId: h.accountId }) }));

import { Dialog } from "@/components/ui/dialog";
import { ExportButton } from "./ExportTimelineButton";
import { readExportReceipt, exportReceiptKey } from "./exportReceipt";

function render(storyId = 1217, pendingStoryRequestId: number | null = null) {
  h.cursor = 0;
  h.effects = [];
  return ExportButton({ storyId, pendingStoryRequestId });
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
const panel = (tree = render()) => nodes(tree).find(n => n.type === Dialog);
const button = (name: string) => nodes(render()).find(n => typeof n.props?.onClick === "function" && React.Children.toArray(n.props.children).includes(name));
const receipt = { storyId: 1217, videoUrl: "/api/videos/export-1217-123.mp4", durationSec: 68.6, mediaDiagnostics: ["No picture"] };

beforeEach(() => {
  h.accountId = 48;
  h.states = [];
  h.jobs.clear();
  h.mutate.mockReset().mockResolvedValue({ status: "running", stage: "preparing" });
  h.refetch.mockReset().mockResolvedValue(undefined);
  const data = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  } });
});
afterEach(() => vi.unstubAllGlobals());

it("waits for explicit confirmation and sends the selected settings and displayed revision", async () => {
  panel().props.onOpenChange(true);
  expect(panel().props.open).toBe(true);
  expect(h.mutate).not.toHaveBeenCalled();
  const change = (index: number, value: string) => nodes(render()).filter(n => n.type === "select")[index].props.onChange({ target: { value } });
  change(0, "16:9");
  change(1, "720");
  change(2, "track:zh");
  button("取消").props.onClick();
  expect(panel().props.open).toBe(false);
  expect(h.mutate).not.toHaveBeenCalled();

  panel().props.onOpenChange(true);
  change(0, "16:9");
  change(1, "720");
  change(2, "track:zh");
  button("开始导出").props.onClick();
  await Promise.resolve();
  expect(h.mutate).toHaveBeenCalledOnce();
  expect(h.mutate).toHaveBeenCalledWith({
    storyId: 1217, accountId: 48, expectedRevision: 71,
    targetAspectRatio: "16:9", resolution: 720, subtitleTrackIds: ["zh"],
  });
});

it("keeps late results scoped to the initiating account and story and restores the saved receipt", async () => {
  panel().props.onOpenChange(true);
  button("开始导出").props.onClick();
  await Promise.resolve();
  h.accountId = 49;
  h.jobs.set("48:1217", { status: "ok", ...receipt });
  render();
  h.effects.forEach(effect => effect());
  expect(readExportReceipt(window.sessionStorage, exportReceiptKey(49, 1217), 1217)).toBeNull();
  expect(panel().props.open).toBe(false);

  h.accountId = 48;
  render();
  h.effects.forEach(effect => effect());
  expect(readExportReceipt(window.sessionStorage, exportReceiptKey(48, 1217), 1217)).toEqual(receipt);
  expect(nodes(render(1218)).find(n => n.props?.receipt?.videoUrl)).toBeUndefined();
  h.jobs.clear();
  h.states = [];
  render();
  h.effects.forEach(effect => effect());
  expect(nodes(render()).find(n => n.props?.receipt?.videoUrl).props.receipt).toEqual(receipt);
  expect(nodes(render(1217, 1218)).find(n => n.props?.["data-tour"] === "export").props.disabled).toBe(true);
});

it("shows the actual failing stage and requires confirmation again on retry", async () => {
  panel().props.onOpenChange(true);
  button("开始导出").props.onClick();
  await Promise.resolve();
  h.jobs.set("48:1217", { status: "error", stage: "media", error: "FFmpeg timed out" });
  const tree = nodes(render());
  expect(tree.find(n => n.props?.["aria-current"] === "step")?.props.children).toContain("合成音频与字幕");
  expect(tree.find(n => n.props?.role === "alert")?.props.children).toBe("FFmpeg timed out");
  panel().props.onOpenChange(false);
  panel().props.onOpenChange(true);
  button("重试").props.onClick();
  expect(h.refetch).toHaveBeenCalledOnce();
  expect(h.mutate).toHaveBeenCalledOnce();
  expect(button("开始导出")).toBeTruthy();
});

it("keeps the toolbar compact and makes real warnings available on demand", () => {
  const silent = "视频 primary:review-take-1651:take-1651 本身没有音轨，已安全跳过原声";
  h.jobs.set("48:1217", { status: "ok", ...receipt, mediaDiagnostics: [silent] });
  render();
  h.effects.forEach(effect => effect());
  expect(nodes(render()).some(n => n.props?.["aria-label"] === "导出提醒")).toBe(false);

  h.jobs.set("48:1217", { status: "ok", ...receipt, mediaDiagnostics: [silent, "No picture"] });
  render();
  h.effects.forEach(effect => effect());
  const toolbar = nodes(render()).find(n => n.props?.role === "status");
  expect(nodes(toolbar).some(n => n.props?.children === "No picture")).toBe(false);
  nodes(toolbar).find(n => n.props?.["aria-label"] === "导出提醒").props.onClick();
  expect(nodes(render()).some(n => n.props?.children === "No picture")).toBe(true);
  expect(nodes(render()).some(n => n.props?.children === silent)).toBe(false);
});
