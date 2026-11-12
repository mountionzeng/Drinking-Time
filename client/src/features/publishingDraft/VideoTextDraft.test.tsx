import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { VideoTextDraft } from "./VideoTextDraft";
const api = vi.hoisted(() => ({
  prepare: vi.fn(),
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
      quoteVideoText: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      generateVideoText: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      adopt: { useMutation: () => ({ mutateAsync: api.adopt }) },
      edit: { useMutation: () => ({ mutateAsync: api.edit }) },
      get: {
        useQuery: () => ({
          data: { state: { conversions: [draft] } },
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
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
