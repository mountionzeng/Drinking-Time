/**
 * The recoverable staged-import state machine that turns a set of audio bytes
 * (local upload, ChatCut, or a TTS result) into a `ready` StoryAudioAsset (U2).
 *
 * The filesystem and the DB never pretend to share a transaction. The import
 * operation row is the single source of truth: a crash at any point leaves
 * either one `ready` asset or one explainable `failed` operation, and never a
 * Timeline reference to something that is not on disk.
 *
 *   pending  -> operation + pending asset row exist
 *   staged   -> bytes written to an isolated, non-executable staging file
 *   probed   -> ffprobe + checksum done, media facts known
 *   ready    -> atomic rename into the managed dir, asset marked ready
 *   failed   -> compensated: staging discarded, asset + operation marked failed
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { readdir, rename, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import {
  createStoryAudioImportOperationRow,
  getStoryAudioImportOperationRow,
  getStoryById,
  listUnsettledStoryAudioImportOperationRows,
  removeManagedAudioFiles,
  updateStoryAudioImportOperationRow,
} from "../db";
import type { StoryAudioAsset } from "../../drizzle/schema";
import {
  MANAGED_AUDIO_FILE_MODE,
  discardAudioStagingFile,
  ensureManagedAudioDirs,
  managedAudioStagingRoot,
  mintAudioStorageKey,
  probeStagedAudio,
  resolveAudioStagingPath,
  resolveManagedAudioPath,
} from "./audioMedia";
import {
  checksumBytes,
  createPendingStoryAudioAsset,
  findReusableReadyStoryAudioAsset,
  markStoryAudioAssetFailed,
  markStoryAudioAssetReady,
  type StoryAudioAssetScope,
  type StoryAudioMediaKind,
  type StoryAudioSourceKind,
} from "./storyAudioAssets";

// ── SSRF guard (pure, exported for the security matrix) ───────────────────

const DEFAULT_ALLOWED_HOSTS = [
  /^file\.302\.ai$/,
  /^s3\.amazonaws\.com$/,
  /\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/,
];
const DEFAULT_ALLOWED_PORTS = new Set([443]);

export type RemoteIpClass =
  | "public"
  | "loopback"
  | "private"
  | "link-local"
  | "unique-local"
  | "multicast"
  | "unspecified"
  | "cloud-metadata"
  | "reserved";

/** Normalize an IPv4-mapped IPv6 (`::ffff:a.b.c.d`) to its IPv4 form. */
function unmapIpv6(ip: string): string {
  const match = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  return match ? match[1] : ip;
}

export function classifyRemoteIp(rawIp: string): RemoteIpClass {
  const ip = unmapIpv6(rawIp.trim());
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
      return "reserved";
    }
    const [a, b, c, d] = parts;
    if (a === 0) return "unspecified";
    if (a === 127) return "loopback";
    if (a === 10) return "private";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 169 && b === 254) {
      // 169.254.169.254 is the AWS/GCP link-local metadata endpoint.
      return c === 169 && d === 254 ? "cloud-metadata" : "link-local";
    }
    if (a === 100 && b === 100 && c === 100 && d === 200) return "cloud-metadata"; // Alibaba
    if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT
    if (a >= 224 && a <= 239) return "multicast";
    if (a >= 240) return "reserved";
    return "public";
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" ) return "unspecified";
    if (lower === "::1") return "loopback";
    if (lower.startsWith("fe80:")) return "link-local";
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return "unique-local";
    if (lower.startsWith("ff")) return "multicast";
    return "public";
  }
  return "reserved"; // not a bare IP literal
}

export class UnsafeRemoteAudioError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UnsafeRemoteAudioError";
    this.code = code;
  }
}

export type RemoteAudioUrlPolicy = {
  allowedHosts?: RegExp[];
  allowedPorts?: Set<number>;
};

/** Structural check: HTTPS, allow-listed host, allow-listed port, hostname is not a bare non-public IP. */
export function assertAllowedRemoteAudioUrl(
  rawUrl: string,
  policy: RemoteAudioUrlPolicy = {}
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeRemoteAudioError("bad-url", "远程音频地址无法解析");
  }
  if (url.protocol !== "https:") {
    throw new UnsafeRemoteAudioError("not-https", "远程音频必须是 HTTPS");
  }
  if (url.username || url.password) {
    throw new UnsafeRemoteAudioError("has-credentials", "远程音频地址不得携带凭据");
  }
  const port = url.port ? Number(url.port) : 443;
  const allowedPorts = policy.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  if (!allowedPorts.has(port)) {
    throw new UnsafeRemoteAudioError("port-not-allowed", "远程音频端口不在白名单");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  // A bare IP literal in the URL: reject unless it is a public address.
  const literalClass = classifyRemoteIp(
    hostname.startsWith("[") ? hostname.slice(1, -1) : hostname
  );
  if (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0 && literalClass !== "public") {
    throw new UnsafeRemoteAudioError(
      "ip-not-public",
      `远程音频地址指向非公网 IP（${literalClass}）`
    );
  }
  const allowedHosts = policy.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  if (
    isIP(hostname) === 0 &&
    !allowedHosts.some(pattern => pattern.test(hostname))
  ) {
    throw new UnsafeRemoteAudioError("host-not-allowed", "远程音频域名不在白名单");
  }
  return url;
}

/** Resolve DNS and reject if ANY answer is a non-public address (rebinding defence). */
export async function assertResolvedIpsArePublic(
  hostname: string,
  options: { lookupImpl?: typeof dnsLookup } = {}
): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return; // literal already checked structurally
  const lookup = options.lookupImpl ?? dnsLookup;
  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeRemoteAudioError("dns-failed", "远程音频域名解析失败");
  }
  if (answers.length === 0) {
    throw new UnsafeRemoteAudioError("dns-empty", "远程音频域名无解析结果");
  }
  for (const answer of answers) {
    const klass = classifyRemoteIp(answer.address);
    if (klass !== "public") {
      throw new UnsafeRemoteAudioError(
        "resolved-not-public",
        `远程音频域名解析到非公网 IP（${klass}）`
      );
    }
  }
}

// ── SSRF-guarded downloader ──────────────────────────────────────────────

export type FetchTrustedAudioOptions = {
  policy?: RemoteAudioUrlPolicy;
  maxBytes?: number;
  redirectLimit?: number;
  totalTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  lookupImpl?: typeof dnsLookup;
};

const DOWNLOAD_DEFAULTS = {
  maxBytes: 64 * 1024 * 1024,
  redirectLimit: 3,
  totalTimeoutMs: 30_000,
};

/**
 * Fetch bytes from a trusted-provenance URL. Every hop (initial + each
 * redirect) is re-checked structurally and re-resolves DNS; the response body
 * is streamed with a hard byte cap and an overall timeout.
 */
export async function fetchTrustedAudioBytes(
  rawUrl: string,
  options: FetchTrustedAudioOptions = {}
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? DOWNLOAD_DEFAULTS.maxBytes;
  const redirectLimit = options.redirectLimit ?? DOWNLOAD_DEFAULTS.redirectLimit;
  const totalTimeoutMs =
    options.totalTimeoutMs ?? DOWNLOAD_DEFAULTS.totalTimeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    totalTimeoutMs
  ) as unknown as { unref?: () => void };
  timer.unref?.();

  try {
    let current = rawUrl;
    for (let hop = 0; hop <= redirectLimit; hop += 1) {
      const url = assertAllowedRemoteAudioUrl(current, options.policy);
      await assertResolvedIpsArePublic(url.hostname, {
        lookupImpl: options.lookupImpl,
      });
      const response = await fetchImpl(url.toString(), {
        redirect: "manual",
        signal: controller.signal as AbortSignal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new UnsafeRemoteAudioError("redirect-no-location", "重定向缺少目标");
        }
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok || !response.body) {
        throw new UnsafeRemoteAudioError(
          "upstream-status",
          `远程音频响应异常（${response.status}）`
        );
      }
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new UnsafeRemoteAudioError("too-large", "远程音频超出大小上限");
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    }
    throw new UnsafeRemoteAudioError("too-many-redirects", "远程音频重定向次数过多");
  } finally {
    clearTimeout(timer as unknown as NodeJS.Timeout);
  }
}

// ── Staged import state machine ─────────────────────────────────────────

const STAGING_RECOVERY_GRACE_MS = 24 * 60 * 60 * 1000;

export type StoryAudioImportResult =
  | { status: "ready"; asset: StoryAudioAsset; reused: boolean }
  | { status: "failed"; reason: string; failureCode: string };

export type ImportAudioBytesInput = {
  scope: StoryAudioAssetScope;
  operationId: string;
  sourceKind: StoryAudioSourceKind;
  displayName: string;
  bytes: Buffer | Uint8Array;
  /** Stable upstream identity for idempotent reuse (chatcut clip id / tts op). */
  sourceKey?: string | null;
  mediaKind?: StoryAudioMediaKind;
  provenance?: unknown;
  ffprobePath?: string;
};

async function failOperation(
  opId: number,
  scope: StoryAudioAssetScope,
  assetId: number | null,
  code: string,
  reason: string,
  stagingOperationId: string
): Promise<StoryAudioImportResult> {
  await discardAudioStagingFile(stagingOperationId);
  if (assetId != null) {
    await markStoryAudioAssetFailed({ scope, assetId, reason });
  }
  await updateStoryAudioImportOperationRow(opId, {
    status: "failed",
    failureCode: code,
  });
  return { status: "failed", reason, failureCode: code };
}

/**
 * Idempotent by `operationId` within `storyId + userId`. A replay of a settled
 * operation returns its recorded outcome without touching disk again.
 */
export async function importAudioBytes(
  input: ImportAudioBytesInput
): Promise<StoryAudioImportResult> {
  const { scope, operationId } = input;

  // The asset row's compound ownership is not enough in local-memory mode:
  // unlike MySQL, the in-memory store has no foreign-key enforcement. Close
  // the boundary here before creating an operation, writing staging bytes, or
  // probing a caller-selected Story id.
  if (!(await getStoryById(scope.storyId, scope.userId))) {
    return {
      status: "failed",
      reason: "故事不存在或无权访问",
      failureCode: "story-not-found",
    };
  }

  const existing = await getStoryAudioImportOperationRow({
    storyId: scope.storyId,
    userId: scope.userId,
    operationId,
  });
  if (existing) {
    if (existing.status === "ready" && existing.assetId != null) {
      const asset = await getReadyAssetById(scope, existing.assetId);
      if (asset) return { status: "ready", asset, reused: true };
    }
    if (existing.status === "failed") {
      return {
        status: "failed",
        reason: "这次导入此前已失败",
        failureCode: existing.failureCode ?? "prior-failure",
      };
    }
    // An unsettled row from a crash: compensate and let the caller retry with a
    // fresh operationId.
    await failOperation(
      existing.id,
      scope,
      existing.assetId,
      "interrupted",
      "上一次导入被中断，请重试",
      operationId
    );
    return {
      status: "failed",
      reason: "上一次导入被中断，请重试",
      failureCode: "interrupted",
    };
  }

  // Idempotent reuse: same Story, same upstream identity, already ready.
  if (input.sourceKey && input.sourceKind !== "local-upload") {
    const reusable = await findReusableReadyStoryAudioAsset({
      scope,
      sourceKind: input.sourceKind,
      sourceKey: input.sourceKey,
    });
    if (reusable) {
      await createStoryAudioImportOperationRow({
        storyId: scope.storyId,
        userId: scope.userId,
        operationId,
        assetId: reusable.id,
        sourceKind: input.sourceKind,
        status: "ready",
      });
      return { status: "ready", asset: reusable, reused: true };
    }
  }

  await ensureManagedAudioDirs();
  const storageKey = mintAudioStorageKey();

  const asset = await createPendingStoryAudioAsset({
    scope,
    storageKey,
    displayName: input.displayName,
    sourceKind: input.sourceKind,
    mediaKind: input.mediaKind,
    sourceKey: input.sourceKey ?? null,
    provenance: input.provenance,
  });
  const operation = await createStoryAudioImportOperationRow({
    storyId: scope.storyId,
    userId: scope.userId,
    operationId,
    assetId: asset.id,
    sourceKind: input.sourceKind,
    status: "pending",
    stagingKey: operationId,
  });

  const stagingPath = resolveAudioStagingPath(operationId);
  try {
    await writeFile(stagingPath, Buffer.from(input.bytes), {
      mode: MANAGED_AUDIO_FILE_MODE,
      flag: "wx",
    });
  } catch {
    return failOperation(
      operation.id,
      scope,
      asset.id,
      "staging-write",
      "写入暂存文件失败",
      operationId
    );
  }
  await updateStoryAudioImportOperationRow(operation.id, { status: "staged" });

  let probe;
  try {
    probe = await probeStagedAudio(stagingPath, {
      ffprobePath: input.ffprobePath,
    });
  } catch (error) {
    return failOperation(
      operation.id,
      scope,
      asset.id,
      "probe-failed",
      error instanceof Error ? error.message : "音频探测失败",
      operationId
    );
  }
  const checksum = checksumBytes(Buffer.from(input.bytes));
  await updateStoryAudioImportOperationRow(operation.id, { status: "probed" });

  try {
    await rename(stagingPath, resolveManagedAudioPath(storageKey));
  } catch {
    return failOperation(
      operation.id,
      scope,
      asset.id,
      "commit-rename",
      "转入正式目录失败",
      operationId
    );
  }

  const ready = await markStoryAudioAssetReady({
    scope,
    assetId: asset.id,
    probe,
    checksum,
  });
  if (!ready) {
    // DB failed after the file moved: roll the file back out so we don't leave
    // an orphaned managed file with no row.
    await removeManagedAudioFiles([storageKey]);
    return failOperation(
      operation.id,
      scope,
      asset.id,
      "commit-db",
      "音频事实落库失败",
      operationId
    );
  }
  await updateStoryAudioImportOperationRow(operation.id, { status: "ready" });
  return { status: "ready", asset: ready, reused: false };
}

async function getReadyAssetById(
  scope: StoryAudioAssetScope,
  assetId: number
): Promise<StoryAudioAsset | null> {
  const { getStoryAudioAssetRow } = await import("../db");
  const asset = await getStoryAudioAssetRow({
    assetId,
    storyId: scope.storyId,
    userId: scope.userId,
  });
  return asset?.status === "ready" ? asset : null;
}

export type MaterializeRemoteAudioInput = {
  scope: StoryAudioAssetScope;
  operationId: string;
  sourceKind: Exclude<StoryAudioSourceKind, "local-upload">;
  url: string;
  displayName: string;
  sourceKey: string;
  mediaKind?: StoryAudioMediaKind;
  provenance?: unknown;
  download?: FetchTrustedAudioOptions;
  ffprobePath?: string;
};

/**
 * Materialize remote bytes (ChatCut S3, a TTS result) into a managed asset.
 * The URL comes only from trusted server-side provenance — never the client.
 */
export async function materializeRemoteAudio(
  input: MaterializeRemoteAudioInput
): Promise<StoryAudioImportResult> {
  // Fail closed before DNS/network work. `importAudioBytes` repeats this check
  // immediately before persistence so the local and remote entry points keep
  // the same ownership contract even if they are called independently.
  if (!(await getStoryById(input.scope.storyId, input.scope.userId))) {
    return {
      status: "failed",
      reason: "故事不存在或无权访问",
      failureCode: "story-not-found",
    };
  }

  // Short-circuit reuse before we touch the network.
  const reusable = await findReusableReadyStoryAudioAsset({
    scope: input.scope,
    sourceKind: input.sourceKind,
    sourceKey: input.sourceKey,
  });
  if (reusable) {
    const existing = await getStoryAudioImportOperationRow({
      storyId: input.scope.storyId,
      userId: input.scope.userId,
      operationId: input.operationId,
    });
    if (!existing) {
      await createStoryAudioImportOperationRow({
        storyId: input.scope.storyId,
        userId: input.scope.userId,
        operationId: input.operationId,
        assetId: reusable.id,
        sourceKind: input.sourceKind,
        status: "ready",
      });
    }
    return { status: "ready", asset: reusable, reused: true };
  }

  let bytes: Buffer;
  try {
    bytes = await fetchTrustedAudioBytes(input.url, input.download);
  } catch (error) {
    const code =
      error instanceof UnsafeRemoteAudioError ? error.code : "download-failed";
    return { status: "failed", reason: "远程音频下载失败", failureCode: code };
  }
  return importAudioBytes({
    scope: input.scope,
    operationId: input.operationId,
    sourceKind: input.sourceKind,
    displayName: input.displayName,
    bytes,
    sourceKey: input.sourceKey,
    mediaKind: input.mediaKind,
    provenance: input.provenance,
    ffprobePath: input.ffprobePath,
  });
}

// ── Crash recovery ─────────────────────────────────────────────────────

export type AudioImportRecoveryReport = {
  compensatedOperations: number;
  removedStagingFiles: number;
};

/**
 * Compensate every unsettled import operation (mark it `failed`, discard its
 * staging file) and sweep staging files older than the 24h grace window that
 * no operation still references. Never re-runs an import — an interrupted
 * operation is always safe to fail because its asset id was never exposed to a
 * Timeline.
 */
export async function recoverStaleAudioImports(options: {
  now?: number;
  graceMs?: number;
} = {}): Promise<AudioImportRecoveryReport> {
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? STAGING_RECOVERY_GRACE_MS;

  const unsettled = await listUnsettledStoryAudioImportOperationRows();
  const referencedStaging = new Set<string>();
  let compensated = 0;
  for (const op of unsettled) {
    if (op.stagingKey) referencedStaging.add(op.stagingKey);
    await discardAudioStagingFile(op.operationId);
    if (op.assetId != null) {
      await markStoryAudioAssetFailed({
        scope: { storyId: op.storyId, userId: op.userId },
        assetId: op.assetId,
        reason: "服务重启时中断的导入已作废",
      });
    }
    await updateStoryAudioImportOperationRow(op.id, {
      status: "failed",
      failureCode: "recovered-interrupted",
    });
    compensated += 1;
  }

  let removedStaging = 0;
  const stagingRoot = managedAudioStagingRoot();
  let entries: string[] = [];
  try {
    entries = await readdir(stagingRoot);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (referencedStaging.has(name)) continue;
    const full = path.join(stagingRoot, name);
    try {
      const info = await stat(full);
      if (now - info.mtimeMs > graceMs) {
        await discardAudioStagingFile(name);
        removedStaging += 1;
      }
    } catch {
      // ignore
    }
  }

  return {
    compensatedOperations: compensated,
    removedStagingFiles: removedStaging,
  };
}
