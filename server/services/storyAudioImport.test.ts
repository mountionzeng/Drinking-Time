import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const execFileP = promisify(execFile);

let tmpDir: string;
let audioDir: string;
const prevAudioDir = process.env.LOCAL_AUDIO_DIR;
let goodWavBytes: Buffer;

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "dt-audio-import-"));
  audioDir = path.join(tmpDir, "audio");
  process.env.LOCAL_AUDIO_DIR = audioDir;
  const wavPath = path.join(tmpDir, "fixture.wav");
  await execFileP("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-t",
    "0.4",
    "-y",
    wavPath,
  ]);
  goodWavBytes = await readFile(wavPath);
});
afterAll(async () => {
  if (prevAudioDir === undefined) delete process.env.LOCAL_AUDIO_DIR;
  else process.env.LOCAL_AUDIO_DIR = prevAudioDir;
  await rm(tmpDir, { recursive: true, force: true });
});

const db = () => import("../db");
const importSvc = () => import("./storyAudioImport");

async function seedStory(userId = 1): Promise<number> {
  const { createStory } = await db();
  const story = await createStory({
    userId,
    title: "audio",
    body: { _revision: 1, shots: [] },
  });
  return story.id;
}

beforeEach(async () => {
  const { resetMemoryStateForTesting } = await db();
  resetMemoryStateForTesting();
});
afterEach(async () => {
  await rm(audioDir, { recursive: true, force: true });
});

describe("SSRF guard — assertAllowedRemoteAudioUrl", () => {
  it("accepts an HTTPS S3 url on 443", async () => {
    const { assertAllowedRemoteAudioUrl } = await importSvc();
    expect(() =>
      assertAllowedRemoteAudioUrl("https://my-bucket.s3.us-west-2.amazonaws.com/a.mp3")
    ).not.toThrow();
  });

  it.each([
    ["http://my-bucket.s3.amazonaws.com/a.mp3", "not-https"],
    ["https://evil.example.com/a.mp3", "host-not-allowed"],
    ["https://my-bucket.s3.amazonaws.com:8443/a.mp3", "port-not-allowed"],
    ["https://user:pw@my-bucket.s3.amazonaws.com/a.mp3", "has-credentials"],
    ["https://169.254.169.254/latest/meta-data/", "ip-not-public"],
    ["https://127.0.0.1/a.mp3", "ip-not-public"],
    ["https://10.0.0.5/a.mp3", "ip-not-public"],
    ["https://[::1]/a.mp3", "ip-not-public"],
    ["not a url", "bad-url"],
  ])("rejects %s (%s)", async (url, code) => {
    const { assertAllowedRemoteAudioUrl, UnsafeRemoteAudioError } = await importSvc();
    try {
      assertAllowedRemoteAudioUrl(url);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeRemoteAudioError);
      expect((error as { code: string }).code).toBe(code);
    }
  });
});

describe("SSRF guard — classifyRemoteIp", () => {
  it.each([
    ["8.8.8.8", "public"],
    ["1.2.3.4", "public"],
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.32.0.1", "public"],
    ["192.168.1.1", "private"],
    ["169.254.1.1", "link-local"],
    ["169.254.169.254", "cloud-metadata"],
    ["100.100.100.200", "cloud-metadata"],
    ["224.0.0.1", "multicast"],
    ["0.0.0.0", "unspecified"],
    ["::1", "loopback"],
    ["fe80::1", "link-local"],
    ["fc00::1", "unique-local"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:8.8.8.8", "public"],
  ])("classifies %s as %s", async (ip, expected) => {
    const { classifyRemoteIp } = await importSvc();
    expect(classifyRemoteIp(ip)).toBe(expected);
  });
});

describe("SSRF guard — DNS rebinding", () => {
  it("rejects a hostname that resolves to a private address", async () => {
    const { assertResolvedIpsArePublic, UnsafeRemoteAudioError } = await importSvc();
    const lookupImpl = (async () => [{ address: "10.9.8.7", family: 4 }]) as never;
    await expect(
      assertResolvedIpsArePublic("bucket.s3.amazonaws.com", { lookupImpl })
    ).rejects.toBeInstanceOf(UnsafeRemoteAudioError);
  });

  it("accepts a hostname that resolves only to public addresses", async () => {
    const { assertResolvedIpsArePublic } = await importSvc();
    const lookupImpl = (async () => [
      { address: "52.216.0.1", family: 4 },
      { address: "2600:1f18::1", family: 6 },
    ]) as never;
    await expect(
      assertResolvedIpsArePublic("bucket.s3.amazonaws.com", { lookupImpl })
    ).resolves.toBeUndefined();
  });
});

describe("fetchTrustedAudioBytes", () => {
  it("follows an allow-listed redirect and streams the body under the cap", async () => {
    const { fetchTrustedAudioBytes } = await importSvc();
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.s3.amazonaws.com/final.mp3" },
        });
      }
      return new Response(goodWavBytes as unknown as BodyInit);
    }) as never;
    const lookupImpl = (async () => [{ address: "52.0.0.1", family: 4 }]) as never;
    const out = await fetchTrustedAudioBytes(
      "https://bucket.s3.amazonaws.com/a.mp3",
      { fetchImpl, lookupImpl }
    );
    expect(out.equals(goodWavBytes)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("rejects a redirect that points off the allow-list", async () => {
    const { fetchTrustedAudioBytes, UnsafeRemoteAudioError } = await importSvc();
    const fetchImpl = (async () =>
      new Response(null, {
        status: 301,
        headers: { location: "https://evil.example.com/x" },
      })) as never;
    const lookupImpl = (async () => [{ address: "52.0.0.1", family: 4 }]) as never;
    await expect(
      fetchTrustedAudioBytes("https://bucket.s3.amazonaws.com/a.mp3", {
        fetchImpl,
        lookupImpl,
      })
    ).rejects.toBeInstanceOf(UnsafeRemoteAudioError);
  });

  it("aborts a body that exceeds the byte cap", async () => {
    const { fetchTrustedAudioBytes, UnsafeRemoteAudioError } = await importSvc();
    const fetchImpl = (async () =>
      new Response(Buffer.alloc(2048) as unknown as BodyInit)) as never;
    const lookupImpl = (async () => [{ address: "52.0.0.1", family: 4 }]) as never;
    await expect(
      fetchTrustedAudioBytes("https://bucket.s3.amazonaws.com/a.mp3", {
        fetchImpl,
        lookupImpl,
        maxBytes: 512,
      })
    ).rejects.toBeInstanceOf(UnsafeRemoteAudioError);
  });
});

describe("importAudioBytes state machine", () => {
  it("rejects a forged Story scope before creating metadata or touching remote bytes", async () => {
    const storyId = await seedStory(1);
    const { importAudioBytes, materializeRemoteAudio } = await importSvc();
    const { listStoryAudioAssetRows } = await db();

    await expect(
      importAudioBytes({
        scope: { storyId, userId: 2 },
        operationId: "op-forged-local",
        sourceKind: "local-upload",
        displayName: "forged.wav",
        bytes: goodWavBytes,
      })
    ).resolves.toMatchObject({
      status: "failed",
      failureCode: "story-not-found",
    });

    const fetchImpl = vi.fn();
    await expect(
      materializeRemoteAudio({
        scope: { storyId, userId: 2 },
        operationId: "op-forged-remote",
        sourceKind: "chatcut",
        sourceKey: "chatcut:forged",
        displayName: "forged.wav",
        url: "https://bucket.s3.amazonaws.com/forged.wav",
        download: { fetchImpl: fetchImpl as never },
      })
    ).resolves.toMatchObject({
      status: "failed",
      failureCode: "story-not-found",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await listStoryAudioAssetRows({ storyId, userId: 2 })).toEqual([]);
    expect(await listStoryAudioAssetRows({ storyId, userId: 1 })).toEqual([]);
  });

  it("happy path: pending -> staged -> probed -> ready with trustworthy facts", async () => {
    const storyId = await seedStory();
    const { importAudioBytes } = await importSvc();
    const result = await importAudioBytes({
      scope: { storyId, userId: 1 },
      operationId: "op-happy",
      sourceKind: "local-upload",
      displayName: "背景音乐.wav",
      bytes: goodWavBytes,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.reused).toBe(false);
    expect(result.asset).toMatchObject({
      status: "ready",
      sourceKind: "local-upload",
      channels: 2,
      sampleRate: 44100,
    });
    expect(result.asset.durationFrames).toBeGreaterThanOrEqual(1);
    expect(result.asset.checksum).toMatch(/^[0-9a-f]{64}$/);

    // The managed file exists at the resolver's path; staging is gone.
    const { resolveManagedAudioPath, resolveAudioStagingPath } = await import(
      "./audioMedia"
    );
    await expect(
      stat(resolveManagedAudioPath(result.asset.storageKey))
    ).resolves.toBeTruthy();
    await expect(stat(resolveAudioStagingPath("op-happy"))).rejects.toThrow();
  });

  it("probe failure compensates: failed op + failed asset + staging cleaned, no ready asset", async () => {
    const storyId = await seedStory();
    const { importAudioBytes } = await importSvc();
    const result = await importAudioBytes({
      scope: { storyId, userId: 1 },
      operationId: "op-badbytes",
      sourceKind: "local-upload",
      displayName: "坏文件",
      bytes: Buffer.from("definitely not audio ".repeat(40)),
    });
    expect(result.status).toBe("failed");

    const { listStoryAudioAssetRows, getStoryAudioImportOperationRow } =
      await db();
    const assets = await listStoryAudioAssetRows({ storyId, userId: 1 });
    expect(assets).toHaveLength(1);
    expect(assets[0].status).toBe("failed");
    const op = await getStoryAudioImportOperationRow({
      storyId,
      userId: 1,
      operationId: "op-badbytes",
    });
    expect(op?.status).toBe("failed");

    const { resolveAudioStagingPath } = await import("./audioMedia");
    await expect(
      stat(resolveAudioStagingPath("op-badbytes"))
    ).rejects.toThrow();
  });

  it("replays a settled operation id without importing again", async () => {
    const storyId = await seedStory();
    const { importAudioBytes } = await importSvc();
    const first = await importAudioBytes({
      scope: { storyId, userId: 1 },
      operationId: "op-replay",
      sourceKind: "local-upload",
      displayName: "once",
      bytes: goodWavBytes,
    });
    const replay = await importAudioBytes({
      scope: { storyId, userId: 1 },
      operationId: "op-replay",
      sourceKind: "local-upload",
      displayName: "once",
      bytes: goodWavBytes,
    });
    expect(first.status).toBe("ready");
    expect(replay.status).toBe("ready");
    if (first.status !== "ready" || replay.status !== "ready") return;
    expect(replay.reused).toBe(true);
    expect(replay.asset.id).toBe(first.asset.id);
    const { listStoryAudioAssetRows } = await db();
    expect(await listStoryAudioAssetRows({ storyId, userId: 1 })).toHaveLength(1);
  });

  it("does not let another user's assetId or a forged storyId read the asset", async () => {
    const storyId = await seedStory(1);
    const { importAudioBytes } = await importSvc();
    const ready = await importAudioBytes({
      scope: { storyId, userId: 1 },
      operationId: "op-own",
      sourceKind: "local-upload",
      displayName: "mine",
      bytes: goodWavBytes,
    });
    if (ready.status !== "ready") throw new Error("setup failed");
    const { loadOwnedStoryAudioAsset } = await import("./storyAudioAssets");
    expect(
      await loadOwnedStoryAudioAsset({
        scope: { storyId, userId: 2 },
        assetId: ready.asset.id,
      })
    ).toBeNull();
    expect(
      await loadOwnedStoryAudioAsset({
        scope: { storyId: storyId + 999, userId: 1 },
        assetId: ready.asset.id,
      })
    ).toBeNull();
  });
});

describe("recoverStaleAudioImports", () => {
  it("compensates an unsettled operation to failed and never re-runs it", async () => {
    const storyId = await seedStory();
    const {
      createStoryAudioAssetRow,
      createStoryAudioImportOperationRow,
      getStoryAudioImportOperationRow,
      getStoryAudioAssetRow,
    } = await db();
    const asset = await createStoryAudioAssetRow({
      storyId,
      userId: 1,
      storageKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      displayName: "half",
      sourceKind: "local-upload",
      status: "pending",
    });
    await createStoryAudioImportOperationRow({
      storyId,
      userId: 1,
      operationId: "op-crashed",
      assetId: asset.id,
      sourceKind: "local-upload",
      status: "staged",
      stagingKey: "op-crashed",
    });

    const { recoverStaleAudioImports } = await importSvc();
    const report = await recoverStaleAudioImports();
    expect(report.compensatedOperations).toBe(1);

    const op = await getStoryAudioImportOperationRow({
      storyId,
      userId: 1,
      operationId: "op-crashed",
    });
    expect(op?.status).toBe("failed");
    expect(op?.failureCode).toBe("recovered-interrupted");
    expect(
      (await getStoryAudioAssetRow({ assetId: asset.id, storyId, userId: 1 }))
        ?.status
    ).toBe("failed");
  });

  it("sweeps an orphan staging file older than the grace window", async () => {
    const { ensureManagedAudioDirs, managedAudioStagingRoot } = await import(
      "./audioMedia"
    );
    await ensureManagedAudioDirs();
    const orphan = path.join(managedAudioStagingRoot(), "orphan-op");
    await writeFile(orphan, "stale");

    const { recoverStaleAudioImports } = await importSvc();
    const report = await recoverStaleAudioImports({
      now: Date.now() + 48 * 60 * 60 * 1000,
    });
    expect(report.removedStagingFiles).toBe(1);
    await expect(stat(orphan)).rejects.toThrow();
  });
});

describe("Story deletion clears managed audio", () => {
  it("removes asset rows, import ops, and the managed bytes", async () => {
    const storyId = await seedStory();
    const { importAudioBytes } = await importSvc();
    const ready = await importAudioBytes({
      scope: { storyId, userId: 1 },
      operationId: "op-del",
      sourceKind: "local-upload",
      displayName: "to delete",
      bytes: goodWavBytes,
    });
    if (ready.status !== "ready") throw new Error("setup failed");
    const { resolveManagedAudioPath } = await import("./audioMedia");
    const filePath = resolveManagedAudioPath(ready.asset.storageKey);
    await expect(stat(filePath)).resolves.toBeTruthy();

    const { deleteStory, listStoryAudioAssetRows } = await db();
    await deleteStory(storyId, 1);

    expect(await listStoryAudioAssetRows({ storyId, userId: 1 })).toHaveLength(0);
    await expect(stat(filePath)).rejects.toThrow();
  });
});
