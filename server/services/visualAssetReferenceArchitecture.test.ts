import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const activeReferenceWriters = [
  "server/routers/visualAssets.ts",
  "server/services/visualAssetPersistence.ts",
  "server/services/visualAssetCreation.ts",
  "client/src/features/creationEditor/visualAssets/VisualAssetCreationDialog.tsx",
  "client/src/features/creationEditor/visualAssets/VisualAssetLibrary.tsx",
];

describe("visual asset reference architecture", () => {
  it("keeps new writers on explicit references instead of the retired image-id-only protocol", async () => {
    const violations: string[] = [];
    for (const relativePath of activeReferenceWriters) {
      const content = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
      if (/\breferenceImageIds\b/.test(content)) violations.push(relativePath);
    }

    expect(violations).toEqual([]);
  });

  it("keeps exactly one legacy read for old image-id-only versions", async () => {
    const content = await fs.readFile(
      path.join(repoRoot, "shared/visualAssets.ts"),
      "utf8"
    );
    const legacyReads = content.match(/obj\.referenceImageIds/g) ?? [];

    expect(legacyReads).toHaveLength(1);
  });
});
