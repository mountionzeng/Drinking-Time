import { describe, expect, it } from "vitest";
import {
  emptyPublishingDraftState,
  normalizePublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import {
  buildInheritedStoryInput,
  createStoryContextSnapshot,
  MAX_STORY_CONTEXT_SNAPSHOT_CHARACTERS,
} from "./storyContextSnapshot";

const NOW = 1_791_000_000_000;

function sourceStory() {
  const publishing = upsertPublishingPlatformDraft(
    emptyPublishingDraftState(NOW),
    {
      platform: "xiaohongshu",
      content: {
        title: "一起长大的故事",
        body: "完整的故事正文。".repeat(120),
        tags: ["成长"],
      },
      now: NOW,
    }
  );
  publishing.core = {
    revision: 4,
    facts: ["两个人在海边长大"],
    thesis: "每个人选择自己的路",
    emotion: "释然",
    voiceTraits: ["private-style"],
    visualConcept: "private-art-direction",
    updatedAt: NOW,
  };
  return {
    title: "原故事",
    logline: "两个朋友走向不同的路",
    theme: "成长",
    arc: "告别与重逢",
    summary: "相识、分离、重逢",
    body: {
      _revision: 32,
      cards: [
        {
          id: "private-card-id",
          title: "离别",
          content: "车站送别",
          sourceQuote: "明天见",
          dialogue: "再见",
          emotion: "不舍",
          personalTrace: "private-memory",
        },
      ],
      characters: [
        {
          name: "甲",
          role: "朋友",
          oneLiner: "和乙一起长大",
          referenceImageId: 321,
        },
      ],
      confirmedIntent: {
        purpose: "share",
        audience: "朋友",
        tone: "温暖",
        desiredEffect: "理解",
        accountDetails: "private-account",
      },
      messages: [
        {
          role: "user",
          content: "我们从小住在海边",
          photoUrl: "private-image",
          operationToken: "private-token",
        },
        {
          role: "assistant",
          content: "这是一段关于告别的故事",
          promptCandidate: { id: "private-prompt" },
        },
        { role: "system", content: "private-system" },
      ],
      shots: [{ stableShotId: "private-shot", imageId: 777 }],
      personalMemory: "private-account-memory",
      publishing: {
        ...publishing,
        cover: { assetId: 123 },
        coverGeneration: { operationToken: "private-token" },
      },
    },
  };
}

describe("story context snapshot", () => {
  it("shares only selected story text and preserves the complete article", () => {
    const story = sourceStory();
    const before = structuredClone(story);
    const snapshot = createStoryContextSnapshot(story, {
      includeConversation: false,
    });
    expect(snapshot.article?.body).toBe(
      story.body.publishing.drafts.xiaohongshu?.content.body
    );
    expect(snapshot.article!.body.length).toBeGreaterThan(600);
    expect(snapshot.core?.facts).toEqual(["两个人在海边长大"]);
    expect(snapshot.cards[0].content).toBe("车站送别");
    expect(snapshot.characters[0]).toEqual({
      name: "甲",
      role: "朋友",
      oneLiner: "和乙一起长大",
    });
    expect(snapshot.conversation).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("private-");
    expect(story).toEqual(before);
  });

  it("includes conversation only when explicitly selected and retains source speaker identity", () => {
    const snapshot = createStoryContextSnapshot(sourceStory(), {
      includeConversation: true,
    });
    expect(snapshot.conversation).toEqual([
      { speaker: "source_author", text: "我们从小住在海边" },
      { speaker: "source_assistant", text: "这是一段关于告别的故事" },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("private-");
  });

  it("owns no mutable references to the source or to another recipient's story", () => {
    const story = sourceStory();
    const snapshot = createStoryContextSnapshot(story, {
      includeConversation: true,
    });
    const first = buildInheritedStoryInput(snapshot, 20, NOW);
    const second = buildInheritedStoryInput(snapshot, 30, NOW);
    expect(first).toMatchObject({
      userId: 20,
      projectId: null,
      title: "原故事",
    });
    expect(second.userId).toBe(30);
    expect(first).not.toHaveProperty("id");
    const body = first.body as Record<string, unknown>;
    expect(body).toMatchObject({
      _revision: 1,
      messages: [],
      cards: [],
      characters: [],
      shots: [],
    });
    expect(body).not.toHaveProperty("confirmedIntent");
    const publishing = normalizePublishingDraftState(body.publishing, NOW);
    expect(publishing.drafts.xiaohongshu?.content.body).toBe(
      snapshot.article?.body
    );
    expect(publishing.cover).toBeNull();
    expect(publishing.coverRounds).toEqual([]);
    expect(publishing.coverGeneration).toBeNull();
    expect(publishing.versionOperationReceipts).toEqual({});
    expect(publishing.core).toBeNull();
    expect(body.inheritedStoryContext).toEqual({ snapshot, importedAt: NOW });
    const original = structuredClone(snapshot);
    snapshot.cards[0].content = "new author edit";
    snapshot.core!.facts.push("new source fact");
    snapshot.article!.tags.push("new source tag");
    expect(body.inheritedStoryContext).toEqual({
      snapshot: original,
      importedAt: NOW,
    });
    const firstPublishing = body.publishing as typeof publishing;
    firstPublishing.drafts.xiaohongshu!.content.body = "recipient edit";
    expect(
      normalizePublishingDraftState(
        (second.body as typeof body).publishing,
        NOW
      ).drafts.xiaohongshu!.content.body
    ).toBe(original.article!.body);
    expect((second.body as typeof body).inheritedStoryContext).toEqual({
      snapshot: original,
      importedAt: NOW,
    });
    expect(story.body.publishing.drafts.xiaohongshu!.content.body).toBe(
      original.article!.body
    );
  });

  it("fails explicitly on oversized content instead of silently truncating it", () => {
    const story = sourceStory();
    story.summary = "文".repeat(MAX_STORY_CONTEXT_SNAPSHOT_CHARACTERS + 1);
    expect(() =>
      createStoryContextSnapshot(story, { includeConversation: false })
    ).toThrow("内容未被截断");
  });

  it("validates and isolates the visible editor article before sharing", () => {
    const article = {
      platform: "xiaohongshu" as const,
      title: "当前标题",
      body: "当前正文",
      tags: ["当前标签"],
    };
    const snapshot = createStoryContextSnapshot(sourceStory(), {
      includeConversation: false,
      article,
    });
    expect(snapshot.article).toEqual(article);
    article.tags.push("后来修改");
    expect(snapshot.article?.tags).toEqual(["当前标签"]);
    expect(
      createStoryContextSnapshot(sourceStory(), {
        includeConversation: false,
        article: null,
      }).article
    ).toBeNull();
    expect(() =>
      createStoryContextSnapshot(sourceStory(), {
        includeConversation: false,
        article: {
          ...article,
          body: "文".repeat(MAX_STORY_CONTEXT_SNAPSHOT_CHARACTERS + 1),
        },
      })
    ).toThrow("内容未被截断");
  });

  it("rejects extra fields on imported snapshots instead of trusting arbitrary Story data", () => {
    const snapshot = createStoryContextSnapshot(sourceStory(), {
      includeConversation: false,
    });
    expect(() =>
      buildInheritedStoryInput(
        { ...snapshot, accountToken: "secret" } as typeof snapshot,
        20
      )
    ).toThrow();
    expect(() => buildInheritedStoryInput(snapshot, 0)).toThrow();
  });

  it("reads the authoritative active version without leaking other drafts or stale text", () => {
    const story = sourceStory();
    const publishing = normalizePublishingDraftState(
      story.body.publishing,
      NOW
    );
    const activeVersion = publishing.versions![0];
    activeVersion.drafts.xiaohongshu!.content.body = "当前确认的文章";
    publishing.canonicalAuthority = "versions";
    publishing.drafts.xiaohongshu!.content.body = "private-stale-article";
    publishing.drafts.wechat_moments = {
      ...activeVersion.drafts.xiaohongshu!,
      platform: "wechat_moments",
      content: {
        title: "private-other-draft",
        body: "private-other-body",
        tags: [],
      },
    };
    const snapshot = createStoryContextSnapshot(
      { ...story, body: { ...story.body, publishing } },
      { includeConversation: false }
    );
    expect(snapshot.article?.body).toBe("当前确认的文章");
    expect(JSON.stringify(snapshot)).not.toContain("private-");
  });

  it("supports stories without publishing, conversation or cards", () => {
    const snapshot = createStoryContextSnapshot(
      { ...sourceStory(), body: null },
      { includeConversation: true }
    );
    expect(snapshot).toMatchObject({
      article: null,
      core: null,
      cards: [],
      characters: [],
      conversation: [],
    });
    expect(buildInheritedStoryInput(snapshot, 20, NOW).body).toMatchObject({
      _revision: 1,
      messages: [],
      shots: [],
    });
  });
});
