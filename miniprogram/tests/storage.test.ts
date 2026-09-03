import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFailingStorage,
  createMemoryStorage,
  createWxStorage,
  readStorageItemObserved,
  removeStorageItemVerified,
  writeStorageItemVerified,
  type MiniProgramStorage,
} from "../src/services/storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("认证凭据的可验证存储操作", () => {
  it("只有写入后能逐字读回才报告成功", () => {
    const storage = createMemoryStorage();
    expect(writeStorageItemVerified(storage, "auth-key", "opaque-value")).toBe(
      true,
    );
    expect(storage.getItem("auth-key")).toBe("opaque-value");
  });

  it("底层吞掉写入失败时仍报告失败", () => {
    const storage: MiniProgramStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      keys: () => [],
    };
    expect(writeStorageItemVerified(storage, "auth-key", "opaque-value")).toBe(
      false,
    );
  });

  it("只有删除后确实读不到才报告成功", () => {
    const storage = createMemoryStorage({ "auth-key": "opaque-value" });
    expect(removeStorageItemVerified(storage, "auth-key")).toBe(true);
    expect(storage.getItem("auth-key")).toBeNull();
  });

  it("删除被吞掉或存储整体不可用时失败关闭", () => {
    const sticky: MiniProgramStorage = {
      getItem: () => "opaque-value",
      setItem: () => {},
      removeItem: () => {},
      keys: () => ["auth-key"],
    };
    expect(removeStorageItemVerified(sticky, "auth-key")).toBe(false);
    expect(
      writeStorageItemVerified(createFailingStorage(), "auth-key", "value"),
    ).toBe(false);
    expect(removeStorageItemVerified(createFailingStorage(), "auth-key")).toBe(
      false,
    );
  });

  it("wx 读取异常保持为 unavailable，删除异常不能被误判为成功", () => {
    let underlying = "still-present";
    vi.stubGlobal("wx", {
      getStorageSync() {
        throw new Error("simulated wx read failure");
      },
      setStorageSync() {},
      removeStorageSync() {
        throw new Error("simulated wx remove failure");
      },
      getStorageInfoSync() {
        return { keys: ["auth-key"] };
      },
    });
    const storage = createWxStorage();

    expect(readStorageItemObserved(storage, "auth-key")).toEqual({
      kind: "unavailable",
    });
    expect(removeStorageItemVerified(storage, "auth-key")).toBe(false);
    expect(underlying).toBe("still-present");

    underlying = "still-present";
  });
});
