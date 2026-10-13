import { describe, expect, it } from "vitest";
import {
  createMobileConversationRecoveryTurn,
  loadMobileConversationRecovery,
  saveMobileConversationRecovery,
} from "../mobileWorkspace/mobileConversationStore";

describe("writing context durability", () => {
  it("roundtrips draft/cursor/question for the same account and story", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    };
    const turn = {
      ...createMobileConversationRecoveryTurn({
        userId: 4,
        storyId: 12,
        userContent: "在屋檐下",
      }),
      writingContext: {
        draft: "那天下雨",
        cursor: 4,
        selection: { start: 0, end: 4 },
        openingQuestion: "你在哪里？",
        scope: "12:v1:1",
      },
    };
    saveMobileConversationRecovery(storage, 4, 12, [turn]);
    expect(loadMobileConversationRecovery(storage, 4, 12)).toEqual([turn]);
    expect(loadMobileConversationRecovery(storage, 5, 12)).toEqual([]);
    expect(loadMobileConversationRecovery(storage, 4, 13)).toEqual([]);
  });
});
