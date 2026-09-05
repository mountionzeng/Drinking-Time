import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupLocalMedia,
  restoreLocalMedia,
  verifyLocalMediaBackup,
} from "./backup-local-media";

let tmp: string;
let audioDir: string;
let persistPath: string;

const KEY_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "dt-backup-media-"));
  audioDir = path.join(tmp, "audio");
  persistPath = path.join(tmp, "local-persist.json");
  await mkdir(audioDir, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function seed(bytesA: Buffer, bytesB: Buffer) {
  await writeFile(path.join(audioDir, KEY_A), bytesA);
  await writeFile(path.join(audioDir, KEY_B), bytesB);
  await writeFile(
    persistPath,
    JSON.stringify({
      stories: [],
      storyAudioAssets: [
        {
          id: 1,
          storyId: 7,
          userId: 1,
          storageKey: KEY_A,
          status: "ready",
          checksum: sha256(bytesA),
          displayName: "a",
        },
        {
          id: 2,
          storyId: 7,
          userId: 1,
          storageKey: KEY_B,
          status: "ready",
          checksum: sha256(bytesB),
          displayName: "b",
        },
      ],
    })
  );
}

describe("backup-local-media", () => {
  it("backs up bytes + metadata and verifies clean", async () => {
    const a = Buffer.from("audio-a-bytes");
    const b = Buffer.from("audio-b-bytes-longer");
    await seed(a, b);
    const outDir = path.join(tmp, "backup");

    const manifest = await backupLocalMedia({
      paths: { audioDir, persistPath },
      outDir,
    });
    expect(manifest.files).toHaveLength(2);
    expect(manifest.assets).toHaveLength(2);

    const report = await verifyLocalMediaBackup({ backupDir: outDir });
    expect(report).toMatchObject({
      ok: true,
      checkedFiles: 2,
      mismatchedFiles: [],
      missingFiles: [],
      readyAssetsMissingBytes: [],
    });
  });

  it("round-trips: restore rebuilds identical bytes and metadata", async () => {
    const a = Buffer.from("round-trip-a");
    const b = Buffer.from("round-trip-b");
    await seed(a, b);
    const outDir = path.join(tmp, "backup");
    await backupLocalMedia({ paths: { audioDir, persistPath }, outDir });

    // Wipe the live copies.
    await rm(audioDir, { recursive: true, force: true });
    await writeFile(persistPath, JSON.stringify({ stories: [] }));

    const report = await restoreLocalMedia({
      backupDir: outDir,
      paths: { audioDir, persistPath },
    });
    expect(report.restoredFiles).toBe(2);
    expect(report.flaggedAssets).toEqual([]);
    expect((await readFile(path.join(audioDir, KEY_A))).equals(a)).toBe(true);
    const persisted = JSON.parse(await readFile(persistPath, "utf8")) as {
      storyAudioAssets: Array<{ id: number; status: string }>;
    };
    expect(persisted.storyAudioAssets.map(x => x.status)).toEqual([
      "ready",
      "ready",
    ]);
  });

  it("flags a ready asset whose bytes went missing instead of silently succeeding", async () => {
    const a = Buffer.from("present");
    const b = Buffer.from("will-vanish");
    await seed(a, b);
    const outDir = path.join(tmp, "backup");
    await backupLocalMedia({ paths: { audioDir, persistPath }, outDir });

    // Corrupt the backup: remove one file.
    await rm(path.join(outDir, "audio", KEY_B));

    const verify = await verifyLocalMediaBackup({ backupDir: outDir });
    expect(verify.ok).toBe(false);
    expect(verify.missingFiles).toContain(KEY_B);

    await rm(audioDir, { recursive: true, force: true });
    const restore = await restoreLocalMedia({
      backupDir: outDir,
      paths: { audioDir, persistPath },
    });
    expect(restore.restoredFiles).toBe(1);
    expect(restore.flaggedAssets).toEqual([2]);
    const persisted = JSON.parse(await readFile(persistPath, "utf8")) as {
      storyAudioAssets: Array<{ id: number; status: string }>;
    };
    expect(persisted.storyAudioAssets.find(x => x.id === 2)?.status).toBe(
      "failed"
    );
  });

  it("detects a tampered file by checksum mismatch", async () => {
    const a = Buffer.from("original");
    const b = Buffer.from("b");
    await seed(a, b);
    const outDir = path.join(tmp, "backup");
    await backupLocalMedia({ paths: { audioDir, persistPath }, outDir });
    await writeFile(path.join(outDir, "audio", KEY_A), Buffer.from("tampered"));

    const verify = await verifyLocalMediaBackup({ backupDir: outDir });
    expect(verify.ok).toBe(false);
    expect(verify.mismatchedFiles).toContain(KEY_A);
  });
});
