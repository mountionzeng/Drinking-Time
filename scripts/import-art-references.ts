import path from "node:path";
import { pathToFileURL } from "node:url";
import { syncArtRepository } from "../server/services/artRepositoryCatalog";

function usage() {
  return [
    "用法：pnpm art:import -- <图片目录> [--dry-run] [--repository=<目录>]",
    '示例：pnpm art:import -- "/Users/yuandai/Desktop/仓库" --dry-run',
    "导入只复制本地私有参考并登记为 pending-analysis，不会调用 AI 或产生费用。",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const sourceDir = argv.find(value => !value.startsWith("--"));
  if (!sourceDir) throw new Error(usage());
  const repositoryArg = argv.find(value => value.startsWith("--repository="));
  const result = await syncArtRepository({
    sourceDir,
    repositoryDir: repositoryArg
      ? path.resolve(repositoryArg.slice("--repository=".length))
      : undefined,
    dryRun: argv.includes("--dry-run"),
  });
  console.log(
    [
      result.dryRun ? "参考库预检完成（未写入）" : "参考库同步完成",
      `新增：${result.added.length}`,
      `同名已存在：${result.existing.length}`,
      `内容重复：${result.duplicates.length}`,
      `补登记旧图：${result.cataloged.length}`,
      `清单总数：${result.totalAssets}`,
      "新图默认只允许派生 DNA 使用；原图不会在运行时送给生图模型。",
    ].join("\n")
  );
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
