import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manusRuntimePlugins, shouldInjectManusRuntime } from "./manusRuntimePolicy";

describe("manus runtime policy", () => {
  it("never injects the inline runtime into production builds", () => {
    expect(shouldInjectManusRuntime("build")).toBe(false);
    let created = 0;
    expect(manusRuntimePlugins("build", () => { created++; return { name: "x" }; })).toEqual([]);
    expect(created).toBe(0);
  });
  it("keeps it in the dev server", () => {
    expect(manusRuntimePlugins("serve", () => ({ name: "x" }))).toHaveLength(1);
  });
  it("vite config routes the runtime plugin through the policy", () => {
    const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(config).toContain("manusRuntimePlugins(command, vitePluginManusRuntime)");
    expect(config).not.toMatch(/^\s*vitePluginManusRuntime\(\),/m);
  });
});
