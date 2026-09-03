import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { generateWorkspaceContracts } from "./generate-miniprogram-contract";

const root = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(root, "shared/miniprogramWorkspace.schema.json");

describe("miniprogram workspace contract generator", () => {
  it("detects generated-file drift without overwriting it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-contract-"));
    const serverOutput = path.join(dir, "server.ts");
    const clientOutput = path.join(dir, "client.ts");
    await generateWorkspaceContracts({ schemaPath, serverOutput, clientOutput });
    await writeFile(clientOutput, "// stale\n", "utf8");

    await expect(
      generateWorkspaceContracts({ schemaPath, serverOutput, clientOutput, check: true }),
    ).rejects.toThrow(/out of date.*client\.ts/i);
    expect(await readFile(clientOutput, "utf8")).toBe("// stale\n");
  });

  it("rejects malformed and unsupported schema input", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-contract-bad-"));
    const badSchema = path.join(dir, "schema.json");
    await writeFile(
      badSchema,
      JSON.stringify({ schemaVersion: 1, $defs: { Unsafe: { type: "function" } } }),
      "utf8",
    );

    await expect(
      generateWorkspaceContracts({
        schemaPath: badSchema,
        serverOutput: path.join(dir, "server.ts"),
        clientOutput: path.join(dir, "client.ts"),
      }),
    ).rejects.toThrow(/unsupported schema type/i);
  });

  it.each([
    ["a missing required property", { type: "object", additionalProperties: false, required: ["missing"], properties: {} }, /required property missing/i],
    ["an array without items", { type: "array" }, /array schema needs items/i],
    ["an unknown ref target", { $ref: "#/$defs/DoesNotExist" }, /unknown schema ref/i],
  ])("rejects %s", async (_label, definition, message) => {
    const dir = await mkdtemp(path.join(tmpdir(), "workspace-contract-invalid-"));
    const badSchema = path.join(dir, "schema.json");
    await writeFile(badSchema, JSON.stringify({ schemaVersion: 1, $defs: { Invalid: definition } }), "utf8");
    await expect(generateWorkspaceContracts({
      schemaPath: badSchema,
      serverOutput: path.join(dir, "server.ts"),
      clientOutput: path.join(dir, "client.ts"),
    })).rejects.toThrow(message);
  });

  it("reproduces the committed outputs byte-for-byte", async () => {
    await expect(
      generateWorkspaceContracts({
        schemaPath,
        serverOutput: path.join(root, "shared/miniprogramWorkspace.ts"),
        clientOutput: path.join(root, "miniprogram/src/contracts/workspace.ts"),
        check: true,
      }),
    ).resolves.toBeUndefined();
  });
});
