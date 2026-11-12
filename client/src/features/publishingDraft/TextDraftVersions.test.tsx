import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPublishingDraftState } from "@shared/publishingDraft";
import { TextDraftVersions } from "./TextDraftVersions";

vi.stubGlobal("React", React);
const fixture = vi.hoisted(() => ({
  publishing: null as ReturnType<typeof emptyPublishingDraftState> | null,
  writingBody: null as string | null,
  error: false,
  pending: false,
  mutate: vi.fn(),
}));
vi.mock("@/features/writingCompanion/desktopWritingSession", () => ({
  useDesktopWritingSession: (selector: (state: unknown) => unknown) => selector({
    session: fixture.writingBody === null ? null : {
      storyId: 1, accountId: null, epoch: 0, snapshot: { draft: fixture.writingBody },
    },
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    bookWorkflow: { videoSource: { useQuery: () => ({ data: { available: false } }) } },
    textSourceLineage: {
      impact: { useQuery: () => ({ data: { current: null } }) },
    },
    textDrafts: {
      read: {
        useQuery: () => ({
          data: { revision: 0, versions: [] },
          isError: fixture.error,
        }),
      },
      generate: {
        useMutation: () => ({
          isPending: fixture.pending,
          mutateAsync: fixture.mutate,
        }),
      },
      adopt: { useMutation: () => ({ isPending: false }) },
      setLearning: { useMutation: () => ({ isPending: false }) },
    },
  },
}));
vi.mock("@/features/storyAgent/StoryAgentContext", () => ({
  useStoryAgent: () => ({
    publishing: fixture.publishing ?? emptyPublishingDraftState(),
    publishingBuffers: {},
    messages: [],
  }),
  useStoryAgentActions: () => ({}),
}));

beforeEach(() => {
  fixture.publishing = null;
  fixture.writingBody = null;
  fixture.error = false;
  fixture.pending = false;
  fixture.mutate.mockClear();
});
describe("book toolbar generation controller", () => {
  it.each([null, "书中的现有正文"])("does not add a duplicate generation button below chat (%s)", writingBody => {
    fixture.writingBody = writingBody;
    const html = renderToStaticMarkup(<TextDraftVersions storyId={1} input="补充" blocked={false} />);
    expect(html).not.toContain("生成新版本");
    expect(html).not.toContain("生成文章");
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it("still exposes history-load failures without silently discarding history", () => {
    fixture.error = true;
    const html = renderToStaticMarkup(<TextDraftVersions storyId={1} input="" blocked={false} />);
    expect(html).toContain("文字历史读取失败，点击重试");
  });
});
