import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { VideoTextDraft } from "./VideoTextDraft";
const api = vi.hoisted(() => ({
  prepare: vi.fn(),
  quote: vi.fn(),
  generate: vi.fn(),
  conversions: [] as any[],
  refresh: vi.fn(),
  adopt: vi.fn(),
  edit: vi.fn(),
  done: vi.fn(),
  dispatch: vi.fn(),
}));
vi.stubGlobal("React", React);
vi.mock("@/features/storyAgent/spine/storySpine", () => ({
  storySpineStore: {
    getState: () => ({
      accountId: 48,
      activeStoryId: 1219,
      storyScopeEpoch: 0,
    }),
  },
}));
vi.mock("@/features/bookVideo/bookPreparation", () => ({
  prepareMountedBook: api.prepare,
  refreshPreparedBook: api.refresh,
}));
const draft = {
  id: "draft",
  revision: 2,
  source: { kind: "video" },
  target: "text",
  request: "原文",
  videoTextMethod: "local-transcript",
  status: "review",
  chapters: [{ title: "书稿", blocks: { body: "原片文字" } }],
};
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      chapters: {
        list: {
          invalidate: vi.fn(),
          fetch: async () => [{ id: 1, version: 3 }],
        },
        get: { invalidate: vi.fn() },
      },
      bookWorkflow: { get: { invalidate: vi.fn() } },
    }),
    bookWorkflow: {
      quoteVideoText: { useMutation: () => ({ mutateAsync: api.quote }) },
      generateVideoText: { useMutation: () => ({ mutateAsync: api.generate }) },
      adopt: { useMutation: () => ({ mutateAsync: api.adopt }) },
      edit: { useMutation: () => ({ mutateAsync: api.edit }) },
      get: {
        useQuery: () => ({
          data: { state: { conversions: api.conversions } },
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  api.conversions = [draft];
  api.quote.mockResolvedValue({
    method: "rewrite",
    unresolvedRequestIds: ["failed"],
  });
  vi.stubGlobal("window", { dispatchEvent: api.dispatch });
  vi.stubGlobal(
    "CustomEvent",
    class {
      constructor(
        public type: string,
        public init: unknown
      ) {}
    }
  );
});
it("loads the adopted version into the mounted book before closing the preview", async () => {
  let click!: () => void;
  const original = React.createElement;
  const capture = vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    if (type === "button" && String(children).includes("采用文字新版本"))
      click = props.onClick;
    return original(type, props, ...children);
  }) as typeof React.createElement);
  try {
    renderToStaticMarkup(
      <VideoTextDraft
        storyId={1219}
        request="原文"
        method="local-transcript"
        blocked={false}
        onDone={api.done}
      />
    );
    expect(click).toBeTypeOf("function");
    click();
    await vi.waitFor(() => expect(api.done).toHaveBeenCalledOnce());
    expect(api.adopt).toHaveBeenCalledWith({
      storyId: 1219,
      id: "draft",
      revision: 2,
    });
    expect(api.refresh).toHaveBeenCalledWith(1219, 48, [{ id: 1, version: 3 }]);
    expect(api.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      api.done.mock.invocationCallOrder[0]
    );
  } finally {
    capture.mockRestore();
  }
});

it("lets an old uncertain task obtain a new quote without submitting generation while retaining the old failure", async () => {
  api.conversions = [
    {
      ...draft,
      id: "failed",
      status: "failed",
      chapters: undefined,
      videoTextMethod: "rewrite",
      submissionUncertain: true,
      error: "旧任务响应中断",
    },
  ];
  let click!: () => void;
  let disabled: boolean | undefined;
  const original = React.createElement;
  const capture = vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    if (type === "button" && String(children).includes("生成文字")) {
      click = props.onClick;
      disabled = props.disabled;
    }
    return original(type, props, ...children);
  }) as typeof React.createElement);
  try {
    const html = renderToStaticMarkup(
      <VideoTextDraft
        storyId={1219}
        request="原文"
        blocked={false}
        onDone={api.done}
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("旧任务响应中断");
    expect(disabled).toBe(false);
    click();
    await vi.waitFor(() =>
      expect(api.quote).toHaveBeenCalledWith({
        storyId: 1219,
        request: "原文",
        method: "rewrite",
      })
    );
    expect(api.generate).not.toHaveBeenCalled();
  } finally {
    capture.mockRestore();
  }
});
