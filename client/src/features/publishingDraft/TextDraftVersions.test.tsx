import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPublishingDraftState } from "@shared/publishingDraft";
import { TextDraftVersions } from "./TextDraftVersions";

vi.stubGlobal("React", React);
const fixture = vi.hoisted(() => ({
  error: false,
  pending: false,
  mutate: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
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
    publishing: emptyPublishingDraftState(),
    publishingBuffers: {},
    messages: [],
  }),
  useStoryAgentActions: () => ({}),
}));

beforeEach(() => {
  fixture.error = false;
  fixture.pending = false;
  fixture.mutate.mockClear();
});
describe("independent text version controls", () => {
  it("renders one compact generation entry without taking over the composer", () => {
    const html = renderToStaticMarkup(
      <TextDraftVersions storyId={1} input="新的补充" blocked={false} />
    );
    expect(html).toContain("生成文稿");
    expect(html).not.toContain("继续补充，准备好再生成。");
    expect(html).not.toContain("文字版本");
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it("disables generation while the chat is busy", () => {
    const html = renderToStaticMarkup(
      <TextDraftVersions storyId={1} input="" blocked />
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
    expect(html).toContain("生成文稿");
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
