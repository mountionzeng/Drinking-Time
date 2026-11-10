import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  slots: [] as any[],
  cursor: 0,
  data: null as any,
  save: vi.fn(),
  convert: vi.fn(),
  adopt: vi.fn(),
  edit: vi.fn(),
  restore: vi.fn(),
  create: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("react", async load => ({
  ...(await load<typeof import("react")>()),
  useEffect: () => {},
  useState: (initial: any) => {
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
    const index = api.cursor++;
    return (api.slots[index] ??= { current: initial });
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    bookWorkflow: {
      get: { useQuery: () => ({ data: api.data, refetch: api.refetch }) },
      ...Object.fromEntries(
        ["save", "convert", "adopt", "edit", "restore"].map(name => [
          name,
          { useMutation: () => ({ mutateAsync: api[name as "save"] }) },
        ])
      ),
    },
    chapters: { create: { useMutation: () => ({ mutateAsync: api.create }) } },
  },
}));
import { BookWorkflowControls } from "./BookWorkflowControls";
vi.stubGlobal("React", React);
const beforeChange = vi.fn(),
  onSelect = vi.fn(),
  onChanged = vi.fn();
let nodes: Array<{ type: string; props: any }>;
function render(kind: "text" | "storyboard" = "text") {
  api.cursor = 0;
  nodes = [];
  const original = React.createElement;
  const spy = vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    if (typeof type === "string")
      nodes.push({ type, props: { ...props, children } });
    return original(type, props, ...children);
  }) as typeof React.createElement);
  try {
    return renderToStaticMarkup(
      <BookWorkflowControls
        storyId={1}
        accountId={9}
        kind={kind}
        beforeChange={beforeChange}
        onSelect={onSelect}
        onChanged={onChanged}
      />
    );
  } finally {
    spy.mockRestore();
  }
}
function button(label: string) {
  return nodes.find(
    n =>
      n.type === "button" &&
      n.props.children.flat(Infinity).join("").includes(label)
  )!.props;
}
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
}
beforeEach(() => {
  vi.clearAllMocks();
  api.slots = [];
  api.data = {
    preferredKind: "text",
    state: { versions: [], conversions: [], current: {} },
    drafts: {
      text: { count: 1, dirty: true, fingerprint: "a".repeat(64) },
      storyboard: { count: 0, dirty: true, fingerprint: "b".repeat(64) },
    },
  };
  api.refetch.mockImplementation(async () => ({ data: api.data }));
  api.save.mockResolvedValue({ id: "saved-text" });
  beforeChange.mockResolvedValue(undefined);
  onChanged.mockResolvedValue(undefined);
  vi.stubGlobal("localStorage", { getItem: () => null });
});
it("flushes writing before switching manuscript and preserves selection on save failure", async () => {
  render();
  button("分镜版").onClick();
  await settle();
  expect(beforeChange).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith("storyboard");
  onSelect.mockClear();
  beforeChange.mockRejectedValueOnce(new Error("未保存"));
  render();
  button("分镜版").onClick();
  await settle();
  expect(onSelect).not.toHaveBeenCalled();
  expect(render()).toContain("未保存");
});
it("saves the source before purpose-driven conversion and never adopts automatically", async () => {
  render();
  button("作品版本与转换").onClick();
  render();
  for (const [index, value] of ["介绍产品", "朋友", "朋友圈"].entries()) {
    render();
    nodes
      .filter(n => n.type === "input")
      [index].props.onChange({ target: { value } });
  }
  render();
  button("保存并转为").onClick();
  await settle();
  expect(api.save).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "text",
      expectedFingerprint: "a".repeat(64),
    })
  );
  expect(api.convert).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceId: "saved-text",
      target: "storyboard",
      intent: { purpose: "介绍产品", audience: "朋友", platform: "朋友圈" },
    })
  );
  expect(api.adopt).not.toHaveBeenCalled();
});
it("recovers orphaned local preview edits with a copyable backup and explicit discard", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        id: "old-draft",
        revision: 2,
        values: [["尚未保存的文案"]],
      }),
  });
  render();
  button("分镜版").onClick();
  await settle();
  expect(onSelect).not.toHaveBeenCalled();
  render();
  button("作品版本与转换").onClick();
  expect(render()).toContain("尚未保存的文案");
  button("放弃本机预览修改").onClick();
  render();
  button("分镜版").onClick();
  await settle();
  expect(onSelect).toHaveBeenCalledWith("storyboard");
});
it("can start an empty storyboard without copying the text draft", async () => {
  render("storyboard");
  button("开始写").onClick();
  await settle();
  expect(api.create).toHaveBeenCalledWith({
    storyId: 1,
    kind: "storyboard",
    title: "第 1 场",
    body: "",
  });
});
