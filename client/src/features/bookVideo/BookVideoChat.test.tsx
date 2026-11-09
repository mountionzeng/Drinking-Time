import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { BookVideoRecord } from "@shared/bookVideoCreation";
const api = vi.hoisted(() => ({
  records: [] as BookVideoRecord[],
  generate: vi.fn(),
  adopt: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  mediaInvalidate: vi.fn().mockResolvedValue(undefined),
  prepare: vi.fn(),
  clear: vi.fn(),
  flush: vi.fn(),
  organize: vi.fn(),
  workflow: vi.fn(),
  refresh: vi.fn(),
  propose: vi.fn(),
  effects: [] as Array<() => unknown>,
  organizeFirst: true,
  activeStoryId: 1,
  workspace: null as any,
  edit: vi.fn(),
  stateful: false,
  slots: [] as any[],
  cursor: 0,
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => unknown) => {
      api.effects.push(effect);
    },
    useState: (initial: any) => {
      if (!api.stateful)
        return actual.useState(initial === true ? api.organizeFirst : initial);
      const index = api.cursor++;
      if (!(index in api.slots))
        api.slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        api.slots[index],
        (value: any) => {
          api.slots[index] =
            typeof value === "function" ? value(api.slots[index]) : value;
        },
      ];
    },
    useRef: (initial: any) => {
      if (!api.stateful) return actual.useRef(initial);
      const index = api.cursor++;
      return (api.slots[index] ??= { current: initial });
    },
  };
});
vi.mock("./BookVideoWorkspace", () => ({
  useBookVideoWorkspace: () => api.workspace,
}));
vi.mock("react-dom", async importOriginal => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (node: React.ReactNode) => node,
}));
vi.mock("./BookVideoStartButton", () => ({ BookVideoStartButton: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      bookWorkflow: { get: { fetch: api.workflow } },
      bookVideo: { list: { invalidate: api.invalidate } },
      storyAgent: { storyMaterialState: { invalidate: api.mediaInvalidate } },
    }),
    bookVideo: {
      prepareManuscript: {
        useMutation: () => ({ mutateAsync: api.organize, isPending: false }),
      },
      list: {
        useQuery: () => ({ data: { records: api.records, images: {} } }),
      },
      propose: {
        useMutation: () => ({ mutateAsync: api.propose, isPending: false }),
      },
      generate: {
        useMutation: () => ({ mutateAsync: api.generate, isPending: false }),
      },
      adopt: {
        useMutation: () => ({ mutateAsync: api.adopt, isPending: false }),
      },
      edit: {
        useMutation: () => ({ mutateAsync: api.edit, isPending: false }),
      },
    },
  },
}));
vi.mock("./bookPreparation", () => ({
  prepareBookForVideo: api.prepare,
  prepareMountedBook: api.flush,
  refreshPreparedBook: api.refresh,
}));
vi.mock("./bookVideoSession", () => ({
  useBookVideoSession: { getState: () => ({ setSession: api.clear }) },
}));
vi.mock("@/features/storyAgent/spine/storySpine", () => ({
  storySpineStore: {
    getState: () => ({ activeStoryId: api.activeStoryId, accountId: 9 }),
  },
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: () => null,
  DialogContent: () => null,
  DialogHeader: () => null,
  DialogTitle: () => null,
}));
import { BookVideoChat } from "./BookVideoChat";
import { clearReviewDraft, readReviewDraft } from "./bookVideoReviewDraft";
const record = {
  id: "record1",
  versionId: "v1",
  createdAt: 1,
  revision: 1,
  request: "5秒，全景和特写",
  layout: { body: "纸船", illustrations: [] },
  status: "proposed",
  bookSource: true,
  brief: {
    purpose: "测试",
    audience: "全年龄",
    tone: "温柔",
    duration: "5秒",
    narration: "无旁白",
    music: "水声",
    useBookMusic: false,
    reuse: "原图",
    changes: "两镜头",
    question: "是否采用建议？",
  },
} as BookVideoRecord;
beforeEach(() => {
  vi.clearAllMocks();
  clearReviewDraft(1, 9);
  api.workspace = null;
  api.stateful = false;
  api.slots = [];
  api.cursor = 0;
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", new EventTarget());
  api.records = [record];
  api.generate.mockResolvedValue({
    ...record,
    preview: { shots: [] },
    status: "ready",
  });
  api.adopt.mockResolvedValue({});
  api.effects = [];
  api.workflow.mockResolvedValue({ drafts: { storyboard: { version: { id: "board-v1" }, dirty: false } } });
  api.organizeFirst = true;
  api.activeStoryId = 1;
  api.organize.mockResolvedValue({
    chapters: [{ id: 3, version: 5 }],
    shotCount: 2,
    changed: true,
  });
  api.propose.mockResolvedValue(record);
});
function render(onAdopt = vi.fn().mockResolvedValue(undefined)) {
  api.cursor = 0;
  return renderToStaticMarkup(
    <BookVideoChat
      storyId={1}
      accountId={9}
      epoch={1}
      session={null}
      handle={{ current: null }}
      onAdopt={onAdopt}
    />
  );
}
it("keeps the confirmation and conditions visible after discussion is closed", () => {
  const html = render();
  expect(html).toContain("视频制作下一步");
  expect(html).toContain("确认方向，整理分镜");
  expect(html).toContain("5秒");
  expect(html).toContain("全年龄");
  expect(html).not.toContain("结束讨论");
});
it("direction confirmation prepares a preview without adopting or navigating", async () => {
  let click!: () => void;
  const create = React.createElement;
  const spy = vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    if (type === "button" && children.includes("确认方向，整理分镜"))
      click = props.onClick;
    return create(type, props, ...children);
  }) as typeof React.createElement);
  const onAdopt = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn();
  window.addEventListener("dt:creation-flow-focus", navigate);
  render(onAdopt);
  click();
  await vi.waitFor(() => expect(api.invalidate).toHaveBeenCalledOnce());
  expect(api.generate).toHaveBeenCalledWith({
    storyId: 1,
    id: "record1",
    confirmBrief: true,
  });
  expect(api.adopt).not.toHaveBeenCalled();
  expect(api.prepare).toHaveBeenCalledWith(1, 9);
  expect(navigate).not.toHaveBeenCalled();
  expect(onAdopt).not.toHaveBeenCalled();
  spy.mockRestore();
});
it("labels confirmed V1 and leaves an entry back into the timeline", () => {
  api.records = [
    {
      ...record,
      status: "adopted",
      videoVersion: 1,
      preview: { shots: [] } as any,
    },
  ];
  const html = render();
  expect(html).toContain("视频 V1 · 已确认");
  expect(html).toContain("进入视频表格");
});

it("opens the timeline without waiting on a slow media refresh", async () => {
  api.records = [
    {
      ...record,
      status: "adopted",
      videoVersion: 1,
      preview: { shots: [] } as any,
    },
  ];
  api.mediaInvalidate.mockImplementationOnce(() => new Promise(() => {}));
  let click!: () => void;
  const create = React.createElement;
  const spy = vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    if (type === "button" && children.includes("进入视频表格"))
      click = props.onClick;
    return create(type, props, ...children);
  }) as typeof React.createElement);
  const onAdopt = vi.fn().mockResolvedValue(undefined);
  render(onAdopt);
  click();
  await vi.waitFor(() => expect(onAdopt).toHaveBeenCalledOnce());
  expect(api.mediaInvalidate).toHaveBeenCalledWith({ storyId: 1 });
  spy.mockRestore();
});

it("opens an adopted video without waiting for history to refresh", async () => {
  api.records = [
    {
      ...record,
      status: "adopted",
      videoVersion: 3,
      preview: { shots: [] } as any,
    },
  ];
  api.invalidate.mockImplementationOnce(() => new Promise(() => {}));
  let click!: () => void;
  const create = React.createElement;
  const spy = vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    if (type === "button" && children.includes("进入视频表格"))
      click = props.onClick;
    return create(type, props, ...children);
  }) as typeof React.createElement);
  const onAdopt = vi.fn().mockResolvedValue(undefined);
  try {
    render(onAdopt);
    click();
    await vi.waitFor(() => expect(onAdopt).toHaveBeenCalledOnce());
    expect(api.generate).not.toHaveBeenCalled();
    expect(api.adopt).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

function openSession() {
  api.cursor = 0;
  api.effects = [];
  const handle: React.MutableRefObject<
    import("./BookVideoChat").BookVideoChatHandle | null
  > = { current: null };
  renderToStaticMarkup(
    <BookVideoChat
      storyId={1}
      accountId={9}
      epoch={1}
      session={{
        storyId: 1,
        accountId: 9,
        epoch: 1,
        versionId: "v1",
        layout: record.layout,
      }}
      handle={handle}
      onAdopt={vi.fn()}
    />
  );
  api.effects.forEach(effect => effect());
  return handle.current!;
}
it("flushes live writing and checks the confirmed storyboard before proposing", async () => {
  expect(await openSession().submit("把修伞的故事做成视频")).toBe(true);
  expect(api.flush).toHaveBeenCalledWith(1, 9);
  expect(api.organize).not.toHaveBeenCalled();
  expect(api.workflow).toHaveBeenCalledWith({ storyId: 1 });
  expect(api.flush.mock.invocationCallOrder[0]).toBeLessThan(api.workflow.mock.invocationCallOrder[0]);
  expect(api.workflow.mock.invocationCallOrder[0]).toBeLessThan(api.propose.mock.invocationCallOrder[0]);
  expect(api.generate).not.toHaveBeenCalled(); expect(api.adopt).not.toHaveBeenCalled();
});
it("cannot bypass the storyboard confirmation when no version exists", async () => {
  api.workflow.mockResolvedValueOnce({ drafts: { storyboard: { version: null, dirty: false } } });
  expect(await openSession().submit("直接讨论视频")).toBe(false);
  expect(api.propose).not.toHaveBeenCalled();
});
it("preserves the request when the storyboard has unsaved version changes", async () => {
  api.workflow.mockResolvedValueOnce({ drafts: { storyboard: { version: { id: "v1" }, dirty: true } } });
  expect(await openSession().submit("整理")).toBe(false);
  expect(api.propose).not.toHaveBeenCalled();
});
it("never proposes into another story after source checks finish", async () => {
  api.workflow.mockImplementationOnce(async () => { api.activeStoryId = 2; return { drafts: { storyboard: { version: { id: "v1" }, dirty: false } } }; });
  await openSession().submit("整理");
  expect(api.propose).not.toHaveBeenCalled();
});

const preview = {
  shots: [
    {
      draftShotId: "shot-1",
      subject: "纸船",
      durationSec: 4,
      speaker: "旁白",
      voiceText: "一条小船",
      action: "顺水前行",
      videoRequirement: "固定镜头",
      soundRequirement: "河水声",
      imageRequirement: "沿用原图",
      scriptText: "一条小船",
    },
  ],
} as NonNullable<BookVideoRecord["preview"]>;
function desktop() {
  api.stateful = true;
  api.workspace = {
    host: {},
    view: "plan",
    openReview: vi.fn(),
    showEditing: vi.fn(),
    discuss: vi.fn(),
  };
  api.records = [{ ...record, status: "ready", revision: 4, preview }];
}
function capture() {
  const nodes: Array<{ type: any; props: any; children: any[] }> = [];
  const original = React.createElement;
  const spy = vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    nodes.push({ type, props, children });
    return original(type, props, ...children);
  }) as typeof React.createElement);
  return {
    nodes,
    spy,
    button: (label: string) =>
      nodes.find(
        node => node.type === "button" && node.children.includes(label)
      )!.props,
    field: (label: string) =>
      nodes.find(node => node.props?.["aria-label"] === label)!.props,
    redraw: () => {
      nodes.length = 0;
      return render();
    },
  };
}
it("shows the latest review in the desktop video surface without generation or adoption", () => {
  desktop();
  const html = render();
  expect(html).toContain("逐镜分镜稿");
  expect(html).toContain("一条小船");
  expect(html).toContain("尚未采用到视频");
  expect(api.generate).not.toHaveBeenCalled();
  expect(api.adopt).not.toHaveBeenCalled();
});
it("the chat entry opens the same desktop review without purchasing or adopting", () => {
  desktop();
  const ui = capture();
  try {
    ui.redraw();
    ui.button("打开方案与参数").onClick();
    expect(api.workspace.openReview).toHaveBeenCalledOnce();
    expect(api.generate).not.toHaveBeenCalled();
    expect(api.adopt).not.toHaveBeenCalled();
  } finally {
    ui.spy.mockRestore();
  }
});
it("keeps unsaved text across workspace views, prevents adoption, and saves against its original revision", async () => {
  desktop();
  const ui = capture();
  try {
    ui.redraw();
    ui.field("镜头1台词/字幕").onChange({ target: { value: "小船回家了" } });
    api.workspace.view = "editing";
    ui.redraw();
    api.workspace.view = "plan";
    ui.redraw();
    expect(ui.field("镜头1台词/字幕").value).toBe("小船回家了");
    expect(ui.field("分镜方案版本").disabled).toBe(true);
    expect(ui.button("确认人物、台词和背景音，进入视频").disabled).toBe(true);
    api.records = [{ ...api.records[0], revision: 5 }];
    ui.redraw();
    ui.button("保存方案修改").onClick();
    await vi.waitFor(() =>
      expect(api.edit).toHaveBeenCalledWith({
        storyId: 1,
        id: "record1",
        revision: 4,
        shots: [expect.objectContaining({ voiceText: "小船回家了" })],
      })
    );
    expect(api.adopt).not.toHaveBeenCalled();
  } finally {
    ui.spy.mockRestore();
  }
});
it("retains the draft and adoption lock if a save conflicts with a newer revision", async () => {
  desktop();
  api.edit.mockRejectedValueOnce(new Error("方案已更新，请重新确认"));
  const ui = capture();
  try {
    ui.redraw();
    ui.field("镜头1台词/字幕").onChange({ target: { value: "保留我的修改" } });
    ui.redraw();
    ui.button("保存方案修改").onClick();
    await vi.waitFor(() => expect(api.edit).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 0));
    const html = ui.redraw();
    expect(html).toContain("方案已更新，请重新确认");
    expect(ui.field("镜头1台词/字幕").value).toBe("保留我的修改");
    expect(ui.button("确认人物、台词和背景音，进入视频").disabled).toBe(true);
  } finally {
    ui.spy.mockRestore();
  }
});
it("confirmed plans are read-only and opening the editor does not re-adopt the snapshot", async () => {
  desktop();
  api.records = [{ ...record, status: "adopted", videoVersion: 2, preview }];
  const ui = capture();
  try {
    const html = ui.redraw();
    expect(html).toContain("当前剪辑以「剪辑与预览」为准");
    expect(ui.field("镜头1台词/字幕").disabled).toBe(true);
    ui.button("进入视频表格").onClick();
    await vi.waitFor(() =>
      expect(api.workspace.showEditing).toHaveBeenCalledOnce()
    );
    expect(api.adopt).not.toHaveBeenCalled();
    expect(api.generate).not.toHaveBeenCalled();
  } finally {
    ui.spy.mockRestore();
  }
});

it("restores an unsaved review when returning to its story, without exposing it to another account or story", () => {
  desktop();
  const ui = capture();
  try {
    ui.redraw();
    ui.field("镜头1台词/字幕").onChange({
      target: { value: "返回后继续编辑" },
    });
    expect(readReviewDraft(2, 9)).toBeUndefined();
    expect(readReviewDraft(1, 10)).toBeUndefined();
    api.slots = [];
    ui.redraw();
    expect(ui.field("镜头1台词/字幕").value).toBe("返回后继续编辑");
    ui.button("取消修改").onClick();
    ui.redraw();
    expect(ui.field("镜头1台词/字幕").value).toBe("一条小船");
    expect(readReviewDraft(1, 9)).toBeUndefined();
    expect(api.edit).not.toHaveBeenCalled();
    expect(api.adopt).not.toHaveBeenCalled();
  } finally {
    ui.spy.mockRestore();
  }
});

it("does not create a new chat plan over unsaved review text", async () => {
  desktop();
  const ui = capture();
  try {
    ui.redraw();
    ui.field("镜头1台词/字幕").onChange({ target: { value: "还没保存" } });
    expect(await openSession().submit("继续修改视频")).toBe(false);
    expect(api.propose).not.toHaveBeenCalled();
    expect(api.organize).not.toHaveBeenCalled();
    expect(readReviewDraft(1, 9)?.preview.shots[0].voiceText).toBe("还没保存");
  } finally { ui.spy.mockRestore(); }
});
