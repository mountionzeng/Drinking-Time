import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV } from "../_core/env";
import { clearStyleLibraryCache } from "./styleLibrary";
import { renderViaGate, compileImagePrompt } from "./renderGate";
import { extractPublishingCoverArtDirection } from "./publishingCoverArtDirection";
import { artRecipeToLibraryItems } from "../../shared/artPromptLibrary";
import { defaultArtRecipe } from "../../shared/artDirection";

describe("real YAML/catalog → selection → single compilation → inheritance", () => {
  let root: string;
  const previous = ENV.styleLibraryDir;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "joint-art-"));
    await mkdir(path.join(root, "entries"));
    ENV.styleLibraryDir = path.join(root, "entries");
    vi.stubEnv("ART_REPOSITORY_DIR", root);
    clearStyleLibraryCache();
  });
  afterEach(async () => {
    ENV.styleLibraryDir = previous;
    clearStyleLibraryCache();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });
  async function card(status = "active") {
    await writeFile(
      path.join(root, "entries", "test.yaml"),
      [
        "id: test-pencil",
        "name: 测试彩铅",
        `status: ${status}`,
        "internal_references: [PRIVATE_ARTIST_SENTINEL]",
        "style: [彩铅]",
        "material: 彩铅纸纹",
        "colorDesign:",
        "  harmony: analogous",
        "  localHarmony: complementary",
        "  localScale: marks",
        "  application: dryLayers",
        "automatic_selection:",
        "  scope: main",
        "  concepts: [colored-pencil]",
        "  provider_fragments: [彩铅纸纹]",
      ].join("\n")
    );
    clearStyleLibraryCache();
  }
  it.each([0, undefined])(
    "consumes selected manual/semantic card (%s), not private provenance",
    async styleIndex => {
      await card();
      await renderViaGate(
        { prompt: "小猫在窗前", intent: "彩铅", styleIndex, longPrompt: true },
        async (prompt, compiled) => {
          expect(compiled.colorDesign?.harmony).toBe("analogous");
          expect(prompt).toContain("仅细小笔触尺度");
          expect(prompt).toContain("干性笔触薄层叠色");
          expect(prompt.match(/【配色关系】/g)).toHaveLength(1);
          expect(prompt).not.toContain("PRIVATE_ARTIST_SENTINEL");
        }
      );
    }
  );
  it("does not execute draft methods", async () => {
    await card("draft");
    const result = await compileImagePrompt({
      prompt: "小猫",
      intent: "彩铅",
      longPrompt: true,
    });
    expect(result.colorDesign).toBeUndefined();
  });
  it("uses only matched ready sanitized methods without source palette", async () => {
    await writeFile(
      path.join(root, "catalog.json"),
      JSON.stringify({
        schemaVersion: 1,
        collectionId: "test",
        assets: {
          ready: {
            status: "ready",
            dna: {
              style: ["纸面节奏"],
              matchTags: ["安静相处"],
              palette: ["SOURCE_PURPLE"],
              colorDesign: {
                harmony: "analogous",
                edges: "soft",
                application: "/private/SENTINEL",
              },
            },
          },
          pending: {
            status: "pending-analysis",
            dna: {
              style: ["纸面"],
              matchTags: ["安静相处"],
              colorDesign: { harmony: "triadic" },
            },
          },
        },
      })
    );
    const result = await compileImagePrompt({
      prompt: "安静相处",
      longPrompt: true,
    });
    expect(result.colorDesign).toMatchObject({
      harmony: "analogous",
      edges: "soft",
    });
    expect(result.prompt).not.toMatch(/SOURCE_PURPLE|SENTINEL|三角色/);
    expect(
      (await compileImagePrompt({ prompt: "奔跑", longPrompt: true }))
        .colorDesign
    ).toBeUndefined();
  });
  it("round trips library methods and inherits no shot-local placement", async () => {
    const recipe = {
      ...defaultArtRecipe(),
      colorDesign: { harmony: "analogous" as const },
    };
    const summary = artRecipeToLibraryItems(recipe).find(
      item => item.dimension === "art_style_recipe"
    )!.content;
    const result = await compileImagePrompt({
      prompt: `小猫\n${summary}`,
      intent: "亮面移到侧边，颜色保留",
      longPrompt: true,
    });
    expect(result.colorDesign).toEqual(recipe.colorDesign);
    expect(result.prompt.match(/配色方法〔/g)).toHaveLength(1);
    const revised = await compileImagePrompt({ prompt: result.prompt, intent: "改互补", longPrompt: true });
    expect(revised.prompt.match(/【配色关系】/g)).toHaveLength(1);
    expect(revised.colorDesign?.harmony).toBe("complementary");
    const inherited = extractPublishingCoverArtDirection(result.prompt);
    expect(inherited).toContain("【配色关系】");
    expect(inherited).not.toContain("在当前既有形体内");
    expect(inherited).not.toContain("亮面移到侧边");
    const album = await compileImagePrompt({
      prompt: inherited,
      authoredBrief: true,
      outputPurpose: "publishing-album",
      emotion: "孤独但有期待",
      longPrompt: true,
    });
    expect(album.prompt.match(/【配色关系】/g)).toHaveLength(1);
    expect(album.colorDesign).toBeUndefined();
  });
});
