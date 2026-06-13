import { beforeEach, describe, expect, it } from "vitest";
import {
  resetMemoryStateForTesting,
  createShots,
  getStoryShots,
  replaceDirectorShotsForStory,
  type InsertShot,
} from "./db";

// 镜头按 storyId 归属（U3）：故事是唯一单位，镜头隔离 + 跨用户安全。
// memory 模式（DATABASE_URL 空）下直接测 db 层逻辑。

function shot(
  storyId: number,
  userId: number,
  shotNo: string,
  intentType: InsertShot["intentType"] = "director_note",
): InsertShot {
  return {
    projectId: 1,
    storyId,
    userId,
    sceneNo: "SC01",
    shotNo,
    intentType,
  };
}

describe("镜头按 storyId 归属（U3）", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("getStoryShots 只返回该故事该用户的镜头", async () => {
    await createShots([
      shot(10, 1, "SH01"),
      shot(10, 1, "SH02"),
      shot(20, 1, "SH01"), // 另一个故事
    ]);
    const storyShots = await getStoryShots(10, 1);
    expect(storyShots).toHaveLength(2);
    expect(storyShots.every((s) => s.storyId === 10)).toBe(true);
  });

  it("Covers AE2：对故事 X 替换镜头不污染同 project 的故事 Y", async () => {
    await createShots([shot(20, 1, "SH01"), shot(20, 1, "SH02")]); // 故事 Y=20
    await replaceDirectorShotsForStory(10, 1, [shot(10, 1, "SH01")]); // 写故事 X=10

    const x = await getStoryShots(10, 1);
    const y = await getStoryShots(20, 1);
    expect(x).toHaveLength(1);
    expect(y).toHaveLength(2); // Y 完全不受影响
  });

  it("replace 两次：X 的导演镜头被新集合替换，Y 不受影响", async () => {
    await createShots([shot(20, 1, "SH99")]);
    await replaceDirectorShotsForStory(10, 1, [shot(10, 1, "SH01")]);
    await replaceDirectorShotsForStory(10, 1, [
      shot(10, 1, "SH02"),
      shot(10, 1, "SH03"),
    ]);
    const x = await getStoryShots(10, 1);
    expect(x.map((s) => s.shotNo).sort()).toEqual(["SH02", "SH03"]);
    expect(await getStoryShots(20, 1)).toHaveLength(1);
  });

  it("保留 intentType 过滤：replace 不删该故事的非 director_note 镜头", async () => {
    await createShots([
      shot(10, 1, "SH01", "idea"), // 非导演镜头，应保留
      shot(10, 1, "SH02", "director_note"),
    ]);
    await replaceDirectorShotsForStory(10, 1, [shot(10, 1, "SH09", "director_note")]);
    const x = await getStoryShots(10, 1);
    const byIntent = x.map((s) => `${s.shotNo}:${s.intentType}`).sort();
    // 旧的 idea 镜头还在；旧 director_note 被替换为 SH09
    expect(byIntent).toContain("SH01:idea");
    expect(byIntent).toContain("SH09:director_note");
    expect(byIntent).not.toContain("SH02:director_note");
  });

  it("跨用户安全：他人无法用 storyId 取到本人镜头", async () => {
    await createShots([shot(10, 1, "SH01")]); // user 1 的镜头
    expect(await getStoryShots(10, 2)).toHaveLength(0); // user 2 取不到
  });

  it("跨用户安全：replace 带 userId，不影响他人同 storyId 的镜头", async () => {
    await createShots([shot(10, 2, "SH01")]); // user 2 在 story 10 下的镜头
    await replaceDirectorShotsForStory(10, 1, [shot(10, 1, "SH02")]); // user 1 替换
    expect(await getStoryShots(10, 2)).toHaveLength(1); // user 2 的不动
    expect(await getStoryShots(10, 1)).toHaveLength(1);
  });
});
