import React from "react";
import { DEFAULT_TIMELINE_TRANSFORM } from "@shared/storyMaterial";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// This repo has no DOM test runtime. Execute the real handlers and dependency-
// tracked effects across renders; the live browser separately verifies DOM/focus.
const h = vi.hoisted(() => ({ active: null as any }));
vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  const memo = (factory: () => any, deps?: any[]) => {
    const host = h.active; const index = host.index++;
    const old = host.slots[index];
    if (!old || !deps || deps.some((d, i) => !Object.is(d, old.deps?.[i]))) {
      host.slots[index] = { value: factory(), deps };
    }
    return host.slots[index].value;
  };
  const effect = (fn: () => any, deps?: any[]) => {
    const host = h.active;
    memo(() => { host.effects.push(fn); }, deps);
  };
  return { ...real, useMemo: memo, useCallback: (fn: any, deps: any[]) => memo(() => fn, deps),
    useRef: (value: any) => memo(() => ({ current: value }), []),
    useState: (initial: any) => {
      const host = h.active; const slot = memo(() => ({ value: typeof initial === "function" ? initial() : initial }), []);
      return [slot.value, (next: any) => { const value = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; host.dirty = true; } }];
    }, useEffect: effect, useLayoutEffect: effect,
  };
});
vi.mock("@/features/uiLanguage/UiLanguage", () => ({
  useUiText: () => (key: string, values: unknown[] = []) => key.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)])),
}));
import { StoryboardEditRow, type StoryboardEditShot, type StoryboardBoardTimeline } from "./StoryboardEditRow";
import { StoryboardVisualLayerRow } from "./StoryboardVisualLayerRow";
import { EditingConfirmationDialog } from "../EditingConfirmationDialog";

function host() {
  const state = { slots: [] as any[], index: 0, effects: [] as any[], cleanups: [] as any[], dirty: false };
  return { render(component: () => any) {
    let tree: any; let count = 0;
    do {
      if (++count > 20) throw new Error("render did not settle");
      state.index = 0; state.dirty = false; h.active = state; tree = component();
      state.effects.splice(0).forEach(fn => { const cleanup = fn(); if (cleanup) state.cleanups.push(cleanup); });
    } while (state.dirty);
    return tree;
  }, dispose: () => state.cleanups.reverse().forEach(fn => fn()) };
}
function nodes(tree: any): any[] { return !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
const hosts: ReturnType<typeof host>[] = [];
const createHost = () => { const next = host(); hosts.push(next); return next; };
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("window", new EventTarget()); vi.stubGlobal("document", { activeElement: null }); });
afterEach(() => { hosts.splice(0).forEach(item => item.dispose()); vi.unstubAllGlobals(); });

function setup() {
  let selectedShotNo: number | null = 1;
  let shots: StoryboardEditShot[] = [1, 2].map((shotNo, i) => ({
    shotNo, shotLabel: `0${shotNo}`, stableShotId: `s${shotNo}`, posterUrl: null,
    extractedFrames: i === 1 ? [{ id: "image-99", imageId: 99, imageUrl: "/99.png", atMs: 3000 }] : [],
    timing: { stableShotId: `s${shotNo}`, shotNo, position: i, startMs: i * 2000, endMs: (i + 1) * 2000,
      durationMs: 2000, startFrame: i * 60, durationFrames: 60, visualLayer: 0, stackOrder: 0, anchorFrames: [] },
    timelineItem: { stableShotId: `s${shotNo}`, position: i, timelineStartFrame: i * 60, durationFrames: 60, included: true, plannedDurationMs: 2000, transform: DEFAULT_TIMELINE_TRANSFORM,
      imageClips: i === 1 ? [{ id: "v2-99", imageId: 99, imageUrl: "/99.png", label: "Frame 99", offsetFrames: 30, timelineStartFrame: 90, durationFrames: 1, visualLayer: 1 }] : [] },
  }));
  const remove = vi.fn().mockResolvedValue(undefined);
  const timeline: StoryboardBoardTimeline = { storySessionKey: "story-1", playheadMs: 0, isPlaying: false, totalMs: 4000, audioClips: [], selectedRange: null,
    canSplitAt: () => true, canExtractAt: () => true, onTogglePlay: vi.fn(), onSelectRange: vi.fn(), onTrimShotDuration: vi.fn(), onSplitAt: vi.fn(), onExtractFrameAt: vi.fn(), onReorderShot: vi.fn(),
    onSeek: (ms: number) => { timeline.playheadMs = ms; selectedShotNo = 2; },
    onDeleteSelectedVisualObjects: remove, onVisualObjectCommand: vi.fn(),
  };
  const row = createHost(), layer = createHost();
  const render = () => row.render(() => StoryboardEditRow({ timeline, shots, selectedShotNo, onSelectShot: no => { selectedShotNo = no; }, columnSpan: 2 }));
  const v2 = (tree = render()) => nodes(tree).find(n => n.type === StoryboardVisualLayerRow && n.props.visualLayer === 1);
  const clickImage = () => {
    const tree = layer.render(() => StoryboardVisualLayerRow(v2().props));
    nodes(tree).find(n => n.props["data-visual-object-id"] === "v2-99").props.onClick({ currentTarget: { focus: vi.fn() } });
    return render();
  };
  return { timeline, remove, render, v2, clickImage,
    visibleFrameCount: () => nodes(layer.render(() => StoryboardVisualLayerRow(v2().props)))
      .filter(n => n.props["data-testid"] === "storyboard-extracted-frame-99").length,
    refreshShots: () => { shots = shots.map(shot => ({ ...shot })); },
    removeImage: () => { shots = shots.map(shot => ({ ...shot, timelineItem: { ...shot.timelineItem!, imageClips: [] } })); },
    legacyClick: () => {
      shots = shots.map(shot => ({ ...shot, timelineItem: { ...shot.timelineItem!, imageClips: undefined },
        extractedFrames: shot.shotNo === 2 ? [{ id: "old", imageId: 88, imageUrl: "/88.png", atMs: 3000 }] : [] }));
      const tree = layer.render(() => StoryboardVisualLayerRow(v2().props));
      nodes(tree).find(n => n.props["data-testid"] === "storyboard-extracted-frame-88").props.onClick({ currentTarget: { focus: vi.fn() } });
      return render();
    },
    contextDelete: () => {
      const tree = layer.render(() => StoryboardVisualLayerRow(v2().props));
      nodes(tree).find(n => n.props["data-visual-object-id"] === "v2-99").props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { focus: vi.fn() }, clientX: 10, clientY: 20 });
      const menu = nodes(render()).find(n => typeof n.props.onPick === "function" && n.props.menu?.object?.type === "image-clip");
      menu.props.onPick("delete");
      return render();
    } };
}

it("keeps the clicked V2 image selected after seek selects its V1 owner and after data refresh", () => {
  const s = setup(); s.clickImage(); s.refreshShots();
  expect(s.v2().props.selectedVisualObject).toEqual({ type: "image-clip", clipId: "v2-99", ownerStableShotId: "s2" });
});
it("single-selection delete confirms the V2 clip and cancel writes nothing", async () => {
  const s = setup(); const tree = s.clickImage();
  const button = nodes(tree).find(n => n.props["data-testid"] === "delete-selected-visual-object");
  expect(button).toBeDefined(); button.props.onClick();
  let dialog = nodes(s.render()).find(n => n.type === EditingConfirmationDialog);
  expect(dialog.props.open).toBe(true); expect(dialog.props.title).toContain("V2");
  expect(s.remove).not.toHaveBeenCalled(); dialog.props.onCancel();
  expect(nodes(s.render()).find(n => n.type === EditingConfirmationDialog).props.open).toBe(false);
  expect(s.remove).not.toHaveBeenCalled();
  nodes(s.render()).find(n => n.props["data-testid"] === "delete-selected-visual-object").props.onClick();
  dialog = nodes(s.render()).find(n => n.type === EditingConfirmationDialog);
  await dialog.props.onConfirm();
  expect(s.remove).toHaveBeenCalledTimes(1);
  expect(s.remove).toHaveBeenCalledWith([{ type: "image-clip", clipId: "v2-99", ownerStableShotId: "s2" }], 1);
  expect(s.timeline.onVisualObjectCommand).not.toHaveBeenCalled();
});

it("keeps the V2 confirmation visible while saving and shows a failed save in the dialog", async () => {
  const s = setup();
  let rejectSave!: (error: Error) => void;
  s.remove.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectSave = reject; }));
  const button = nodes(s.clickImage()).find(n => n.props["data-testid"] === "delete-selected-visual-object");
  button.props.onClick();
  const dialog = () => nodes(s.render()).find(n => n.type === EditingConfirmationDialog).props;
  const save = dialog().onConfirm();
  expect(dialog()).toMatchObject({ open: true, pendingLabel: "正在删除…" });
  dialog().onConfirm();
  expect(s.remove).toHaveBeenCalledTimes(1);
  rejectSave(new Error("保存失败，请重试"));
  await save;
  expect(dialog()).toMatchObject({ open: true, error: "保存失败，请重试" });
  await dialog().onConfirm();
  expect(dialog().open).toBe(false);
  expect(s.remove).toHaveBeenCalledTimes(2);
});
it("a removed V2 selection clears without falling back to a destructive V1 target", () => {
  const s = setup(); s.clickImage(); s.removeImage();
  expect(s.v2().props.selectedVisualObject).toBeNull();
  expect(s.visibleFrameCount()).toBe(0);
});
it("an explicit V1 click can replace a V2 selection", () => {
  const s = setup(); s.clickImage();
  s.v2().props.onSelectVisualObject({ type: "story-shot", stableShotId: "s1", shotNo: 1 }, { focus: vi.fn() });
  expect(s.v2().props.selectedVisualObject).toEqual({ type: "story-shot", stableShotId: "s1", shotNo: 1 });
});

it("a true legacy extraction clears the edit target instead of selecting its V1 owner", () => {
  const s = setup(); s.legacyClick();
  expect(s.v2().props.selectedVisualObject).toBeNull();
  expect(s.remove).not.toHaveBeenCalled();
});
it("the V2 context menu uses the same scoped confirmation", () => {
  const s = setup();
  const dialog = nodes(s.contextDelete()).find(n => n.type === EditingConfirmationDialog);
  expect(dialog.props.open).toBe(true);
  expect(dialog.props.title).toContain("V2");
  expect(s.remove).not.toHaveBeenCalled();
  expect(s.timeline.onVisualObjectCommand).not.toHaveBeenCalled();
});
it("changing story clears the previous editing selection", () => {
  const s = setup(); s.clickImage(); s.timeline.storySessionKey = "story-2";
  expect(s.v2().props.selectedVisualObject).toBeNull();
});
