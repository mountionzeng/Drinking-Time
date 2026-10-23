import { describe, expect, it, vi } from "vitest";
import { ChapterSaveQueue } from "./chapterSaveQueue";

describe("chapter save queue", () => {
  it("saves the latest edit after an in-flight write using its returned version", async () => {
    let release!: (version: number) => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>(resolve => {
            release = resolve;
          })
      )
      .mockResolvedValueOnce(9);
    const queue = new ChapterSaveQueue<string>(7, "initial", write);
    queue.enqueue("first");
    const saving = queue.flush();
    queue.enqueue("intermediate");
    queue.enqueue("last");
    expect(write).toHaveBeenCalledTimes(1);
    release(8);
    await saving;
    expect(write.mock.calls).toEqual([
      ["first", 7],
      ["last", 8],
    ]);
    expect(queue.version).toBe(9);
    expect(queue.dirty).toBe(false);
  });
  it("keeps the edit and stops after a conflict instead of overwriting with a retry", async () => {
    const write = vi.fn().mockRejectedValue(new Error("版本冲突"));
    const queue = new ChapterSaveQueue<string>(1, "old", write);
    queue.enqueue("mine");
    await expect(queue.flush()).rejects.toThrow("版本冲突");
    queue.enqueue("newer mine");
    await expect(queue.flush()).rejects.toThrow("版本冲突");
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.dirty).toBe(true);
    expect(queue.version).toBe(1);
  });
  it("does not write unchanged layouts and isolates two chapters", async () => {
    const a = vi.fn().mockResolvedValue(2);
    const b = vi.fn().mockResolvedValue(6);
    const first = new ChapterSaveQueue<string>(1, "a", a);
    const second = new ChapterSaveQueue<string>(5, "b", b);
    first.enqueue("a");
    second.enqueue("second chapter");
    await Promise.all([first.flush(), second.flush()]);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith("second chapter", 5);
  });
});
