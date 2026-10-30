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
  it("allows only one browser to save the same base version and retains the prior text", async () => {
    const id = await story();
    const first = await caller(10).create({storyId:id,title:"并发验收",body:"双方开始时的原稿"});
    const results = await Promise.allSettled(["浏览器甲的修改","浏览器乙的修改"].map(body =>
      caller(10).save({chapterId:first.id,expectedVersion:first.version,body})
    ));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected' && result.reason.code === 'CONFLICT')).toHaveLength(1);
    const winner = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<typeof first>;
    const saved = (await caller(10).get({chapterId:first.id})).chapter;
    expect(saved.blocks.body).toBe(winner.value.blocks.body);
    expect(saved.version).toBe(first.version+1);
    expect((await caller(10).version({chapterId:first.id,version:first.version})).chapter.blocks.body).toBe("双方开始时的原稿");
    // A comparison is a snapshot, not permission to overwrite later saves.
    const compared = saved.version;
    await caller(10).save({chapterId:first.id,expectedVersion:compared,body:"比较期间的更新"});
    await expect(caller(10).save({chapterId:first.id,expectedVersion:compared,body:"过期比较稿"})).rejects.toMatchObject({code:'CONFLICT'});
    expect((await caller(10).get({chapterId:first.id})).chapter.blocks.body).toBe("比较期间的更新");
  });
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

describe("local chapter images", () => {
  it("persists image facts and pixels with layout, keeps ownership checks, and reopens without local URLs", async () => {
    const sharp = (await import("sharp")).default;
    const base64 = (await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer()).toString("base64");
    const storyId = await story();
    const chapter = await caller(10).create({ storyId, title: "图文", body: "纸船" });
    const input = { chapterId: chapter.id, expectedVersion: chapter.version, layout: { version: 1 as const, pages: [{ label: "页", modules: [{ id: "image", kind: "image" as const, imageUrl: "local-image:0", rect: { x: 0, y: 0, width: 1, height: 1 }, crop: { x: 0, y: 0, width: 1, height: 1 } }] }] }, localImages: [{ ref: "local-image:0", base64 }] };
    await expect(caller(11).save(input)).rejects.toThrow();
    await caller(10).save(input);
    const reopened = await caller(10).get({ chapterId: chapter.id });
    const key = Object.keys(reopened.chapter.blocks.images)[0];
    expect(key).toMatch(/^chapters\/10\/.+\.webp$/);
    expect(reopened.chapter.layout?.pages[0].modules[0]).toHaveProperty("imageUrl", key);
    expect(reopened.chapter.blocks.images[key]).toMatchObject({ mime: "image/webp", width: 2, height: 2, aiGenerated: false });
    expect(reopened.imageUrls[key]).toContain(key);
    await expect(caller(10).save(input)).rejects.toThrow("新版本");
  });
});

it("preserves imported authorship in history while own edits get the authenticated editor", async () => {
  const pkg=fixture("valid-01-text-only.json");
  pkg.sender.displayName="朋友小禾";
  const kept=await caller(20).importPackage({requestId:uuid(),mode:"keep",package:pkg});
  const chapter=(await caller(20).get({chapterId:kept.chapterId!})).chapter;
  expect(chapter.blocks.attribution).toMatchObject({editorName:"朋友小禾",action:"received"});
  const unchanged=await caller(20).save({chapterId:chapter.id,expectedVersion:chapter.version,body:chapter.blocks.body,autosave:true});
  expect(unchanged.blocks.attribution).toEqual(chapter.blocks.attribution);
  const edited=await caller(20).save({chapterId:chapter.id,expectedVersion:unchanged.version,body:"我修改的最新正文"});
  expect(edited.blocks.attribution).toMatchObject({editorName:"测试用户",sourceName:"朋友小禾",action:"edited"});
  const versions=await caller(20).versions({chapterId:chapter.id});
  expect(versions.find(row=>row.version===unchanged.version)?.attribution?.editorName).toBe("朋友小禾");
});

it("sharing history shows only this chapter and this account's own exchanges", async () => {
  vi.stubEnv("CHAPTER_DELIVERY_ENABLED","true");
  const {chapterDeliveryRouter}=await import("./routers/chapterDelivery");
  const delivery=(id:number)=>chapterDeliveryRouter.createCaller({user:{id,name:`作者${id}`},req:{},res:{}} as TrpcContext);
  const a=await caller(10).create({storyId:await story(),title:"纸船",body:"最新文字"});
  const out=await caller(10).exportPackage({chapterId:a.id});
  const sent=await delivery(10).createClaimLink({package:out.package,requestId:uuid()});
  await delivery(20).claim({token:sent.claimUrl!.split('/').at(-1)!});
  const kept=await caller(20).importPackage({requestId:uuid(),mode:"keep",package:out.package});
  await delivery(20).resolve({deliveryId:sent.deliveryId,status:"kept"});
  expect(await caller(10).sharingHistory({chapterId:a.id})).toMatchObject([{direction:"sent",status:"kept"}]);
  expect(await caller(20).sharingHistory({chapterId:kept.chapterId!})).toMatchObject([{direction:"received",senderName:"作者10"}]);
  await expect(caller(30).sharingHistory({chapterId:a.id})).rejects.toThrow();
  const unrelated=await caller(10).create({storyId:await story(),title:"别的故事"});
  expect(await caller(10).sharingHistory({chapterId:unrelated.id})).toEqual([]);
  const second=await delivery(10).createClaimLink({package:out.package,requestId:uuid()});
  await delivery(30).claim({token:second.claimUrl!.split('/').at(-1)!});
  expect(await caller(20).sharingHistory({chapterId:kept.chapterId!})).toHaveLength(1);
});

it("reads an old version without restoring it and refuses other accounts", async () => {
  const id = await story();
  const first = await caller(10).create({ storyId: id, title: "第一稿", body: "蓝色纸船" });
  const updated = await caller(10).save({ chapterId: first.id, expectedVersion: first.version, body: "红色纸船", changeNote: "我把颜色改成了红色" });
  const old = await caller(10).version({ chapterId: first.id, version: first.version });
  expect(old.chapter.blocks.body).toBe("蓝色纸船");
  expect((await caller(10).get({chapterId:first.id})).chapter.version).toBe(updated.version);
  await expect(caller(20).version({chapterId:first.id,version:first.version})).rejects.toThrow();
  await expect(caller(10).version({chapterId:first.id,version:99999})).rejects.toThrow();
});

it("only stores a writer supplied note and does not inherit it for later edits", async () => {
  const id = await story();
  const first = await caller(10).create({ storyId: id, title: "一", body: "原文" });
  expect(first.blocks.attribution?.changeNote).toBeUndefined();
  const next = await caller(10).save({ chapterId: first.id, expectedVersion: first.version, body: "改文", changeNote: "  自己写的说明  " });
  expect(next.blocks.attribution?.changeNote).toBe("自己写的说明");
  const final = await caller(10).save({ chapterId: first.id, expectedVersion: next.version, body: "再改" });
  expect(final.blocks.attribution?.changeNote).toBeUndefined();
  expect((await caller(10).version({chapterId:first.id,version:next.version})).chapter.blocks.attribution?.changeNote).toBe("自己写的说明");
  const exported = await caller(10).exportPackage({chapterId:first.id,changeNote:"发给朋友的说明"});
  expect(exported.package.sender.changeNote).toBe("发给朋友的说明");
  expect((await caller(10).exportPackage({chapterId:first.id})).package.sender.changeNote).toBeUndefined();
  const imported = await caller(20).importPackage({requestId:uuid(),mode:"keep",package:exported.package});
  expect((await caller(20).get({chapterId:imported.chapterId!})).chapter.blocks.attribution?.changeNote).toBe("发给朋友的说明");
});

it('persists formatting-only changes with CAS and restores their version across clients', async()=>{
  const id=await story();
  const created=await caller(10).create({storyId:id,title:'Book',body:'Heading\nText'});
  const writingStyle=[{id:'h',format:'heading2' as const,parentId:null,collapsed:true},{id:'p',format:'text' as const,parentId:'h',collapsed:false,emphasis:'bright' as const}];
  const styled=await caller(10).save({chapterId:created.id,expectedVersion:created.version,body:'Heading\nText',writingStyle});
  expect((await caller(10).get({chapterId:created.id})).chapter.blocks.writingStyle).toEqual(writingStyle);
  await expect(caller(10).save({chapterId:created.id,expectedVersion:created.version,writingStyle})).rejects.toThrow();
  const plain=await caller(10).save({chapterId:created.id,expectedVersion:styled.version,body:'New heading\nText'});
  expect(plain.blocks.writingStyle).toBeUndefined();
  const restored=await caller(10).restoreVersion({chapterId:created.id,expectedVersion:plain.version,version:styled.version});
  expect(restored.blocks.writingStyle).toEqual(writingStyle);
  await expect(caller(20).get({chapterId:created.id})).rejects.toThrow();
});
it('rejects formatting that has mismatched lines or invalid nesting',async()=>{
  const id=await story();const created=await caller(10).create({storyId:id,title:'Book',body:'A\nB'});
  await expect(caller(10).save({chapterId:created.id,expectedVersion:created.version,writingStyle:[{id:'a',format:'text',parentId:null,collapsed:false}]})).rejects.toThrow();
  await expect(caller(10).save({chapterId:created.id,expectedVersion:created.version,writingStyle:[{id:'a',format:'text',parentId:null,collapsed:false},{id:'b',format:'text',parentId:'a',collapsed:false}]})).rejects.toThrow();
});

it('saves and restores a two-column row without dropping its membership on another client', async()=>{
  const id=await story();
  const created=await caller(10).create({storyId:id,title:'Columns',body:'Left\nRight'});
  const writingStyle=['left','right'].map(id=>({id,format:'text' as const,parentId:null,collapsed:false,columnGroup:'paired-row'}));
  const saved=await caller(10).save({chapterId:created.id,expectedVersion:created.version,writingStyle});
  expect((await caller(10).get({chapterId:created.id})).chapter.blocks.writingStyle).toEqual(writingStyle);
  await expect(caller(10).save({chapterId:created.id,expectedVersion:created.version,writingStyle})).rejects.toThrow();
  const unpaired=await caller(10).save({chapterId:created.id,expectedVersion:saved.version,writingStyle:writingStyle.map(({columnGroup,...row})=>row)});
  const restored=await caller(10).restoreVersion({chapterId:created.id,expectedVersion:unpaired.version,version:saved.version});
  expect(restored.blocks.writingStyle).toEqual(writingStyle);
  await expect(caller(10).save({chapterId:created.id,expectedVersion:restored.version,writingStyle:[writingStyle[0],{...writingStyle[1],columnGroup:'orphan'}]})).rejects.toThrow();
});
