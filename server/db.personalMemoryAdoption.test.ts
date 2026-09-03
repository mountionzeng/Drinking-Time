import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const previousAllowlist = process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-adoption-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = "7";

const fs = await import("node:fs/promises");
const db = await import("./db");
const { imageAdoptionCaptureIfEnabled } = await import(
  "./services/personalMemoryAdoption"
);
const realWriteFile = (
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
).writeFile;

const USER = 7;
const STORY = 1186;

async function seedImage(id: number) {
  return db.createGeneratedImage({
    projectId: null,
    storyId: STORY,
    userId: USER,
    shotNo: "SH01",
    shotIdentity: "shot-1",
    imageKey: null,
    imageUrl: `/api/images/candidate-${id}.png`,
    prompt: "候选图",
    parentImageId: null,
    generationType: "initial",
    isCurrent: false,
  });
}

function adoptionFor(imageId: number) {
  return (signalId: number) =>
    imageAdoptionCaptureIfEnabled({
      userId: USER,
      storyId: STORY,
      imageId,
      signalId,
      context: { entry: "select_image" },
    });
}

describe("图片采用只由显式入口产生（U3）", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.writeFile).mockImplementation(realWriteFile);
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    if (previousAllowlist === undefined) {
      delete process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
    } else {
      process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = previousAllowlist;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("传了采用上下文才产生采用经历", async () => {
    const image = await seedImage(1);
    const promoted = await db.promoteStoryImageToCurrent({
      imageId: image.id,
      storyId: STORY,
      userId: USER,
      adoption: adoptionFor(image.id),
    });
    expect(promoted).not.toBeNull();

    const events = await db.listPersonalMemoryEvents(USER);
    expect(events).toHaveLength(1);
    expect(events[0].sourceType).toBe("image_adoption");
    expect(events[0].sourceKey).toBe(`image:${image.id}`);
  });

  // 这是 U3 的承重约束。同一个函数既被用户点击调用，也被生成后自动置为当前、
  // 恢复 isCurrent、批量迁移调用。不传上下文就必须一条都不记——否则来信会
  // 引用一个用户其实从没挑过的作品。
  it("内部/自动路径不传上下文时零采用经历", async () => {
    const image = await seedImage(1);
    const promoted = await db.promoteStoryImageToCurrent({
      imageId: image.id,
      storyId: STORY,
      userId: USER,
      metadata: { source: "generate_for_mobile_auto_select" },
    });

    expect(promoted).not.toBeNull();
    // 作品权威照常推进：图确实成了当前。
    expect(promoted!.image.isCurrent).toBe(true);
    expect(promoted!.signal.action).toBe("swipe_right");
    // 但足迹里什么都没有。
    expect(await db.listPersonalMemoryEvents(USER)).toHaveLength(0);
  });

  // metadata.source 是给排查用的，不是采用凭据。
  it("带着 director_advice 的 metadata 但不传上下文，同样不记采用", async () => {
    const image = await seedImage(1);
    await db.promoteStoryImageToCurrent({
      imageId: image.id,
      storyId: STORY,
      userId: USER,
      metadata: { source: "director_advice" },
    });
    expect(await db.listPersonalMemoryEvents(USER)).toHaveLength(0);
  });

  it("四张候选只采用一张，足迹里只出现被采用那张", async () => {
    const images = [];
    for (let i = 0; i < 4; i += 1) images.push(await seedImage(i));
    const chosen = images[2];
    await db.promoteStoryImageToCurrent({
      imageId: chosen.id,
      storyId: STORY,
      userId: USER,
      adoption: adoptionFor(chosen.id),
    });

    const events = await db.listPersonalMemoryEvents(USER);
    expect(events).toHaveLength(1);
    expect(events[0].sourceKey).toBe(`image:${chosen.id}`);
  });

  // 换一张图 = 一次新的采用；旧那条采用事件仍然留着，因为它确实发生过。
  it("改选另一张后，两条采用都留在足迹里", async () => {
    const first = await seedImage(1);
    const second = await seedImage(2);
    await db.promoteStoryImageToCurrent({
      imageId: first.id,
      storyId: STORY,
      userId: USER,
      adoption: adoptionFor(first.id),
    });
    await db.promoteStoryImageToCurrent({
      imageId: second.id,
      storyId: STORY,
      userId: USER,
      adoption: adoptionFor(second.id),
    });

    const events = await db.listPersonalMemoryEvents(USER);
    expect(events).toHaveLength(2);
    expect(events.map(event => event.sourceKey).sort()).toEqual(
      [`image:${first.id}`, `image:${second.id}`].sort()
    );
    // 当前状态只有一张，但历史保留了两次选择。
    expect(second.id).not.toBe(first.id);
  });

  it("采用失败（图不属于该故事）时不留经历", async () => {
    const image = await seedImage(1);
    const promoted = await db.promoteStoryImageToCurrent({
      imageId: image.id,
      storyId: STORY + 999,
      userId: USER,
      adoption: adoptionFor(image.id),
    });
    expect(promoted).toBeNull();
    expect(await db.listPersonalMemoryEvents(USER)).toHaveLength(0);
  });

  it("落盘失败时采用经历与 isCurrent 一起回滚", async () => {
    const image = await seedImage(1);
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(
      db.promoteStoryImageToCurrent({
        imageId: image.id,
        storyId: STORY,
        userId: USER,
        adoption: adoptionFor(image.id),
      })
    ).rejects.toThrow();
    expect(await db.listPersonalMemoryEvents(USER)).toHaveLength(0);
  });

  it("不在白名单的账号即使走显式入口也不捕获", async () => {
    const image = await db.createGeneratedImage({
      projectId: null,
      storyId: STORY,
      userId: 8,
      shotNo: "SH01",
      shotIdentity: "shot-1",
      imageKey: null,
      imageUrl: "/api/images/other.png",
      prompt: "别人的图",
      parentImageId: null,
      generationType: "initial",
      isCurrent: false,
    });
    const promoted = await db.promoteStoryImageToCurrent({
      imageId: image.id,
      storyId: STORY,
      userId: 8,
      adoption: signalId =>
        imageAdoptionCaptureIfEnabled({
          userId: 8,
          storyId: STORY,
          imageId: image.id,
          signalId,
          context: { entry: "select_image" },
        }),
    });
    expect(promoted).not.toBeNull();
    expect(await db.listPersonalMemoryEvents(8)).toHaveLength(0);
  });
});
