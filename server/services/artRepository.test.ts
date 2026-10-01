import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ART_REPOSITORY_USAGE,
  curatedDnaPromptBlock,
  curatorProfilePromptBlock,
  loadArtRepositoryProfile,
  matchCuratedArtDna,
  sanitizeCuratedArtDna,
  type ArtRepositoryCatalog,
  type ArtRepositoryProfile,
} from "./artRepository";
import { syncArtRepository } from "./artRepositoryCatalog";
import { normalizeArtReferenceTags } from "../../shared/artReferenceTags";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dt-art-repository-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true }))
  );
});

function profile(): ArtRepositoryProfile {
  return {
    schemaVersion: 1,
    collectionId: "test-private-library",
    status: "approved",
    applicationPolicy: ART_REPOSITORY_USAGE,
    principles: ["故事决定色彩", "保留手工痕迹"],
    narrativeFunctions: ["让记忆渗出"],
    avoid: ["库存隐喻"],
    sourceArtifactExclusions: ["平台水印", "手机状态栏"],
  };
}

describe("artRepository", () => {
  it("只加载明确批准且声明 derived-dna-only 的策展配置", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      path.join(directory, "curator-profile.json"),
      JSON.stringify(profile()),
      "utf8"
    );

    const loaded = await loadArtRepositoryProfile(directory);

    expect(loaded?.collectionId).toBe("test-private-library");
    expect(curatorProfilePromptBlock(loaded!)).toContain("不是内容模板");
    expect(curatorProfilePromptBlock(loaded!)).toContain("不得因此固定色调");
    expect(curatorProfilePromptBlock(loaded!)).toContain("平台水印");
  });

  it("Vision 即使误把水印、文字或界面写进 DNA，也会在进入提示词前再次过滤", () => {
    const sanitized = sanitizeCuratedArtDna({
      style: ["纸本水粉", "小红书水印"],
      composition: ["人物偏侧", "右下角用户名"],
      material: ["粗纸纤维", "UI chrome"],
      mood: ["克制"],
      matchTags: ["记忆", "readable text"],
    });

    expect(sanitized.style).toEqual(["纸本水粉"]);
    expect(sanitized.composition).toEqual(["人物偏侧"]);
    expect(sanitized.material).toEqual(["粗纸纤维"]);
    expect(sanitized.matchTags).toEqual(["记忆"]);
  });

  it("运行时只匹配 ready 的派生 DNA，并默认不把参考库色板写进提示词", () => {
    const catalog: ArtRepositoryCatalog = {
      schemaVersion: 1,
      collectionId: "test",
      updatedAt: "2026-08-10T00:00:00.000Z",
      sourcePolicy: {
        visibility: "private",
        rawImagesAtRuntime: false,
        defaultRightsStatus: "unverified",
        artifactExclusions: ["watermark"],
      },
      assets: {
        "ready.jpg": {
          sha256: "a",
          sourceFileName: "ready.jpg",
          status: "ready",
          rightsStatus: "unverified",
          usage: ART_REPOSITORY_USAGE,
          addedAt: "2026-08-10T00:00:00.000Z",
          dna: {
            style: ["纸本拼贴"],
            palette: ["深蓝与金色"],
            light: ["光成为材料"],
            composition: ["极端留白"],
            material: ["撕纸边缘"],
            mood: ["怀旧"],
            matchTags: ["记忆"],
          },
        },
        "pending.jpg": {
          sha256: "b",
          sourceFileName: "pending.jpg",
          status: "pending-analysis",
          rightsStatus: "unverified",
          usage: ART_REPOSITORY_USAGE,
          addedAt: "2026-08-10T00:00:00.000Z",
        },
      },
    };

    const matched = matchCuratedArtDna(catalog, "一段正在渗出的记忆");
    const block = curatedDnaPromptBlock(matched);

    expect(matched).toHaveLength(1);
    expect(block).toContain("纸本拼贴");
    expect(block).toContain("色板默认不继承");
    expect(block).not.toContain("深蓝与金色");
    // 无关内容不能悄悄套用目录里的第一种画风。
    expect(matchCuratedArtDna(catalog, "两个人讨论明天的工作")).toEqual([]);
    expect(matchCuratedArtDna(catalog, "")).toEqual([]);

    catalog.assets["ready.jpg"].dna = sanitizeCuratedArtDna({
      style: ["常玉式简练", "轮廓概括"],
      artTags: normalizeArtReferenceTags({
        artistReferences: [{ name: "常玉", basis: "简练轮廓与大面积色面具有视觉亲缘，非作者鉴定" }],
        media: ["彩铅", "撕纸拼贴"],
        composition: ["横向展开", "偏置"],
        viewpoint: ["俯视"],
        spatialLayers: ["平面叠层"],
        markMaking: ["铅笔颗粒"],
        freeTags: ["轻盈的失衡"],
      }),
    });
    for (const query of ["想要俯视", "横向展开", "撕纸拼贴", "参考常玉的艺术语言", "轻盈的失衡"]) {
      const selections = matchCuratedArtDna(catalog, query);
      expect(selections).toHaveLength(1);
      const prompt = curatedDnaPromptBlock(selections);
      expect(prompt).toContain("横向展开");
      expect(prompt).toContain("彩铅、撕纸拼贴");
      expect(prompt).not.toContain("常玉");
      expect(prompt).not.toContain("作者鉴定");
    }
  });

  it("重复导入按同名和内容哈希去重，并给新图建立待分析安全清单", async () => {
    const root = await temporaryDirectory();
    const sourceDir = path.join(root, "source");
    const repositoryDir = path.join(root, "repository");
    const referencesDir = path.join(repositoryDir, "references");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(referencesDir, { recursive: true });
    await writeFile(path.join(referencesDir, "same.jpg"), "processed-copy");
    await writeFile(path.join(sourceDir, "same.jpg"), "raw-screenshot-copy");
    await writeFile(path.join(sourceDir, "a-new.png"), "new-image");
    await writeFile(path.join(sourceDir, "b-duplicate.webp"), "new-image");

    const result = await syncArtRepository({
      sourceDir,
      repositoryDir,
      now: "2026-08-10T00:00:00.000Z",
    });
    const catalog = JSON.parse(
      await readFile(path.join(repositoryDir, "catalog.json"), "utf8")
    ) as ArtRepositoryCatalog;

    expect(result.existing).toEqual(["same.jpg"]);
    expect(result.added).toEqual(["a-new.png"]);
    expect(result.duplicates).toEqual(["b-duplicate.webp -> a-new.png"]);
    expect(catalog.assets["a-new.png"]?.status).toBe("pending-analysis");
    expect(catalog.assets["a-new.png"]?.rightsStatus).toBe("unverified");
    expect(catalog.assets["a-new.png"]?.usage).toBe("derived-dna-only");
    expect(catalog.sourcePolicy.rawImagesAtRuntime).toBe(false);
  });
});
