/**
 * The single resolver from an opaque storage key to a real path on disk for
 * managed Story audio (U2).
 *
 * Nothing else may join a path for audio bytes. A client-supplied filename,
 * path, or URL never reaches the filesystem: the only inputs accepted here are
 * a 32-hex storage key (minted server-side) and a server-minted operation id.
 * The managed directory defaults to `.webdev/audio` under `process.cwd()` and
 * is overridable with `LOCAL_AUDIO_DIR`; staging lives in a sibling `.staging`
 * dir so a half-written or hostile upload can never be referenced as `ready`.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const STORAGE_KEY_PATTERN = /^[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

/** Files are written owner-only, never executable. */
export const MANAGED_AUDIO_FILE_MODE = 0o600;

export function managedAudioRoot(): string {
  const override = process.env.LOCAL_AUDIO_DIR?.trim();
  if (override) return path.resolve(override);
  return path.resolve(process.cwd(), ".webdev", "audio");
}

export function managedAudioStagingRoot(): string {
  return path.join(managedAudioRoot(), ".staging");
}

export function isValidAudioStorageKey(value: unknown): value is string {
  return typeof value === "string" && STORAGE_KEY_PATTERN.test(value);
}

/** Mint a fresh, unguessable storage key. */
export function mintAudioStorageKey(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Absolute path of the final managed file for `storageKey`. Throws on any key
 * that is not exactly 32 lowercase hex chars — path separators, `..`, absolute
 * paths and empty strings all fail here rather than escaping the managed root.
 */
export function resolveManagedAudioPath(storageKey: string): string {
  if (!isValidAudioStorageKey(storageKey)) {
    throw new Error("音频存储键非法");
  }
  return path.join(managedAudioRoot(), storageKey);
}

/** Absolute path of the isolated staging file for one import operation. */
export function resolveAudioStagingPath(operationId: string): string {
  if (typeof operationId !== "string" || !OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error("导入操作标识非法");
  }
  return path.join(managedAudioStagingRoot(), operationId);
}

export async function ensureManagedAudioDirs(): Promise<void> {
  await mkdir(managedAudioRoot(), { recursive: true });
  await mkdir(managedAudioStagingRoot(), { recursive: true });
}

/** Best-effort staging cleanup; never throws. */
export async function discardAudioStagingFile(operationId: string): Promise<void> {
  try {
    await rm(resolveAudioStagingPath(operationId), { force: true });
  } catch {
    // best effort
  }
}

// ── ffprobe: no shell, hard limits ───────────────────────────────────────

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_OUTPUT_CAP_BYTES = 256 * 1024;
const PROBE_MAX_STREAMS = 8;
const AUDIO_FPS = 30;

export type AudioProbeFacts = {
  durationSeconds: number;
  durationFrames: number;
  sampleRate: number;
  channels: number;
  codecName: string;
  formatName: string;
};

/**
 * Probe a file that is already inside our staging dir. `execFile` (argv array,
 * never a shell string), a hard kill timeout, capped stdout/stderr, and a
 * `file`-only protocol whitelist so a crafted container cannot make ffprobe
 * reach the network. A malformed container, an empty file, too many streams,
 * over-long metadata, a timeout, or a non-zero exit all throw.
 */
export async function probeStagedAudio(
  filePath: string,
  options: { ffprobePath?: string } = {}
): Promise<AudioProbeFacts> {
  const size = (await stat(filePath)).size;
  if (size <= 0) throw new Error("音频文件为空");

  const ffprobePath =
    options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe";
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      ffprobePath,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-show_entries",
        "stream=codec_type,codec_name,sample_rate,channels,duration:format=format_name,duration,nb_streams",
        "-of",
        "json",
        "-i",
        filePath,
      ],
      {
        timeout: PROBE_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: PROBE_OUTPUT_CAP_BYTES,
        windowsHide: true,
        env: { PATH: process.env.PATH ?? "" },
      },
      (error, out, err) => {
        if (error) {
          reject(
            new Error(
              `ffprobe 失败：${(err || error.message || "unknown").toString().slice(-200)}`
            )
          );
          return;
        }
        resolve(String(out));
      }
    );
    child.stdin?.end();
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("ffprobe 输出无法解析");
  }
  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const streams = Array.isArray(root.streams) ? root.streams : [];
  if (streams.length === 0) throw new Error("音频文件不含任何流");
  if (streams.length > PROBE_MAX_STREAMS) throw new Error("音频文件流数量异常");
  const format =
    root.format && typeof root.format === "object"
      ? (root.format as Record<string, unknown>)
      : {};

  const audioStream = streams
    .map(value =>
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {}
    )
    .find(stream => stream.codec_type === "audio");
  if (!audioStream) throw new Error("文件里没有音频流");

  const sampleRate = Number(audioStream.sample_rate);
  const channels = Number(audioStream.channels);
  const durationValue = Number(
    audioStream.duration ?? (format as Record<string, unknown>).duration
  );
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("无法识别音频采样率");
  }
  if (!Number.isFinite(channels) || channels <= 0 || channels > 32) {
    throw new Error("无法识别音频声道数");
  }
  if (!Number.isFinite(durationValue) || durationValue <= 0) {
    throw new Error("无法识别音频时长");
  }
  const codecName = String(audioStream.codec_name ?? "").slice(0, 64);
  const formatName = String(
    (format as Record<string, unknown>).format_name ?? ""
  ).slice(0, 128);

  return {
    durationSeconds: durationValue,
    durationFrames: Math.max(1, Math.round(durationValue * AUDIO_FPS)),
    sampleRate: Math.round(sampleRate),
    channels: Math.round(channels),
    codecName,
    formatName,
  };
}
