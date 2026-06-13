import { beforeEach, describe, expect, it } from "vitest";
import {
  resetMemoryStateForTesting,
  createShots,
  getStoryShots,
  replaceDirectorShotsForStory,
  createStory,
  deleteStory,
  createGeneratedImage,
  getStoryGeneratedImages,
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

  it("删除故事级联删除其镜头（不留孤儿）", async () => {
    const story = await createStory({
      userId: 1,
      projectId: 1,
      title: "待删故事",
      body: {} as never,
    });
    await createShots([shot(story.id, 1, "SH01"), shot(story.id, 1, "SH02")]);
    await createShots([shot(999, 1, "SH01")]); // 另一个故事的镜头，不应受影响
    expect(await getStoryShots(story.id, 1)).toHaveLength(2);

    await deleteStory(story.id, 1);
    expect(await getStoryShots(story.id, 1)).toHaveLength(0); // 镜头随故事删除
    expect(await getStoryShots(999, 1)).toHaveLength(1); // 别的故事不受影响
  });

  it("图片按故事独立：故事 A 的图不出现在故事 B（用户要的核心）", async () => {
    await createGeneratedImage({
      projectId: 1, storyId: 100, userId: 1, shotNo: "SH01",
      imageUrl: "https://x/a.png", prompt: "A", isCurrent: true, generationType: "generate",
    });
    await createGeneratedImage({
      projectId: 1, storyId: 200, userId: 1, shotNo: "SH01",
      imageUrl: "https://x/b.png", prompt: "B", isCurrent: true, generationType: "generate",
    });
    const a = await getStoryGeneratedImages(100, 1);
    const b = await getStoryGeneratedImages(200, 1);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].imageUrl).toBe("https://x/a.png"); // 不串故事
    expect(b[0].imageUrl).toBe("https://x/b.png");
  });

  it("图片跨用户安全：他人 storyId 取不到本人图片", async () => {
    await createGeneratedImage({
      projectId: 1, storyId: 100, userId: 1, shotNo: "SH01",
      imageUrl: "https://x/a.png", prompt: "A", isCurrent: true, generationType: "generate",
    });
    expect(await getStoryGeneratedImages(100, 2)).toHaveLength(0);
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
