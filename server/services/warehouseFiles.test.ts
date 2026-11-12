import { beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createStory, getStoryById, resetMemoryStateForTesting } from "../db";
import { ENV } from "../_core/env";
import {
  importWarehouseFile,
  listWarehouseFiles,
  readWarehouseOriginal,
  inspectWarehouseFiles,
} from "./warehouseFiles";
import { prepareStoryBody, mergeStaleStoryBody } from "./storySync";
const ai = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("file contents must stay local");
  })
);
vi.mock("../_core/llm", () => ({ invokeLLM: ai }));
beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
  ai.mockClear();
});
async function fixture() {
  const story = await createStory({
    userId: 1,
    title: "test",
    body: { _revision: 1, marker: "keep" },
  });
  return {
    storyId: story.id,
    userId: 1,
    fileName: "../点彩.md",
    mimeType: "text/markdown",
    bytes: Buffer.from("# 点彩\n细小彩点形成城市。"),
  };
}
it("stores exact private originals, deduplicates and preserves files through stale saves", async () => {
  const input = await fixture();
  const file = await importWarehouseFile(input);
  expect(file.name).toBe("点彩.md");
  expect(file.extractedText).toContain("细小彩点");
  expect((await importWarehouseFile(input)).id).toBe(file.id);
  expect(
    (await readWarehouseOriginal({ ...input, fileId: file.id })).bytes.equals(
      input.bytes
    )
  ).toBe(true);
  const body = (await getStoryById(input.storyId, 1))!.body;
  expect(
    prepareStoryBody({ warehouseFiles: [] }, 99, body).warehouseFiles
  ).toEqual([file]);
  expect(
    mergeStaleStoryBody(body, { warehouseFiles: [] }, 99).warehouseFiles
  ).toEqual([file]);
  expect(
    prepareStoryBody({ warehouseFiles: [file] }, 1).warehouseFiles
  ).toBeUndefined();
  expect(await listWarehouseFiles(input)).toHaveLength(1);
  expect(
    await inspectWarehouseFiles({
      ...input,
      fileIds: [file.id],
      instruction: "analyze",
    })
  ).toContain("尚未提交外部 AI");
  expect(ai).not.toHaveBeenCalled();
  const raw = path.join(
    `${process.env.LOCAL_PERSIST_PATH}.warehouse-files`,
    "1",
    file.sha256
  );
  expect((await fs.stat(raw)).mode & 0o777).toBe(0o600);
});
it("rejects foreign stories, missing files and corrupt originals", async () => {
  const input = await fixture();
  const file = await importWarehouseFile(input);
  await expect(listWarehouseFiles({ ...input, userId: 2 })).rejects.toThrow(
    "无权"
  );
  await expect(
    readWarehouseOriginal({ ...input, fileId: 900 })
  ).rejects.toThrow("不存在");
  await expect(
    inspectWarehouseFiles({ ...input, fileIds: [900], instruction: "read" })
  ).rejects.toThrow("不属于");
  await fs.writeFile(
    path.join(
      `${process.env.LOCAL_PERSIST_PATH}.warehouse-files`,
      "1",
      file.sha256
    ),
    "corrupt"
  );
  await expect(
    readWarehouseOriginal({ ...input, fileId: file.id })
  ).rejects.toThrow("校验");
});
it("retains both concurrent uploads and disallows oversized/empty files", async () => {
  const input = await fixture();
  const files = await Promise.all([
    importWarehouseFile(input),
    importWarehouseFile({
      ...input,
      fileName: "notes.csv",
      bytes: Buffer.from("a,b\n1,2"),
    }),
  ]);
  expect(new Set(files.map(f => f.id)).size).toBe(2);
  expect(await listWarehouseFiles(input)).toHaveLength(2);
  await expect(
    importWarehouseFile({ ...input, bytes: Buffer.alloc(0) })
  ).rejects.toThrow("25MB");
  await expect(
    importWarehouseFile({ ...input, bytes: Buffer.alloc(25 * 1024 * 1024 + 1) })
  ).rejects.toThrow("25MB");
});

it("keeps the original without a preview when text would exceed story capacity", async () => {
  const story = await createStory({
    userId: 1,
    title: "near capacity",
    body: { _revision: 1, padding: "x".repeat(4 * 1024 * 1024 - 5000) },
  });
  const input = {
    storyId: story.id,
    userId: 1,
    fileName: "long.txt",
    mimeType: "text/plain",
    bytes: Buffer.from("x".repeat(30000)),
  };
  const saved = await importWarehouseFile(input);
  expect(saved.extractionStatus).toBe("stored");
  expect(saved.extractedText).toBe("");
  expect(
    (await readWarehouseOriginal({ ...input, fileId: saved.id })).bytes.equals(
      input.bytes
    )
  ).toBe(true);
});
