import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeVisionReference } from "../server/archive/visionAgent";
import {
  loadArtRepositoryCatalog,
  resolveArtRepositoryDir,
  sanitizeCuratedArtDna,
} from "../server/services/artRepository";
import { writeArtRepositoryCatalog } from "../server/services/artRepositoryCatalog";

function mimeType(fileName: string): string {
  const extension = path.extname(fileName).toLocaleLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

function parseLimit(argv: string[]): number {
  const raw = argv.find(value => value.startsWith("--limit="));
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = Number(raw.slice("--limit=".length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export async function main(argv = process.argv.slice(2)) {
  const repositoryArg = argv.find(value => value.startsWith("--repository="));
  const repositoryDir = repositoryArg
    ? path.resolve(repositoryArg.slice("--repository=".length))
    : resolveArtRepositoryDir();
  const catalog = await loadArtRepositoryCatalog(repositoryDir);
  if (!catalog) throw new Error("没有找到有效的 art-repository/catalog.json");

  const pending = Object.entries(catalog.assets).filter(
    ([, asset]) => asset.status === "pending-analysis"
  );
  const limit = parseLimit(argv);
  const selected = pending.slice(0, limit);
  if (!argv.includes("--confirm-paid-analysis")) {
    console.log(
      [
        `待分析参考图：${pending.length} 张`,
        `本次计划：${selected.length} 张`,
        "未提供 --confirm-paid-analysis；没有调用视觉模型，也没有产生费用。",
      ].join("\n")
    );
    return;
  }

  for (const [fileName, asset] of selected) {
    const filePath = path.join(repositoryDir, "references", fileName);
    try {
      const buffer = await readFile(filePath);
      const result = await analyzeVisionReference({
        imageDataUrl: `data:${mimeType(fileName)};base64,${buffer.toString("base64")}`,
        fileName,
        brief:
          "这是私有策展库截图。只提取可泛化的美术 DNA；把水印、文字、签名、账号、状态栏和应用界面视为源图污染，不得写入 promptDraft；不要把人物、物体、地点或情节当作需要复制的内容。",
      });
      asset.dna = sanitizeCuratedArtDna({
        style: result.analysis.visualStyle,
        palette: result.analysis.colorPalette,
        light: result.analysis.lighting ? [result.analysis.lighting] : [],
        composition: result.analysis.composition
          ? [result.analysis.composition]
          : [],
        material: result.analysis.materialsAndTextures,
        mood: result.analysis.mood,
        matchTags: [
          ...result.analysis.visualStyle,
          ...result.analysis.mood,
          result.analysis.eraAndCulture,
        ],
      });
      asset.status = "ready";
      asset.analyzedAt = new Date().toISOString();
      catalog.updatedAt = asset.analyzedAt;
      await writeArtRepositoryCatalog(repositoryDir, catalog);
      console.log(`已分析：${fileName}`);
    } catch (error) {
      console.warn(
        `分析失败，保留待处理状态：${fileName}`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
