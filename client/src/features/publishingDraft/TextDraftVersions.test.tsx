import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPublishingDraftState, upsertPublishingPlatformDraft } from "@shared/publishingDraft";
import { TextDraftVersions } from "./TextDraftVersions";

vi.stubGlobal("React", React);
const fixture = vi.hoisted(() => ({
  publishing: null as ReturnType<typeof emptyPublishingDraftState> | null,
  error: false,
  pending: false,
  mutate: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
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
  fixture.error = false;
  fixture.pending = false;
  fixture.mutate.mockClear();
});
describe("independent text version controls", () => {
  it("offers a new version for pasted text even without AI version history", () => {
    fixture.publishing = upsertPublishingPlatformDraft(emptyPublishingDraftState(), {
      platform: "xiaohongshu", content: { title: "", body: "手写正文", tags: [] }, activate: true,
    });
    const html = renderToStaticMarkup(<TextDraftVersions storyId={1} input="继续修改" blocked={false} />);
    expect(html).toContain("生成新版本");
    expect(html).not.toContain("生成文章");
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it("renders one compact generation entry without taking over the composer", () => {
    const html = renderToStaticMarkup(
      <TextDraftVersions storyId={1} input="新的补充" blocked={false} />
    );
    expect(html).toContain("生成文章");
    expect(html).not.toContain("继续补充，准备好再生成。");
    expect(html).not.toContain("文字版本");
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it("disables generation while the chat is busy", () => {
    const html = renderToStaticMarkup(
      <TextDraftVersions storyId={1} input="" blocked />
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
    expect(html).toContain("生成文章");
  });
  it("shows a retry affordance instead of treating unreadable history as empty", () => {
    fixture.error = true;
    const html = renderToStaticMarkup(
      <TextDraftVersions storyId={1} input="" blocked={false} />
    );
    expect(html).toContain("文字历史读取失败，点击重试");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
  });
});
