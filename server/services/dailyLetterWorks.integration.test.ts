import { describe, expect, it, vi } from "vitest";
import { generateDailyLetterViaAttempt } from "./emotionDailyLetters";

describe("saved works in immutable daily letters", () => {
  it("passes selected writing to generation and records sources without changing profile or memory evidence", async () => {
    const works = [{ storyId: 4, title: "雨中书店", excerpt: "小说里的角色在读书。", savedOn: "2026-10-28" }];
    const personalize = vi.fn().mockResolvedValue({ dailyReference: { summary: "新信" }, source: "302-deepseek", model: "mock" });
    const commitAttempt = vi.fn().mockResolvedValue({ outcome: "committed", letter: { id: 1 } });
    const selectWorks = vi.fn().mockResolvedValue(works);
    const dependencies = {
      beginAttempt: vi.fn().mockResolvedValue({ status: "started", attempt: { id: 1, claimToken: "test", privacyEpoch: 0 } }),
      commitAttempt,
      failAttempt: vi.fn(),
      selectMemory: vi.fn().mockResolvedValue({ selected: [], promptContext: [] }),
      selectWorks,
      getAlmanac: vi.fn().mockResolvedValue({ date: "2026-10-29", status: "ok", yi: ["祭祀"], ji: [], luckyHours: [], directions: [], meta: {} }),
      personalize,
    };
    const result = await generateDailyLetterViaAttempt({
      userId: 7, letterDate: "2026-10-29", actionId: "test", trigger: "reread",
      generationIntent: "daily-letter", baseDailyReference: {}, analysisSeed: {},
      userMessage: null, userMessageSaidAt: null, userMessageEditedAt: null, profileRevision: null,
    }, dependencies as unknown as Parameters<typeof generateDailyLetterViaAttempt>[1]);
    expect(result.status).toBe("committed");
    expect(selectWorks).toHaveBeenCalledWith(7, "2026-10-29");
    expect(personalize.mock.calls[0][0].authoredWorks).toEqual(works);
    const payload = commitAttempt.mock.calls[0][0].payload;
    expect(payload.analysisSeed).toEqual({});
    expect(payload.selectedEvidence).toEqual([]);
    expect(payload.dailyReference.workSources).toEqual([{ storyId: 4, title: "雨中书店", savedOn: "2026-10-28" }]);
    expect(JSON.stringify(payload)).not.toContain("小说里的角色");
  });
});
