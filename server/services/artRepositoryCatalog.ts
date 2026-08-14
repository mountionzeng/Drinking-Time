import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  ART_REPOSITORY_USAGE,
  type ArtRepositoryAsset,
  type ArtRepositoryCatalog,
} from "./artRepository";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DEFAULT_ARTIFACT_EXCLUSIONS = [
  "平台水印",
  "可读文字与伪文字",
  "作者签名、用户名和账号",
  "手机状态栏与应用界面",
];

export type ArtRepositorySyncResult = {
  added: string[];
  existing: string[];
  duplicates: string[];
  cataloged: string[];
  totalAssets: number;
  dryRun: boolean;
};

function imageExtension(fileName: string): string | null {
  const extension = path.extname(fileName).toLocaleLowerCase();
  return IMAGE_EXTENSIONS.has(extension) ? extension : null;
}

async function listImages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(entry => !entry.name.startsWith("."))
      .map(async entry => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return listImages(absolute);
        return entry.isFile() && imageExtension(entry.name) ? [absolute] : [];
      })
  );
  return nested.flat().sort();
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function safeTargetName(sourcePath: string, checksum: string): string {
  const extension = imageExtension(sourcePath) ?? ".jpg";
  const base = path
    .basename(sourcePath, path.extname(sourcePath))
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `${base || checksum.slice(0, 32)}${extension === ".jpeg" ? ".jpg" : extension}`;
}

function emptyCatalog(now: string): ArtRepositoryCatalog {
  return {
    schemaVersion: 1,
    collectionId: "founder-private-art-references",
    updatedAt: now,
    sourcePolicy: {
      visibility: "private",
      rawImagesAtRuntime: false,
      defaultRightsStatus: "unverified",
      artifactExclusions: DEFAULT_ARTIFACT_EXCLUSIONS,
    },
    assets: {},
  };
}

async function readCatalog(
  repositoryDir: string,
  now: string
): Promise<ArtRepositoryCatalog> {
  try {
    const raw = await readFile(
      path.join(repositoryDir, "catalog.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw) as ArtRepositoryCatalog;
    if (parsed.schemaVersion === 1 && parsed.assets) return parsed;
  } catch {
    // First import, or a legacy repository without the new catalog.
  }
  return emptyCatalog(now);
}

function pendingAsset(params: {
  checksum: string;
  sourceFileName: string;
  now: string;
}): ArtRepositoryAsset {
  return {
    sha256: params.checksum,
    sourceFileName: params.sourceFileName,
    status: "pending-analysis",
    rightsStatus: "unverified",
    usage: ART_REPOSITORY_USAGE,
    addedAt: params.now,
  };
}

export async function writeArtRepositoryCatalog(
  repositoryDir: string,
  catalog: ArtRepositoryCatalog
): Promise<void> {
  const catalogPath = path.join(repositoryDir, "catalog.json");
  const temporaryPath = `${catalogPath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8"
  );
  await rename(temporaryPath, catalogPath);
}

export async function syncArtRepository(params: {
  sourceDir: string;
  repositoryDir?: string;
  dryRun?: boolean;
  now?: string;
}): Promise<ArtRepositorySyncResult> {
  const sourceDir = path.resolve(params.sourceDir);
  const repositoryDir = path.resolve(
    params.repositoryDir ?? path.join(process.cwd(), "art-repository")
  );
  const referencesDir = path.join(repositoryDir, "references");
  const now = params.now ?? new Date().toISOString();
  const dryRun = params.dryRun ?? false;

  await mkdir(referencesDir, { recursive: true });
  const catalog = await readCatalog(repositoryDir, now);
  const destinationFiles = await listImages(referencesDir);
  const destinationByName = new Map(
    destinationFiles.map(filePath => [path.basename(filePath), filePath])
  );
  const destinationByHash = new Map<string, string>();

  const result: ArtRepositorySyncResult = {
    added: [],
    existing: [],
    duplicates: [],
    cataloged: [],
    totalAssets: 0,
    dryRun,
  };

  for (const destinationPath of destinationFiles) {
    const fileName = path.basename(destinationPath);
    const checksum = await sha256(destinationPath);
    destinationByHash.set(checksum, fileName);
    if (!catalog.assets[fileName]) {
      catalog.assets[fileName] = pendingAsset({
        checksum,
        sourceFileName: fileName,
        now,
      });
      result.cataloged.push(fileName);
    }
  }

  const sourceFiles = await listImages(sourceDir);
  const sameDirectory = sourceDir === path.resolve(referencesDir);
  if (!sameDirectory) {
    for (const sourcePath of sourceFiles) {
      const originalName = path.basename(sourcePath);
      if (destinationByName.has(originalName)) {
        result.existing.push(originalName);
        continue;
      }

      const checksum = await sha256(sourcePath);
      const duplicateName = destinationByHash.get(checksum);
      if (duplicateName) {
        result.duplicates.push(`${originalName} -> ${duplicateName}`);
        continue;
      }

      let targetName = safeTargetName(sourcePath, checksum);
      if (destinationByName.has(targetName)) {
        targetName = `${path.basename(targetName, path.extname(targetName))}-${checksum.slice(0, 10)}${path.extname(targetName)}`;
      }
      const targetPath = path.join(referencesDir, targetName);
      if (!dryRun) await copyFile(sourcePath, targetPath);
      catalog.assets[targetName] = pendingAsset({
        checksum,
        sourceFileName: originalName,
        now,
      });
      destinationByName.set(targetName, targetPath);
      destinationByHash.set(checksum, targetName);
      result.added.push(targetName);
    }
  }

  catalog.updatedAt = now;
  catalog.sourcePolicy = {
    visibility: "private",
    rawImagesAtRuntime: false,
    defaultRightsStatus: "unverified",
    artifactExclusions: DEFAULT_ARTIFACT_EXCLUSIONS,
  };
  result.totalAssets = Object.keys(catalog.assets).length;
  if (!dryRun) await writeArtRepositoryCatalog(repositoryDir, catalog);
  return result;
}
