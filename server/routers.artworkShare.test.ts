import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { artworkShareRouter } from "./routers/artworkShare";
import * as runtime from "./repositories/runtime";
import { createStory } from "./repositories/stories";
import type { TrpcContext } from "./_core/context";
const caller = (id: number | null) =>
  artworkShareRouter.createCaller({
    user: id ? { id, name: "小林", email: "private@example.com", openId: "secret-open-id" } : null,
    req: {},
    res: { setHeader: vi.fn() },
  } as unknown as TrpcContext);
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  runtime.resetMemoryStateForTesting();
});
async function fixture() {
  const { id } = await createStory({
    userId: 10,
    title: "未分享的故事名称",
    body: { secret: "private-memory" },
  });
  const image = await sharp({
    create: { width: 20, height: 30, channels: 3, background: "#efe6cf" },
  })
    .png()
    .toBuffer();
  return {
    storyId: id,
    token: randomUUID(),
    title: "我的图文",
    pages: [`data:image/png;base64,${image.toString("base64")}`],
  };
}
describe("rendered artwork sharing", () => {
  it("publishes only re-encoded rendered pages, anonymously, without source account or story data", async () => {
    const input = await fixture();
    expect(await caller(10).create(input)).toEqual({
      path: `/p/${input.token}`,
    });
    const result = await caller(null).read({ token: input.token });
    expect(result.title).toBe(input.title);
    expect(result.author).toEqual({ name: "小林" });
    expect(result.pages[0]).toMatchObject({ width: 20, height: 30 });
    expect(result.pages[0].dataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(JSON.stringify(result)).not.toMatch(
      /private-memory|未分享的故事名称|userId|storyId|private@example.com|secret-open-id/
    );
    expect(JSON.stringify(runtime.memoryState.artworkShares)).not.toContain(
      input.token
    );
  });
  it("requires ownership for publishing and revoking; supports replay without duplicates", async () => {
    const input = await fixture();
    await expect(caller(null).create(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller(11).create(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await Promise.all([caller(10).create(input), caller(10).create(input)]);
    expect(runtime.memoryState.artworkShares).toHaveLength(1);
    await expect(
      caller(10).create({ ...input, title: "changed" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller(11).revoke({ storyId: input.storyId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller(10).revoke({ storyId: input.storyId });
    await expect(
      caller(null).read({ token: input.token })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(10).create(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("rejects arbitrary URLs, SVG, malformed pixels and over-size sets", async () => {
    const input = await fixture();
    for (const pages of [
      ["https://secret.example/a.png"],
      ["data:image/svg+xml;base64,AAAA"],
      ["data:image/png;base64,AAAA"],
      Array(10).fill(input.pages[0]),
    ])
      await expect(
        caller(10).create({ ...input, pages })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(runtime.memoryState.artworkShares).toHaveLength(0);
  });
  it("rolls back local writes when persistence fails", async () => {
    const input = await fixture();
    const write = vi
      .spyOn(runtime, "persistMemoryState")
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(caller(10).create(input)).rejects.toThrow("disk full");
    expect(runtime.memoryState.artworkShares).toHaveLength(0);
    write.mockRestore();
  });
  it("keeps the immutable artwork after source edits, but hides it after source removal", async () => {
    const input = await fixture();
    await caller(10).create(input);
    runtime.memoryState.stories[0].title = "changed source";
    expect((await caller(null).read({ token: input.token })).title).toBe(
      input.title
    );
    runtime.memoryState.stories = [];
    await expect(
      caller(null).read({ token: input.token })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
