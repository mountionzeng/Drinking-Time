import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  storyId: 11 as number | null,
  list: vi.fn(),
  forStory: vi.fn(),
}));
vi.mock("@/components/ui/dialog", () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: Wrapper,
    DialogContent: Wrapper,
    DialogDescription: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
  };
});
vi.mock("@/features/storyAgent/StoryAgentContext", () => ({
  useStoryAgent: () => ({
    activeStoryId: fixture.storyId,
    publishing: {},
    publishingBuffers: {},
    isReplying: false,
    saveStatus: "saved",
  }),
  useStoryAgentActions: () => ({
    ensureActiveStoryPersisted: vi.fn(),
    createNewStory: vi.fn(),
  }),
}));
vi.mock("@/features/storyAgent/spine/storySpine", () => ({
  useStorySpine: () => 1,
  storySpineStore: {},
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    memoryWarehouse: {
      list: { useQuery: fixture.list },
      forStory: { useQuery: fixture.forStory },
      ...Object.fromEntries(
        ["save", "archive", "compose", "sync", "syncStory"].map(name => [
          name,
          { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        ])
      ),
    },
  },
}));
import MemoryWarehouse from "./MemoryWarehouse";

function result(title: string) {
  return {
    data: {
      cards: [
        {
          id: title,
          title,
          content: title,
          kind: "conversation",
          origin: "user",
          createdAt: new Date(),
        },
      ],
      nextOffset: null,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
  };
}
beforeEach(() => {
  fixture.storyId = 11;
  fixture.list.mockReset().mockReturnValue(result("其他故事的秘密"));
  fixture.forStory
    .mockReset()
    .mockImplementation(({ storyId }: { storyId: number }) =>
      result(`故事${storyId}的记忆`)
    );
});
describe("story warehouse scope", () => {
  it("defaults to current-story results even when account-wide results are cached", () => {
    const html = renderToStaticMarkup(
      <MemoryWarehouse onOpenWriting={() => {}} />
    );
    expect(html).toContain("故事11的记忆");
    expect(html).not.toContain("其他故事的秘密");
    expect(html).toContain(
      '<option value="story" selected="">当前故事</option>'
    );
    expect(html).toContain("账号全部记忆");
    expect(fixture.forStory).toHaveBeenCalledWith(
      { storyId: 11, offset: 0, archived: false },
      expect.anything()
    );
    expect(fixture.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false, refetchInterval: false })
    );
  });
  it("reads the next story's scope when the active story changes", () => {
    renderToStaticMarkup(<MemoryWarehouse onOpenWriting={() => {}} />);
    fixture.storyId = 22;
    const html = renderToStaticMarkup(
      <MemoryWarehouse onOpenWriting={() => {}} />
    );
    expect(html).toContain("故事22的记忆");
    expect(html).not.toContain("故事11的记忆");
    expect(html).not.toContain("其他故事的秘密");
  });
  it.each([null, -1])(
    "does not fall back to cached cards in an unsaved workspace (%s)",
    storyId => {
      fixture.storyId = storyId;
      const html = renderToStaticMarkup(
        <MemoryWarehouse onOpenWriting={() => {}} />
      );
      expect(html).not.toContain("其他故事的秘密");
      expect(html).not.toContain("故事1的记忆");
      expect(fixture.forStory).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: false, refetchInterval: false })
      );
    }
  );
});
