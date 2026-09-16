import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const MAGIC = Buffer.from("DTVSMP01", "ascii");
const STORAGE_KEY_PATTERN = /^[0-9a-f]{32}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;
const MAX_KEY_VERSION_BYTES = 64;
const TOKEN_VERSION = "v1";
const TOKEN_PURPOSES = ["preview", "provider_upload"] as const;

export const VOICE_SAMPLE_FILE_MODE = 0o600;

export type VoiceSampleKeyring = {
  activeVersion: string;
  /** Each value must be an independent 32-byte AES-256 key. */
  keys: ReadonlyMap<string, Uint8Array>;
};

export type StoredVoiceSampleBlob = {
  storageKey: string;
  keyVersion: string;
  contentHash: string;
  byteLength: number;
};

export function voiceSamplePrivateRoot(): string {
  const override = process.env.VOICE_SAMPLE_PRIVATE_DIR?.trim();
  return override
    ? path.resolve(override)
    : path.resolve(process.cwd(), ".private", "voice-samples");
}

export function resolveVoiceSamplePath(
  storageKey: string,
  directory = voiceSamplePrivateRoot()
): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error("声音样本存储键非法");
  }
  return path.join(path.resolve(directory), storageKey);
}

function keyForVersion(keyring: VoiceSampleKeyring, version: string): Buffer {
  const key = keyring.keys.get(version);
  if (!key || key.byteLength !== 32) {
    throw new Error(`声音样本密钥版本不可用：${version}`);
  }
  return Buffer.from(key);
}

function encryptAesGcm(input: {
  plaintext: Uint8Array;
  key: Uint8Array;
  iv: Uint8Array;
  aad: Uint8Array;
}): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv("aes-256-gcm", input.key, input.iv);
  cipher.setAAD(input.aad);
  return {
    ciphertext: Buffer.concat([cipher.update(input.plaintext), cipher.final()]),
    tag: cipher.getAuthTag(),
  };
}

function decryptAesGcm(input: {
  ciphertext: Uint8Array;
  key: Uint8Array;
  iv: Uint8Array;
  aad: Uint8Array;
  tag: Uint8Array;
}): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", input.key, input.iv);
  decipher.setAAD(input.aad);
  decipher.setAuthTag(input.tag);
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
}

function encodeEncryptedBlob(input: {
  plaintext: Uint8Array;
  keyring: VoiceSampleKeyring;
}): Buffer {
  const versionBytes = Buffer.from(input.keyring.activeVersion, "utf8");
  if (
    versionBytes.length === 0 ||
    versionBytes.length > MAX_KEY_VERSION_BYTES
  ) {
    throw new Error("声音样本密钥版本非法");
  }
  const wrappingKey = keyForVersion(input.keyring, input.keyring.activeVersion);
  const aad = Buffer.concat([MAGIC, versionBytes]);
  const dek = randomBytes(DEK_BYTES);
  const wrapIv = randomBytes(IV_BYTES);
  const wrapped = encryptAesGcm({
    plaintext: dek,
    key: wrappingKey,
    iv: wrapIv,
    aad,
  });
  const dataIv = randomBytes(IV_BYTES);
  const encrypted = encryptAesGcm({
    plaintext: input.plaintext,
    key: dek,
    iv: dataIv,
    aad,
  });
  dek.fill(0);
  return Buffer.concat([
    MAGIC,
    Buffer.from([versionBytes.length]),
    versionBytes,
    wrapIv,
    wrapped.ciphertext,
    wrapped.tag,
    dataIv,
    encrypted.tag,
    encrypted.ciphertext,
  ]);
}

function decodeEncryptedBlob(input: {
  encrypted: Uint8Array;
  keyring: VoiceSampleKeyring;
}): { plaintext: Buffer; keyVersion: string } {
  const bytes = Buffer.from(input.encrypted);
  if (bytes.length < MAGIC.length + 1 || !bytes.subarray(0, 8).equals(MAGIC)) {
    throw new Error("声音样本密文格式非法");
  }
  const versionLength = bytes[MAGIC.length];
  if (versionLength === 0 || versionLength > MAX_KEY_VERSION_BYTES) {
    throw new Error("声音样本密钥版本非法");
  }
  let cursor = MAGIC.length + 1;
  const minimumTail =
    IV_BYTES + DEK_BYTES + TAG_BYTES + IV_BYTES + TAG_BYTES + 1;
  if (bytes.length < cursor + versionLength + minimumTail) {
    throw new Error("声音样本密文不完整");
  }
  const versionBytes = bytes.subarray(cursor, cursor + versionLength);
  cursor += versionLength;
  const keyVersion = versionBytes.toString("utf8");
  const aad = Buffer.concat([MAGIC, versionBytes]);
  const wrapIv = bytes.subarray(cursor, cursor + IV_BYTES);
  cursor += IV_BYTES;
  const wrappedDek = bytes.subarray(cursor, cursor + DEK_BYTES);
  cursor += DEK_BYTES;
  const wrapTag = bytes.subarray(cursor, cursor + TAG_BYTES);
  cursor += TAG_BYTES;
  const dataIv = bytes.subarray(cursor, cursor + IV_BYTES);
  cursor += IV_BYTES;
  const dataTag = bytes.subarray(cursor, cursor + TAG_BYTES);
  cursor += TAG_BYTES;
  const ciphertext = bytes.subarray(cursor);
  const dek = decryptAesGcm({
    ciphertext: wrappedDek,
    key: keyForVersion(input.keyring, keyVersion),
    iv: wrapIv,
    aad,
    tag: wrapTag,
  });
  try {
    return {
      plaintext: decryptAesGcm({
        ciphertext,
        key: dek,
        iv: dataIv,
        aad,
        tag: dataTag,
      }),
      keyVersion,
    };
  } finally {
    dek.fill(0);
  }
}

export async function storeEncryptedVoiceSample(input: {
  plaintext: Uint8Array;
  keyring: VoiceSampleKeyring;
  directory?: string;
  storageKey?: string;
}): Promise<StoredVoiceSampleBlob> {
  if (input.plaintext.byteLength === 0) {
    throw new Error("声音样本不能为空");
  }
  const directory = path.resolve(input.directory ?? voiceSamplePrivateRoot());
  const storageKey = input.storageKey ?? randomBytes(16).toString("hex");
  const target = resolveVoiceSamplePath(storageKey, directory);
  const temporary = `${target}.tmp-${randomBytes(8).toString("hex")}`;
  const encrypted = encodeEncryptedBlob({
    plaintext: input.plaintext,
    keyring: input.keyring,
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, encrypted, { mode: VOICE_SAMPLE_FILE_MODE });
    await chmod(temporary, VOICE_SAMPLE_FILE_MODE);
    await rename(temporary, target);
    await chmod(target, VOICE_SAMPLE_FILE_MODE);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    storageKey,
    keyVersion: input.keyring.activeVersion,
    contentHash: createHash("sha256").update(input.plaintext).digest("hex"),
    byteLength: input.plaintext.byteLength,
  };
}

export async function readEncryptedVoiceSample(input: {
  storageKey: string;
  keyring: VoiceSampleKeyring;
  directory?: string;
}): Promise<Buffer> {
  const encrypted = await readFile(
    resolveVoiceSamplePath(
      input.storageKey,
      input.directory ?? voiceSamplePrivateRoot()
    )
  );
  return decodeEncryptedBlob({ encrypted, keyring: input.keyring }).plaintext;
}

export async function deleteEncryptedVoiceSample(input: {
  storageKey: string;
  directory?: string;
}): Promise<void> {
  await rm(
    resolveVoiceSamplePath(
      input.storageKey,
      input.directory ?? voiceSamplePrivateRoot()
    ),
    { force: true }
  );
}

export type VoiceSampleAccessPurpose = (typeof TOKEN_PURPOSES)[number];

type VoiceSampleTokenRecord = {
  tokenHash: string;
  userId: number;
  sampleId: string;
  purpose: VoiceSampleAccessPurpose;
  expiresAt: number;
};

export type VoiceSampleAccessTokenStore = {
  register(record: VoiceSampleTokenRecord): Promise<void>;
  consume(record: VoiceSampleTokenRecord, now: number): Promise<boolean>;
};

export function createMemoryVoiceSampleAccessTokenStore(): VoiceSampleAccessTokenStore {
  const records = new Map<string, VoiceSampleTokenRecord>();
  return {
    async register(value) {
      records.set(value.tokenHash, value);
    },
    async consume(value, now) {
      const stored = records.get(value.tokenHash);
      if (
        !stored ||
        stored.expiresAt < now ||
        stored.userId !== value.userId ||
        stored.sampleId !== value.sampleId ||
        stored.purpose !== value.purpose
      ) {
        return false;
      }
      records.delete(value.tokenHash);
      return true;
    },
  };
}

type TokenPayload = {
  version: typeof TOKEN_VERSION;
  nonce: string;
  userId: number;
  sampleId: string;
  purpose: VoiceSampleAccessPurpose;
  expiresAt: number;
};

function signTokenPayload(payload: string, signingKey: Uint8Array): Buffer {
  if (signingKey.byteLength < 32) {
    throw new Error("声音样本访问签名密钥过短");
  }
  return createHmac("sha256", signingKey).update(payload).digest();
}

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function mintVoiceSampleAccessToken(input: {
  userId: number;
  sampleId: string;
  purpose: VoiceSampleAccessPurpose;
  expiresAt: number;
  signingKey: Uint8Array;
  store: VoiceSampleAccessTokenStore;
}): Promise<string> {
  if (
    !Number.isInteger(input.userId) ||
    input.userId <= 0 ||
    !input.sampleId ||
    !TOKEN_PURPOSES.includes(input.purpose) ||
    !Number.isFinite(input.expiresAt)
  ) {
    throw new Error("声音样本访问令牌参数非法");
  }
  const payload: TokenPayload = {
    version: TOKEN_VERSION,
    nonce: randomBytes(16).toString("hex"),
    userId: input.userId,
    sampleId: input.sampleId,
    purpose: input.purpose,
    expiresAt: input.expiresAt,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = signTokenPayload(encoded, input.signingKey).toString(
    "base64url"
  );
  const token = `${encoded}.${signature}`;
  await input.store.register({
    tokenHash: tokenHash(token),
    userId: input.userId,
    sampleId: input.sampleId,
    purpose: input.purpose,
    expiresAt: input.expiresAt,
  });
  return token;
}

export type ConsumeVoiceSampleTokenResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "malformed"
        | "invalid_signature"
        | "scope_mismatch"
        | "expired"
        | "used_or_unknown";
    };

export async function consumeVoiceSampleAccessToken(input: {
  token: string;
  expectedUserId: number;
  expectedSampleId: string;
  expectedPurpose: VoiceSampleAccessPurpose;
  now: number;
  signingKey: Uint8Array;
  store: VoiceSampleAccessTokenStore;
}): Promise<ConsumeVoiceSampleTokenResult> {
  const parts = input.token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const expectedSignature = signTokenPayload(parts[0], input.signingKey);
  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(parts[1], "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return { ok: false, reason: "invalid_signature" };
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    ) as TokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    payload.version !== TOKEN_VERSION ||
    payload.userId !== input.expectedUserId ||
    payload.sampleId !== input.expectedSampleId ||
    payload.purpose !== input.expectedPurpose
  ) {
    return { ok: false, reason: "scope_mismatch" };
  }
  if (payload.expiresAt < input.now) return { ok: false, reason: "expired" };
  const consumed = await input.store.consume(
    {
      tokenHash: tokenHash(input.token),
      userId: payload.userId,
      sampleId: payload.sampleId,
      purpose: payload.purpose,
      expiresAt: payload.expiresAt,
    },
    input.now
  );
  return consumed ? { ok: true } : { ok: false, reason: "used_or_unknown" };
}
