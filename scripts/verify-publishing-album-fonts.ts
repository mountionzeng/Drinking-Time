import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLISHING_ALBUM_FONT_BUDGET_BYTES,
  PUBLISHING_ALBUM_FONT_SOURCE_COMMIT,
  PUBLISHING_ALBUM_FONTS,
  type PublishingAlbumFontManifestEntry,
} from "../shared/publishingAlbumFonts";
import { fontBufferMissingCharacters } from "../client/src/features/publishingAlbum/publishingAlbumFontRepository";

const COVERAGE_SAMPLE = "中国时间故事生活我们，。！？：；（）《》“”0123456789ABCxyz";

async function filesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(target) : [target];
  }));
  return nested.flat();
}

function arrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function verifyPublishingAlbumFonts(input: {
  repoRoot?: string;
  manifest?: readonly PublishingAlbumFontManifestEntry[];
} = {}): Promise<{ fontCount: number; totalBytes: number }> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const manifest = input.manifest ?? PUBLISHING_ALBUM_FONTS;
  const installed = manifest.filter(font => font.installed);
  const errors: string[] = [];
  let totalBytes = 0;
  const expectedFontFiles = new Set<string>();

  for (const font of installed) {
    if (!font.filePath || !font.licensePath || !font.sourcePath || !font.sha256 || font.sizeBytes == null) {
      errors.push(`${font.fontId}: installed manifest fields are incomplete`);
      continue;
    }
    if (!font.sourceUrl.includes(PUBLISHING_ALBUM_FONT_SOURCE_COMMIT) || /\/main\//.test(font.sourceUrl)) {
      errors.push(`${font.fontId}: source URL is mutable or not pinned`);
    }
    const fontPath = path.resolve(repoRoot, font.filePath);
    const licensePath = path.resolve(repoRoot, font.licensePath);
    const sourcePath = path.resolve(repoRoot, font.sourcePath);
    expectedFontFiles.add(fontPath);
    try {
      const [bytes, license, sourceRaw] = await Promise.all([
        readFile(fontPath), readFile(licensePath, "utf8"), readFile(sourcePath, "utf8"),
      ]);
      totalBytes += bytes.byteLength;
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== font.sha256) errors.push(`${font.fontId}: SHA-256 mismatch`);
      if (bytes.byteLength !== font.sizeBytes) errors.push(`${font.fontId}: size mismatch`);
      if (!license.includes("SIL OPEN FONT LICENSE") || !license.includes("Version 1.1")) {
        errors.push(`${font.fontId}: OFL 1.1 license is missing`);
      }
      const source = JSON.parse(sourceRaw) as Record<string, unknown>;
      if (
        source.fontId !== font.fontId || source.commit !== font.sourceCommit ||
        source.url !== font.sourceUrl || source.sha256 !== font.sha256
      ) errors.push(`${font.fontId}: SOURCE.json does not match manifest`);
      const missing = fontBufferMissingCharacters(arrayBuffer(bytes), COVERAGE_SAMPLE);
      if (missing.length > 0) errors.push(`${font.fontId}: missing required glyphs ${missing.join("")}`);
    } catch (error) {
      errors.push(`${font.fontId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (totalBytes > PUBLISHING_ALBUM_FONT_BUDGET_BYTES) {
    errors.push(`font repository exceeds ${PUBLISHING_ALBUM_FONT_BUDGET_BYTES} bytes`);
  }
  const assetRoot = path.resolve(repoRoot, "client/src/assets/fonts/publishing-album");
  const actualFontFiles = (await filesRecursively(assetRoot)).filter(file => /\.(?:ttf|otf|woff2?)$/i.test(file));
  for (const file of actualFontFiles) {
    if (!expectedFontFiles.has(file)) errors.push(`unmanifested font file: ${path.relative(repoRoot, file)}`);
  }
  for (const file of expectedFontFiles) {
    try { await stat(file); } catch { errors.push(`manifest font file missing: ${path.relative(repoRoot, file)}`); }
  }
  const clientFiles = await filesRecursively(path.resolve(repoRoot, "client/src"));
  for (const cssPath of clientFiles.filter(file => file.endsWith(".css"))) {
    const css = await readFile(cssPath, "utf8");
    if (css.includes("fonts/publishing-album") || css.includes("Publishing Album Noto")) {
      errors.push(`album font must not be globally imported: ${path.relative(repoRoot, cssPath)}`);
    }
  }
  if (errors.length > 0) throw new Error(`画册字体仓库校验失败：\n- ${errors.join("\n- ")}`);
  return { fontCount: installed.length, totalBytes };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const report = await verifyPublishingAlbumFonts();
  console.log(`画册字体仓库校验通过：${report.fontCount} 款，${report.totalBytes} bytes`);
}
