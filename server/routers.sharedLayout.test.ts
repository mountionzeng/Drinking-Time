import { emptyMemorySpace } from "../shared/memorySpace";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { artworkShareRouter } from "./routers/artworkShare";
import * as runtime from "./repositories/runtime";
import { createStory, getStoryById } from "./repositories/stories";
import { storeImageBytes } from "./services/imageGen";
import type { SharedLayoutPackage } from "../shared/sharedLayout";

vi.mock("./services/imageGen", () => ({
  localImageDir: "/unused",
  storeImageBytes: vi.fn(),
}));

const names: Record<number, string> = { 10: "小林", 20: "小周", 30: "路人" };
const caller = (id: number | null) =>
  artworkShareRouter.createCaller({
    user: id ? { id, name: names[id] } : null,
    req: {},
    res: { setHeader: vi.fn() },
  } as unknown as TrpcContext);

async function picture(color: string) {
  const bytes = await sharp({
    create: { width: 40, height: 30, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function layout(title: string, colors: string[]): Promise<SharedLayoutPackage> {
  return {
    settings: {
      title,
      style: "sage",
      fontId: "noto-serif-sc",
      texture: "paper",
      textureSeed: 3,
      includeCover: true,
      cover: 0,
      bodyTexture: null,
      illustrations: colors.length > 1 ? [{ image: 1, after: null }] : [],
    },
    modules: {
      version: 1,
      flowVersion: 1,
      pages: [
        {
          label: "封面",
          modules: [
            {
              id: "cover-image",
              kind: "image",
              imageUrl: "layout-image:0",
              rect: { x: 65, y: 110, width: 770, height: 578 },
              crop: { x: 0, y: 0, width: 1, height: 1 },
            },
            {
              id: "cover-title",
              kind: "text",
              text: title,
              fontSize: 60,
              contentWidth: 774,
              contentHeight: 228,
              alignment: "center",
              rect: { x: 63, y: 840, width: 774, height: 228 },
            },
          ],
        },
      ],
    },
    images: await Promise.all(colors.map(picture)),
  };
}

let stored = 0;
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  runtime.resetMemoryStateForTesting();
  stored = 0;
  vi.mocked(storeImageBytes)
    .mockReset()
    .mockImplementation(async (_bytes, _mime, options) => {
      stored++;
      return {
        status: "ok",
        imageUrl: `/api/images/${options!.storageKey!.split("/").pop()}`,
        imageKey: options?.storageKey,
      };
    });
});

async function share(permissions = { rewrite: true, fork: true }) {
  const { id } = await createStory({
    userId: 10,
    title: "秋天的茶",
    body: { secret: "author-memory" },
  });
  const input = {
    storyId: id,
    token: randomUUID(),
    title: "秋天的茶",
    pages: [await picture("#efe6cf")],
    permissions,
    work: {
      title: "秋天的茶",
      body: "第一段。\n第二段。",
      tags: [],
      platform: "xiaohongshu" as const,
    },
    layout: await layout("秋天的茶", ["#c96", "#369"]),
  };
  await caller(10).create(input);
  return { authorStoryId: id, input };
}

describe("shared layout co-creation", () => {
  it("never exposes the editable layout through the public link", async () => {
    const { input } = await share();
    const result = await caller(null).read({ token: input.token });
    expect(result.hasLayout).toBe(true);
    expect(result).not.toHaveProperty("layout");
    expect(JSON.stringify(result)).not.toMatch(/layout-image|cover-title/);
  });

  it("rejects a layout on view-only links", async () => {
    const { id } = await createStory({ userId: 10, title: "x", body: {} });
    await expect(
      caller(10).create({
        storyId: id,
        token: randomUUID(),
        title: "x",
        pages: [await picture("#fff")],
        layout: await layout("x", ["#c96"]),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(runtime.memoryState.artworkShares).toHaveLength(0);
  });

  it("copies the layout and its pictures into the recipient's own story once", async () => {
    const { input } = await share();
    const { storyId } = await caller(20).accept({ token: input.token });
    await caller(20).accept({ token: input.token });
    expect(stored).toBe(2);
    const state = await caller(20).layout({ storyId });
    expect(state.inherited?.authorName).toBe("小林");
    expect(state.inherited?.settings).toMatchObject({ title: "秋天的茶", cover: 0 });
    expect(state.inherited?.assets).toHaveLength(2);
    const coverUrl = state.inherited!.assets[0].imageUrl;
    expect(coverUrl).toMatch(/^\/api\/images\/[a-f0-9]{64}\.webp$/);
    const imageModule = state.inherited!.modules!.pages[0].modules[0];
    expect(imageModule).toMatchObject({ kind: "image", imageUrl: coverUrl });
    // The pictures belong to the recipient's story; the author's story is untouched.
    const images = runtime.memoryState.generatedImages.filter(
      row => row.storyId === storyId
    );
    expect(images.map(row => row.userId)).toEqual([20, 20]);
    expect(JSON.stringify(await getStoryById(storyId, 20))).not.toContain(
      "author-memory"
    );
    // A generic whole-story save cannot overwrite the server-owned layout.
    expect(state.candidates).toEqual([]);
  });

  it("shares the recipient's layout back as a labelled candidate the author adopts or ignores", async () => {
    const { authorStoryId, input } = await share();
    const { storyId } = await caller(20).accept({ token: input.token });
    const activityState = emptyMemorySpace();
    activityState.activity[storyId] = { totalMs: 90_000, lastCreditedAt: Date.now(), sessions: [] };
    runtime.memoryState.accountMemorySpaces.push({ userId: 20, revision: 0, state: activityState, createdAt: new Date(), updatedAt: new Date() });
    const operationToken = randomUUID();
    const edited = await layout("和小周一起改的秋天", ["#c96", "#963", "#369"]);
    const before = structuredClone(
      (await getStoryById(authorStoryId, 10))!.body
    );
    await expect(
      caller(20).shareBackLayout({ storyId, operationToken, layout: edited })
    ).resolves.toEqual({ submitted: true });
    await expect(
      caller(20).shareBackLayout({ storyId, operationToken, layout: edited })
    ).resolves.toEqual({ submitted: true });
    await expect(
      caller(20).shareBackLayout({
        storyId,
        operationToken,
        layout: await layout("另一个", ["#000"]),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const author = await caller(10).layout({ storyId: authorStoryId });
    expect(author.candidates).toHaveLength(1);
    const [candidate] = author.candidates;
    expect(candidate.activeEditingMs).toBe(90_000);
    activityState.activity[storyId].totalMs = 180_000;
    expect(candidate.activeEditingMs).toBe(90_000);
    expect(candidate).toMatchObject({
      authorName: "小周",
      status: "pending",
      settings: { title: "和小周一起改的秋天" },
    });
    expect(candidate).not.toHaveProperty("contributorUserId");
    expect(candidate).not.toHaveProperty("requestHash");
    expect(candidate.assets).toHaveLength(3);
    // Pictures now live in the author's library; nothing else changed yet.
    expect(
      runtime.memoryState.generatedImages.filter(
        row => row.storyId === authorStoryId && row.userId === 10
      )
    ).toHaveLength(3);
    const after = (await getStoryById(authorStoryId, 10))!.body as any;
    expect(after.publishing).toEqual((before as any).publishing);
    expect(after.secret).toBe("author-memory");

    await caller(10).resolveLayoutCandidate({
      storyId: authorStoryId,
      candidateId: candidate.id,
      status: "adopted",
    });
    expect(
      (await caller(10).layout({ storyId: authorStoryId })).candidates[0].status
    ).toBe("adopted");
    await expect(
      caller(20).resolveLayoutCandidate({
        storyId: authorStoryId,
        candidateId: candidate.id,
        status: "dismissed",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blocks strangers, fork-only copies and revoked shares", async () => {
    const { authorStoryId, input } = await share();
    const { storyId } = await caller(20).accept({ token: input.token });
    const body = await layout("x", ["#c96"]);
    await expect(
      caller(30).shareBackLayout({ storyId, operationToken: randomUUID(), layout: body })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(30).layout({ storyId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const own = await createStory({ userId: 30, title: "自己的", body: {} });
    await expect(
      caller(30).shareBackLayout({
        storyId: own.id,
        operationToken: randomUUID(),
        layout: body,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await caller(10).revoke({ storyId: authorStoryId });
    await expect(
      caller(20).shareBackLayout({ storyId, operationToken: randomUUID(), layout: body })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Revoking keeps the recipient's copy and its inherited layout.
    expect((await caller(20).layout({ storyId })).inherited).not.toBeNull();

    const forkOnly = await share({ rewrite: false, fork: true });
    const copy = await caller(20).accept({ token: forkOnly.input.token });
    await expect(
      caller(20).shareBackLayout({
        storyId: copy.storyId,
        operationToken: randomUUID(),
        layout: body,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects packages that reference missing pictures or foreign URLs", async () => {
    const { id } = await createStory({ userId: 10, title: "x", body: {} });
    const base = await layout("x", ["#c96"]);
    const broken = [
      { ...base, settings: { ...base.settings, cover: 4 } },
      {
        ...base,
        modules: {
          ...base.modules!,
          pages: [
            {
              label: "封面",
              modules: [
                { ...base.modules!.pages[0].modules[0], imageUrl: "https://evil.test/a.png" },
              ],
            },
          ],
        },
      },
      { ...base, images: ["data:image/png;base64,AAAA"] },
    ];
    for (const value of broken)
      await expect(
        caller(10).create({
          storyId: id,
          token: randomUUID(),
          title: "x",
          pages: [await picture("#fff")],
          permissions: { rewrite: true, fork: true },
          work: { title: "x", body: "y", tags: [], platform: "xiaohongshu" },
          layout: value as SharedLayoutPackage,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(runtime.memoryState.artworkShares).toHaveLength(0);
  });
});
