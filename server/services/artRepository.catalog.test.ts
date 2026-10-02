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

const secondBatch = [
  "1f76c7a5df6a7921dc7fe8ae44b3c878.jpg",
  "216e86f32c4f626514166409c01bd899.jpg",
  "26f4744ffb6f71c236685cf7a25a5d1e.jpg",
  "296fe087f8d9d677eb8e964936b67171.jpg",
  "2c23550c177b13810e1aa846a2e6314d.jpg",
  "3162303808fac712bcf00c60c7a8afa5.jpg",
  "3685382d7bcbfce321817eb262cff5a1.jpg",
  "3939b6d147017e60c3d16a5ab2ccfdee.jpg",
  "3ae3c085b442624a0ff45cf0b0a944e0.jpg",
  "3beac1dbb97b4477f7630ee4a88cbf72.jpg",
];

const thirdBatch = [
  "3dced4d435f910947e32aecacbd7b76b.jpg",
  "431dafa5900a573375537236b166e765.jpg",
  "447db8569fe4fd0d32ab2f5816044223.jpg",
  "44cc4963d85d7a278283c11d2f82814a.jpg",
  "4626c808af84c874e6fe32b8a314c64f.jpg",
  "4840de42868f1c351f97a4c4a8ebf94a.jpg",
  "49203439d467bce185ba0294414be5c8.jpg",
  "492aca92bbbc80ed82525dc21ae1cd0c.jpg",
  "498da3c58a6e60e0b97cefbd63306e95.jpg",
  "4a9bfb3b9d61a99a0f06eafb4b4f3772.jpg",
];

describe("会话策展目录", () => {
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
    for (const name of [
      "Vincent van Gogh",
      "Alphonse Mucha",
      "Edward Hopper",
      "Camille Corot",
    ]) {
      const selected = matchCuratedArtDna(catalog, name);
      expect(selected).toHaveLength(1);
      const prompt = curatedDnaPromptBlock(selected);
      expect(prompt).not.toContain(name);
      expect(prompt).not.toMatch(/梵高|穆夏|\.jpg|references\//);
      for (const color of selected[0].palette)
        expect(prompt).not.toContain(color);
    }
  });

  it("第二批十张新记录都有可复用信息，自由观察词通过清洗且不改变权利边界", async () => {
    const catalog = (await loadArtRepositoryCatalog(repositoryDir))!;
    for (const name of secondBatch) {
      const asset = catalog.assets[name];
      expect(asset.status).toBe("ready");
      expect(asset.rightsStatus).toBe("unverified");
      expect(asset.usage).toBe("derived-dna-only");
      const clean = sanitizeCuratedArtDna(asset.dna!);
      expect(clean).toEqual(asset.dna);
      expect(hasReusableArtDna(clean)).toBe(true);
      expect(clean.artTags?.freeTags.length).toBeGreaterThan(0);
    }
  });

  it("分类之外的自由词能检索到可执行方法，但不会把自由标签整套注入", async () => {
    const catalog = (await loadArtRepositoryCatalog(repositoryDir))!;
    for (const [query, name, method] of [
      ["颗粒闪光", secondBatch[0], "暗底上的颗粒闪光"],
      ["暗幕亮窗", secondBatch[3], "暗前景衬亮远景"],
      ["呼吸感", secondBatch[5], "大面积留白"],
      ["断续轮廓", secondBatch[6], "失而复现的轮廓"],
      ["反光碎片", secondBatch[8], "断续亮线"],
      ["图底游戏", secondBatch[9], "图底互换"],
    ]) {
      const selected = matchCuratedArtDna(catalog, query, 1);
      expect(selected).toEqual([
        sanitizeCuratedArtDna(catalog.assets[name].dna!),
      ]);
      const prompt = curatedDnaPromptBlock(selected);
      expect(prompt).toContain(method);
      expect(prompt).not.toMatch(
        /\.jpg|小红书|Art History|Dan Schultz|克里姆特|马蒂斯|Gustav Klimt|Henri Matisse/
      );
    }
    const prompt = curatedDnaPromptBlock(
      matchCuratedArtDna(catalog, "图底游戏", 1)
    );
    expect(prompt).not.toContain("图底游戏");
    expect(prompt).not.toContain("明黄绿");
  });

  it("第三批十张开放标签可完整清洗、可复用，保留原图权利限制", async () => {
    const catalog = (await loadArtRepositoryCatalog(repositoryDir))!;
    for (const name of thirdBatch) {
      const asset = catalog.assets[name];
      expect(asset.status).toBe("ready");
      expect(asset.rightsStatus).toBe("unverified");
      expect(asset.usage).toBe("derived-dna-only");
      expect(asset.analyzedAt).toBeTruthy();
      const clean = sanitizeCuratedArtDna(asset.dna!);
      expect(clean).toEqual(asset.dna);
      expect(hasReusableArtDna(clean)).toBe(true);
      expect(clean.artTags?.freeTags.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["雾光穿透", thirdBatch[0], "雾中散射光晕"],
    ["光池孤岛", thirdBatch[1], "局部光池"],
    ["垂坠线韵", thirdBatch[2], "曲线向上汇聚"],
    ["纸剧场感", thirdBatch[3], "横向多焦点展开"],
    ["环抱式动势", thirdBatch[4], "环形围合与弧线接力"],
    ["线面反拍", thirdBatch[5], "曲直节奏对照"],
    ["灯色包裹", thirdBatch[6], "内外冷暖光交叠"],
    ["矿物哑色", thirdBatch[7], "不等量大色面叠置"],
    ["银灰透气", thirdBatch[8], "软边团簇"],
    ["碎金节律", thirdBatch[9], "横向短线"],
  ])(
    "第三批自由词 %s 通过真实入口提供方法而非原图内容",
    async (query, name, method) => {
      const catalog = (await loadArtRepositoryCatalog(repositoryDir))!;
      const selected = matchCuratedArtDna(catalog, query, 1);
      expect(selected).toEqual([
        sanitizeCuratedArtDna(catalog.assets[name].dna!),
      ]);
      const blocks = await artRepositoryPromptBlocks(query, repositoryDir);
      const prompt = blocks.find(block =>
        block.startsWith("【策展库情境匹配】")
      )!;
      expect(prompt).toContain(method);
      expect(prompt).not.toContain(query);
      expect(prompt).not.toMatch(
        /\.jpg|references\/|小红书|水印|签名|状态栏|手机|电车|钢琴|帆船|猫|Edward Hopper|Camille Corot/
      );
      for (const color of selected[0].palette)
        expect(prompt).not.toContain(color);
    }
  );

  it("只在命中数相同时优先更长的已命中词组，完全同分保持目录顺序", async () => {
    const source = (await loadArtRepositoryCatalog(repositoryDir))!;
    const seed = source.assets[batch[0]];
    const generic = {
      ...seed,
      dna: sanitizeCuratedArtDna({
        style: ["泛词方法"],
        matchTags: ["颗粒", "颗粒", "尚未命中的很长词组"],
      }),
    };
    const specific = {
      ...seed,
      dna: sanitizeCuratedArtDna({
        style: ["具体方法"],
        matchTags: ["颗粒闪光"],
      }),
    };
    const catalog = { ...source, assets: { generic, specific } };
    expect(matchCuratedArtDna(catalog, "颗粒闪光", 1)).toEqual([specific.dna]);
    generic.dna.matchTags = ["颗粒", "闪光"];
    expect(matchCuratedArtDna(catalog, "颗粒闪光", 1)).toEqual([generic.dna]);
    generic.dna.matchTags = ["颗粒闪光"];
    expect(matchCuratedArtDna(catalog, "颗粒闪光", 1)).toEqual([generic.dna]);
    expect(matchCuratedArtDna(catalog, "无关请求")).toEqual([]);
    expect(matchCuratedArtDna(catalog, "颗粒闪光", 0)).toEqual([]);
    catalog.assets.specific = { ...specific, status: "pending-analysis" };
    generic.dna.matchTags = ["颗粒"];
    expect(matchCuratedArtDna(catalog, "颗粒闪光", 1)).toEqual([generic.dna]);
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
