import fs from "node:fs";
import path from "node:path";

type GenjiAsset = {
  index: number;
  group: string;
  kind: "audio" | "image" | "video" | string;
  name: string;
  extension: string;
  size_mb: number;
  duration_sec: number | "";
  width: number | "";
  height: number | "";
  role_hint: string;
  relative_path: string;
  source_path: string;
  quick_link: string;
  preview_rel: string;
};

type WorkspaceAsset = {
  index: number;
  group: string;
  kind: string;
  rank: string;
  name: string;
  duration: string;
  sizeMb: string;
  dimensions: string;
  roleHint: string;
  preview: string;
  quickLink: string;
  sourcePath: string;
};

type WorkspaceShot = {
  id: string;
  time: string;
  segment: string;
  task: string;
  candidate_ids: number[];
  status: string;
  priority: string;
  edit: string;
  gap: string;
  candidates: WorkspaceAsset[];
};

type WorkspaceData = {
  story: {
    title: string;
    version: string;
    format: string;
    premise: string;
    workingRule: string;
  };
  shots: WorkspaceShot[];
  assets: WorkspaceAsset[];
};

type AssignedShot = {
  shot: WorkspaceShot;
  shotNo: number;
  stableShotId: string;
  candidateShotIds: string[];
};

type Args = {
  apply: boolean;
  allowMysql: boolean;
  userId: number | null;
  storyId: number | null;
  title: string;
};

type ImportCounters = {
  previewCopiesCreated: number;
  previewCopiesExisting: number;
  generatedImagesCreated: number;
  generatedImagesExisting: number;
  videoTakesCreated: number;
  videoTakesExisting: number;
  videoLinksCreated: number;
  videoLinksExisting: number;
  timelineSelectionsSet: number;
};

const repoRoot = process.cwd();
const genjiRoot = path.resolve(repoRoot, "../根基_素材整理");
const workspacePath = path.join(genjiRoot, "04_故事工作台/story_data.json");
const manifestPath = path.join(genjiRoot, "asset_manifest.json");

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    allowMysql: false,
    userId: null,
    storyId: null,
    title: "根基",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--allow-mysql") {
      args.allowMysql = true;
    } else if (arg === "--user-id") {
      const value = argv[i + 1];
      i += 1;
      args.userId = positiveInt(value, "--user-id");
    } else if (arg === "--story-id") {
      const value = argv[i + 1];
      i += 1;
      args.storyId = positiveInt(value, "--story-id");
    } else if (arg === "--title") {
      const value = argv[i + 1];
      i += 1;
      if (!value) throw new Error("--title 后面需要故事标题");
      args.title = value;
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
  npx tsx scripts/genji-import-all-media.ts --user-id 48
  npx tsx scripts/genji-import-all-media.ts --user-id 48 --apply

默认只预演，不写库、不复制文件。

参数：
  --user-id <id>      必填。导入到哪个 DT 本地用户。
  --story-id <id>     可选。默认按标题查找《根基》。
  --title <title>     可选。默认《根基》。
  --apply            真正写入 story body、generatedImages、videoTakes，并复制/链接媒体。
  --allow-mysql      默认强制使用本地 .webdev/local-persist.json；如要写 MySQL 才开启。
`);
}

function positiveInt(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} 必须是正整数`);
  }
  return parsed;
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
  const target = path.join(backupDir, `genji-all-media-${stamp}.json`);
  fs.copyFileSync(source, target);
  return target;
}

function stableShotId(shot: WorkspaceShot): string {
  return `genji-${shot.id.toLowerCase()}`;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "asset"
  );
}

function importedPreviewFileName(asset: Pick<GenjiAsset, "index" | "name">) {
  const index = String(asset.index).padStart(3, "0");
  return `genji-${index}-${slug(asset.name)}.jpg`;
}

function importedPreviewUrl(asset: Pick<GenjiAsset, "index" | "name">) {
  return `/api/images/${importedPreviewFileName(asset)}`;
}

function previewSourcePath(asset: GenjiAsset): string | null {
  return asset.preview_rel ? path.join(genjiRoot, asset.preview_rel) : null;
}

function numeric(value: number | "" | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function aspectRatio(asset: GenjiAsset): string {
  const width = numeric(asset.width);
  const height = numeric(asset.height);
  if (!width || !height) return "16:9";
  return width >= height ? "16:9" : "9:16";
}

function visualAssets(manifest: GenjiAsset[]): GenjiAsset[] {
  return manifest.filter(
    asset => (asset.kind === "image" || asset.kind === "video") && asset.preview_rel
  );
}

function videoAssets(manifest: GenjiAsset[]): GenjiAsset[] {
  return manifest.filter(asset => asset.kind === "video");
}

function workspaceAssetByIndex(workspace: WorkspaceData): Map<number, WorkspaceAsset> {
  return new Map(workspace.assets.map(asset => [asset.index, asset]));
}

function shotById(workspace: WorkspaceData): Map<string, WorkspaceShot> {
  return new Map(workspace.shots.map(shot => [shot.id, shot]));
}

function candidateShotIdsByAsset(workspace: WorkspaceData): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const shot of workspace.shots) {
    for (const index of shot.candidate_ids) {
      const list = map.get(index) ?? [];
      list.push(shot.id);
      map.set(index, list);
    }
  }
  return map;
}

function fallbackShotId(asset: GenjiAsset): string {
  const group = asset.group;
  const lowerName = asset.name.toLowerCase();
  if (group.includes("第5幕")) return "S13";
  if (group.includes("第一幕")) {
    return lowerName.includes("closeup") || lowerName.includes("close-up")
      ? "S01"
      : "S02";
  }
  if (group.includes("第二幕")) return asset.index <= 90 ? "S03" : "S04";
  if (group.includes("第三幕")) {
    if (asset.index <= 42) return "S05";
    if (asset.index <= 52) return "S06";
    return "S07";
  }
  if (group.includes("第四幕")) {
    if (asset.index <= 108) return "S08";
    if (asset.index <= 119) return "S09";
    if (asset.index <= 122) return "S10";
    return "S11";
  }
  return "S02";
}

function assignAssetToShot(
  asset: GenjiAsset,
  workspace: WorkspaceData,
  candidateMap: Map<number, string[]>
): AssignedShot {
  const shots = shotById(workspace);
  const candidateShotIds = candidateMap.get(asset.index) ?? [];
  const shotId = candidateShotIds[0] ?? fallbackShotId(asset);
  const shot = shots.get(shotId);
  if (!shot) throw new Error(`素材 ${asset.index} 找不到可分配镜头 ${shotId}`);
  const shotNo = workspace.shots.findIndex(item => item.id === shot.id) + 1;
  return {
    shot,
    shotNo,
    stableShotId: stableShotId(shot),
    candidateShotIds,
  };
}

function buildVisualCanvasItems(
  manifest: GenjiAsset[],
  workspace: WorkspaceData
) {
  const workspaceByIndex = workspaceAssetByIndex(workspace);
  const candidateMap = candidateShotIdsByAsset(workspace);
  return visualAssets(manifest).map((asset, index) => {
    const workspaceAsset = workspaceByIndex.get(asset.index);
    const assignment = assignAssetToShot(asset, workspace, candidateMap);
    const titleParts = [
      String(asset.index).padStart(3, "0"),
      workspaceAsset?.rank ?? "待筛",
      asset.kind === "video" ? "视频首帧" : "图片",
      asset.group,
    ];
    return {
      id: `genji-asset-${String(asset.index).padStart(3, "0")}`,
      title: titleParts.join("｜"),
      imageUrl: importedPreviewUrl(asset),
      originalImageUrl: importedPreviewUrl(asset),
      source: "reference" as const,
      x: (index % 8) * 180,
      y: Math.floor(index / 8) * 150,
      width: 160,
      height: 100,
      prompt: asset.role_hint,
      userInstruction: [
        "《根基》全量导入素材。",
        `建议挂接：${assignment.shot.id} ${assignment.shot.task}`,
        asset.kind === "video" ? "这是视频的可视首帧；原视频已作为 take 导入。" : "这是原始图片素材。",
      ].join(" "),
      analysis: {
        objective: `${asset.group} 的 ${asset.kind} 素材 ${asset.name}`,
        aesthetic: asset.role_hint,
        visualStyle: [workspaceAsset?.rank ?? "待筛", asset.group, asset.kind],
        mood: [asset.role_hint],
        colorPalette: [],
        composition:
          asset.width && asset.height ? `${asset.width}x${asset.height}` : "",
        lighting: "",
        promptDraft: asset.role_hint,
        negativePrompt: "",
        confidence: workspaceAsset?.rank === "A" ? 0.85 : 0.7,
      },
      createdAt: Date.parse("2026-07-02T00:00:00.000Z") + index,
    };
  });
}

function imagePrompt(asset: GenjiAsset, assignment: AssignedShot): string {
  return [
    `《根基》现有${asset.kind === "video" ? "视频首帧" : "图片"}素材 ${String(asset.index).padStart(3, "0")} 导入为镜头素材。`,
    `素材组：${asset.group}`,
    `用途：${asset.role_hint}`,
    `建议镜头：${assignment.shot.id} ${assignment.shot.task}`,
    `原文件：${asset.relative_path}`,
  ].join("\n");
}

function videoPrompt(asset: GenjiAsset, assignment: AssignedShot): string {
  return [
    `《根基》现有视频素材 ${String(asset.index).padStart(3, "0")}。`,
    `建议镜头：${assignment.shot.id} ${assignment.shot.task}`,
    `素材组：${asset.group}`,
    `用途：${asset.role_hint}`,
    `原文件：${asset.relative_path}`,
  ].join("\n");
}

function ensurePreviewCopy(
  asset: GenjiAsset,
  localImageDir: string,
  apply: boolean
): "created" | "existing" {
  const source = previewSourcePath(asset);
  if (!source || !fs.existsSync(source)) {
    throw new Error(`素材 ${asset.index} 缺少预览图：${source ?? "(empty)"}`);
  }
  const target = path.join(localImageDir, importedPreviewFileName(asset));
  if (fs.existsSync(target)) return "existing";
  if (apply) {
    fs.mkdirSync(localImageDir, { recursive: true });
    fs.copyFileSync(source, target);
  }
  return "created";
}

function ensureVideoLink(
  sourcePath: string,
  targetPath: string,
  apply: boolean
): "created" | "existing" {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`视频源文件不存在：${sourcePath}`);
  }
  if (fs.existsSync(targetPath)) {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(targetPath);
      const resolved = path.resolve(path.dirname(targetPath), linkTarget);
      if (resolved === sourcePath) return "existing";
    }
    throw new Error(`视频目标已存在但不是本次导入链接：${targetPath}`);
  }
  if (apply) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.symlinkSync(sourcePath, targetPath);
  }
  return "created";
}

function currentShotIdentitySet(images: Array<{ shotIdentity: string | null; isCurrent: boolean }>) {
  return new Set(
    images
      .filter(image => image.isCurrent && image.shotIdentity)
      .map(image => image.shotIdentity as string)
  );
}

function buildAssetPool(
  manifest: GenjiAsset[],
  workspace: WorkspaceData,
  generatedImageIdsByIndex: Map<number, number>,
  videoTakeIdsByIndex: Map<number, number>
) {
  const workspaceByIndex = workspaceAssetByIndex(workspace);
  const candidateMap = candidateShotIdsByAsset(workspace);
  return manifest.map(asset => {
    const workspaceAsset = workspaceByIndex.get(asset.index);
    const assignment =
      asset.kind === "image" || asset.kind === "video"
        ? assignAssetToShot(asset, workspace, candidateMap)
        : null;
    const previewUrl = asset.preview_rel ? importedPreviewUrl(asset) : null;
    const videoTakeId = videoTakeIdsByIndex.get(asset.index) ?? null;
    return {
      index: asset.index,
      group: asset.group,
      kind: asset.kind,
      rank: workspaceAsset?.rank ?? "待筛",
      name: asset.name,
      durationSec: numeric(asset.duration_sec),
      dimensions:
        asset.width && asset.height ? `${asset.width}x${asset.height}` : null,
      roleHint: asset.role_hint,
      sourcePath: asset.source_path,
      quickLink: asset.quick_link,
      previewPath: previewSourcePath(asset),
      dtPreviewUrl: previewUrl,
      proposedDtImageUrl: previewUrl,
      assignedShotId: assignment?.shot.id ?? null,
      assignedShotNo: assignment?.shotNo ?? null,
      assignedStableShotId: assignment?.stableShotId ?? null,
      candidateShotIds: assignment?.candidateShotIds ?? [],
      dtGeneratedImageId: generatedImageIdsByIndex.get(asset.index) ?? null,
      dtVideoTakeId: videoTakeId,
      dtVideoUrl: videoTakeId ? `/api/videos/take-${videoTakeId}.mp4` : null,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.userId) {
    printHelp();
    throw new Error("缺少 --user-id。为了避免导入到错误账号，这个参数必须显式传入。");
  }

  assertLocalModeUnlessAllowed(args.allowMysql);

  const manifest = readJson<GenjiAsset[]>(manifestPath);
  const workspace = readJson<WorkspaceData>(workspacePath);
  const allVisualAssets = visualAssets(manifest);
  const allVideoAssets = videoAssets(manifest);
  const candidateMap = candidateShotIdsByAsset(workspace);

  const db = await import("../server/db");
  const storySync = await import("../server/services/storySync");
  const imageGen = await import("../server/services/imageGen");
  const videoMedia = await import("../server/services/videoMedia");

  const stories = await db.listUserStories(args.userId);
  const story =
    args.storyId != null
      ? stories.find(item => item.id === args.storyId)
      : stories.find(item => item.title === args.title);
  if (!story) {
    throw new Error(
      args.storyId != null
        ? `找不到 story #${args.storyId}`
        : `user ${args.userId} 下找不到《${args.title}》`
    );
  }

  const existingImages = await db.getStoryGeneratedImages(story.id, args.userId);
  const existingImageByKeyAndShot = new Map(
    existingImages
      .filter(image => image.imageKey)
      .map(image => [`${image.imageKey}|${image.shotIdentity ?? ""}`, image])
  );
  const generatedImageIdsByIndex = new Map<number, number>();
  const currentShots = currentShotIdentitySet(existingImages);
  const seenNewCurrentShots = new Set<string>();
  const localImageDir = imageGen.localImageDir();
  const localVideoDir = videoMedia.localVideoDir();

  const counters: ImportCounters = {
    previewCopiesCreated: 0,
    previewCopiesExisting: 0,
    generatedImagesCreated: 0,
    generatedImagesExisting: 0,
    videoTakesCreated: 0,
    videoTakesExisting: 0,
    videoLinksCreated: 0,
    videoLinksExisting: 0,
    timelineSelectionsSet: 0,
  };

  for (const asset of allVisualAssets) {
    const copyStatus = ensurePreviewCopy(asset, localImageDir, args.apply);
    if (copyStatus === "created") counters.previewCopiesCreated += 1;
    else counters.previewCopiesExisting += 1;
  }

  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          storyId: story.id,
          userId: args.userId,
          localImageDir,
          localVideoDir,
          sourceAssets: manifest.length,
          visualPreviewAssets: allVisualAssets.length,
          videoAssets: allVideoAssets.length,
          previewsToCopy: counters.previewCopiesCreated,
          previewsAlreadyPresent: counters.previewCopiesExisting,
          currentGeneratedImages: existingImages.length,
          visualCanvasItemsAfterImport: allVisualAssets.length,
          note: "dry-run 完成：没有写 story、图片记录、视频 take 或本地媒体目录。",
        },
        null,
        2
      )
    );
    return;
  }

  const backupPath = backupLocalPersist();

  for (const asset of allVisualAssets) {
    const assignment = assignAssetToShot(asset, workspace, candidateMap);
    const imageKey = `genji-import/${importedPreviewFileName(asset)}`;
    const key = `${imageKey}|${assignment.stableShotId}`;
    const existing = existingImageByKeyAndShot.get(key);
    if (existing) {
      generatedImageIdsByIndex.set(asset.index, existing.id);
      counters.generatedImagesExisting += 1;
      continue;
    }
    const shouldBecomeCurrent =
      !currentShots.has(assignment.stableShotId) &&
      !seenNewCurrentShots.has(assignment.stableShotId);
    const image = await db.createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: args.userId,
      shotNo: String(assignment.shotNo),
      shotIdentity: assignment.stableShotId,
      imageKey,
      imageUrl: importedPreviewUrl(asset),
      prompt: imagePrompt(asset, assignment),
      promptCompilationId: null,
      generationType: "initial",
      parentImageId: null,
      isCurrent: shouldBecomeCurrent,
      maskKey: null,
    });
    generatedImageIdsByIndex.set(asset.index, image.id);
    counters.generatedImagesCreated += 1;
    if (shouldBecomeCurrent) {
      seenNewCurrentShots.add(assignment.stableShotId);
      currentShots.add(assignment.stableShotId);
    }
  }

  const videoTakeIdsByIndex = new Map<number, number>();
  const selectedTakeByShot = new Map<string, number>();
  for (const asset of allVideoAssets) {
    const assignment = assignAssetToShot(asset, workspace, candidateMap);
    const idempotencyKey = `genji-import-video-${story.id}-${asset.index}`;
    let take = await db.findVideoTakeByIdempotencyKey(
      story.id,
      args.userId,
      idempotencyKey
    );
    if (take) {
      counters.videoTakesExisting += 1;
    } else {
      take = await db.createVideoTake({
        storyId: story.id,
        userId: args.userId,
        stableShotId: assignment.stableShotId,
        sourceImageId: null,
        promptCompilationId: null,
        status: "available",
        taskId: `genji-${String(asset.index).padStart(3, "0")}`,
        provider: "local-import",
        model: "existing-local-video",
        prompt: videoPrompt(asset, assignment),
        subtitle: null,
        durationSec: numeric(asset.duration_sec),
        aspectRatio: aspectRatio(asset),
        videoKey: null,
        videoUrl: null,
        errorMessage: null,
        parameterSnapshot: {
          source: "genji-import",
          sourceAssetIndex: asset.index,
          sourcePath: asset.source_path,
          previewUrl: importedPreviewUrl(asset),
          group: asset.group,
          rank: workspaceAssetByIndex(workspace).get(asset.index)?.rank ?? "待筛",
          assignedShotId: assignment.shot.id,
          assignedStableShotId: assignment.stableShotId,
          durationSec: numeric(asset.duration_sec),
          aspectRatio: aspectRatio(asset),
        },
        idempotencyKey,
        extractionCapability: "unavailable",
      });
      counters.videoTakesCreated += 1;
    }

    const extension = asset.extension.toLowerCase() === ".webm" ? "webm" : "mp4";
    const videoFile = `take-${take.id}.${extension}`;
    const targetPath = path.join(localVideoDir, videoFile);
    const linkStatus = ensureVideoLink(asset.source_path, targetPath, args.apply);
    if (linkStatus === "created") counters.videoLinksCreated += 1;
    else counters.videoLinksExisting += 1;

    if (take.videoKey !== videoFile || take.videoUrl !== `/api/videos/${videoFile}`) {
      take = await db.updateVideoTake(take.id, args.userId, {
        videoKey: videoFile,
        videoUrl: `/api/videos/${videoFile}`,
      });
      if (!take) throw new Error(`更新视频 take ${videoFile} 失败`);
    }

    videoTakeIdsByIndex.set(asset.index, take.id);
    if (!selectedTakeByShot.has(assignment.stableShotId)) {
      selectedTakeByShot.set(assignment.stableShotId, take.id);
    }
  }

  for (const [stableShotId, takeId] of selectedTakeByShot) {
    await db.setVideoTimelineSelection({
      storyId: story.id,
      userId: args.userId,
      stableShotId,
      takeId,
      rangeId: null,
      selectionType: "full_take",
    });
    counters.timelineSelectionsSet += 1;
  }

  const latestStory = await db.getStoryById(story.id, args.userId);
  if (!latestStory) throw new Error(`导入后找不到 story ${story.id}`);
  const previousBody =
    latestStory.body &&
    typeof latestStory.body === "object" &&
    !Array.isArray(latestStory.body)
      ? (latestStory.body as Record<string, unknown>)
      : {};
  const nonGenjiVisualItems = Array.isArray(previousBody.visualCanvasItems)
    ? previousBody.visualCanvasItems.filter(item => {
        if (!item || typeof item !== "object") return false;
        const id = (item as Record<string, unknown>).id;
        return typeof id !== "string" || !id.startsWith("genji-asset-");
      })
    : [];
  const nextBody = {
    ...previousBody,
    visualCanvasItems: [
      ...nonGenjiVisualItems,
      ...buildVisualCanvasItems(manifest, workspace),
    ],
    genjiAssetPool: buildAssetPool(
      manifest,
      workspace,
      generatedImageIdsByIndex,
      videoTakeIdsByIndex
    ),
    genjiImport: {
      ...(previousBody.genjiImport &&
      typeof previousBody.genjiImport === "object" &&
      !Array.isArray(previousBody.genjiImport)
        ? (previousBody.genjiImport as Record<string, unknown>)
        : {}),
      allMediaImportedAt: new Date().toISOString(),
      allMediaImportScript: "scripts/genji-import-all-media.ts",
      sourceAssetCount: manifest.length,
      visualPreviewAssetCount: allVisualAssets.length,
      imageAssetCount: manifest.filter(asset => asset.kind === "image").length,
      videoAssetCount: allVideoAssets.length,
      localImageDir,
      localVideoDir,
      videoStorageMode: "symlink-to-original-source-files",
    },
  };
  const revision = storySync.getStoryRevision(latestStory.body) + 1;
  const body = storySync.prepareStoryBody(nextBody, revision, latestStory.body);
  await db.updateStory(story.id, args.userId, { body });

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        storyId: story.id,
        userId: args.userId,
        backupPath,
        localImageDir,
        localVideoDir,
        sourceAssets: manifest.length,
        visualPreviewAssets: allVisualAssets.length,
        videoAssets: allVideoAssets.length,
        visualCanvasItems: allVisualAssets.length,
        counters,
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error("[genji-import-all-media] 失败：", error);
  process.exitCode = 1;
});
