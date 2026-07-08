import fs from "node:fs";
import path from "node:path";

type ImportPackage = {
  mode: "dry-run";
  storyUpsertInput: {
    title: string;
    logline: string | null;
    theme: string | null;
    arc: string | null;
    summary: string | null;
    projectId: number | null;
    body: Record<string, unknown>;
  };
  proposedGeneratedImages: Array<{
    sourceAssetIndex: number;
    sourceAssetName: string;
    sourcePreviewPath: string;
    copyTargetFileName: string;
    createGeneratedImageInput: {
      projectId: null;
      storyId: "__CREATED_STORY_ID__";
      userId: "__CURRENT_USER_ID__";
      shotNo: string;
      shotIdentity: string;
      imageKey: string;
      imageUrl: string;
      prompt: string;
      generationType: "initial";
      parentImageId: null;
      isCurrent: boolean;
      maskKey: null;
    };
  }>;
  copyPlan: Array<{
    sourcePreviewPath: string;
    targetRelativeToLocalImageDir: string;
    imageUrl: string;
  }>;
};

type Args = {
  apply: boolean;
  allowMysql: boolean;
  updateExisting: boolean;
  userId: number | null;
  packagePath: string;
};

const repoRoot = process.cwd();
const defaultPackagePath = path.resolve(
  repoRoot,
  "../根基_素材整理/05_DT导入/genji_dt_story_import.json"
);

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    allowMysql: false,
    updateExisting: false,
    userId: null,
    packagePath: defaultPackagePath,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--allow-mysql") {
      args.allowMysql = true;
    } else if (arg === "--update-existing") {
      args.updateExisting = true;
    } else if (arg === "--user-id") {
      const value = argv[i + 1];
      i += 1;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--user-id 必须是正整数");
      }
      args.userId = parsed;
    } else if (arg === "--package") {
      const value = argv[i + 1];
      i += 1;
      if (!value) throw new Error("--package 后面需要文件路径");
      args.packagePath = path.resolve(value);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`用法：
  npx tsx scripts/genji-import-dt-story.ts --user-id 48
  npx tsx scripts/genji-import-dt-story.ts --user-id 48 --apply

默认只预演，不写库。

参数：
  --user-id <id>        必填。导入到哪个 DT 本地用户。
  --apply              真正写入 story、generatedImages，并复制预览图。
  --update-existing    如果用户下已有《根基》，允许覆盖 story body。
  --allow-mysql        默认强制使用本地 .webdev/local-persist.json；如要写 MySQL 才开启。
  --package <path>     指定 dry-run 导入包路径。
`);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function assertLocalModeUnlessAllowed(allowMysql: boolean) {
  if (allowMysql) return;
  process.env.DATABASE_URL = "";
}

function localPersistPath() {
  return path.join(repoRoot, ".webdev", "local-persist.json");
}

function backupLocalPersist() {
  const source = localPersistPath();
  if (!fs.existsSync(source)) return null;
  const backupDir = path.join(repoRoot, ".webdev", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `genji-import-${stamp}.json`);
  fs.copyFileSync(source, target);
  return target;
}

function storyPromptLineageBody(story: {
  title: string;
  theme: string | null;
  arc: string | null;
  body: unknown;
}): Record<string, unknown> {
  const body =
    story.body && typeof story.body === "object" && !Array.isArray(story.body)
      ? { ...(story.body as Record<string, unknown>) }
      : {};
  return {
    ...body,
    title: story.title,
    theme: story.theme,
    arc: story.arc,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.userId) {
    printHelp();
    throw new Error("缺少 --user-id。为了避免导入到错误账号，这个参数必须显式传入。");
  }

  assertLocalModeUnlessAllowed(args.allowMysql);

  const pkg = readJson<ImportPackage>(args.packagePath);
  const db = await import("../server/db");
  const storySync = await import("../server/services/storySync");
  const promptLineage = await import("../server/services/promptLineageMigration");
  const imageGen = await import("../server/services/imageGen");

  const stories = await db.listUserStories(args.userId);
  const existing = stories.find(story => story.title === pkg.storyUpsertInput.title);
  if (existing && !args.updateExisting) {
    throw new Error(
      `user ${args.userId} 下已经有《${pkg.storyUpsertInput.title}》。如要覆盖 story body，请加 --update-existing。`
    );
  }

  const localImageDir = imageGen.localImageDir();
  const copyTargets = pkg.copyPlan.map(item => ({
    ...item,
    targetPath: path.join(localImageDir, item.targetRelativeToLocalImageDir),
    sourceExists: fs.existsSync(item.sourcePreviewPath),
    targetExists: fs.existsSync(path.join(localImageDir, item.targetRelativeToLocalImageDir)),
  }));
  const missingSources = copyTargets.filter(item => !item.sourceExists);
  if (missingSources.length > 0) {
    throw new Error(
      `有 ${missingSources.length} 张预览图不存在，不能导入。第一张：${missingSources[0].sourcePreviewPath}`
    );
  }

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    userId: args.userId,
    packagePath: args.packagePath,
    existingStoryId: existing?.id ?? null,
    willUpdateExisting: Boolean(existing && args.updateExisting),
    localImageDir,
    copyCount: copyTargets.length,
    generatedImageRows: pkg.proposedGeneratedImages.length,
    storyShots: Array.isArray(pkg.storyUpsertInput.body.shots)
      ? pkg.storyUpsertInput.body.shots.length
      : 0,
  };

  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2));
    console.log("dry-run 完成：没有写入 story、图片记录或本地图片目录。");
    return;
  }

  const backupPath = backupLocalPersist();
  fs.mkdirSync(localImageDir, { recursive: true });
  for (const item of copyTargets) {
    if (!item.targetExists) {
      fs.copyFileSync(item.sourcePreviewPath, item.targetPath);
    }
  }

  let storyId: number;
  if (existing) {
    const row = await db.getStoryById(existing.id, args.userId);
    if (!row) throw new Error(`找不到已有 story ${existing.id}`);
    const revision = storySync.getStoryRevision(row.body) + 1;
    const body = storySync.prepareStoryBody(
      pkg.storyUpsertInput.body,
      revision,
      row.body
    );
    await db.updateStory(existing.id, args.userId, {
      title: pkg.storyUpsertInput.title,
      logline: pkg.storyUpsertInput.logline,
      theme: pkg.storyUpsertInput.theme,
      arc: pkg.storyUpsertInput.arc,
      summary: pkg.storyUpsertInput.summary,
      projectId: pkg.storyUpsertInput.projectId,
      body,
    });
    storyId = existing.id;
    const saved = await db.getStoryById(storyId, args.userId);
    if (saved) {
      await promptLineage.migrateStoryPromptLineage({
        storyId,
        userId: args.userId,
        body: storyPromptLineageBody(saved),
      });
    }
  } else {
    const body = storySync.prepareStoryBody(pkg.storyUpsertInput.body, 1);
    const created = await db.createStory({
      userId: args.userId,
      projectId: pkg.storyUpsertInput.projectId,
      title: pkg.storyUpsertInput.title,
      logline: pkg.storyUpsertInput.logline,
      theme: pkg.storyUpsertInput.theme,
      arc: pkg.storyUpsertInput.arc,
      summary: pkg.storyUpsertInput.summary,
      body,
    });
    storyId = created.id;
    const saved = await db.getStoryById(storyId, args.userId);
    if (saved) {
      await promptLineage.migrateStoryPromptLineage({
        storyId,
        userId: args.userId,
        source: "initial",
        body: storyPromptLineageBody(saved),
      });
    }
  }

  let promotedCount = 0;
  for (const row of pkg.proposedGeneratedImages) {
    const input = row.createGeneratedImageInput;
    const image = await db.createGeneratedImage({
      projectId: null,
      storyId,
      userId: args.userId,
      shotNo: input.shotNo,
      shotIdentity: input.shotIdentity,
      imageKey: input.imageKey,
      imageUrl: input.imageUrl,
      prompt: input.prompt,
      promptCompilationId: null,
      generationType: input.generationType,
      parentImageId: null,
      isCurrent: input.isCurrent,
      maskKey: null,
    });
    if (input.isCurrent) {
      const promoted = await db.promoteStoryImageToCurrent({
        imageId: image.id,
        storyId,
        userId: args.userId,
        metadata: {
          source: "genji-import",
          sourceAssetIndex: row.sourceAssetIndex,
          sourceAssetName: row.sourceAssetName,
        },
      });
      if (promoted) promotedCount += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        storyId,
        backupPath,
        copiedImages: copyTargets.filter(item => !item.targetExists).length,
        skippedExistingImages: copyTargets.filter(item => item.targetExists).length,
        promotedCount,
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error("[genji-import-dt-story] 失败：", error);
  process.exitCode = 1;
});
