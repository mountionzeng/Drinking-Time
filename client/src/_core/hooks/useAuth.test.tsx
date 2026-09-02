import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  currentUser: null as { id: number } | null,
  mutateAsync: vi.fn<() => Promise<void>>(),
  setData: vi.fn(),
  invalidate: vi.fn<() => Promise<void>>(),
  refetch: vi.fn(),
  queryClientClear: vi.fn(),
}));

vi.mock("@/const", () => ({ getLoginUrl: () => "/login" }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: authMocks.queryClientClear }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      auth: {
        me: {
          setData: authMocks.setData,
          invalidate: authMocks.invalidate,
        },
      },
    }),
    auth: {
      me: {
        useQuery: () => ({
          data: authMocks.currentUser,
          isLoading: false,
          error: null,
          refetch: authMocks.refetch,
        }),
      },
      logout: {
        useMutation: () => ({
          mutateAsync: authMocks.mutateAsync,
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

import { useAuth } from "./useAuth";

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

function installBrowserStorage(storage: Storage) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { pathname: "/m", href: "/m" }, localStorage: storage },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

function renderedLogout(): () => Promise<void> {
  let logout: (() => Promise<void>) | undefined;
  function Harness() {
    logout = useAuth().logout;
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  if (!logout) throw new Error("useAuth logout was not rendered");
  return logout;
}

describe("useAuth logout behavior", () => {
  beforeEach(() => {
    authMocks.currentUser = null;
    authMocks.mutateAsync.mockReset().mockResolvedValue(undefined);
    authMocks.setData.mockReset();
    authMocks.invalidate.mockReset().mockResolvedValue(undefined);
    authMocks.refetch.mockReset();
    authMocks.queryClientClear.mockReset();
    installBrowserStorage(new MemoryStorage());
  });

  it("clears only the signed-in user's mobile recovery before logout", async () => {
    const storage = window.localStorage;
    storage.setItem("dt:mobile:recovery-owner:v1", "7");
    storage.setItem("dt:mobile:document:v1:7:42", "用户 7 正文");
    storage.setItem("dt:mobile:conversation:v1:7:42", "用户 7 对话");
    storage.setItem("dt:mobile:document:v1:8:99", "用户 8 正文");
    authMocks.currentUser = { id: 7 };
    authMocks.mutateAsync.mockImplementationOnce(async () => {
      expect(storage.getItem("dt:mobile:document:v1:7:42")).toBeNull();
      expect(storage.getItem("dt:mobile:conversation:v1:7:42")).toBeNull();
      expect(storage.getItem("dt:mobile:recovery-owner:v1")).toBeNull();
      expect(storage.getItem("dt:mobile:document:v1:8:99")).toBe(
        "用户 8 正文"
      );
    });

    await renderedLogout()();

    expect(authMocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(authMocks.setData).toHaveBeenCalledWith(undefined, null);
    expect(authMocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not let mobile storage denial block server logout", async () => {
    authMocks.currentUser = { id: 7 };
    const deniedStorage = {
      get length(): number {
        throw new Error("storage denied");
      },
      clear: vi.fn(),
      getItem: vi.fn(() => null),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error("storage denied");
      }),
    } satisfies Storage;
    installBrowserStorage(deniedStorage);

    await expect(renderedLogout()()).resolves.toBeUndefined();
    expect(authMocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(authMocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it("still clears and invalidates auth state when already unauthenticated", async () => {
    authMocks.currentUser = null;

    await renderedLogout()();

    expect(authMocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(authMocks.setData).toHaveBeenCalledWith(undefined, null);
    expect(authMocks.invalidate).toHaveBeenCalledTimes(1);
  });
});
