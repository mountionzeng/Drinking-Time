import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as runtime from "./repositories/runtime";
import { createStory } from "./repositories/stories";
import { chaptersRouter } from "./routers/chapters";

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key, url: `https://x/${key}` })),
  storageGet: vi.fn(async (key: string) => ({
    key,
    url: `https://x/${key}?sig=1`,
  })),
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
    const a = await caller(10).create({
      storyId: id,
      title: "一",
      body: "甲\n乙",
    });
    const b = await caller(10).create({ storyId: id, title: "二" });
    const c = await caller(10).create({ storyId: id, title: "三" });
    await caller(10).reorder({ storyId: id, order: [c.id, a.id, b.id] });
    expect((await caller(10).list({ storyId: id })).map(x => x.title)).toEqual([
      "三",
      "一",
      "二",
    ]);
    await expect(
      caller(10).reorder({ storyId: id, order: [a.id, b.id] })
    ).rejects.toThrow("不一致");
    await caller(10).remove({ chapterId: a.id });
    expect((await caller(10).list({ storyId: id })).map(x => x.title)).toEqual([
      "三",
      "二",
    ]);
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
    const saved = await caller(10).save({
      chapterId: a.id,
      expectedVersion: 1,
      layout: layout as never,
    });
    expect(saved.version).toBe(2);
    await expect(
      caller(10).save({ chapterId: a.id, expectedVersion: 1, title: "新" })
    ).rejects.toThrow("新版本");
    expect((await caller(10).get({ chapterId: a.id })).chapter.title).toBe(
      "一"
    );
  });

  it("changing the text keeps the layout", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "一", body: "甲" });
    await caller(10).save({
      chapterId: a.id,
      expectedVersion: 1,
      layout: layout as never,
    });
    const edited = await caller(10).save({
      chapterId: a.id,
      expectedVersion: 2,
      body: "甲改",
    });
    expect(edited.blocks.body).toBe("甲改");
    expect(edited.layout).toEqual(layout);
  });

  it("refuses a layout that embeds a data url", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "一", body: "甲" });
    const bad = {
      version: 1,
      pages: [
        {
          label: "p",
          modules: [
            {
              id: "image-0",
              kind: "image",
              imageUrl: "data:image/png;base64,AAAA",
              rect: { x: 0, y: 0, width: 100, height: 100 },
              crop: { x: 0, y: 0, width: 1, height: 1 },
            },
          ],
        },
      ],
    };
    await expect(
      caller(10).save({
        chapterId: a.id,
        expectedVersion: 1,
        layout: bad as never,
      })
    ).rejects.toThrow(/本机|图片|Invalid/);
  });

  it("layout autosaves do not fill the ten-version history", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "一", body: "甲" });
    let version = 1;
    for (let i = 0; i < 15; i++) {
      await caller(10).save({
        chapterId: a.id,
        expectedVersion: version,
        layout: layout as never,
        autosave: true,
      });
      version++;
    }
    expect(await caller(10).versions({ chapterId: a.id })).toHaveLength(0);
  });

  it("keeps only the latest ten old versions and can restore one", async () => {
    const id = await story();
    const a = await caller(10).create({ storyId: id, title: "v1" });
    let version = 1;
    for (let i = 2; i <= 14; i++) {
      await caller(10).save({
        chapterId: a.id,
        expectedVersion: version,
        title: `v${i}`,
      });
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
    const a = await caller(10).create({
      storyId: id,
      title: "海边",
      body: "第一行\n第二行",
    });
    const out = await caller(10).exportPackage({ chapterId: a.id });
    expect(out.package.kind).toBe("chapter-package");
    expect(
      out.package.chapters[0].blocks.filter(block => block.type === "text")
    ).toHaveLength(2);
  });

  it("keep creates a new story, append adds a chapter, and a retry does nothing", async () => {
    const pkg = fixture("valid-01-text-only.json");
    const requestId = uuid();
    const kept = await caller(20).importPackage({
      requestId,
      mode: "keep",
      package: pkg,
    });
    expect(kept.outcome).toBe("keep");
    const again = await caller(20).importPackage({
      requestId,
      mode: "keep",
      package: pkg,
    });
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
      caller(20).importPackage({
        requestId: uuid(),
        mode: "append",
        package: pkg,
      })
    ).rejects.toThrow("选择");
  });

  it("refuses a reused requestId with a different package", async () => {
    const requestId = uuid();
    await caller(20).importPackage({
      requestId,
      mode: "keep",
      package: fixture("valid-01-text-only.json"),
    });
    await expect(
      caller(20).importPackage({
        requestId,
        mode: "keep",
        package: fixture("valid-04-ai-marked.json"),
      })
    ).rejects.toThrow("已完成");
  });

  it("rejects invalid packages", async () => {
    await expect(
      caller(20).importPackage({
        requestId: uuid(),
        mode: "keep",
        package: fixture("invalid-version.json"),
      })
    ).rejects.toThrow("不是有效");
  });

  it("limits imports per hour", async () => {
    const pkg = fixture("valid-01-text-only.json");
    for (let i = 0; i < 20; i++)
      await caller(30).importPackage({
        requestId: uuid(),
        mode: "keep",
        package: pkg,
      });
    await expect(
      caller(30).importPackage({
        requestId: uuid(),
        mode: "keep",
        package: pkg,
      })
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
    const a = await caller(10).create({
      storyId: id,
      title: "海边",
      body: "第一行\n第二行",
    });
    const out = await caller(10).exportPackage({ chapterId: a.id });
    return { id, chapter: a, pkg: out.package };
  }
  const reply = (
    pkg: Awaited<ReturnType<typeof sent>>["pkg"],
    text: string
  ) => ({
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

    const { candidates } = await caller(10).candidates({
      chapterId: chapter.id,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].senderName).toBe("小朋友");
    const adopted = await caller(10).resolveCandidate({
      candidateId: candidates[0].id,
      status: "adopted",
      expectedVersion: chapter.version,
    });
    expect(adopted.chapter?.blocks.body.split("\n")[0]).toBe(
      "朋友改过的第一行"
    );
    expect(
      (await caller(10).versions({ chapterId: chapter.id }))[0].reason
    ).toBe("adopt-candidate");
    await expect(
      caller(10).resolveCandidate({
        candidateId: candidates[0].id,
        status: "dismissed",
      })
    ).rejects.toThrow("处理过");
  });

  it("dismissing leaves the chapter untouched", async () => {
    const { chapter, pkg } = await sent();
    await caller(10).importPackage({
      requestId: uuid(),
      mode: "keep",
      package: reply(pkg, "别人的"),
    });
    const { candidates } = await caller(10).candidates({
      chapterId: chapter.id,
    });
    await caller(10).resolveCandidate({
      candidateId: candidates[0].id,
      status: "dismissed",
    });
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

describe("chapter editing and package roundtrip", () => {
  const text = (id: string, value: string) => ({
    id,
    kind: "text" as const,
    text: value,
    rect: { x: 80, y: 80, width: 700, height: 100 },
    fontSize: 32,
    contentWidth: 700,
    contentHeight: 100,
    alignment: "start" as const,
  });
  it("stores text once, keeps block ids across module edits and exports the same binding", async () => {
    const id = await story();
    const a = await caller(10).create({
      storyId: id,
      title: "一",
      body: "甲\n乙",
    });
    const saved = await caller(10).save({
      chapterId: a.id,
      expectedVersion: 1,
      layout: {
        version: 1,
        pages: [
          {
            label: "页",
            modules: [text("paragraph-1", "乙改"), text("paragraph-0", "甲")],
          },
        ],
      },
      autosave: true,
    });
    expect(saved.blocks.body).toBe("甲\n乙改");
    expect(saved.blocks.blockIds).toEqual(a.blocks.blockIds);
    const persisted = runtime.memoryState.storyChapters.find(
      row => row.id === a.id
    )!;
    expect(JSON.stringify(persisted.layout)).not.toContain("乙改");
    const out = await caller(10).exportPackage({ chapterId: a.id });
    const firstModule = out.package.chapters[0].layout!.pages[0].modules[0];
    expect(firstModule).toMatchObject({
      bind: { blockId: a.blocks.blockIds[1] },
    });
    expect(out.package.chapters[0].blocks[1]).toMatchObject({
      text: "乙改",
      blockId: a.blocks.blockIds[1],
    });
    await caller(10).save({
      chapterId: a.id,
      expectedVersion: saved.version,
      body: "甲\n乙又改",
    });
    expect(
      (await caller(10).get({ chapterId: a.id })).chapter.layout!.pages[0]
        .modules[0]
    ).toMatchObject({ text: "乙又改" });
  });
  it("only mirrors its source, keeps the marker for geometry, and detaches after text edits", async () => {
    const id = await story();
    const a = await caller(10).create({
      storyId: id,
      title: "一",
      body: "甲",
      draftSource: "platform-A",
    });
    await expect(
      caller(10).save({
        chapterId: a.id,
        expectedVersion: 1,
        body: "串稿",
        mirrorFrom: "platform-B",
      })
    ).rejects.toThrow("独立编辑");
    const b = await caller(10).save({
      chapterId: a.id,
      expectedVersion: 1,
      body: "新甲",
      mirrorFrom: "platform-A",
    });
    const c = await caller(10).save({
      chapterId: a.id,
      expectedVersion: b.version,
      layout: {
        version: 1,
        pages: [{ label: "页", modules: [text("paragraph-0", "新甲")] }],
      },
      autosave: true,
    });
    expect(c.blocks.draftMirror?.source).toBe("platform-A");
    const d = await caller(10).save({
      chapterId: a.id,
      expectedVersion: c.version,
      layout: {
        version: 1,
        pages: [
          { label: "页", modules: [text("paragraph-0", "我的独立编辑")] },
        ],
      },
      autosave: true,
    });
    expect(d.blocks.draftMirror).toBeUndefined();
    await expect(
      caller(10).save({
        chapterId: a.id,
        expectedVersion: d.version,
        body: "想覆盖",
        mirrorFrom: "platform-A",
      })
    ).rejects.toThrow("独立编辑");
    expect(
      (await caller(10).get({ chapterId: a.id })).chapter.blocks.body
    ).toBe("我的独立编辑");
  });
  it("keeps lineage through another account and rejects adoption after the compared version changes", async () => {
    const id = await story();
    const a = await caller(10).create({
      storyId: id,
      title: "一",
      body: "原文",
    });
    const sent = await caller(10).exportPackage({ chapterId: a.id });
    const received = await caller(20).importPackage({
      requestId: uuid(),
      mode: "keep",
      package: sent.package,
    });
    await caller(20).save({
      chapterId: received.chapterId!,
      expectedVersion: 1,
      body: "朋友改过",
    });
    const returned = await caller(20).exportPackage({
      chapterId: received.chapterId!,
    });
    expect(returned.package.lineage).toEqual({
      rootPackageId: sent.package.packageId,
      parentPackageId: sent.package.packageId,
    });
    await caller(10).importPackage({
      requestId: uuid(),
      mode: "keep",
      package: returned.package,
    });
    const candidate = (await caller(10).candidates({ chapterId: a.id }))
      .candidates[0];
    await caller(10).save({
      chapterId: a.id,
      expectedVersion: 1,
      body: "我又改了",
    });
    await expect(
      caller(10).resolveCandidate({
        candidateId: candidate.id,
        status: "adopted",
        expectedVersion: 1,
      })
    ).rejects.toThrow("新版本");
    expect(
      (await caller(10).get({ chapterId: a.id })).chapter.blocks.body
    ).toBe("我又改了");
    await caller(10).resolveCandidate({
      candidateId: candidate.id,
      status: "adopted",
      expectedVersion: 2,
    });
    expect(
      (await caller(10).get({ chapterId: a.id })).chapter.blocks.body
    ).toBe("朋友改过");
    await caller(10).restoreVersion({
      chapterId: a.id,
      version: 2,
      expectedVersion: 3,
    });
    expect(
      (await caller(10).get({ chapterId: a.id })).chapter.blocks.body
    ).toBe("我又改了");
  });
  it("imports every chapter in a multi-chapter package", async () => {
    const pkg = fixture("valid-01-text-only.json");
    pkg.chapters.push({
      ...pkg.chapters[0],
      chapterId: "chapter-second",
      title: "第二章",
    });
    const result = await caller(20).importPackage({
      requestId: uuid(),
      mode: "keep",
      package: pkg,
    });
    expect(
      (await caller(20).list({ storyId: result.storyId })).map(row => row.title)
    ).toEqual([pkg.chapters[0].title, "第二章"]);
  });
  it("does not resolve arbitrary storage keys to other users' private images", async () => {
    const id = await story();
    const chapter = await caller(10).create({ storyId: id, title: "一" });
    await expect(
      caller(10).save({
        chapterId: chapter.id,
        expectedVersion: 1,
        layout: {
          version: 1,
          pages: [
            {
              label: "p",
              modules: [
                {
                  id: "image",
                  kind: "image",
                  imageUrl: "chapters/999/private.png",
                  rect: { x: 0, y: 0, width: 100, height: 100 },
                  crop: { x: 0, y: 0, width: 1, height: 1 },
                },
              ],
            },
          ],
        },
      })
    ).rejects.toThrow("未归属");
  });
});

it("deduplicates simultaneous import retries and keeps all chapters with their receipt", async () => {
  const input = {
    requestId: uuid(),
    mode: "keep" as const,
    package: fixture("valid-01-text-only.json"),
  };
  const results = await Promise.all([
    caller(20).importPackage(input),
    caller(20).importPackage(input),
  ]);
  expect(results[0].storyId).toBe(results[1].storyId);
  expect(
    runtime.memoryState.stories.filter(row => row.userId === 20)
  ).toHaveLength(1);
  expect(
    runtime.memoryState.chapterImports.filter(row => row.userId === 20)
  ).toHaveLength(1);
});

it("serializes adoption and dismissal so an ignored candidate cannot overwrite the chapter", async () => {
  const id = await story();
  const chapter = await caller(10).create({
    storyId: id,
    title: "原章",
    body: "原文",
  });
  const sent = await caller(10).exportPackage({ chapterId: chapter.id });
  const reply = structuredClone(sent.package);
  reply.packageId = "cp_reply00000001";
  reply.lineage = {
    rootPackageId: sent.package.packageId,
    parentPackageId: sent.package.packageId,
  };
  const block = reply.chapters[0].blocks[0];
  if (block.type === "text") block.text = "发回的修改";
  await caller(10).importPackage({
    requestId: uuid(),
    mode: "keep",
    package: reply,
  });
  const candidate = (await caller(10).candidates({ chapterId: chapter.id }))
    .candidates[0];
  const outcomes = await Promise.allSettled([
    caller(10).resolveCandidate({
      candidateId: candidate.id,
      status: "adopted",
      expectedVersion: 1,
    }),
    caller(10).resolveCandidate({
      candidateId: candidate.id,
      status: "dismissed",
    }),
  ]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(
    1
  );
  const final = (await caller(10).candidates({ chapterId: chapter.id }))
    .candidates[0];
  const current = (await caller(10).get({ chapterId: chapter.id })).chapter;
  expect(current.blocks.body).toBe(
    final.status === "adopted" ? "发回的修改" : "原文"
  );
});
