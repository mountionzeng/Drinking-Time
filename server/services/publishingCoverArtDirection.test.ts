import { describe, expect, it } from "vitest";

import {
  applyPublishingCoverArtDirection,
  extractPublishingCoverArtDirection,
  publishingCoverArtRecipe,
  resolvePublishingCoverArtDirection,
  selectPublishingStoryboardArtRecipe,
} from "./publishingCoverArtDirection";

const coverPrompt = `【封面内容简报】
这是封面的具体内容，不应复制到镜头。
【封面产品约束】
顶部保留标题安全区。
【整轮否决·第8轮】
更换主体类别与构图骨架。
【四图探索梯度】
生成四个不同方向。
【文本美术信号】
主情绪：清醒、冷静；生活质地：技术与系统。
【私人策展库审美底线】
使用纸面、笔触、擦除、叠色和不完美边缘，避免商品静物。
【艺术谱系】
早期抽象艺术；蛋彩、水粉、铅笔网格与有齿纸面。
【手作完成度】
保留纸纤维、颜料厚薄、擦除与轻微套色偏差。
【风格化硬约束】
必须明显风格化，不得成为摄影写实、商品摄影或光滑 3D。
【静态图片无字硬约束】
禁止可读文字、伪文字、Logo、签名、水印和字幕。`;

describe("publishing cover art direction", () => {
  it("inherits only reusable art DNA from the formally adopted cover prompt", () => {
    const artDirection = extractPublishingCoverArtDirection(coverPrompt);

    expect(artDirection).toContain("【艺术谱系】");
    expect(artDirection).toContain("蛋彩、水粉、铅笔网格与有齿纸面");
    expect(artDirection).toContain("【手作完成度】");
    expect(artDirection).toContain("【风格化硬约束】");
    expect(artDirection).toContain("【静态图片无字硬约束】");
    expect(artDirection).not.toContain("封面内容简报");
    expect(artDirection).not.toContain("标题安全区");
    expect(artDirection).not.toContain("整轮否决");
    expect(artDirection).not.toContain("四图探索梯度");
  });

  it("places cover art before shot facts while keeping direct edits highest priority", () => {
    const merged = applyPublishingCoverArtDirection(
      "镜头事实：女人把手放在桌面上。\n图片要求：中景，人物看向窗外。",
      extractPublishingCoverArtDirection(coverPrompt)
    );

    expect(merged.indexOf("正式封面美术 DNA")).toBeLessThan(
      merged.indexOf("镜头事实")
    );
    expect(merged).toContain("封面只控制美术表达");
    expect(merged).toContain("镜头事实：女人把手放在桌面上");
  });

  it("translates default photographic shot language into the adopted cover medium", () => {
    const merged = applyPublishingCoverArtDirection(
      [
        "Cinematic extreme close-up of a sleek glass hourglass on a minimal white desktop.",
        "Fingertip in sharp focus, skin detail, shallow depth of field and soft out-of-focus background.",
        "Cool clinical top lighting, sharp rim light, glass texture, crisp edges and clean high-contrast look.",
        "Style: realistic glass and sand detail with slightly painterly textures.",
        "图片要求：沙漏占画面1/2，手占1/4；冷白顶光+轻微侧逆光，上层玻璃干净反光，玻璃材质高反差，指尖对焦清晰，后景虚化，沙粒呈细小颗粒质感。",
      ].join("\n"),
      extractPublishingCoverArtDirection(coverPrompt)
    );

    expect(merged).toContain("镜头词的封面媒介转译");
    expect(merged).toContain("清晰的手绘轮廓和局部明度对比");
    expect(merged).toContain("半透明叠色、留白和手绘边缘");
    expect(merged).toContain("颜料颗粒与纸面阻力");
    expect(merged).toContain("沙漏占画面1/2，手占1/4");
    expect(merged).not.toMatch(/cinematic|sharp focus|skin detail/i);
    expect(merged).not.toMatch(/shallow depth of field|out-of-focus/i);
    expect(merged).not.toMatch(/realistic glass and sand detail/i);
    expect(merged).not.toMatch(/sleek|sharp rim light|clean high-contrast/i);
    expect(merged).not.toContain("对焦清晰");
    expect(merged).not.toContain("后景虚化");
  });

  it("loads the formally adopted cover instead of the latest unadopted round", async () => {
    const loadImage = async (id: number) =>
      id === 1480
        ? { id, storyId: 1176, prompt: coverPrompt }
        : { id, storyId: 1176, prompt: "【艺术谱系】错误的未采用候选" };

    const artDirection = await resolvePublishingCoverArtDirection({
      storyId: 1176,
      storyBody: {
        publishing: {
          activeVersionId: "v1",
          activeVideoStoryboardVersionId: "v1",
          versions: [
            {
              versionId: "v1",
              sequence: 1,
              displayName: "V1",
              parentId: null,
              versionRevision: 1,
              core: null,
              drafts: {},
              activePlatform: "xiaohongshu",
              selectedPlatforms: ["xiaohongshu"],
              narrativeIntent: {
                purpose: "share",
                audience: "self",
                tone: "plainspoken",
              },
              cover: { assetId: 1480, sourceCoreRevision: 1, createdAt: 1 },
              coverRounds: [{ assetIds: [9999] }],
              conversationSnapshot: null,
              videoStoryboard: null,
            },
          ],
        },
      },
      loadImage,
    });

    expect(artDirection).toContain("蛋彩、水粉、铅笔网格与有齿纸面");
    expect(artDirection).not.toContain("错误的未采用候选");
  });

  it("keeps the formally adopted cover ahead of legacy story and style recipes", () => {
    const inheritedCoverArtRecipe = publishingCoverArtRecipe(
      extractPublishingCoverArtDirection(coverPrompt)
    );

    expect(
      selectPublishingStoryboardArtRecipe({
        inheritedCoverArtRecipe,
        explicitStyleRecipe: {
          style: ["写实电影摄影"],
          palette: [],
          light: [],
          composition: [],
          material: [],
          negative: [],
        },
        storyArtRecipe: {
          style: ["旧版故事视觉配方"],
          palette: [],
          light: [],
          composition: [],
          material: [],
          negative: [],
        },
      })
    ).toBe(inheritedCoverArtRecipe);
  });
});
