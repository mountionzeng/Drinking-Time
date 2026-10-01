import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  artRepositoryPromptBlocks,
  curatedDnaPromptBlock,
  hasReusableArtDna,
  loadArtRepositoryCatalog,
  matchCuratedArtDna,
  sanitizeCuratedArtDna,
} from "./artRepository";

const repositoryDir = path.resolve(import.meta.dirname, "../../art-repository");
const batch = [
  "03594f4458acbae0dd26d5f300a29752.jpg",
  "06569be4a45e54227196702cb6bc7d77.jpg",
  "0781ba7c7ab7dd3f9207b55bfd6e29ec.jpg",
  "0af818be4335b46e4469b441dd81c34b.jpg",
  "0c41a277134678fb58cdeb5aad372500.jpg",
  "146143e43a78dc9929c164b70580abb8.jpg",
  "156900199dd9b770b27c4139ed1bdea0.jpg",
  "17320d144bd333ce49915b70c1676e3f.jpg",
  "1be19bdc622271b9e9005978e8faec64.jpg",
  "1d03dab4a17835d92115fc7dfd7c1ca5.jpg",
];

describe("首批会话策展目录", () => {
  it("真实目录的十张 DNA 可清洗、可复用，且没有改变权利状态", async () => {
    const catalog = await loadArtRepositoryCatalog(repositoryDir);
    expect(catalog).not.toBeNull();
    expect(catalog!.sourcePolicy.rawImagesAtRuntime).toBe(false);
    for (const name of batch) {
      const asset = catalog!.assets[name];
      expect(asset.status).toBe("ready");
      expect(asset.rightsStatus).toBe("unverified");
      expect(asset.usage).toBe("derived-dna-only");
      expect(asset.analyzedAt).toBeTruthy();
      const clean = sanitizeCuratedArtDna(asset.dna!);
      expect(hasReusableArtDna(clean)).toBe(true);
      expect(clean).toEqual(asset.dna);
      expect(clean.artTags?.composition.length).toBeGreaterThan(0);
    }
  });

  it("不同视觉需求命中不同候选，无证据不套模板", async () => {
    const catalog = (await loadArtRepositoryCatalog(repositoryDir))!;
    const cases = [
      ["方向性笔触，波浪感", batch[1]],
      ["漫画", batch[4]],
      ["逆光，空气感", batch[6]],
      ["稚拙，变形", batch[7]],
      ["弥散，柔焦", batch[9]],
    ];
    for (const [query, fileName] of cases) {
      const selected = matchCuratedArtDna(catalog, query, 1);
      expect(selected).toEqual([
        sanitizeCuratedArtDna(catalog.assets[fileName].dna!),
      ]);
    }
    expect(matchCuratedArtDna(catalog, "季度财务报表")).toEqual([]);
    expect(matchCuratedArtDna(catalog, "")).toEqual([]);
    expect(matchCuratedArtDna(catalog, "横向展开")).toHaveLength(2);
  });

  it("艺术家可检索，但姓名、色板、原图路径不会随候选输出", async () => {
    const catalog = (await loadArtRepositoryCatalog(repositoryDir))!;
    for (const name of ["Vincent van Gogh", "Alphonse Mucha"]) {
      const selected = matchCuratedArtDna(catalog, name);
      expect(selected).toHaveLength(1);
      const prompt = curatedDnaPromptBlock(selected);
      expect(prompt).not.toContain(name);
      expect(prompt).not.toMatch(/梵高|穆夏|\.jpg|references\//);
      for (const color of selected[0].palette)
        expect(prompt).not.toContain(color);
    }
  });

  it("现有入口实际加载候选，不加载原图内容或截图污染", async () => {
    const blocks = await artRepositoryPromptBlocks("漫画", repositoryDir);
    const candidate = blocks.find(block =>
      block.startsWith("【策展库情境匹配】")
    );
    expect(candidate).toContain("图形化叙事插画");
    expect(candidate).not.toMatch(/小红书|徽章|分格|标题|状态栏|\.jpg/);
    expect(candidate).toContain("用户明确要求优先");
  });
});
