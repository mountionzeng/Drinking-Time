import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as runtime from "./repositories/runtime";
import { createStory } from "./repositories/stories";
import { chaptersRouter } from "./routers/chapters";

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key, url: `https://x/${key}` })),
  storageGet: vi.fn(async (key: string) => ({ key, url: `https://x/${key}?sig=1` })),
}));

const fixture = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/chapter-package/${name}`, "utf8"));
const caller = (userId: number | null) =>
  chaptersRouter.createCaller({
    user: userId ? { id: userId, name: "测试用户" } : null,
    res: { setHeader: vi.fn() },
    req: {},
  } as unknown as TrpcContext);
const uuid = () => crypto.randomUUID();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("CHAPTER_PACKAGE_ENABLED", "true");
  runtime.resetMemoryStateForTesting();
});

async function story(userId = 10) {
  return (await createStory({ userId, title: "故事A", body: {} })).id;
}

describe("chapters switch", () => {
  it("refuses every route when the switch is off", async () => {
    vi.stubEnv("CHAPTER_PACKAGE_ENABLED", "false");
    const id = await story();
    expect((await caller(10).enabled()).enabled).toBe(false);
    await expect(caller(10).list({ storyId: id })).rejects.toThrow("暂未开放");
    await expect(
      caller(10).create({ storyId: id, title: "一" })
    ).rejects.toThrow("暂未开放");
  });
});

describe("chapter CRUD and order", () => {
  it("creates, reorders and deletes chapters", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "一", body: "甲\n乙" });
    const b = await caller(10).create({ storyId: id, title: "二" });
    const c = await caller(10).create({ storyId: id, title: "三" });
    await caller(10).reorder({ storyId: id, order: [c.id, a.id, b.id] });
    expect((await caller(10).list({ storyId: id })).map(x => x.title)).toEqual(["三", "一", "二"]);
    await expect(
      caller(10).reorder({ storyId: id, order: [a.id, b.id] })
    ).rejects.toThrow("不一致");
    await caller(10).remove({ chapterId: a.id });
    expect((await caller(10).list({ storyId: id })).map(x => x.title)).toEqual(["三", "二"]);
  });

  it("keeps other users out", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "一" });
    await expect(caller(11).list({ storyId: id })).rejects.toThrow();
    await expect(caller(11).get({ chapterId: a.id })).rejects.toThrow();
    await expect(caller(11).remove({ chapterId: a.id })).rejects.toThrow();
  });
});

describe("layout saving", () => {
  const layout = {
    version: 1,
    pages: [{ label: "第一页", modules: [] }],
  };
  it("bumps the version and refuses a stale save", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "一", body: "甲" });
    const saved = await caller(10).save({ chapterId: a.id, expectedVersion: 1, layout: layout as never });
    expect(saved.version).toBe(2);
    await expect(
      caller(10).save({ chapterId: a.id, expectedVersion: 1, title: "新" })
    ).rejects.toThrow("新版本");
    expect((await caller(10).get({ chapterId: a.id })).chapter.title).toBe("一");
  });

  it("changing the text keeps the layout", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "一", body: "甲" });
    await caller(10).save({ chapterId: a.id, expectedVersion: 1, layout: layout as never });
    const edited = await caller(10).save({ chapterId: a.id, expectedVersion: 2, body: "甲改" });
    expect(edited.blocks.body).toBe("甲改");
    expect(edited.layout).toEqual(layout);
  });

  it("keeps only the latest ten old versions and can restore one", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "v1" });
    let version = 1;
    for (let i = 2; i <= 14; i++) {
      await caller(10).save({ chapterId: a.id, expectedVersion: version, title: `v${i}` });
      version++;
    }
    const kept = await caller(10).versions({ chapterId: a.id });
    expect(kept.length).toBe(10);
    const restored = await caller(10).restoreVersion({
      chapterId: a.id,
      version: kept[0].version,
      expectedVersion: version,
    });
    expect(restored.title).toBe(kept[0].title);
    expect(restored.version).toBe(version + 1);
  });
});

describe("export and import", () => {
  it("exports a package that passes the shared validator", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "海边", body: "第一行\n第二行" });
    const out = await caller(10).exportPackage({ chapterId: a.id });
    expect(out.package.kind).toBe("chapter-package");
    expect(out.package.chapters[0].blocks.filter(block => block.type === "text")).toHaveLength(2);
  });

  it("keep creates a new story, append adds a chapter, and a retry does nothing", async () => {
    const pkg = fixture("valid-01-text-only.json");
    const requestId = uuid();
    const kept = await caller(20).importPackage({ requestId, mode: "keep", package: pkg });
    expect(kept.outcome).toBe("keep");
    const again = await caller(20).importPackage({ requestId, mode: "keep", package: pkg });
    expect(again.repeated).toBe(true);
    expect(again.storyId).toBe(kept.storyId);
    expect((await caller(20).list({ storyId: kept.storyId })).length).toBe(1);

    const target = await story(20);
    const appended = await caller(20).importPackage({
      requestId: uuid(),
      mode: "append",
      storyId: target,
      package: pkg,
    });
    expect(appended.outcome).toBe("append");
    expect((await caller(20).list({ storyId: target })).length).toBe(1);
    await expect(
      caller(20).importPackage({ requestId: uuid(), mode: "append", package: pkg })
    ).rejects.toThrow("选择");
  });

  it("refuses a reused requestId with a different package", async () => {
    const requestId = uuid();
    await caller(20).importPackage({ requestId, mode: "keep", package: fixture("valid-01-text-only.json") });
    await expect(
      caller(20).importPackage({ requestId, mode: "keep", package: fixture("valid-04-ai-marked.json") })
    ).rejects.toThrow("已完成");
  });

  it("rejects invalid packages", async () => {
    await expect(
      caller(20).importPackage({ requestId: uuid(), mode: "keep", package: fixture("invalid-version.json") })
    ).rejects.toThrow("不是有效");
  });

  it("limits imports per hour", async () => {
    const pkg = fixture("valid-01-text-only.json");
    for (let i = 0; i < 20; i++)
      await caller(30).importPackage({ requestId: uuid(), mode: "keep", package: pkg });
    await expect(
      caller(30).importPackage({ requestId: uuid(), mode: "keep", package: pkg })
    ).rejects.toThrow("太频繁");
  });

  it("imports a layout package, dropping images whose bytes were not sent", async () => {
    const out = await caller(20).importPackage({
      requestId: uuid(),
      mode: "keep",
      package: fixture("valid-02-layout-two-images.json"),
    });
    expect(out.missingImages).toBeGreaterThan(0);
    const chapter = (await caller(20).list({ storyId: out.storyId }))[0];
    expect(chapter.layout).not.toBeNull();
    expect(JSON.stringify(chapter)).not.toContain("data:");
  });
});

describe("returned candidates", () => {
  async function sent() {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "海边", body: "第一行\n第二行" });
    const out = await caller(10).exportPackage({ chapterId: a.id });
    return { id, chapter: a, pkg: out.package };
  }
  const reply = (pkg: Awaited<ReturnType<typeof sent>>["pkg"], text: string) => ({
    ...pkg,
    packageId: "cp_returned00000001",
    lineage: { rootPackageId: pkg.packageId, parentPackageId: pkg.packageId },
    sender: { platform: "miniprogram", displayName: "小朋友" },
    chapters: pkg.chapters.map(chapter => ({
      ...chapter,
      blocks: chapter.blocks.map((block, index) =>
        block.type === "text" && index === 0 ? { ...block, text } : block
      ),
    })),
  });

  it("attaches to the chapter, then adopting makes a new version and keeps the old", async () => {
    const { chapter, pkg, id } = await sent();
    const out = await caller(10).importPackage({
      requestId: uuid(),
      mode: "keep",
      package: reply(pkg, "朋友改过的第一行"),
    });
    expect(out.outcome).toBe("candidate");
    expect(out.chapterId).toBe(chapter.id);
    expect((await caller(10).list({ storyId: id })).length).toBe(1);

    const { candidates } = await caller(10).candidates({ chapterId: chapter.id });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].senderName).toBe("小朋友");
    const adopted = await caller(10).resolveCandidate({ candidateId: candidates[0].id, status: "adopted" });
    expect(adopted.chapter?.blocks.body.split("\n")[0]).toBe("朋友改过的第一行");
    expect((await caller(10).versions({ chapterId: chapter.id }))[0].reason).toBe("adopt-candidate");
    await expect(
      caller(10).resolveCandidate({ candidateId: candidates[0].id, status: "dismissed" })
    ).rejects.toThrow("处理过");
  });

  it("dismissing leaves the chapter untouched", async () => {
    const { chapter, pkg } = await sent();
    await caller(10).importPackage({ requestId: uuid(), mode: "keep", package: reply(pkg, "别人的") });
    const { candidates } = await caller(10).candidates({ chapterId: chapter.id });
    await caller(10).resolveCandidate({ candidateId: candidates[0].id, status: "dismissed" });
    const now = (await caller(10).get({ chapterId: chapter.id })).chapter;
    expect(now.version).toBe(1);
    expect(now.blocks.body.split("\n")[0]).toBe("第一行");
  });

  it("a package from someone else's export is an ordinary import", async () => {
    const { pkg } = await sent();
    const out = await caller(40).importPackage({
      requestId: uuid(),
      mode: "keep",
      package: reply(pkg, "x"),
    });
    expect(out.outcome).toBe("keep");
  });
});
