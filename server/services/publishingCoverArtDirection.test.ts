import { describe, expect, it } from "vitest";

import {
  applyPublishingCoverArtDirection,
  extractPublishingCoverArtDirection,
  resolvePublishingCoverArtDirection,
} from "./publishingCoverArtDirection";

const coverPrompt = `【封面内容简报】
这是封面的具体内容，不应复制到镜头。
【用户持续要求】
我希望主体是个女性，画面整体唯美一点，温暖一点。
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
  it("copies reusable art sections from the formally adopted cover", () => {
    const artDirection = extractPublishingCoverArtDirection(coverPrompt);

    expect(artDirection).toContain("【用户持续要求】");
    expect(artDirection).toContain("画面整体唯美一点，温暖一点");
    expect(artDirection).toContain("蛋彩、水粉、铅笔网格与有齿纸面");
    expect(artDirection).toContain("【风格化硬约束】");
    expect(artDirection).not.toContain("封面内容简报");
    expect(artDirection).not.toContain("标题安全区");
    expect(artDirection).not.toContain("整轮否决");
    expect(artDirection).not.toContain("四图探索梯度");
  });

  it("does not invent or rewrite the cover or shot wording", () => {
    const artDirection = extractPublishingCoverArtDirection(coverPrompt);
    const shotPrompt =
      "镜头事实原文：人物停顿后看向远处。\n图片要求原文：保持封面的人物、色板与纸张材质连续。";

    expect(applyPublishingCoverArtDirection(shotPrompt, artDirection)).toBe(
      `【正式采用封面的美术提示词｜原文复制】\n${artDirection}\n\n${shotPrompt}`
    );
  });

  it("loads the formally adopted cover instead of an unadopted candidate", async () => {
    const loadImage = async (id: number) =>
      id === 1490
        ? { id, storyId: 1178, prompt: coverPrompt }
        : { id, storyId: 1178, prompt: "【艺术谱系】错误的未采用候选" };

    const artDirection = await resolvePublishingCoverArtDirection({
      storyId: 1178,
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
              cover: { assetId: 1490, sourceCoreRevision: 1, createdAt: 1 },
              coverRounds: [{ assetIds: [1493] }],
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
});
