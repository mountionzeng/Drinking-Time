import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import {
  MAX_WAREHOUSE_FILE_BYTES,
  readWarehouseFiles,
  type WarehouseFile,
} from "../../shared/warehouseFiles";
import { getStoryById } from "../repositories/stories";
import { consumePersistentRateLimit } from "../repositories/accounts";
import {
  jsonRecord,
  persistedStoryBodyRevision,
} from "../repositories/storyValues";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import { MAX_STORY_BODY_BYTES } from "./publishingPersistence";
import { extractWarehouseFile } from "./warehouseFileExtraction";

type Owner = { storyId: number; userId: number };
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function privatePath(userId: number, sha: string) {
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !/^[a-f0-9]{64}$/.test(sha)
  )
    throw new Error("Invalid file identity");
  return path.join(
    process.env.WAREHOUSE_FILES_DIR ||
      (process.env.LOCAL_PERSIST_PATH
        ? `${process.env.LOCAL_PERSIST_PATH}.warehouse-files`
        : path.join(process.cwd(), ".webdev", "private-warehouse-files")),
    String(userId),
    sha
  );
}
export async function listWarehouseFiles(owner: Owner) {
  const story = await getStoryById(owner.storyId, owner.userId);
  if (!story)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "故事不存在或无权访问 / Story unavailable",
    });
  return readWarehouseFiles(story.body);
}
export async function importWarehouseFile(
  input: Owner & { fileName: string; mimeType: string; bytes: Buffer }
) {
  const initial = await listWarehouseFiles(input);
  if (!input.bytes.length || input.bytes.length > MAX_WAREHOUSE_FILE_BYTES)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "文件需为1字节至25MB / File must be between 1 byte and 25 MB",
    });
  const name =
    path
      .basename(input.fileName.replace(/\\/g, "/"))
      .replace(/[\x00-\x1f\x7f]/g, "")
      .slice(0, 300) || "file";
  const sha256 = digest(input.bytes),
    extension = name.split(".").slice(1).pop()?.toLowerCase() || "";
  const existing = initial.find(
    file => file.sha256 === sha256 && file.name === name
  );
  if (existing) return existing;
  if (
    initial.length >= 200 ||
    initial.reduce((sum, file) => sum + file.bytes, 0) + input.bytes.length >
      512 * 1024 * 1024
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "当前故事文件仓库已达200份或512MB上限 / Story file storage is full",
    });
  const rate = await consumePersistentRateLimit({
    scope: "warehouse-file-import",
    subject: String(input.userId),
    windowSeconds: 3600,
    maxAttempts: 100,
  });
  if (!rate.allowed)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "本小时上传较多，请稍后重试 / Please try again later",
    });
  const destination = privatePath(input.userId, sha256),
    staged = `${destination}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(staged, input.bytes, { mode: 0o600 });
    await fs.rename(staged, destination);
  } finally {
    await fs.rm(staged, { force: true });
  }
  const extracted = await extractWarehouseFile(
    destination,
    extension,
    input.mimeType
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const story = await getStoryById(input.storyId, input.userId);
    if (!story)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "故事不存在 / Story unavailable",
      });
    const files = readWarehouseFiles(story.body);
    const duplicate = files.find(
      file => file.sha256 === sha256 && file.name === name
    );
    if (duplicate) return duplicate;
    if (
      files.length >= 200 ||
      files.reduce((sum, file) => sum + file.bytes, 0) + input.bytes.length >
        512 * 1024 * 1024
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "当前故事文件仓库已达200份或512MB上限 / Story file storage is full",
      });
    const file: WarehouseFile = {
      id: Math.max(0, ...files.map(file => file.id)) + 1,
      name,
      mime: input.mimeType.slice(0, 120),
      bytes: input.bytes.length,
      sha256,
      extension,
      createdAt: new Date().toISOString(),
      ...extracted,
    };
    const revision = persistedStoryBodyRevision(story.body);
    const nextBody = {
      ...jsonRecord(story.body),
      warehouseFiles: [...files, file],
      _revision: revision + 1,
    };
    if (
      Buffer.byteLength(JSON.stringify(nextBody), "utf8") > MAX_STORY_BODY_BYTES
    ) {
      // The original remains intact when a large preview would crowd out editing.
      file.extractedText = "";
      file.extractionStatus = "stored";
      file.extractionNote =
        "原件已保存；故事预览容量已满 / Original saved; story preview capacity reached";
      if (
        Buffer.byteLength(JSON.stringify(nextBody), "utf8") >
        MAX_STORY_BODY_BYTES
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "故事容量已满，文件未加入仓库 / Story capacity reached; file not added",
        });
      }
    }
    try {
      await persistPreparedStoryBody({
        ...input,
        expectedRevision: revision,
        body: nextBody,
      });
      return file;
    } catch (error) {
      if (!(error instanceof StoryBodyRevisionConflictError) || attempt === 4)
        throw error;
    }
  }
  throw new Error("文件保存冲突，请重试 / Save conflict; please retry");
}
export async function readWarehouseOriginal(owner: Owner & { fileId: number }) {
  const file = (await listWarehouseFiles(owner)).find(
    file => file.id === owner.fileId
  );
  if (!file)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "文件不存在 / File unavailable",
    });
  const bytes = await fs.readFile(privatePath(owner.userId, file.sha256));
  if (digest(bytes) !== file.sha256)
    throw new Error("文件校验失败 / File checksum mismatch");
  return { file, bytes };
}
export async function inspectWarehouseFiles(
  input: Owner & { fileIds: number[]; instruction: string }
) {
  const all = await listWarehouseFiles(input);
  const files = input.fileIds.map(id => all.find(file => file.id === id));
  if (files.some(file => !file))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "文件不属于当前故事 / File not in this story",
    });
  return (
    (files as WarehouseFile[])
      .map(
        file =>
          `文件 #${file.id}「${file.name}」已保存在仓库 · ${(file.bytes / 1024).toFixed(1)} KB。${file.extractionNote}`
      )
      .join("\n") +
    "\n可在仓库的‘文字 / 文件’查看本地内容预览和下载原件。尚未提交外部 AI 分析 / Local preview and originals are available in Warehouse; no external AI analysis was submitted."
  );
}
