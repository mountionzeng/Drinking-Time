import { describe, expect, it, vi } from "vitest";
import { selectDailyLetterWorks } from "./dailyLetterWorks";

function fixture() {
  return {
    listUserStorySummariesPage: vi
      .fn()
      .mockResolvedValue({
        stories: [{ id: 1 }, { id: 2 }, { id: 3 }],
        nextOffset: null,
      }),
    getStoryById: vi.fn(async (id: number) => ({
      id,
      userId: 7,
      title: `作品${id}`,
      body: { messages: [{ text: "私密聊天不读取" }] },
    })),
    listChapters: vi.fn(async (storyId: number) => [
      {
        userId: 7,
        storyId,
        blocks: { body: "雨中的书店".repeat(400) },
        updatedAt: new Date("2026-10-28T12:00:00Z"),
      },
    ]),
  };
}
// Repository return shapes omitted here are not consumed by the selector.
const deps = (value: ReturnType<typeof fixture>) =>
  value as unknown as NonNullable<Parameters<typeof selectDailyLetterWorks>[2]>;
describe("daily letter saved works", () => {
  it("dates writing by nonempty saved chapters, not a later empty draft", async () => {
    const db = fixture();
    db.listChapters.mockImplementation(async storyId => [
      {
        userId: 7,
        storyId,
        blocks: { body: "11月6日晚保存的分镜" },
        updatedAt: new Date("2026-11-06T15:28:15Z"),
      },
      {
        userId: 7,
        storyId,
        blocks: { body: "  " },
        updatedAt: new Date("2026-11-07T13:45:00Z"),
      },
    ]);
    const [work] = await selectDailyLetterWorks(7, "2026-11-08", deps(db));
    expect(work).toMatchObject({
      savedOn: "2026-11-06",
      savedAt: "2026-11-06T15:28:15.000Z",
    });
  });

  it("prioritizes the latest saved writing over unrelated story metadata updates", async () => {
    const db = fixture();
    db.listChapters.mockImplementation(async storyId => [
      {
        userId: 7,
        storyId,
        blocks: { body: `作品${storyId}` },
        updatedAt: new Date(`2026-11-0${storyId}T12:00:00Z`),
      },
    ]);
    expect(
      (await selectDailyLetterWorks(7, "2026-11-08", deps(db))).map(
        work => work.storyId
      )
    ).toEqual([3, 2]);
  });

  it("keeps a recently edited chapter inside the bounded excerpt", async () => {
    const db = fixture();
    db.listChapters.mockImplementation(async storyId => [
      {
        userId: 7,
        storyId,
        blocks: { body: "旧章".repeat(1200) },
        updatedAt: new Date("2026-11-01T00:00:00Z"),
      },
      {
        userId: 7,
        storyId,
        blocks: { body: "新写的章节" },
        updatedAt: new Date("2026-11-06T15:28:15Z"),
      },
    ]);
    expect(
      (await selectDailyLetterWorks(7, "2026-11-06", deps(db)))[0].excerpt
    ).toMatch(/^新写的章节/);
  });

  it("reads at most two bounded saved works and scopes every query to the account", async () => {
    const db = fixture();
    const result = await selectDailyLetterWorks(7, "2026-10-29", deps(db));
    expect(result).toHaveLength(2);
    expect(result[0].excerpt).toHaveLength(1200);
    expect(JSON.stringify(result)).not.toContain("私密聊天");
    expect(db.listUserStorySummariesPage).toHaveBeenCalledWith(7, 0, 8);
    expect(db.getStoryById).toHaveBeenCalledWith(1, 7);
    expect(db.listChapters).toHaveBeenCalledWith(1, 7);
  });
  it("rejects removed/foreign stories and foreign chapters", async () => {
    const db = fixture();
    db.getStoryById
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 2, userId: 8, title: "他人" } as never);
    db.listChapters.mockResolvedValue([
      {
        userId: 8,
        storyId: 3,
        blocks: { body: "不能读取" },
        updatedAt: new Date(),
      },
    ]);
    expect(await selectDailyLetterWorks(7, "2026-10-29", deps(db))).toEqual([]);
  });
  it("does not read future revisions into an earlier letter, using China dates", async () => {
    const db = fixture();
    db.listChapters.mockResolvedValue([
      {
        userId: 7,
        storyId: 1,
        blocks: { body: "第二天的文章" },
        updatedAt: new Date("2026-10-28T16:01:00Z"),
      },
    ]);
    expect(await selectDailyLetterWorks(7, "2026-10-28", deps(db))).toEqual([]);
  });
});
