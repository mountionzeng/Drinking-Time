import type { Express } from "express";
import type { Server } from "node:http";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "vite";
import { setupVite } from "./vite";

vi.mock("vite", async importOriginal => ({
  ...await importOriginal<typeof import("vite")>(),
  createServer: vi.fn(),
}));

describe("setupVite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the function-based client config before creating the embedded dev server", async () => {
    const middleware = vi.fn();
    vi.mocked(createServer).mockResolvedValue({ middlewares: middleware } as never);
    const app = { use: vi.fn() };
    const httpServer = {} as Server;

    await setupVite(app as unknown as Express, httpServer);

    const config = vi.mocked(createServer).mock.calls[0][0]!;
    const clientRoot = path.resolve(import.meta.dirname, "../../client");
    expect(config.root).toBe(clientRoot);
    expect(config.publicDir).toBe(path.join(clientRoot, "public"));
    expect(config.resolve?.alias).toMatchObject({ "@": path.join(clientRoot, "src") });
    const plugins: readonly unknown[] = config.plugins ?? [];
    expect(plugins.flat(Infinity)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "app-release-identity" }),
      expect.objectContaining({ name: "vite:react-refresh" }),
    ]));
    expect(config.configFile).toBe(false);
    expect(config.server).toMatchObject({ middlewareMode: true, hmr: { server: httpServer } });
    expect(app.use).toHaveBeenCalledWith(middleware);
  });
});
