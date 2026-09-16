import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeVoiceSampleAccessToken,
  createMemoryVoiceSampleAccessTokenStore,
  deleteEncryptedVoiceSample,
  mintVoiceSampleAccessToken,
  readEncryptedVoiceSample,
  resolveVoiceSamplePath,
  storeEncryptedVoiceSample,
  type VoiceSampleKeyring,
} from "./voiceSampleMedia";

let directory: string;
let keyring: VoiceSampleKeyring;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "dt-voice-sample-"));
  keyring = {
    activeVersion: "k2",
    keys: new Map([
      ["k1", randomBytes(32)],
      ["k2", randomBytes(32)],
    ]),
  };
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("private encrypted voice samples", () => {
  it("stores only ciphertext with owner-only permissions and decrypts through the recorded key version", async () => {
    const plaintext = Buffer.from("fresh randomized challenge audio bytes");
    const stored = await storeEncryptedVoiceSample({
      plaintext,
      directory,
      keyring,
    });
    const filePath = resolveVoiceSamplePath(stored.storageKey, directory);
    const persisted = await readFile(filePath);

    expect(persisted.includes(plaintext)).toBe(false);
    expect(stored.keyVersion).toBe("k2");
    expect(stored.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await expect(
      readEncryptedVoiceSample({
        storageKey: stored.storageKey,
        directory,
        keyring,
      })
    ).resolves.toEqual(plaintext);
  });

  it("keeps old samples readable after rotation without writing plaintext or a base64 JSON blob", async () => {
    const firstRing: VoiceSampleKeyring = {
      activeVersion: "k1",
      keys: keyring.keys,
    };
    const stored = await storeEncryptedVoiceSample({
      plaintext: Buffer.from("old-key-sample"),
      directory,
      keyring: firstRing,
    });

    expect(stored.keyVersion).toBe("k1");
    await expect(
      readEncryptedVoiceSample({
        storageKey: stored.storageKey,
        directory,
        keyring,
      })
    ).resolves.toEqual(Buffer.from("old-key-sample"));
    const file = await readFile(
      resolveVoiceSamplePath(stored.storageKey, directory)
    );
    expect(file[0]).not.toBe("{".charCodeAt(0));
  });

  it("fails closed for missing keys, tampered ciphertext, and path traversal", async () => {
    const stored = await storeEncryptedVoiceSample({
      plaintext: Buffer.from("sensitive"),
      directory,
      keyring,
    });
    await expect(
      readEncryptedVoiceSample({
        storageKey: stored.storageKey,
        directory,
        keyring: { activeVersion: "other", keys: new Map() },
      })
    ).rejects.toThrow(/密钥版本/);
    expect(() => resolveVoiceSamplePath("../secret", directory)).toThrow();
    expect(() => resolveVoiceSamplePath("a".repeat(31), directory)).toThrow();
  });

  it("deletes the encrypted blob idempotently", async () => {
    const stored = await storeEncryptedVoiceSample({
      plaintext: Buffer.from("delete-me"),
      directory,
      keyring,
    });
    await deleteEncryptedVoiceSample({
      storageKey: stored.storageKey,
      directory,
    });
    await deleteEncryptedVoiceSample({
      storageKey: stored.storageKey,
      directory,
    });
    await expect(
      readEncryptedVoiceSample({
        storageKey: stored.storageKey,
        directory,
        keyring,
      })
    ).rejects.toThrow();
  });
});

describe("single-purpose voice sample access tokens", () => {
  it("allows exactly one matching owner/sample read before expiry", async () => {
    const store = createMemoryVoiceSampleAccessTokenStore();
    const signingKey = randomBytes(32);
    const token = await mintVoiceSampleAccessToken({
      userId: 7,
      sampleId: "sample-1",
      purpose: "provider_upload",
      expiresAt: 10_000,
      signingKey,
      store,
    });

    await expect(
      consumeVoiceSampleAccessToken({
        token,
        expectedUserId: 7,
        expectedSampleId: "sample-1",
        expectedPurpose: "provider_upload",
        now: 9_000,
        signingKey,
        store,
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      consumeVoiceSampleAccessToken({
        token,
        expectedUserId: 7,
        expectedSampleId: "sample-1",
        expectedPurpose: "provider_upload",
        now: 9_001,
        signingKey,
        store,
      })
    ).resolves.toEqual({ ok: false, reason: "used_or_unknown" });
  });

  it("rejects foreign owner, wrong purpose, expired, and forged tokens without consuming a valid token", async () => {
    const store = createMemoryVoiceSampleAccessTokenStore();
    const signingKey = randomBytes(32);
    const token = await mintVoiceSampleAccessToken({
      userId: 7,
      sampleId: "sample-1",
      purpose: "preview",
      expiresAt: 10_000,
      signingKey,
      store,
    });

    for (const input of [
      { expectedUserId: 8, expectedPurpose: "preview" as const, now: 9_000 },
      {
        expectedUserId: 7,
        expectedPurpose: "provider_upload" as const,
        now: 9_000,
      },
      { expectedUserId: 7, expectedPurpose: "preview" as const, now: 10_001 },
    ]) {
      const result = await consumeVoiceSampleAccessToken({
        token,
        expectedSampleId: "sample-1",
        signingKey,
        store,
        ...input,
      });
      expect(result.ok).toBe(false);
    }
    const forged = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(
      (
        await consumeVoiceSampleAccessToken({
          token: forged,
          expectedUserId: 7,
          expectedSampleId: "sample-1",
          expectedPurpose: "preview",
          now: 9_000,
          signingKey,
          store,
        })
      ).ok
    ).toBe(false);
  });
});
