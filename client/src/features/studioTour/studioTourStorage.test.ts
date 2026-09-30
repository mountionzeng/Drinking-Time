import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStudioTourSeen,
  nextStudioTourIndex,
  previousStudioTourIndex,
  readStudioTourSeen,
  shouldShowStudioTour,
  studioTourSeenKey,
  writeStudioTourSeen,
} from "./studioTourStorage";

function stubStorage(values = new Map<string, string>()) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shouldShowStudioTour", () => {
  const base = {
    forced: false,
    seen: false,
    storageReadable: true,
    hasUser: true,
  };

  it("登录后第一次进来自动播放", () => {
    expect(shouldShowStudioTour(base)).toBe(true);
  });

  it("看过就不再自动弹", () => {
    expect(shouldShowStudioTour({ ...base, seen: true })).toBe(false);
  });

  it("用户自己点重看时，看过也照放", () => {
    expect(shouldShowStudioTour({ ...base, seen: true, forced: true })).toBe(
      true
    );
  });

  it("读不到本地存储就不自动弹，避免每次进来都被拦一次", () => {
    expect(shouldShowStudioTour({ ...base, storageReadable: false })).toBe(
      false
    );
  });

  it("没有登录用户时不播放，按账号记录才有意义", () => {
    expect(shouldShowStudioTour({ ...base, hasUser: false })).toBe(false);
  });
});

describe("studioTour seen 读写", () => {
  it("按账号分开记录，互不影响", () => {
    const values = stubStorage();
    writeStudioTourSeen(7, "2026-09-25T10:00:00.000Z");
    expect(values.get(studioTourSeenKey(7))).toBe("2026-09-25T10:00:00.000Z");
    expect(readStudioTourSeen(7)).toEqual({ seen: true, readable: true });
    expect(readStudioTourSeen(8)).toEqual({ seen: false, readable: true });
  });

  it("清掉之后会重新变成没看过", () => {
    stubStorage();
    writeStudioTourSeen(7, "2026-09-25T10:00:00.000Z");
    clearStudioTourSeen(7);
    expect(readStudioTourSeen(7).seen).toBe(false);
  });

  it("本地存储抛错时报告不可读，而不是当成没看过", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(readStudioTourSeen(7)).toEqual({ seen: false, readable: false });
    expect(() => writeStudioTourSeen(7, "now")).not.toThrow();
    expect(() => clearStudioTourSeen(7)).not.toThrow();
  });
});

describe("步骤前进后退", () => {
  it("走到最后一步返回 null，表示该收尾", () => {
    expect(nextStudioTourIndex(0, 3)).toBe(1);
    expect(nextStudioTourIndex(2, 3)).toBeNull();
  });

  it("第一步再往前退还是第一步", () => {
    expect(previousStudioTourIndex(0)).toBe(0);
    expect(previousStudioTourIndex(2)).toBe(1);
  });
});
