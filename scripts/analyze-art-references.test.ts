import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtRepositoryCatalog } from "../server/services/artRepository";
import { normalizeArtReferenceTags } from "../shared/artReferenceTags";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  load: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../server/archive/visionAgent", () => ({
  analyzeVisionReference: mocks.analyze,
}));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }));
vi.mock("../server/services/artRepository", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../server/services/artRepository")
  >()),
  loadArtRepositoryCatalog: mocks.load,
}));
vi.mock("../server/services/artRepositoryCatalog", () => ({
  writeArtRepositoryCatalog: mocks.write,
}));

import { main } from "./analyze-art-references";

function catalog(): ArtRepositoryCatalog {
  return {
    schemaVersion: 1,
    collectionId: "test",
    updatedAt: "2026-10-01",
    sourcePolicy: {
      visibility: "private",
      rawImagesAtRuntime: false,
      defaultRightsStatus: "unverified",
      artifactExclusions: [],
    },
    assets: Object.fromEntries(
      ["first.jpg", "second.jpg"].map(name => [
        name,
        {
          sha256: name,
          sourceFileName: name,
          status: "pending-analysis",
          rightsStatus: "unverified",
          usage: "derived-dna-only",
          addedAt: "2026-10-01",
        },
      ])
    ),
  };
}

const analysis = {
  visualStyle: ["套色版画"],
  colorPalette: ["赭红"],
  lighting: "平面色层",
  composition: "不对称的横向节奏",
  materialsAndTextures: ["压印痕迹"],
  mood: ["轻快"],
  eraAndCulture: "无法确定",
  confidence: 0.8,
};

describe("art reference analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(catalog());
    mocks.read.mockResolvedValue(Buffer.from("test-image"));
    mocks.analyze.mockResolvedValue({ configured: true, analysis });
    mocks.write.mockResolvedValue(undefined);
  });

  it("previews without reading images, invoking a paid model or writing results", async () => {
    await main(["--limit=1"]);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("honors the batch limit and saves only reusable, cleaned DNA", async () => {
    await main(["--limit=1", "--confirm-paid-analysis"]);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    const saved = mocks.write.mock.calls[0][1] as ArtRepositoryCatalog;
    expect(saved.assets["first.jpg"]).toMatchObject({
      status: "ready",
      dna: { style: ["套色版画"], composition: ["不对称的横向节奏"] },
    });
    expect(saved.assets["second.jpg"].status).toBe("pending-analysis");
  });

  it.each([
    { ...analysis, confidence: 0 },
    { ...analysis, visualStyle: [], composition: "", materialsAndTextures: [] },
    {
      ...analysis,
      visualStyle: ["小红书水印"],
      composition: "右下角用户名",
      materialsAndTextures: ["UI chrome"],
    },
  ])(
    "leaves an unusable analysis pending instead of making it active",
    async invalid => {
      const current = catalog();
      mocks.load.mockResolvedValue(current);
      mocks.analyze.mockResolvedValue({ configured: true, analysis: invalid });
      await main(["--limit=1", "--confirm-paid-analysis"]);
      expect(mocks.write).not.toHaveBeenCalled();
      expect(current.assets["first.jpg"].status).toBe("pending-analysis");
      expect(current.assets["first.jpg"].dna).toBeUndefined();
    }
  );

  it("accepts useful open tags even when the old style categories cannot be determined", async () => {
    const artTags = normalizeArtReferenceTags({
      media: ["彩铅", "拼贴"],
      composition: ["横向展开", "不对称"],
      freeTags: ["介于平面和空间之间"],
      artistReferences: [],
    });
    mocks.analyze.mockResolvedValue({
      configured: true,
      analysis: {
        ...analysis,
        visualStyle: [],
        composition: "",
        materialsAndTextures: [],
        confidence: 0.4,
        artTags,
      },
    });
    await main(["--limit=1", "--confirm-paid-analysis"]);
    expect(mocks.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "art-curation" })
    );
    const saved = mocks.write.mock.calls[0][1] as ArtRepositoryCatalog;
    expect(saved.assets["first.jpg"]).toMatchObject({
      status: "ready",
      dna: { artTags },
    });
  });
});
