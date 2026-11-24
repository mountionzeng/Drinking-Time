import { createHash, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { COOKIE_NAME } from "../../shared/const";
import { createContext } from "../_core/context";
import { ENV } from "../_core/env";
import { sdk } from "../_core/sdk";
import { putChapterMedia } from "../chapterMediaStore";
import { upsertUser, createStory, createGeneratedImage, updateStory } from "../db";
import { insertChapter } from "../repositories/chapters";
import { artSystemsRouter } from "../routers/artSystems";
import { openPreviewCoverCopy } from "./previewCoverCopy";

const upload = vi.hoisted(() => vi.fn());
vi.mock("./videoTransition302", async original => ({ ...await original<typeof import("./videoTransition302")>(), uploadFileTo302: upload }));
const saved = { appOrigin: ENV.appOrigin, cookieSecret: ENV.cookieSecret, databaseUrl: ENV.databaseUrl };
afterEach(() => { Object.assign(ENV, saved); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function account(name: string) {
  const openId = `email:${name}@example.invalid`;
  await upsertUser({ openId, name, role: "user", loginMethod: "email" });
  const token = await sdk.createSessionToken(openId, { name });
  const ctx = await createContext({ req: { headers: { cookie: `${COOKIE_NAME}=${token}` } }, res: {} } as Parameters<typeof createContext>[0]);
  expect(ctx.user?.role).toBe("user");
  return { id: ctx.user!.id, caller: artSystemsRouter.createCaller(ctx), ctx };
}

it("uses separate signed-in authors' books and prepares only the explicitly authorized reduced cover", async () => {
  vi.stubEnv("DISABLE_AUTH", "false");
  Object.assign(ENV, { databaseUrl: "", appOrigin: "http://localhost:3000", cookieSecret: randomUUID() });
  const a = await account("author-a"), b = await account("author-b");
  expect(a.id).not.toBe(b.id);
  const shot = { stableShotId: "scene", shotNo: 1, promptDraft: "海边的云。画面为海岸的黑白照片。" };
  const alice = await createStory({ userId: a.id, title: "Harbour", body: { shots: [shot] } });
  const bob = await createStory({ userId: b.id, title: "Meadow", body: { shots: [shot] } });
  const original = await sharp({ create: { width: 80, height: 60, channels: 3, background: "blue" } }).jpeg().withMetadata().toBuffer();
  const digest = createHash("sha256").update(original).digest("hex");
  const key = `chapters/${a.id}/${digest}.jpg`, source = `/api/wechat-import/media/${digest}.jpg`;
  await putChapterMedia(key, original);
  await insertChapter({ storyId: alice.id, userId: a.id, content: { title: "Harbour", layout: null, blocks: {
    body: "Sea", images: { [key]: { sha256: digest, mime: "image/jpeg", width: 80, height: 60, bytes: original.length, aiGenerated: false } },
    wechatImport: { storyId: "fixture", revisionId: "1", version: 1, importedAt: new Date().toISOString(), modules: [], warnings: [] },
    blockIds: [], containsAiText: false, settings: null, coverKey: key, bodyTextureKey: null, illustrations: [],
  } } });
  const image = await createGeneratedImage({ storyId: alice.id, userId: a.id, imageKey: key, imageUrl: source, prompt: "paper", isCurrent: false });
  await updateStory(alice.id, a.id, { body: { shots: [shot], publishing: { cover: { assetId: image.id, createdAt: 1, sourceCoreRevision: 1 } },
    artDirection: { recipe: { version: 1, system: { name: "Gouache", confirmedAt: 1, filmStyleImageId: image.id } } } } });
  expect(await a.caller.previewArtBasis({ storyId: alice.id })).toMatchObject({ source: "Harbour", coverImageId: image.id, needsCoverCopy: true });
  expect(await b.caller.previewArtBasis({ storyId: bob.id })).toMatchObject({ source: "Meadow", coverImageId: null, needsCoverCopy: false });
  const plan = { storyId: alice.id, sampleShotIds: ["scene"], instruction: "试图", operationToken: randomUUID() };
  await expect(a.caller.previewPlan(plan)).rejects.toThrow("勾选");
  await expect(b.caller.previewPlan({ ...plan, storyId: bob.id, coverCopyImageId: image.id })).rejects.toThrow("封面已更换");
  await expect(b.caller.previewArtBasis({ storyId: alice.id })).rejects.toThrow();
  expect(upload).not.toHaveBeenCalled();
  const plain = await b.caller.previewPlan({ ...plan, storyId: bob.id });
  expect(plain.baselineImageId).toBeNull();
  expect(plain.coverCopy).toBeUndefined();

  let copy = Buffer.alloc(0);
  upload.mockImplementation(async ({ bytes }) => { copy = Buffer.from(bytes); return "https://file.302.ai/synth.jpg"; });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(copy), { headers: { "content-type": "image/jpeg" } })));
  const batch = await a.caller.previewPlan({ ...plan, coverCopyImageId: image.id });
  expect((await a.caller.previewPlan({ ...plan, coverCopyImageId: image.id })).id).toBe(batch.id);
  expect(upload).toHaveBeenCalledTimes(1);
  const metadata = await sharp(copy).metadata();
  expect([metadata.width, metadata.height, metadata.exif, metadata.icc]).toEqual([40,30,undefined,undefined]);
  expect(copy.equals(original)).toBe(false);
  expect(JSON.stringify(batch)).not.toContain("synth.jpg");
  const scope = { userId: a.id, storyId: alice.id, imageId: image.id, roundId: batch.id };
  const receipt = batch.coverCopy!.receipt;
  expect(await openPreviewCoverCopy(receipt, scope)).toMatchObject({ source, url: expect.stringContaining("synth.jpg") });
  for (const change of [{ userId: b.id }, { storyId: bob.id }, { roundId: randomUUID() }])
    await expect(openPreviewCoverCopy(receipt, { ...scope, ...change })).rejects.toThrow("失效");
  await expect(b.caller.previewRead({ storyId: alice.id })).rejects.toThrow();
  expect((await a.caller.previewRead({ storyId: alice.id }))[0].shots[0].status).toBe("planned");
  expect((await b.caller.previewRead({ storyId: bob.id }))[0].coverCopy).toBeUndefined();
  const other = await createGeneratedImage({ storyId: bob.id, userId: b.id, imageUrl: "https://example.invalid/meadow.jpg", prompt: "pastel", isCurrent: false });
  await updateStory(bob.id, b.id, { body: { shots: [shot], publishing: { cover: { assetId: other.id, createdAt: 1, sourceCoreRevision: 1 } } } });
  expect(await b.caller.previewArtBasis({ storyId: bob.id })).toMatchObject({ coverImageId: other.id, needsCoverCopy: false });
  expect((await b.caller.previewPlan({ ...plan, storyId: bob.id, operationToken: randomUUID() })).baselineImageId).toBe(other.id);
  const generator = await import("./legnextImage");
  const render = vi.spyOn(generator, "generateLegnextImage").mockResolvedValue({ status: "error", message: "simulated supplier refusal" });
  try {
    const { appRouter } = await import("../routers");
    await appRouter.createCaller(a.ctx).storyAgent.generateForMobile({ storyId: alice.id, previewBatchId: batch.id,
      shotNo: 1, costConfirmation: { accepted: true, estimatedCny: 0.68 } });
    expect(render).toHaveBeenCalledTimes(1);
    const options = render.mock.calls[0][2];
    expect(options?.referenceImageUrl).toBeUndefined();
    expect(options?.styleRef).toContain("synth.jpg");
    expect(render.mock.calls[0][0]).toMatch(/--no [^\n]*, color/);
    expect(JSON.stringify(options)).not.toMatch(/wechat-import|data:image/);
  } finally { render.mockRestore(); }
});
