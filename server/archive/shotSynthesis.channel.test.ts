import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("shot synthesis script structure agent channel", () => {
  it("routes the optional script/dialogue Claude channel behind OpenAI Next", () => {
    const envSource = readFileSync(
      resolve(root, "server/_core/env.ts"),
      "utf8"
    );
    const source = readFileSync(
      resolve(root, "server/archive/shotSynthesis.ts"),
      "utf8"
    );

    expect(envSource).toContain("SCRIPT_STRUCTURE_AGENT_API_KEY");
    expect(envSource).toContain("SCRIPT_STRUCTURE_AGENT_API_URL");
    expect(envSource).toContain("SCRIPT_STRUCTURE_AGENT_MODEL");
    expect(source).toContain("invokeScriptStructureAgent");
    expect(source).toContain("hasScriptStructureAgentConfig");
    expect(source).toContain("hasStoryAgentCompute");
    expect(source).toContain("runInference");
    expect(source).toContain("resolveComputeCandidates");
    expect(source).not.toContain("invokeScriptStructureClaudeMessages");
    expect(source).not.toContain("fetch(");
  });
});
