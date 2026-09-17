import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StoryAgentChat.tsx", import.meta.url), "utf8");

describe("StoryAgentChat layout", () => {
  it("keeps photo assets out of the message stream and marks the scroll surface", () => {
    expect(source).not.toContain("<ChatPhotoAssets");
    expect(source).toContain("story-chat-scroll-surface");
    expect(source).toContain("story-context-surface");
    expect(source).not.toContain("{storyDisplaySubtitle}");
  });
});
