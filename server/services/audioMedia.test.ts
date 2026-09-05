import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileP = promisify(execFile);

let tmpDir: string;
const prevAudioDir = process.env.LOCAL_AUDIO_DIR;

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "dt-audio-media-"));
  process.env.LOCAL_AUDIO_DIR = path.join(tmpDir, "audio");
});
afterAll(async () => {
  if (prevAudioDir === undefined) delete process.env.LOCAL_AUDIO_DIR;
  else process.env.LOCAL_AUDIO_DIR = prevAudioDir;
  await rm(tmpDir, { recursive: true, force: true });
});

const importModule = () => import("./audioMedia");

describe("managed audio path resolver", () => {
  it("accepts a 32-hex storage key and joins it under the managed root", async () => {
    const { resolveManagedAudioPath, managedAudioRoot, isValidAudioStorageKey } =
      await importModule();
    const key = "0123456789abcdef0123456789abcdef";
    expect(isValidAudioStorageKey(key)).toBe(true);
    expect(resolveManagedAudioPath(key)).toBe(path.join(managedAudioRoot(), key));
  });

  it("rejects anything that is not exactly 32 lowercase hex", async () => {
    const { resolveManagedAudioPath } = await importModule();
    for (const bad of [
      "",
      "../secret",
      "0123456789abcdef0123456789abcde", // 31
      "0123456789ABCDEF0123456789abcdef", // uppercase
      "0123456789abcdef0123456789abcdef/x",
      "/etc/passwd",
      "..%2f..%2fetc",
    ]) {
      expect(() => resolveManagedAudioPath(bad)).toThrow();
    }
  });

  it("rejects an illegal operation id for the staging path", async () => {
    const { resolveAudioStagingPath } = await importModule();
    expect(() => resolveAudioStagingPath("ok-op_1")).not.toThrow();
    for (const bad of ["../x", "a/b", "", "x".repeat(200), "bad space"]) {
      expect(() => resolveAudioStagingPath(bad)).toThrow();
    }
  });

  it("mints unguessable, distinct storage keys", async () => {
    const { mintAudioStorageKey, isValidAudioStorageKey } = await importModule();
    const a = mintAudioStorageKey();
    const b = mintAudioStorageKey();
    expect(a).not.toBe(b);
    expect(isValidAudioStorageKey(a)).toBe(true);
  });
});

describe("probeStagedAudio", () => {
  let goodWav: string;

  beforeAll(async () => {
    goodWav = path.join(tmpDir, "good.wav");
    // 0.5s of silence, 22050Hz mono — a real, well-formed container.
    await execFileP("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=22050:cl=mono",
      "-t",
      "0.5",
      "-y",
      goodWav,
    ]);
  });

  it("returns trustworthy media facts for a well-formed file", async () => {
    const { probeStagedAudio } = await importModule();
    const facts = await probeStagedAudio(goodWav);
    expect(facts.sampleRate).toBe(22050);
    expect(facts.channels).toBe(1);
    expect(facts.durationSeconds).toBeGreaterThan(0.4);
    expect(facts.durationFrames).toBe(Math.round(facts.durationSeconds * 30));
    expect(facts.durationFrames).toBeGreaterThanOrEqual(1);
  });

  it("throws on an empty file", async () => {
    const { probeStagedAudio } = await importModule();
    const empty = path.join(tmpDir, "empty.bin");
    await writeFile(empty, "");
    await expect(probeStagedAudio(empty)).rejects.toThrow(/为空/);
  });

  it("throws on a fake / malformed container", async () => {
    const { probeStagedAudio } = await importModule();
    const junk = path.join(tmpDir, "junk.mp3");
    await writeFile(junk, Buffer.from("not audio at all, just text".repeat(50)));
    await expect(probeStagedAudio(junk)).rejects.toThrow();
  });

  it("throws quickly when the probe binary is missing", async () => {
    const { probeStagedAudio } = await importModule();
    await expect(
      probeStagedAudio(goodWav, { ffprobePath: "/nonexistent/ffprobe-xyz" })
    ).rejects.toThrow();
  });
});
