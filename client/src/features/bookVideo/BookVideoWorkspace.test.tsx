import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  view: "plan",
  effects: [] as Array<() => unknown>,
  setView: vi.fn(),
  shots: [{ stableShotId: "shot-a" }] as unknown[],
}));
vi.mock("@/features/creationEditor/CreationEditorContext", () => ({
  useCreationEditor: () => ({ shots: state.shots }),
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => unknown) => {
      state.effects.push(effect);
    },
    useState: (initial: unknown) =>
      initial === "plan"
        ? [state.view, state.setView]
        : actual.useState(initial),
  };
});
import {
  BookVideoWorkspace,
  BookVideoWorkspaceProvider,
  useBookVideoWorkspace,
} from "./BookVideoWorkspace";
let actions: NonNullable<ReturnType<typeof useBookVideoWorkspace>>;
function Probe() {
  actions = useBookVideoWorkspace()!;
  return null;
}
const open = vi.fn();
function render(active = true, preferEditing = false) {
  return renderToStaticMarkup(
    <BookVideoWorkspaceProvider storyId={1} onOpen={open} onDiscuss={vi.fn()}>
      <Probe />
      <BookVideoWorkspace
        active={active}
        preferEditing={preferEditing}
        toolbar={<span>已有导出操作</span>}
        editor={(presentation, suspended) => (
          <span data-presentation={presentation} data-suspended={suspended}>
            原剪辑与播放界面
          </span>
        )}
      />
    </BookVideoWorkspaceProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.view = "plan";
  state.effects = [];
  state.shots = [{ stableShotId: "shot-a" }];
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", new EventTarget());
});

it("opens the live manuscript with the same editor controller mounted", () => {
  const html = render();
  expect(html).toContain("video-storyboard-manuscript");
  expect(html).toContain("分镜稿");
  expect(html).toContain("已有导出操作");
  expect(html).toContain("原剪辑与播放界面");
  expect(html).toContain(
    'data-presentation="manuscript" data-suspended="false"'
  );
});
it("shows the candidate review before formal shots exist and suspends hidden playback", () => {
  state.shots = [];
  expect(render()).toContain('data-suspended="true"');
});
it("keeps the draft host mounted while showing the original editor, and stops playback when leaving video", () => {
  state.view = "editing";
  const editing = render();
  expect(editing).toContain("原剪辑与播放界面");
  expect(editing).toContain("video-storyboard-manuscript");
  const book = render(false);
  expect(book).toContain("video-storyboard-manuscript");
  expect(book).not.toContain("原剪辑与播放界面");
});
it("opens the correct workspace from chat and preserves an explicit editor handoff", () => {
  render();
  actions.openReview();
  expect(state.setView).toHaveBeenCalledWith("plan");
  expect(open).toHaveBeenCalledOnce();
  actions.showEditing();
  expect(state.setView).toHaveBeenLastCalledWith("editing");
  render(true, true);
  state.effects.forEach(effect => effect());
  expect(state.setView).toHaveBeenLastCalledWith("editing");
});
it("only routes editor focus events for the current story", () => {
  render();
  const cleanups = state.effects.map(effect => effect());
  try {
    window.dispatchEvent(
      new CustomEvent("dt:creation-flow-focus", {
        detail: { storyId: 2, target: "editing" },
      })
    );
    expect(state.setView).not.toHaveBeenCalled();
    window.dispatchEvent(
      new CustomEvent("dt:creation-flow-focus", {
        detail: { storyId: 1, target: "editing" },
      })
    );
    expect(state.setView).toHaveBeenCalledWith("editing");
  } finally {
    cleanups.forEach(cleanup => {
      if (typeof cleanup === "function") cleanup();
    });
  }
});
