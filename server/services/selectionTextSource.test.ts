import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  selectionContentFingerprint,
  type SelectionContext,
} from "../../shared/selectionContext";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const directory = await mkdtemp(
  path.join(os.tmpdir(), "selection-text-source-")
);
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(directory, "persist.json");
const db = await import("../db");
const service = await import("./selectionTextSource");

let userId: number;
let storyId: number;

function cardSelection(fullText: string): SelectionContext {
  const selectedText = "我们去了公园";
  const start = fullText.indexOf(selectedText);
  return {
    sourceType: "card",
    sourceId: "card-a",
    selectedText,
    fullText,
    storyId,
    contentFingerprint: selectionContentFingerprint(fullText),
    selection: { kind: "text", start, end: start + selectedText.length },
  };
}

describe("owned selection text source", () => {
  beforeEach(async () => {
    db.resetMemoryStateForTesting();
    await db.upsertUser({ openId: "selection-owner" });
    userId = (await db.getUserByOpenId("selection-owner"))!.id;
    storyId = (
      await db.createStory({
        userId,
        title: "selection story",
        body: {
          _revision: 1,
          cards: [
            {
              id: "card-a",
              title: "一天",
              content: "今天下雨。我们去了公园。晚上回家。",
            },
          ],
          shots: [],
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined)
      delete process.env.LOCAL_PERSIST_PATH;
    else process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    await rm(directory, { recursive: true, force: true });
  });

  it("persists only through an owned, unchanged source snapshot", async () => {
    const selection = cardSelection("今天下雨。我们去了公园。晚上回家。");
    const resolved = await service.resolveOwnedSelectionTextSource({
      selection,
      userId,
    });
    expect(resolved.status).toBe("ok");
    if (resolved.status !== "ok") return;
    await expect(
      service.persistOwnedSelectionTextReplacement({
        selection,
        userId,
        expected: resolved.source,
        nextText: "今天下雨。我们开心地去了公园。晚上回家。",
      })
    ).resolves.toMatchObject({ status: "ok" });
    const saved = await db.getStoryById(storyId, userId);
    expect((saved!.body as any).cards[0].content).toBe(
      "今天下雨。我们开心地去了公园。晚上回家。"
    );
  });

  it("rejects forged ownership and stale fingerprints", async () => {
    const selection = cardSelection("今天下雨。我们去了公园。晚上回家。");
    await expect(
      service.resolveOwnedSelectionTextSource({ selection, userId: userId + 1 })
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      service.resolveOwnedSelectionTextSource({
        selection: { ...selection, contentFingerprint: "fnv1a:stale:0" },
        userId,
      })
    ).resolves.toMatchObject({ status: "error" });
  });
});
