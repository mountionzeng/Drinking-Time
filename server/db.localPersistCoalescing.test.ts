import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 只包一层，用来数「真正落了几次盘」，其余走真实文件系统。
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-persist-coalesce-"));
const persistPath = path.join(tempDir, "local-persist.json");
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = persistPath;

const fs = await import("node:fs/promises");
const db = await import("./db");

const readPersistedTitles = async (): Promise<string[]> => {
  const parsed = JSON.parse(await readFile(persistPath, "utf-8")) as {
    stories?: { title: string }[];
  };
  return (parsed.stories ?? []).map(story => story.title);
};

describe("local persistence write coalescing", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
  });

  afterEach(() => {
    vi.mocked(fs.writeFile).mockClear();
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("collapses a burst of concurrent writes into far fewer full-state rewrites", async () => {
    const burst = 20;
    await Promise.all(
      Array.from({ length: burst }, (_, index) =>
        db.createStory({
          userId: 1,
          title: `burst-${index}`,
          body: { _revision: 1, shots: [] },
        })
      )
    );

    // 合并前：每次写各自全量重写一遍（≥20 次）。合并后同一瞬间的请求应压成个位数。
    expect(vi.mocked(fs.writeFile).mock.calls.length).toBeLessThan(burst);
  });

  it("resolves each caller only after a rewrite that contains its own mutation", async () => {
    // 逐个 await：每次返回后，这条 story 必须已经在盘上——合并不能偷走这个保证。
    for (let index = 0; index < 5; index += 1) {
      const title = `sequential-${index}`;
      await db.createStory({
        userId: 1,
        title,
        body: { _revision: 1, shots: [] },
      });
      expect(await readPersistedTitles()).toContain(title);
    }
  });

  it("persists every mutation from a concurrent burst, losing none", async () => {
    const titles = Array.from({ length: 12 }, (_, index) => `concurrent-${index}`);
    await Promise.all(
      titles.map(title =>
        db.createStory({ userId: 1, title, body: { _revision: 1, shots: [] } })
      )
    );

    const persisted = await readPersistedTitles();
    for (const title of titles) {
      expect(persisted).toContain(title);
    }
  });
});
