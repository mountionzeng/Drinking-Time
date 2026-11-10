import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  data: null as any,
  save: vi.fn(),
  export: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    videoWorkflow: {
      get: { useQuery: () => ({ data: api.data, refetch: api.refetch }) },
      save: { useMutation: () => ({ mutateAsync: api.save }) },
      export: { useMutation: () => ({ mutateAsync: api.export }) },
    },
  },
}));
vi.mock("@/features/bookVideo/BookVideoStartButton", () => ({
  BookVideoStartButton: () => <button>规划新视频</button>,
}));
import { VideoWorkflowControls } from "./VideoWorkflowControls";
vi.stubGlobal("React", React);
beforeEach(() => {
  vi.clearAllMocks();
  api.data = {
    bookUpdated: true,
    source: { number: 3 },
    state: {
      versions: [
        {
          id: "video-1",
          number: 1,
          name: "产品介绍",
          createdAt: 123,
          author: { name: "作者" },
          confirmedBy: { name: "作者" },
          intent: { purpose: "产品介绍", audience: "朋友", platform: "朋友圈" },
          summary: "短版",
          textSource: { number: 2 },
          manuscriptSource: { number: 3 },
          material: { timeline: { items: [{}] } },
          shots: [{ subject: "旧镜头", action: "原动作" }],
          exports: [],
        },
      ],
    },
  };
});
it("shows exact source ancestry and prompts a new plan without mutating the old video", () => {
  const html = renderToStaticMarkup(
    <VideoWorkflowControls storyId={1} disabled={false} />
  );
  expect(html).toContain("文字版 V2 → 分镜版 V3");
  expect(html).toContain("旧镜头");
  expect(html).toContain("规划新视频");
  expect(api.save).not.toHaveBeenCalled();
  expect(api.export).not.toHaveBeenCalled();
});
it("exports the chosen immutable version ID", async () => {
  const original = React.createElement;
  let exportButton: any;
  const spy = vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    if (type === "button" && children.includes("导出此版本"))
      exportButton = props;
    return original(type, props, ...children);
  }) as typeof React.createElement);
  try {
    renderToStaticMarkup(
      <VideoWorkflowControls storyId={1} disabled={false} />
    );
  } finally {
    spy.mockRestore();
  }
  exportButton.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(api.export).toHaveBeenCalledWith(
    expect.objectContaining({ storyId: 1, id: "video-1", aspectRatio: "16:9" })
  );
  expect(api.save).not.toHaveBeenCalled();
});
