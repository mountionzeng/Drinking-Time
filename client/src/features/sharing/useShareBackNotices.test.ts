import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSeenShareBacks,
  shareBackLabel,
  unreadShareBacks,
} from "./useShareBackNotices";

vi.mock("@/lib/trpc", () => ({ trpc: {} }));

const notice = (id: string, kind: "text" | "layout" = "text") => ({
  id,
  storyId: 1,
  storyTitle: "海边",
  kind,
  authorName: "小周",
  createdAt: 1_760_918_400_000,
});

function stubStorage(initial: Record<string, string>) {
  const store = { ...initial };
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("share-back seen state", () => {
  it("keeps seen ids per user and ignores damaged storage", () => {
    stubStorage({
      "dt:share-back-seen:10": JSON.stringify(["text:1:a", 7]),
      "dt:share-back-seen:20": "{not json",
    });
    expect([...readSeenShareBacks(10)]).toEqual(["text:1:a"]);
    expect(readSeenShareBacks(20).size).toBe(0);
    expect(readSeenShareBacks(30).size).toBe(0);
  });

  it("only counts notices the author has not seen yet", () => {
    const notices = [notice("text:1:a"), notice("layout:1:b", "layout")];
    expect(unreadShareBacks(notices, new Set(["text:1:a"])).map(n => n.id)).toEqual([
      "layout:1:b",
    ]);
  });

  it("names who shared back and what kind of version it is", () => {
    expect(shareBackLabel(notice("text:1:a"))).toBe("小周 分享回了文字");
    expect(shareBackLabel(notice("layout:1:b", "layout"))).toBe("小周 分享回了排版");
  });
});
