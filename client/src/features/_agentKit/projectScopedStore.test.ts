import { describe, it, expect, beforeEach } from "vitest";
import {
  makeStorageKey,
  loadProjectState,
  saveProjectState,
} from "./projectScopedStore";

// vitest 全局环境是 node（无 DOM），用内存版 localStorage 测纯函数
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const id = <T,>(r: unknown) => r as T;

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe("projectScopedStore（按 projectId 分区的持久化）", () => {
  it("makeStorageKey：有 projectId 拼键，无则 null", () => {
    expect(makeStorageKey("dt:x", 1)).toBe("dt:x:1");
    expect(makeStorageKey("dt:x", null)).toBeNull();
  });

  it("save + load 往返，且按 projectId 分区互不串号", () => {
    saveProjectState("dt:x", 1, { n: 1 });
    saveProjectState("dt:x", 2, { n: 2 });
    expect(
      loadProjectState("dt:x", 1, id<{ n: number }>, () => ({ n: 0 })),
    ).toEqual({ n: 1 });
    expect(
      loadProjectState("dt:x", 2, id<{ n: number }>, () => ({ n: 0 })),
    ).toEqual({ n: 2 });
  });

  it("无 projectId → 不写入，load 返回 fallback", () => {
    saveProjectState("dt:x", null, { n: 9 }); // no-op
    expect(
      loadProjectState("dt:x", null, id<{ n: number }>, () => ({ n: 0 })),
    ).toEqual({ n: 0 });
  });

  it("坏 JSON / 无数据 → fallback，不抛", () => {
    localStorage.setItem("dt:x:1", "{not json");
    expect(
      loadProjectState("dt:x", 1, id<{ n: number }>, () => ({ n: -1 })),
    ).toEqual({ n: -1 });
    expect(
      loadProjectState("dt:x", 3, id<{ n: number }>, () => ({ n: -1 })),
    ).toEqual({ n: -1 });
  });

  it("parse 回调负责规范化（坏字段收敛到默认）", () => {
    localStorage.setItem("dt:x:1", JSON.stringify({ messages: "bad" }));
    const loaded = loadProjectState<{ messages: unknown[] }>(
      "dt:x",
      1,
      (r) => ({
        messages: Array.isArray((r as { messages?: unknown }).messages)
          ? (r as { messages: unknown[] }).messages
          : [],
      }),
      () => ({ messages: [] }),
    );
    expect(loaded.messages).toEqual([]);
  });
});
