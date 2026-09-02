import { describe, expect, it } from "vitest";

import {
  clearMobileRecoveryForUser,
  reconcileMobileRecoveryOwner,
  rememberMobileRecoveryOwner,
} from "./mobileRecoveryIdentity";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("mobile recovery identity", () => {
  it("keeps scoped recovery for a same-user session renewal", () => {
    const storage = new MemoryStorage();
    rememberMobileRecoveryOwner(storage, 7);
    storage.setItem("dt:mobile:document:v1:7:42", "手机正文");
    storage.setItem("dt:mobile:conversation:v1:7:42", "手机对话");

    expect(reconcileMobileRecoveryOwner(storage, 7)).toEqual({
      previousUserId: 7,
      changed: false,
    });
    expect(storage.getItem("dt:mobile:document:v1:7:42")).toBe("手机正文");
    expect(storage.getItem("dt:mobile:conversation:v1:7:42")).toBe("手机对话");
  });

  it("removes every prior-user mobile record before remembering a new user", () => {
    const storage = new MemoryStorage();
    rememberMobileRecoveryOwner(storage, 7);
    storage.setItem("dt:mobile:document:v1:7:42", "用户 A 正文");
    storage.setItem("dt:mobile:conversation:v1:7:42", "用户 A 对话");
    storage.setItem("dt:mobile:document:v1:8:99", "用户 B 正文");
    storage.setItem("unrelated", "保留");

    expect(reconcileMobileRecoveryOwner(storage, 8)).toEqual({
      previousUserId: 7,
      changed: true,
    });
    expect(
      [...Array(storage.length)].map((_, index) => storage.key(index))
    ).not.toContain("dt:mobile:document:v1:7:42");
    expect(storage.getItem("dt:mobile:conversation:v1:7:42")).toBeNull();
    expect(storage.getItem("dt:mobile:document:v1:8:99")).toBe("用户 B 正文");
    expect(storage.getItem("unrelated")).toBe("保留");
  });

  it("cleans legacy foreign records even when no owner marker exists", () => {
    const storage = new MemoryStorage();
    storage.setItem("dt:mobile:document:v1:7:42", "旧用户正文");
    storage.setItem("dt:mobile:conversation:v1:8:99", "当前用户对话");

    expect(reconcileMobileRecoveryOwner(storage, 8)).toEqual({
      previousUserId: null,
      changed: true,
    });
    expect(storage.getItem("dt:mobile:document:v1:7:42")).toBeNull();
    expect(storage.getItem("dt:mobile:conversation:v1:8:99")).toBe(
      "当前用户对话"
    );
  });

  it("clears the current user's records on explicit logout", () => {
    const storage = new MemoryStorage();
    rememberMobileRecoveryOwner(storage, 7);
    storage.setItem("dt:mobile:document:v1:7:42", "正文");
    storage.setItem("dt:mobile:conversation:v1:7:42", "对话");

    clearMobileRecoveryForUser(storage, 7);

    expect(storage.length).toBe(0);
  });
});
