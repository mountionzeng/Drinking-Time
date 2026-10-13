import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureHttpConnectionPool,
  resolveHttpProxyOptions,
} from "./httpConnectionPool";

const dispatchers = vi.hoisted(() => ({
  direct: vi.fn(),
  proxy: vi.fn(),
  set: vi.fn(),
}));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options: unknown) {
      dispatchers.direct(options);
    }
  },
  EnvHttpProxyAgent: class {
    constructor(options: unknown) {
      dispatchers.proxy(options);
    }
  },
  setGlobalDispatcher: dispatchers.set,
}));

const systemProxy = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
}`;
afterEach(() => vi.unstubAllEnvs());

describe("outbound HTTP proxy resolution", () => {
  it("uses the existing macOS local proxy in development when no environment proxy is configured", () => {
    const read = vi.fn(() => systemProxy);
    expect(
      resolveHttpProxyOptions({ NODE_ENV: "development" }, "darwin", read)
    ).toEqual({
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7890",
      noProxy: "localhost,127.0.0.1,[::1],::1,*.local",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("prefers explicit environment proxies and keeps exclusions plus loopback bypasses", () => {
    const read = vi.fn(() => systemProxy);
    const options = resolveHttpProxyOptions(
      {
        NODE_ENV: "development",
        http_proxy: "http://proxy.example:8080",
        HTTP_PROXY: "http://ignored.example:80",
        HTTPS_PROXY: "http://secure.example:8080",
        no_proxy: "internal.example",
      },
      "darwin",
      read
    );
    expect(options).toMatchObject({
      httpProxy: "http://proxy.example:8080",
      httpsProxy: "http://secure.example:8080",
      noProxy: "localhost,127.0.0.1,[::1],::1,*.local,internal.example",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["production", "test"])("never reads macOS settings in %s", mode => {
    const read = vi.fn(() => systemProxy);
    expect(
      resolveHttpProxyOptions({ NODE_ENV: mode }, "darwin", read)
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not discover system proxies on Linux", () => {
    const read = vi.fn(() => systemProxy);
    expect(
      resolveHttpProxyOptions({ NODE_ENV: "development" }, "linux", read)
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves explicit direct mode in development", () => {
    const read = vi.fn(() => systemProxy);
    expect(
      resolveHttpProxyOptions(
        {
          NODE_ENV: "development",
          DEV_USE_PROXY: "0",
          HTTPS_PROXY: "http://proxy.example:80",
        },
        "darwin",
        read
      )
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps production environment proxies independent of the development switch", () => {
    expect(
      resolveHttpProxyOptions(
        {
          NODE_ENV: "production",
          DEV_USE_PROXY: "0",
          HTTPS_PROXY: "http://proxy.example:80",
        },
        "linux"
      )
    ).toMatchObject({ httpsProxy: "http://proxy.example:80" });
  });

  it.each([
    "<dictionary> {}",
    systemProxy.replaceAll("Enable : 1", "Enable : 0"),
    systemProxy.replaceAll("7890", "99999"),
    systemProxy.replaceAll("127.0.0.1", "unexpected.example"),
  ])(
    "ignores disabled, malformed or nonlocal system proxy settings",
    output => {
      expect(
        resolveHttpProxyOptions(
          { NODE_ENV: "development" },
          "darwin",
          () => output
        )
      ).toBeNull();
    }
  );

  it("stays direct when macOS settings are unavailable", () => {
    expect(
      resolveHttpProxyOptions({ NODE_ENV: "development" }, "darwin", () => {
        throw new Error("unavailable");
      })
    ).toBeNull();
  });

  it("installs a proxy-aware pool without losing keep-alive or configuring twice", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("http_proxy", "");
    vi.stubEnv("https_proxy", "");
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:7890");
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7890");
    configureHttpConnectionPool();
    configureHttpConnectionPool();
    expect(dispatchers.proxy).toHaveBeenCalledTimes(1);
    expect(dispatchers.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        keepAliveTimeout: 240_000,
        keepAliveMaxTimeout: 600_000,
        httpProxy: "http://127.0.0.1:7890",
        httpsProxy: "http://127.0.0.1:7890",
      })
    );
    expect(dispatchers.direct).not.toHaveBeenCalled();
    expect(dispatchers.set).toHaveBeenCalledTimes(1);
  });
});
