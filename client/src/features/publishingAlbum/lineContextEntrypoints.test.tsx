import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ states: [] as any[], cursor: 0, refs: [] as any[], refCursor: 0, mutation: vi.fn(), dispatch: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState(initial: any) { const i = mock.cursor++; if (!(i in mock.states)) mock.states[i] = typeof initial === "function" ? initial() : initial; return [mock.states[i], (next: any) => { mock.states[i] = typeof next === "function" ? next(mock.states[i]) : next; }]; },
    useRef(initial: any) { const i = mock.refCursor++; return mock.refs[i] ?? (mock.refs[i] = { current: initial }); },
    useEffect() {}, useImperativeHandle() {}, useMemo: (fn: () => any) => fn(),
  };
});
vi.mock("./useLayoutOperationMemory", () => ({ useLayoutOperationMemory: () => ({ context: null, record: vi.fn(), travel: vi.fn() }) }));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({ useUiText: () => (text: string) => text }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({}),
  textDrafts: { revise: { useMutation: () => ({ mutateAsync: mock.mutation }) } },
  memoryWarehouse: { revise: { useMutation: () => ({ mutateAsync: mock.mutation }) } },
} }));
import { ImagePackModuleEditor } from "./ImagePackModuleEditor";
import { ModuleCompanionContext } from "./ModuleSelectionBridge";
import { newTextModule, newImageModule } from "./imagePackModules";
import { MobileSyncedEditor } from "../mobileWorkspace/MobileSyncedEditor";
import { mobileWritingContext } from "../mobileWorkspace/mobileMemoryFollowup";
import { lineContextMessage } from "../../../../server/services/writingCompanion";

function nodes(node: any): any[] { if (!node || typeof node !== "object") return []; return Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function renderEditor(extra: any = {}) {
  mock.cursor = mock.refCursor = 0;
  return ImagePackModuleEditor({ options: {} as any, scope: "chapter-a", initial: null, sourceChanged: false, onApply: vi.fn(), onClose: vi.fn(), companion: { storyId: 7, active: true }, mobile: true, ...extra });
}
const bridge = (tree: any) => nodes(tree).find(node => node.type === ModuleCompanionContext);
beforeEach(() => {
  mock.states = []; mock.refs = []; mock.cursor = mock.refCursor = 0; vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { dispatchEvent: mock.dispatch });
  vi.stubGlobal("document", { createElement: () => ({ toDataURL: () => "data:image/jpeg;base64,AAAA" }) });
});

it("layout editor clicks select the repeated module, clear on page/source change, and feed the existing chat bridge", () => {
  mock.states[0] = { draw: vi.fn(), measure: () => 20 };
  const a = newTextModule("a", "重复", () => 20), b = newTextModule("b", "重复", () => 20);
  const photo = newImageModule("photo", "/private.png", { width: 400, height: 400 });
  mock.states[1] = { past: [], present: { version: 1, pages: [{ label: "一", modules: [a, photo, b] }, { label: "二", modules: [] }] }, future: [] };
  let tree = renderEditor();
  expect(bridge(tree)).toBeUndefined();
  nodes(tree).find(node => node.props?.["data-module-id"] === "b").props.onClick();
  tree = renderEditor();
  expect(bridge(tree).props.context.line.position).toMatchObject({ text: "重复", index: 1, total: 2 });
  const desktop = ModuleCompanionContext({ ...bridge(tree).props, mobile: false }) as React.ReactElement<any>;
  expect(desktop.props.getSnapshot().module.line.position.index).toBe(1);
  expect(mock.dispatch).not.toHaveBeenCalled();
  expect(mock.mutation).not.toHaveBeenCalled();
  nodes(tree).find(node => node.props?.["aria-label"] === "编辑第 2 页：二").props.onClick();
  expect(bridge(renderEditor())).toBeUndefined();
  mock.states[2] = 0; mock.states[3] = "b";
  expect(bridge(renderEditor({ sourceChanged: true }))).toBeUndefined();
});

it("mobile text editor carries the real selection and unsaved body into the existing companion without saving", () => {
  const draft = { kind: "text" as const, id: "v2", token: "token", title: "标题", content: "甲\n重复\n\n重复\n尾", baseTitle: "标题", baseContent: "甲", tags: [] };
  const update = vi.fn();
  const tree = MobileSyncedEditor({ storyId: 7, editor: { draft, update, storageError: false, open: vi.fn() }, onTextSaved: vi.fn() });
  const textarea = nodes(tree).find(node => node.type === "textarea");
  textarea.props.ref.current = { selectionStart: 7, selectionEnd: 9 };
  const button = nodes(tree).find(node => node.props?.children === "小忆");
  expect(mock.dispatch).not.toHaveBeenCalled();
  button.props.onClick();
  const source = mock.dispatch.mock.calls[0][0].detail;
  const context = mobileWritingContext(source)!;
  expect(context).toMatchObject({ draft: draft.content, cursor: 7, selection: { start: 7, end: 9 } });
  expect(lineContextMessage(context, true)).toContain("第 3 行（共 4 行）");
  expect(update).not.toHaveBeenCalled();
  expect(mock.mutation).not.toHaveBeenCalled();
});
