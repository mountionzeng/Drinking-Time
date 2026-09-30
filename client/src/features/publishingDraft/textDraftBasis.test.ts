import { describe, expect, it } from "vitest";
import { resolveTextDraftBasis } from "./textDraftBasis";
import type { TextDraftVersion } from "@shared/textDraftHistory";
const content = (body: string) => ({ title: "", body, tags: [] });
const version = (adopted = false): TextDraftVersion => ({
  id: "v1",
  sequence: 1,
  requestHash: "fixture",
  status: "ready",
  createdAt: 1,
  request: {
    storyId: 1,
    operationToken: "fixture-token",
    expectedRevision: 0,
    platform: "xiaohongshu",
    parentId: null,
    basis: null,
    messages: [],
    instruction: "",
    source: "unknown",
  },
  conversationSnapshot: [],
  conversationDelta: [],
  promptVersion: "test",
  libraryVersion: "test",
  systemPrompt: "",
  modelMessage: "",
  generated: content("候选"),
  ...(adopted
    ? {
        adoption: {
          content: content("采用稿"),
          adoptedAt: 2,
          feedback: "",
          learningEnabled: true,
        },
      }
    : {}),
});
describe("text draft generation basis", () => {
  it("uses the latest unadopted candidate after reload instead of stale published text", () => {
    expect(
      resolveTextDraftBasis({
        latest: version(),
        published: content("旧发布稿"),
        edited: null,
      })
    ).toEqual({ parentId: "v1", basis: content("候选") });
  });
  it("includes dirty publishing buffer before every other source", () => {
    expect(
      resolveTextDraftBasis({
        selected: version(),
        latest: version(),
        edited: content("面板稿"),
        buffer: content("未保存修改"),
      }).basis
    ).toEqual(content("未保存修改"));
  });
  it("uses saved publishing edits made after adoption", () => {
    expect(
      resolveTextDraftBasis({
        selected: version(true),
        latest: version(true),
        edited: content("采用稿"),
        published: content("采用后又修改"),
      }).basis
    ).toEqual(content("采用后又修改"));
  });
  it("supports branching from an explicitly viewed older candidate", () => {
    expect(
      resolveTextDraftBasis({
        selected: version(),
        latest: { ...version(), id: "v2" },
        edited: content("旧版修改"),
      })
    ).toEqual({ parentId: "v1", basis: content("旧版修改") });
  });
});
