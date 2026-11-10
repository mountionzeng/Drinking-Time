import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryMaterialState,
} from "../../shared/storyMaterial";
const mocks = vi.hoisted(() => ({ material: vi.fn(), export: vi.fn() }));
vi.mock("./storyMaterials", () => ({ getStoryMaterialState: mocks.material }));
vi.mock("./videoExport", () => ({ exportStoryTimeline: mocks.export }));
const dir = await mkdtemp(path.join(os.tmpdir(), "video-workflow-"));
const previous = {
  path: process.env.LOCAL_PERSIST_PATH,
  db: process.env.DATABASE_URL,
};
process.env.LOCAL_PERSIST_PATH = path.join(dir, "state.json");
process.env.DATABASE_URL = "";
const { createStory, getStoryById } = await import("../repositories/stories");
const runtime = await import("../repositories/runtime");
const service = await import("./videoWorkflow");
const { mutateBookWorkflow } = await import("../repositories/bookWorkflow");
afterAll(async () => {
  if (previous.path === undefined) delete process.env.LOCAL_PERSIST_PATH;
  else process.env.LOCAL_PERSIST_PATH = previous.path;
  if (previous.db === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous.db;
  await rm(dir, { recursive: true, force: true });
});
const intent = { purpose: "纪念生活", audience: "家人", platform: "朋友圈" },
  actor = { userId: 62, name: "测试导演" };
let material: StoryMaterialState;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.export.mockResolvedValue({
    status: "ok",
    videoUrl: "/api/videos/export.mp4",
    durationSec: 5,
  });
});
async function fixture() {
  const story = await createStory({
    userId: 62,
    title: "成片测试",
    body: {
      _revision: 1,
      shots: [{ stableShotId: "s1", subject: "旧画面", action: "旧动作" }],
    },
  });
  material = {
    storyId: story.id,
    timeline: {
      storyId: story.id,
      version: 0,
      items: [
        {
          stableShotId: "s1",
          included: true,
          position: 0,
          plannedDurationMs: 5000,
          transform: DEFAULT_TIMELINE_TRANSFORM,
        },
      ],
      extensions: {
        subtitleTracks: { schemaVersion: 1, tracks: [], styles: [] },
        audioTracks: { schemaVersion: 1, tracks: [] },
      },
    },
    shots: [],
    unassignedImages: [],
    unassignedVideoTakes: [],
    reusableVideoTakes: [],
  };
  mocks.material.mockImplementation(async () => structuredClone(material));
  return {
    storyId: story.id,
    userId: 62,
    actor,
    id: randomUUID(),
    intent,
    summary: "保存初剪",
  };
}
it("freezes the exact timeline, subtitles, audio and shot prose; repeated save is idempotent", async () => {
  const input = await fixture(),
    version = await service.saveVideoWorkVersion(input);
  expect(version.number).toBe(1);
  expect(version.author).toEqual(actor);
  expect(version.shots[0].subject).toBe("旧画面");
  material.timeline.items[0].plannedDurationMs = 9000;
  expect(await service.saveVideoWorkVersion(input)).toEqual(version);
  const second = await service.saveVideoWorkVersion({
    ...input,
    id: randomUUID(),
    summary: "延长镜头",
  });
  expect(second.number).toBe(2);
  expect(second.parentId).toBe(version.id);
  expect(
    (await service.getVideoWorkflow(input)).state.versions[0].material.timeline
      .items[0].plannedDurationMs
  ).toBe(5000);
});
it("freezes selected media version references without recursively copying their history", async () => {
  const input = await fixture();
  material.timeline.extensions!.videoMediaVersions = { schemaVersion: 1, entries: [], current: { music: "media-version-2", subtitles: "media-version-1" } };
  const version = await service.saveVideoWorkVersion(input);
  expect(version.material.timeline.extensions?.videoMediaVersions).toBeUndefined();
  expect(version.material.timeline.extensions?.videoMediaVersionRefs).toEqual({ music: "media-version-2", subtitles: "media-version-1" });
});
it("exports from the chosen immutable version and records result without changing current editing", async () => {
  const input = await fixture(),
    version = await service.saveVideoWorkVersion(input);
  material.timeline.items[0].plannedDurationMs = 9000;
  const request = {
    ...input,
    id: version.id,
    exportId: randomUUID(),
    aspectRatio: "9:16" as const,
  };
  const result = await service.exportVideoWorkVersion(request);
  expect(result).toMatchObject({
    status: "ready",
    durationSec: 5,
    aspectRatio: "9:16",
    actor,
  });
  expect(
    mocks.export.mock.calls[0][0].frozenMaterial.timeline.items[0]
      .plannedDurationMs
  ).toBe(5000);
  expect(await service.exportVideoWorkVersion(request)).toEqual(result);
  expect(mocks.export).toHaveBeenCalledTimes(1);
  expect(material.timeline.items[0].plannedDurationMs).toBe(9000);
  await expect(
    service.exportVideoWorkVersion({ ...request, userId: 99 })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("retains failed export attempts and version contents", async () => {
  const input = await fixture(),
    version = await service.saveVideoWorkVersion(input);
  mocks.export.mockRejectedValue(new Error("missing file"));
  const result = await service.exportVideoWorkVersion({
    ...input,
    id: version.id,
    exportId: randomUUID(),
    aspectRatio: "16:9",
  });
  expect(result.status).toBe("failed");
  expect(
    (await service.getVideoWorkflow(input)).state.versions[0].shots
  ).toEqual(version.shots);
});
it("freezes legacy audio URL references instead of resolving them from later editing", async () => {
  const input = await fixture();
  material.timeline.extensions = {};
  await mutateBookWorkflow(input, ({ body }) => {
    body.chatCutImport = {
      sourceFormat: "xmeml",
      fps: 30,
      audioTracks: [
        {
          index: 1,
          clips: [
            {
              id: "audio-1",
              name: "音乐",
              audioUrl: "https://example.invalid/original.mp3",
              startFrame: 0,
              endFrame: 90,
              inFrame: 0,
              outFrame: 90,
            },
          ],
        },
      ],
    };
    return { result: true };
  });
  const version = await service.saveVideoWorkVersion(input);
  expect(version.legacyAudioSources).toEqual([
    expect.objectContaining({ url: "https://example.invalid/original.mp3" }),
  ]);
  await mutateBookWorkflow(input, ({ body }) => {
    body.chatCutImport = {};
    return { result: true };
  });
  await service.exportVideoWorkVersion({
    ...input,
    id: version.id,
    exportId: randomUUID(),
    aspectRatio: "16:9",
  });
  expect(mocks.export.mock.calls[0][0].frozenLegacyAudioSources).toEqual(
    version.legacyAudioSources
  );
});
it("rejects a timeline revision changed during snapshotting", async () => {
  const input = await fixture();
  material.timeline.version = 99;
  await expect(service.saveVideoWorkVersion(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await service.getVideoWorkflow(input)).state.versions).toEqual([]);
});
it("rolls back workflow and story state when persistence fails", async () => {
  const input = await fixture(),
    before = structuredClone(
      (await getStoryById(input.storyId, input.userId))!.body
    );
  const spy = vi
    .spyOn(runtime, "persistMemoryState")
    .mockRejectedValueOnce(new Error("disk failure"));
  await expect(
    mutateBookWorkflow(input, ({ body }) => {
      body.videoWorkflow = { schemaVersion: 1, versions: [] };
      return { result: true };
    })
  ).rejects.toThrow("disk failure");
  spy.mockRestore();
  expect((await getStoryById(input.storyId, input.userId))!.body).toEqual(
    before
  );
});
it("atomically preserves old editing with plan replacement and rejects a concurrent story write", async () => {
  const input = await fixture();
  const before = structuredClone(
    (await getStoryById(input.storyId, input.userId))!.body
  ) as Record<string, unknown>;
  const nextBody = {
    ...before,
    shots: [{ subject: "new plan" }],
    _revision: 2,
  };
  const request = { ...input, before, nextBody, expectedRevision: 1 };
  const spy = vi
    .spyOn(runtime, "persistMemoryState")
    .mockRejectedValueOnce(new Error("disk failure"));
  await expect(service.preserveVideoWhileReplacing(request)).rejects.toThrow(
    "disk failure"
  );
  spy.mockRestore();
  expect((await getStoryById(input.storyId, input.userId))!.body).toEqual(
    before
  );
  await service.preserveVideoWhileReplacing(request);
  const saved = (await getStoryById(input.storyId, input.userId))!.body as any;
  expect(saved._revision).toBe(2);
  expect(saved.shots).toEqual(nextBody.shots);
  expect(saved.videoWorkflow.versions[0].shots).toEqual(before.shots);
  await expect(
    service.preserveVideoWhileReplacing(request)
  ).rejects.toBeInstanceOf(service.VideoSnapshotConflictError);
  expect((await service.getVideoWorkflow(input)).state.versions).toHaveLength(
    1
  );
});
