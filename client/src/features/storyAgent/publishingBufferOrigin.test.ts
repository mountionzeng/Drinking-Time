import { describe, expect, it } from "vitest";
import {
  filterUnsavedPublishingBuffers,
  normalizePublishingBuffers,
  resolvePublishingBufferOrigin,
  type PublishingDraftBuffer,
} from "./storyAgentPersistence";

const content = (body: string) => ({ title: "标题", body, tags: [] as string[] });
const buffer = (over: Partial<PublishingDraftBuffer>): PublishingDraftBuffer => ({
  storyId: 7,
  platform: "x" as PublishingDraftBuffer["platform"],
  versionId: "v1",
  content: content("正文"),
  updatedAt: 1,
  ...over,
});

describe("filterUnsavedPublishingBuffers", () => {
  it("ignores generated buffers and buffers equal to the saved draft", () => {
    const buffers = {
      a: buffer({ origin: "generated" }),
      b: buffer({ platform: "xiaohongshu" as PublishingDraftBuffer["platform"], content: content("已保存") }),
      c: buffer({ platform: "linkedin" as PublishingDraftBuffer["platform"], content: content("用户改过") }),
      d: buffer({ storyId: 8 }),
    };
    const publishing = {
      activeVersionId: "v1",
      drafts: { xiaohongshu: { content: content("已保存") }, linkedin: { content: content("原稿") } },
    };
    expect(filterUnsavedPublishingBuffers(buffers, 7, publishing).map(b => b.content.body)).toEqual(["用户改过"]);
    expect(filterUnsavedPublishingBuffers(buffers, null, publishing)).toEqual([]);
  });
  it("does not compare buffers of another version against the active draft", () => {
    const buffers = { b: buffer({ versionId: "v2", content: content("已保存") }) };
    const publishing = { activeVersionId: "v1", drafts: { x: { content: content("已保存") } } };
    expect(filterUnsavedPublishingBuffers(buffers, 7, publishing)).toHaveLength(1);
  });
});

describe("resolvePublishingBufferOrigin", () => {
  it("keeps generated when the editor echoes identical content", () => {
    const prev = buffer({ origin: "generated" });
    expect(resolvePublishingBufferOrigin(prev, content("正文"), undefined)).toBe("generated");
    expect(resolvePublishingBufferOrigin(prev, content("改了"), undefined)).toBe("user");
    expect(resolvePublishingBufferOrigin(undefined, content("x"), "generated")).toBe("generated");
  });
});

describe("normalizePublishingBuffers origin", () => {
  it("round-trips generated origin and drops unknown values", () => {
    const out = normalizePublishingBuffers({
      a: { ...buffer({ origin: "generated" }) },
      b: { ...buffer({ platform: "linkedin" as PublishingDraftBuffer["platform"] }), origin: "weird" },
    });
    const values = Object.values(out);
    expect(values.find(b => b.platform === "x")?.origin).toBe("generated");
    expect(values.find(b => b.platform === "linkedin")?.origin).toBeUndefined();
  });
});
