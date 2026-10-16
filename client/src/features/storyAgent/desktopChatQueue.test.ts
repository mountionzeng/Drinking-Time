import { describe, expect, it, vi } from "vitest";
import { DesktopChatQueue } from "./desktopChatQueue";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("desktop sequential chat", () => {
  it("freezes the module, crop and visual preview per send and restores that snapshot after reload", () => {
    const saved = storage();
    const queue = new DesktopChatQueue("a", saved);
    const module = {
      storyId: 7,
      scope: "layout:v1",
      moduleId: "image1",
      kind: "image" as const,
      page: 1,
      pageCount: 2,
      rect: { x: 30, y: 40, width: 200, height: 100 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
      pageText: "页面文字",
      pagePreview: "data:image/jpeg;base64,AAAA",
    };
    const layoutMemory = {
      storyId: 7,
      scope: module.scope,
      total: 1,
      recent: [
        {
          kind: "style" as const,
          summary: "改成加粗浅色字",
          undone: false,
          at: 1,
          sameSource: true,
        },
      ],
    };
    queue.enqueue("这块怎么改", {
      draft: module.pageText,
      cursor: 0,
      scope: module.scope,
      module,
      layoutMemory,
    });
    module.page = 2;
    module.crop.x = 0.25;
    module.pagePreview = "data:image/jpeg;base64,BBBB";
    layoutMemory.recent[0].undone = true;
    const frozen = queue.snapshot().items[0].writingContext!.module!;
    expect(frozen).toMatchObject({
      page: 1,
      crop: { x: 0 },
      pagePreview: "data:image/jpeg;base64,AAAA",
    });
    expect(
      new DesktopChatQueue("a", saved).snapshot().items[0].writingContext!
        .module
    ).toEqual(frozen);
    expect(
      new DesktopChatQueue("a", saved).snapshot().items[0].writingContext!
        .layoutMemory!.recent[0].undone
    ).toBe(false);
  });
  it("accepts another message immediately while only one request runs, then sees the preceding reply", async () => {
    const queue = new DesktopChatQueue("user:story", storage());
    const first = deferred();
    const history: string[] = [];
    const seen: string[][] = [];
    const run = vi.fn(async item => {
      seen.push([...history]);
      if (item.text === "one") await first.promise;
      history.push(item.text, `reply:${item.text}`);
      return true;
    });
    queue.enqueue("one");
    const pending = queue.drain(run, () => true);
    queue.enqueue("two");
    await queue.drain(run, () => true);
    expect(queue.snapshot().items.map(item => item.status)).toEqual([
      "sending",
      "queued",
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    first.resolve(true);
    await pending;
    expect(seen).toEqual([[], ["one", "reply:one"]]);
    expect(queue.snapshot().items).toEqual([]);
  });
  it("captures separate writing scopes for messages submitted before and after an editor change", async () => {
    const queue = new DesktopChatQueue("a", storage());
    const snapshot = {
      draft: "before",
      scope: "v1",
      cursor: 2,
      selection: { start: 0, end: 2 },
    };
    queue.enqueue("same", snapshot);
    queue.enqueue("same", { ...snapshot, draft: "after", scope: "v2" });
    const items = queue.snapshot().items;
    expect(items[0].id).not.toBe(items[1].id);
    const seen: string[] = [];
    await queue.drain(
      async item => {
        seen.push(item.writingContext!.draft);
        return true;
      },
      () => true
    );
    expect(seen).toEqual(["before", "after"]);
  });
  it("pauses an uncertain failure without retrying or sending following messages", async () => {
    const saved = storage();
    const queue = new DesktopChatQueue("a", saved);
    queue.enqueue("one");
    queue.enqueue("two");
    const run = vi.fn(async () => {
      throw new Error("response lost");
    });
    await queue.drain(run, () => true);
    queue.resume();
    await queue.drain(run, () => true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().items.map(item => item.status)).toEqual([
      "failed",
      "queued",
    ]);
    expect(queue.takeBack(queue.snapshot().items[0].id)?.text).toBe("one");
    queue.resume();
    await queue.drain(
      async () => true,
      () => true
    );
    expect(saved.getItem("a")).toBeNull();
  });
  it("does not auto-send after reload and preserves original writing context", async () => {
    const saved = storage();
    const queue = new DesktopChatQueue("a", saved);
    queue.enqueue("one", { draft: "source", scope: "old", cursor: 1 });
    const first = deferred();
    const pending = queue.drain(
      () => first.promise,
      () => true
    );
    const restored = new DesktopChatQueue("a", saved);
    const run = vi.fn(async () => true);
    await restored.drain(run, () => true);
    expect(run).not.toHaveBeenCalled();
    expect(restored.snapshot().items[0]).toMatchObject({
      status: "failed",
      writingContext: { draft: "source", scope: "old" },
    });
    first.resolve(true);
    await pending;
  });
  it("stops before the next request after switching stories and cannot overwrite the restored queue", async () => {
    const saved = storage();
    const queue = new DesktopChatQueue("a", saved);
    queue.enqueue("one");
    queue.enqueue("two");
    const first = deferred();
    let current = true;
    const run = vi.fn(() => first.promise);
    const pending = queue.drain(run, () => current);
    current = false;
    queue.setSuspended(true);
    const restored = new DesktopChatQueue("a", saved);
    restored.enqueue("three");
    first.resolve(true);
    await pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      new DesktopChatQueue("a", saved).snapshot().items.map(item => item.text)
    ).toEqual(["one", "two", "three"]);
  });
  it("moves pending messages to the persisted id when a new story is first saved", async () => {
    const saved = storage();
    const queue = new DesktopChatQueue("new", saved);
    queue.enqueue("one");
    queue.moveTo("saved");
    expect(saved.getItem("new")).toBeNull();
    expect(new DesktopChatQueue("saved", saved).snapshot().items[0].text).toBe(
      "one"
    );
    await queue.drain(
      async () => true,
      () => true
    );
    expect(saved.getItem("saved")).toBeNull();
  });
  it("fails before accepting a message when recovery storage is full", () => {
    const queue = new DesktopChatQueue("a", {
      ...storage(),
      setItem() {
        throw new Error("quota");
      },
    });
    expect(() => queue.enqueue("keep in composer")).toThrow("quota");
    expect(queue.snapshot().items).toEqual([]);
  });
  it("leaves an actionable paused record if storage fails after the request", async () => {
    const saved = storage();
    const queue = new DesktopChatQueue("a", saved);
    queue.enqueue("one");
    await expect(
      queue.drain(
        async () => {
          saved.removeItem = () => {
            throw new Error("storage denied");
          };
          return true;
        },
        () => true
      )
    ).rejects.toThrow("storage denied");
    expect(queue.snapshot()).toMatchObject({
      paused: true,
      items: [{ status: "failed" }],
    });
  });
});
