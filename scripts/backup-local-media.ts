/**
 * Backup & restore for locally-managed Story audio (U2).
 *
 * `.webdev/local-persist.json` already has an automatic safety net; managed
 * audio bytes under `.webdev/audio` do not. This script snapshots both the
 * bytes and the `story_audio_assets` metadata together, verifies every file's
 * sha-256 against the recorded checksum, and on restore refuses to present an
 * asset as `ready` when its bytes are missing — a gap is surfaced, never
 * silently healed.
 *
 * Usage:
 *   pnpm tsx scripts/backup-local-media.ts backup   [--out <dir>]
 *   pnpm tsx scripts/backup-local-media.ts verify   --in <dir>
 *   pnpm tsx scripts/backup-local-media.ts restore  --in <dir>
 */
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STORAGE_KEY_PATTERN = /^[0-9a-f]{32}$/;

export type LocalMediaPaths = {
  audioDir: string;
  persistPath: string;
};

export function defaultLocalMediaPaths(cwd = process.cwd()): LocalMediaPaths {
  const webdev = path.join(cwd, ".webdev");
  return {
    audioDir: process.env.LOCAL_AUDIO_DIR?.trim()
      ? path.resolve(process.env.LOCAL_AUDIO_DIR)
      : path.join(webdev, "audio"),
    persistPath:
      process.env.LOCAL_PERSIST_PATH?.trim() ||
      path.join(webdev, "local-persist.json"),
  };
}

type AudioAssetRecord = {
  id: number;
  storyId: number;
  userId: number;
  storageKey: string;
  status: string;
  checksum: string | null;
  displayName?: string;
};

export type LocalMediaBackupManifest = {
  createdAt: string;
  assets: AudioAssetRecord[];
  files: Array<{ storageKey: string; sha256: string; bytes: number }>;
};

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function readAudioAssets(persistPath: string): Promise<AudioAssetRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(persistPath, "utf8")) as {
      storyAudioAssets?: AudioAssetRecord[];
    };
    return Array.isArray(parsed.storyAudioAssets)
      ? parsed.storyAudioAssets
      : [];
  } catch {
    return [];
  }
}

export async function backupLocalMedia(input: {
  paths?: LocalMediaPaths;
  outDir: string;
}): Promise<LocalMediaBackupManifest> {
  const paths = input.paths ?? defaultLocalMediaPaths();
  await mkdir(path.join(input.outDir, "audio"), { recursive: true });

  let names: string[] = [];
  try {
    names = (await readdir(paths.audioDir)).filter(name =>
      STORAGE_KEY_PATTERN.test(name)
    );
  } catch {
    names = [];
  }

  const files: LocalMediaBackupManifest["files"] = [];
  for (const name of names) {
    const source = path.join(paths.audioDir, name);
    const info = await stat(source);
    await cp(source, path.join(input.outDir, "audio", name));
    files.push({
      storageKey: name,
      sha256: await sha256File(source),
      bytes: info.size,
    });
  }

  const assets = await readAudioAssets(paths.persistPath);
  const manifest: LocalMediaBackupManifest = {
    createdAt: new Date().toISOString(),
    assets,
    files,
  };
  await writeFile(
    path.join(input.outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  return manifest;
}

export type LocalMediaVerifyReport = {
  ok: boolean;
  checkedFiles: number;
  mismatchedFiles: string[];
  missingFiles: string[];
  readyAssetsMissingBytes: number[];
};

export async function verifyLocalMediaBackup(input: {
  backupDir: string;
}): Promise<LocalMediaVerifyReport> {
  const manifest = JSON.parse(
    await readFile(path.join(input.backupDir, "manifest.json"), "utf8")
  ) as LocalMediaBackupManifest;

  const mismatchedFiles: string[] = [];
  const missingFiles: string[] = [];
  for (const file of manifest.files) {
    const filePath = path.join(input.backupDir, "audio", file.storageKey);
    try {
      const digest = await sha256File(filePath);
      if (digest !== file.sha256) mismatchedFiles.push(file.storageKey);
    } catch {
      missingFiles.push(file.storageKey);
    }
  }

  const backedUpKeys = new Set(manifest.files.map(file => file.storageKey));
  const readyAssetsMissingBytes = manifest.assets
    .filter(
      asset => asset.status === "ready" && !backedUpKeys.has(asset.storageKey)
    )
    .map(asset => asset.id);

  return {
    ok:
      mismatchedFiles.length === 0 &&
      missingFiles.length === 0 &&
      readyAssetsMissingBytes.length === 0,
    checkedFiles: manifest.files.length,
    mismatchedFiles,
    missingFiles,
    readyAssetsMissingBytes,
  };
}

export type LocalMediaRestoreReport = LocalMediaVerifyReport & {
  restoredFiles: number;
  flaggedAssets: number[];
};

export async function restoreLocalMedia(input: {
  backupDir: string;
  paths?: LocalMediaPaths;
}): Promise<LocalMediaRestoreReport> {
  const paths = input.paths ?? defaultLocalMediaPaths();
  const verify = await verifyLocalMediaBackup({ backupDir: input.backupDir });
  const manifest = JSON.parse(
    await readFile(path.join(input.backupDir, "manifest.json"), "utf8")
  ) as LocalMediaBackupManifest;

  // Restore order: bytes first, then metadata, so a crash mid-restore never
  // publishes a row that points at a file that is not there yet.
  await mkdir(paths.audioDir, { recursive: true });
  let restoredFiles = 0;
  for (const file of manifest.files) {
    if (verify.missingFiles.includes(file.storageKey)) continue;
    await cp(
      path.join(input.backupDir, "audio", file.storageKey),
      path.join(paths.audioDir, file.storageKey)
    );
    restoredFiles += 1;
  }

  const restoredKeys = new Set(
    manifest.files
      .filter(file => !verify.missingFiles.includes(file.storageKey))
      .map(file => file.storageKey)
  );
  const flaggedAssets: number[] = [];
  const nextAssets = manifest.assets.map(asset => {
    if (asset.status === "ready" && !restoredKeys.has(asset.storageKey)) {
      flaggedAssets.push(asset.id);
      return { ...asset, status: "failed", failureReason: "备份恢复时缺少音频文件" };
    }
    return asset;
  });

  let persisted: Record<string, unknown> = {};
  try {
    persisted = JSON.parse(await readFile(paths.persistPath, "utf8"));
  } catch {
    persisted = {};
  }
  persisted.storyAudioAssets = nextAssets;
  await writeFile(paths.persistPath, JSON.stringify(persisted, null, 2));

  return { ...verify, restoredFiles, flaggedAssets };
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  if (command === "backup") {
    const outDir =
      flag("--out") ??
      path.join(
        process.cwd(),
        ".webdev",
        `manual-backups-audio-${Date.now()}`
      );
    const manifest = await backupLocalMedia({ outDir });
    console.log(
      `[backup-local-media] ${manifest.files.length} 个音频文件 + ${manifest.assets.length} 条资产元数据 → ${outDir}`
    );
    return;
  }
  if (command === "verify") {
    const backupDir = flag("--in");
    if (!backupDir) throw new Error("verify 需要 --in <dir>");
    const report = await verifyLocalMediaBackup({ backupDir });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
  if (command === "restore") {
    const backupDir = flag("--in");
    if (!backupDir) throw new Error("restore 需要 --in <dir>");
    const report = await restoreLocalMedia({ backupDir });
    console.log(JSON.stringify(report, null, 2));
    if (report.flaggedAssets.length > 0) {
      console.warn(
        `[backup-local-media] ⚠️ ${report.flaggedAssets.length} 条资产缺少字节，已标为 failed（不静默当成 ready）`
      );
    }
    return;
  }
  console.error("用法: backup-local-media.ts <backup|verify|restore> [--out|--in <dir>]");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
