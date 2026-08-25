import { describe, expect, it } from "vitest";
import { createKeyedSerialLock } from "./keyedSerialLock";

describe("createKeyedSerialLock", () => {
  it("serializes tasks for the same key while allowing different keys through", async () => {
    const lock = createKeyedSerialLock<string>();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = lock.run("a", async () => {
      events.push("a1:start");
      await firstGate;
      events.push("a1:end");
    });
    const second = lock.run("a", async () => {
      events.push("a2");
    });
    await lock.run("b", async () => {
      events.push("b");
    });

    expect(events).toEqual(["a1:start", "b"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["a1:start", "b", "a1:end", "a2"]);
  });

  it("releases the next task after a rejection", async () => {
    const lock = createKeyedSerialLock<string>();
    const failed = lock.run("a", async () => {
      throw new Error("failed");
    });
    const next = lock.run("a", async () => "ok");

    await expect(failed).rejects.toThrow("failed");
    await expect(next).resolves.toBe("ok");
  });
});
