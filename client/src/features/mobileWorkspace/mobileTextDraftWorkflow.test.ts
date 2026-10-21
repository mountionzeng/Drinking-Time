import { describe, expect, it } from "vitest";
import { emptyPublishingDraftState } from "@shared/publishingDraft";
import {
  mobileTextDraftRequest,
  mobileTextPreviewKey,
} from "./mobileTextDraftWorkflow";
import { mobileWritingContext } from "./mobileMemoryFollowup";
const history = { schemaVersion: 1 as const, revision: 7, versions: [] };
function setup() {
  const publishing = emptyPublishingDraftState();
  publishing.activePlatform = "xiaohongshu";
  publishing.activeVersionId = "v1";
  publishing.drafts.xiaohongshu = {
    revision: 2,
    bodyRevision: 2,
    content: { title: "原题", body: "服务器正文", tags: ["原标签"] },
  } as any;
  return {
    storyId: 8,
    token: "test-candidate-1",
    publishing,
    history,
    messages: [],
    instruction: "简洁一点",
  };
}
describe("mobile draft request", () => {
  it("uses unsaved visible text and selection, not an unrelated latest generated version", () => {
    const request = mobileTextDraftRequest({
      ...setup(),
      source: {
        storyId: 8,
        id: "text:current",
        kind: "text",
        origin: "note",
        content: "展示标题和正文",
        text: {
          content: { title: "", body: "手机未保存内容", tags: [] },
          parentId: null,
          platform: "xiaohongshu",
          versionId: "v1",
          bodyRevision: 2,
          selection: { start: 0, end: 2 },
        },
      },
    });
    expect(request.basis).toEqual({
      title: "原题",
      body: "手机未保存内容",
      tags: ["原标签"],
    });
    expect(request.selection).toEqual({ start: 0, end: 2 });
    expect(request.expectedRevision).toBe(7);
  });
  it("rejects stale publication scope before inference", () => {
    for (const text of [
      { versionId: "v2", bodyRevision: 2 },
      { versionId: "v1", bodyRevision: 1 },
    ]) {
      expect(() =>
        mobileTextDraftRequest({
          ...setup(),
          source: {
            storyId: 8,
            id: "text:current",
            kind: "text",
            origin: "note",
            content: "旧正文",
            text: {
              ...text,
              content: { title: "", body: "旧正文", tags: [] },
              parentId: null,
            },
          },
        })
      ).toThrow("重新读取");
    }
  });
  it("uses the selected memory content as the basis for a new text draft", () => {
    const source = {
      storyId: 8,
      id: "memory:1",
      kind: "memory" as const,
      origin: "user" as const,
      title: "外婆的厨房",
      content: "小时候我常在外婆家的厨房帮忙。",
    };
    const request = mobileTextDraftRequest({
      ...setup(),
      source,
      basisMode: "current-content",
    });
    expect(request.basis).toEqual({
      title: "外婆的厨房",
      body: source.content,
      tags: [],
    });
  });
  it("keeps assistant memory quoted as context, while text requests carry a full-draft proposal context", () => {
    const source = {
      storyId: 8,
      id: "memory1",
      origin: "assistant" as const,
      content: "以前的整理",
    };
    expect(
      mobileTextDraftRequest({ ...setup(), source }).instruction
    ).toContain("不作为用户事实");
    expect(mobileWritingContext(source)).toBeUndefined();
    expect(mobileWritingContext({ ...source, kind: "text" })).toMatchObject({
      draft: source.content,
      fullDraft: true,
    });
    expect(mobileTextPreviewKey(1, 8)).not.toBe(mobileTextPreviewKey(2, 8));
  });
});

it("keeps a full 12000-character memory in source messages without overflowing the instruction field", () => {
  const content = "记".repeat(12000);
  const request = mobileTextDraftRequest({
    ...setup(),
    source: { storyId: 8, id: "long-memory", content, origin: "assistant" },
  });
  expect(request.messages[0].role).toBe("assistant");
  expect(request.messages[0].content).toContain(content);
  expect(request.instruction.length).toBeLessThan(8000);
});
