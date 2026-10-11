import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryWarehouseRouter } from "./routers/memoryWarehouse";
import { resetMemoryStateForTesting } from "./repositories/runtime";
import { createStory } from "./repositories/stories";
import { deleteStory } from "./repositories/storyLifecycle";
import { insertMemoryCard, readMemoryCards } from "./repositories/memoryCards";
import type { TrpcContext } from "./_core/context";
import type { MemoryCardInput } from "../shared/memoryWarehouse";

process.env.DATABASE_URL = "";
const caller = (id: number | null) =>
  memoryWarehouseRouter.createCaller({
    user: id ? { id } : null,
  } as TrpcContext);
const input = (): MemoryCardInput => ({
  id: randomUUID(),
  title: "雨后",
  content: "今天闻到了桂花香。",
  kind: "event",
  origin: "note",
  sourceStoryId: null,
});
beforeEach(() => resetMemoryStateForTesting());

describe("explicit memory warehouse", () => {
  it("requires login and isolates list, save source and archive by account", async () => {
    await expect(caller(null).list({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const card = await caller(11).save(input());
    expect((await caller(12).list({})).cards).toEqual([]);
    expect(await readMemoryCards(12, [card.id])).toEqual([]);
    await expect(
      caller(12).archive({ id: card.id, archived: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const story = await createStory({ userId: 11, title: "原故事", body: {} });
    await expect(
      caller(12).save({ ...input(), sourceStoryId: story.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("persists a standalone card, deduplicates retries and rejects changed payloads", async () => {
    const value = input();
    await Promise.all([caller(11).save(value), caller(11).save(value)]);
    expect((await caller(11).list({})).cards).toHaveLength(1);
    await expect(
      caller(11).save({ ...value, content: "修改内容" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller(12).save(value)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const disk = JSON.parse(
      await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")
    );
    expect(disk.memoryCards).toHaveLength(1);
    expect(disk.memoryCards[0].content).toBe(value.content);
    const reloaded = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { readMemoryCards } from './server/repositories/memoryCards.ts';
       const rows = await readMemoryCards(11, [${JSON.stringify(value.id)}]);
       console.log(JSON.stringify({ content: rows[0]?.content, isDate: rows[0]?.createdAt instanceof Date }));`
    ], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } });
    expect(JSON.parse(reloaded.trim().split("\n").at(-1)!)).toEqual({ content: value.content, isDate: true });
  });
  it("keeps cards after source story deletion; archive is reversible", async () => {
    const story = await createStory({ userId: 11, title: "原故事", body: {} });
    const card = await caller(11).save({ ...input(), sourceStoryId: story.id });
    await deleteStory(story.id, 11);
    expect((await caller(11).list({})).cards[0].id).toBe(card.id);
    await caller(11).archive({ id: card.id, archived: true });
    expect((await caller(11).list({})).cards).toEqual([]);
    expect((await caller(11).list({ archived: true })).cards[0].id).toBe(
      card.id
    );
    await caller(11).archive({ id: card.id, archived: false });
    expect((await caller(11).list({})).cards[0].id).toBe(card.id);
  });
  it("paginates without hiding older cards and rejects empty card content", async () => {
    for (let i = 0; i < 51; i++) await insertMemoryCard(11, input());
    const first = await caller(11).list({});
    const second = await caller(11).list({ offset: first.nextOffset! });
    expect(first.cards).toHaveLength(50);
    expect(second.cards).toHaveLength(1);
    expect(
      new Set([...first.cards, ...second.cards].map(card => card.id)).size
    ).toBe(51);
    expect(second.nextOffset).toBeNull();
    await expect(
      caller(11).save({ ...input(), content: "  " })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
