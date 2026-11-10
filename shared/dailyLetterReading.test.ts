import { describe, expect, it } from "vitest";
import { dailyLetterReadingContext } from "./dailyLetterReading";

const work = {
  storyId: 1217,
  title: "launch video",
  excerpt: "分镜草案",
  savedOn: "2026-11-06",
  savedAt: "2026-11-06T15:28:15.650Z",
};
describe("daily letter reading receipt", () => {
  it("shows evening writing separately from the immutable early-morning letter", () => {
    const reference = { summary: "旧信", workSources: [] };
    const context = dailyLetterReadingContext(
      [work],
      "2026-11-05T16:27:22Z",
      reference
    );
    expect(context.hasNewerWorks).toBe(true);
    expect(context.savedWorks).toEqual([work]);
    expect(context.workSources).toEqual([]);
    expect(reference).toEqual({ summary: "旧信", workSources: [] });
  });

  it("uses the actual generation cutoff, not today's clock or a message-edit time", () => {
    expect(
      dailyLetterReadingContext([work], "2026-11-07T04:00:00Z", {})
        .hasNewerWorks
    ).toBe(false);
    expect(dailyLetterReadingContext([work], null, {}).hasNewerWorks).toBe(
      false
    );
  });

  it("does not claim that available works were read, and bounds legacy source metadata", () => {
    const context = dailyLetterReadingContext([work], null, {
      workSources: [
        null,
        {},
        { storyId: 1, title: "旧标题", savedOn: "2026-11-02" },
      ],
    });
    expect(context.workSources).toEqual([
      { storyId: 1, title: "旧标题", savedOn: "2026-11-02" },
    ]);
    expect(dailyLetterReadingContext([work], null, null).workSources).toEqual(
      []
    );
    expect(dailyLetterReadingContext([work], null, null).hasSourceReceipt).toBe(false);
    expect(dailyLetterReadingContext([work], null, {workSources: []}).hasSourceReceipt).toBe(true);
  });
});
