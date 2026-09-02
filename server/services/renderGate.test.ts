import { describe, it, expect, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getRecentEditPreferences: vi.fn(),
}));

vi.mock("./artRepository", () => ({
  artRepositoryPromptBlocks: vi.fn(async () => [
    "【私人策展库审美底线】不是内容模板，不得因此固定色调；过滤平台水印。",
  ]),
}));

vi.mock("../db", async importOriginal => {
  const actual = await importOriginal<typeof import("../db")>();
  return { ...actual, ...dbMocks };
});

import { renderViaGate } from "./renderGate";

describe("renderViaGate（出图网关）", () => {
  it("资产锁进入最高优先级提示词，锁定风格时不再混入自动美术方向", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "夜间近景，人物回头",
        lockedVisualAssets: {
          fingerprint: "asset-fingerprint",
          kinds: ["character", "scene", "style"],
          promptContract:
            "【锁定视觉资产·最高优先级】\n发型：黑色短发\n服饰：红外套\n媒介：水粉",
        },
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("【锁定视觉资产·最高优先级】");
    expect(seen).toContain("发型：黑色短发");
    expect(seen).not.toContain("【艺术谱系】");
    expect(seen).not.toContain("【艺术跃迁】");
    expect(seen).not.toContain("【私人策展库审美底线】");
  });

  it("正式封面原文已锁定时原样透传，不再追加任何美术内容", async () => {
    const lockedPrompt = [
      "【正式采用封面的美术提示词｜原文复制】",
      "【艺术谱系】蛋彩、水粉、平涂油彩与纸板。",
      "【手作完成度】不完美透视、手描轮廓和不均匀平涂。",
      "镜头原文：人物停顿后把目光移向远处。",
    ].join("\n");
    let seen = "";

    await renderViaGate(
      { prompt: lockedPrompt, preservePrompt: true },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toBe(lockedPrompt);
    expect(seen).not.toContain("【故事视觉配方】");
    expect(seen).not.toContain("【用户创作偏好】");
    expect(seen).not.toContain("【美术流派·");
  });

  it("没有用户选定风格时只增加艺术底线，不给所有图片染上同一套流派", async () => {
    let seen = "";
    await renderViaGate({ prompt: "a cat on a wall" }, async prompt => {
      seen = prompt;
      return { ok: true };
    });
    expect(seen).toContain("a cat on a wall");
    expect(seen).toContain("【艺术跃迁】");
    expect(seen).toContain("相机无法直接拍到");
    expect(seen).toContain("【文本美术信号】");
    expect(seen).toContain("【私人策展库审美底线】");
    expect(seen).toContain("不是内容模板");
    expect(seen).toContain("不得因此固定色调");
    expect(seen).toContain("平台水印");
    expect(seen).not.toContain("【艺术谱系】");
    expect(seen).not.toContain("【手作完成度】");
    expect(seen).not.toContain("【美术流派·");
    expect(seen).toContain("【静态图片无字硬约束】");
    expect(seen).toContain("禁止可读文字、伪文字、字母、数字");
    expect(seen).toContain("钟表、日历、书页、报纸、招牌、包装、屏幕");
    expect(seen).toContain("【风格化硬约束】");
    expect(seen).toContain("不能被误认成相机照片");
    expect(
      seen.endsWith(
        "任何需要的标题或文案只能由产品界面后期叠加，绝不能画进图片像素中。"
      )
    ).toBe(true);
  });

  it("从文字中读取情绪、明确年代和生活质地，为手绘谱系服务但不杜撰年代", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "1990年代南方县城的旧厨房里，一个孩子翻看家里的相册",
        emotion: "怀旧里带一点不安",
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("主情绪：怀旧里带一点不安");
    expect(seen).toContain("明确年代：1990年代");
    expect(seen).toContain("生活质地：家庭内部");
    expect(seen).toContain("【艺术谱系】");
    expect(seen).toContain("可见叠笔、局部擦洗与轻微失准");
    expect(seen).not.toMatch(/皮埃尔·博纳尔|爱德华·维亚尔/);
    expect(seen).toContain("【时间、季节与服装】");
    expect(seen).toContain("轻微褪色的暖色");
  });

  it("用本轮情绪与生命体验选择词库卡，不读取长期画像冒充当下", async () => {
    dbMocks.getRecentEditPreferences.mockResolvedValueOnce([
      { inferredPreferences: '["长期偏好焦虑压迫的表达"]' },
    ]);
    let seen = "";

    await renderViaGate(
      {
        prompt: "她刚刚毕业，正在整理旧房间",
        emotion: "离开校园以后有些释然，想重新开始",
        projectId: 1,
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("【艺术谱系】");
    expect(seen).toContain("书法性轮廓与概括色面");
    expect(seen).not.toContain("木刻刀痕、重压黑线");
    expect(seen).toContain("【用户创作偏好】");
  });

  it("普通故事不会因为历史编辑偏好被自动套上情绪画风", async () => {
    dbMocks.getRecentEditPreferences.mockResolvedValueOnce([
      { inferredPreferences: '["长期偏好焦虑压迫的表达"]' },
    ]);
    let seen = "";

    await renderViaGate(
      { prompt: "两个人在房间里讨论明天的安排", projectId: 1 },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("【用户创作偏好】");
    expect(seen).not.toContain("【艺术谱系】");
  });

  it("否定的情绪不会在文本美术信号里被反写成当前情绪", async () => {
    let seen = "";

    await renderViaGate(
      { prompt: "她已经不焦虑了，只是释然地收拾房间" },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("主情绪：清醒与克制");
    expect(seen).not.toContain("主情绪：焦虑与不安");
    expect(seen).not.toContain("木刻刀痕、重压黑线");
  });

  it("明确说当下且画面有人时，按当前季节补日常服装", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "现在，一个女孩走在街边",
        currentDate: "2026-07-15",
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("【时间、季节与服装】");
    expect(seen).toContain("轻薄透气的夏季日常服装");
  });

  it("用户点名艺术参照时内部完成映射，艺术谱系只输出可观察画面特征", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "一个人坐在空旷房间里",
        userInstructions: ["参考常玉、Georges Seurat 和吴冠中的视觉语言"],
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    const artLine = seen
      .split("\n")
      .find(line => line.startsWith("【艺术谱系】"));
    expect(artLine).toContain("书法性轮廓与概括色面");
    expect(artLine).toContain("疏密点触组织空气感");
    expect(artLine).not.toMatch(/常玉|Seurat|吴冠中/);
  });

  it("同一轮最多应用一张主卡和一个相容动态辅助效果", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "人物奔跑，边缘出现方向性拖影",
        userInstructions: ["朦胧彩铅、大面积留白、局部动态模糊"],
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    const artLine = seen
      .split("\n")
      .find(line => line.startsWith("【艺术谱系】"));
    expect(artLine).toContain("主风格：柔软彩铅颗粒与纸面阻力");
    expect(artLine).toContain(
      "相容辅助效果：仅在运动边缘加入方向性拖擦与局部弥散"
    );
    expect(artLine).not.toContain("全画面失焦");
  });

  it("render 的返回值原样透传（保留各生成器自己的返回形）", async () => {
    const r = await renderViaGate({ prompt: "x" }, async () => ({
      url: "http://img/1.png",
    }));
    expect(r).toEqual({ url: "http://img/1.png" });
  });

  it("有故事视觉配方时优先注入原创 DNA，不再注入具名流派", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "窗边开花的小草",
        artDirection: {
          style: ["平涂风格化插图"],
          palette: ["低饱和青绿"],
          light: ["清晨柔侧光"],
          composition: ["主体偏侧"],
          material: ["纸张颗粒"],
          negative: ["摄影写实"],
        },
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("【故事视觉配方】");
    expect(seen).toContain("低饱和青绿");
    expect(seen).not.toContain("【美术流派·");
  });

  it("封面由同一工程合并用户累计要求、参考图边界与四图创造力梯度", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "事实：一个人在空旷房间里等待",
        userInstructions: ["更多留白", "像风景画"],
        outputPurpose: "publishing-cover",
        referencePolicy: "style-only",
        fourCandidateExploration: true,
        artDirection: {
          style: ["纸本拼贴"],
          palette: ["矿物色"],
          light: ["光成为实体"],
          composition: ["极端留白"],
          material: ["粗纸纤维"],
          negative: [],
        },
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("【用户持续要求】更多留白；像风景画");
    // 用户的美术指令必须被声明为高优先级，且不得再挂一句「不能篡改故事事实」
    // 的自我否决尾巴——那句话会让「我希望是两个女性」被当成越界而悄悄忽略。
    expect(seen).toContain("优先级高于你的默认想象");
    expect(seen).not.toMatch(
      /【用户持续要求】[^\n]*但不能篡改已经确认的故事事实/
    );
    // 内容主权必须把「原文没写的外观」明确划出故事事实之外。
    expect(seen).toContain("不属于故事事实");
    expect(seen).toMatch(/【内容主权】[^\n]*性别/);
    expect(seen).toContain("【故事视觉配方】");
    expect(seen).toContain("矿物色");
    expect(seen).toContain("只继承已提取并经用户确认的美术 DNA");
    expect(seen).toContain("一张克制但有艺术判断");
    expect(seen).toContain("禁止可读文字");
    expect(seen).toContain("原始视觉联想不是已确认的故事事实");
    expect(seen).toContain("不要照搬钟表、沙漏");
    expect(seen).toContain("商品静物");
    expect(seen).toContain("可能承载字符的表面");
  });

  it("上一轮一个方向都没选时整轮换掉视觉元素并切换探索方法", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "事实：一个人没有被信息洪流带走",
        outputPurpose: "publishing-cover",
        referencePolicy: "none",
        fourCandidateExploration: true,
        discardPreviousRound: true,
        explorationRound: 8,
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("【整轮否决·第8轮】");
    expect(seen).toContain("上一轮四张都没有被选中");
    expect(seen).toContain("更换核心主体类别、主要物件、空间机制、构图骨架");
    expect(seen).toContain("本轮指定探索方法");
    expect(seen).toContain("明显风格化");
  });

  it("修改图片时只锁真实可见的信息，不再凭空写死服装与颜色", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "人物走向门口",
        outputPurpose: "image-edit",
        referencePolicy: "preserve-identity",
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("同一人物的可辨认身份");
    expect(seen).toContain("不凭空指定裙长、颜色");
    expect(seen).not.toContain("floor-length gown");
    expect(seen).not.toContain("blue, cyan, or teal");
  });

  it("故事板参考事实和用户原话也由同一工程合并，不再经过第二套后处理", async () => {
    let seen = "";
    const instruction = "只把背景调亮，人物、发型和物体都不要变。";
    await renderViaGate(
      {
        prompt: "人物站在既有空间里",
        userInstructions: [instruction],
        outputPurpose: "image-edit",
        referencePolicy: "preserve-composition",
        storyboardReferenceTruth: true,
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain(`【用户持续要求】${instruction}`);
    expect(seen).toContain("一律按用户所说执行");
    expect(seen).toContain("【故事板视觉事实】");
    expect(seen).toContain("画面中真实可见的人物身份");
    expect(seen).not.toContain("GARMENT LENGTH IS IDENTITY");
    expect(seen).not.toContain("blue, cyan, teal");
  });

  it("累计要求接近模型长度上限时优先保留用户最新写下的文字", async () => {
    let seen = "";
    const latest = "这一次最重要：人物缩小到画面十分之一";
    await renderViaGate(
      {
        prompt: "一个人在巨大空间里",
        userInstructions: ["旧要求".repeat(1_000), latest],
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain(latest);
    expect(seen.length).toBeLessThanOrEqual(3_500);
  });

  it("render 抛错时原样冒泡，不吞错", async () => {
    await expect(
      renderViaGate({ prompt: "x" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  it("跳过损坏或非字符串偏好，同时保留其他有效编辑偏好", async () => {
    dbMocks.getRecentEditPreferences.mockResolvedValueOnce([
      { inferredPreferences: '["  保留留白  ", 42, null, ""]' },
      { inferredPreferences: "{坏掉的 JSON" },
      { inferredPreferences: ["使用低饱和色彩", {}, "  "] },
    ]);
    let seen = "";

    await renderViaGate(
      { prompt: "一间安静的屋子", projectId: 1 },
      async prompt => {
        seen = prompt;
        return { ok: true };
      }
    );

    expect(seen).toContain("【用户创作偏好】");
    expect(seen).toContain("保留留白；使用低饱和色彩");
    expect(seen).not.toContain("42");
  });
});
