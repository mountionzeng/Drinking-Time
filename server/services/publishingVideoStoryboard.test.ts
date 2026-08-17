import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";

import {
  assignNarrativeBeats,
  generatePublishingVideoStoryboardPreview,
} from "./publishingVideoStoryboard";
import {
  canonicalizePublishingVideoParagraphs,
  validatePublishingVideoPreview,
} from "../../shared/publishingVideoStoryboard";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  videoPrompt302Model: ENV.videoPrompt302Model,
  videoPrompt302TimeoutMs: ENV.videoPrompt302TimeoutMs,
  publishingVideoStoryboard302TimeoutMs:
    ENV.publishingVideoStoryboard302TimeoutMs,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextTextModel: ENV.openaiNextTextModel,
};

function mockSuccessful302() {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const content = String(request.messages[1].content);
    const context = JSON.parse(content.slice(content.indexOf("上下文：") + 4));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "gpt-5.4-nano-2026-03-17",
        choices: [
          {
            message: {
              content: JSON.stringify({
                paragraphs: context.paragraphs.map(
                  (paragraph: { paragraphId: string }) => ({
                    paragraphId: paragraph.paragraphId,
                    scriptText: `${paragraph.paragraphId} 被转写成可说、可演的短句。`,
                    visualTreatment: `人物完成 ${paragraph.paragraphId} 对应的叙事动作。`,
                    shots: [
                      {
                        subject: `${paragraph.paragraphId} 的独立主体`,
                        action: `完成 ${paragraph.paragraphId} 的独立动作`,
                        imageRequirement: `油画纸张质感中的 ${paragraph.paragraphId} 独立场景与构图`,
                        videoRequirement: `${paragraph.paragraphId} 采用不同运动节拍并停在下一镜入口`,
                        soundRequirement: `${paragraph.paragraphId} 的纸张摩擦与低频环境声`,
                      },
                    ],
                  })
                ),
              }),
            },
          },
        ],
      }),
      text: async () => "",
    };
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const body = Array.from(
  { length: 6 },
  (_, index) => `这是第${index + 1}段发布正文。`
).join("\n\n");

describe("publishing video storyboard generation", () => {
  beforeEach(() => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.videoPrompt302Model = "gpt-5.4-nano-2026-03-17";
    ENV.videoPrompt302TimeoutMs = "30000";
    ENV.publishingVideoStoryboard302TimeoutMs = "90000";
    ENV.openaiNextApiKey = "";
    ENV.openaiNextBaseUrl = "https://api.openai-next.com";
    ENV.openaiNextTextModel = "gpt-5.6-terra";
    vi.clearAllMocks();
  });

  afterEach(() => {
    ENV.api302Key = saved.api302Key;
    ENV.api302BaseUrl = saved.api302BaseUrl;
    ENV.videoPrompt302Model = saved.videoPrompt302Model;
    ENV.videoPrompt302TimeoutMs = saved.videoPrompt302TimeoutMs;
    ENV.publishingVideoStoryboard302TimeoutMs =
      saved.publishingVideoStoryboard302TimeoutMs;
    ENV.openaiNextApiKey = saved.openaiNextApiKey;
    ENV.openaiNextBaseUrl = saved.openaiNextBaseUrl;
    ENV.openaiNextTextModel = saved.openaiNextTextModel;
    vi.unstubAllGlobals();
  });

  it("rewrites all six paragraphs into at least six mapped shots", async () => {
    const fetch = mockSuccessful302();

    const generated = await generatePublishingVideoStoryboardPreview({
      body,
      platform: "xiaohongshu",
      narrativeIntent: {
        primaryPurpose: "gift",
        secondaryPurposes: ["share"],
        coreAudience: "妈妈",
        secondaryAudiences: ["朋友圈朋友"],
        status: "confirmed",
        updatedAt: 1,
      },
      core: {
        revision: 1,
        facts: ["事实"],
        thesis: "判断",
        emotion: "克制",
        voiceTraits: ["直接"],
        visualConcept: "纸上的人物",
        updatedAt: 1,
      },
      now: 100,
    });

    expect(generated.preview.paragraphs).toHaveLength(6);
    expect(generated.preview.segments).toHaveLength(6);
    expect(generated.preview.shots).toHaveLength(6);
    expect(generated.modelLabel).toBe("gpt-5.4-nano-2026-03-17");
    expect(
      new Set(generated.preview.shots.map(shot => shot.imageRequirement)).size
    ).toBe(6);
    expect(
      new Set(generated.preview.shots.map(shot => shot.videoRequirement)).size
    ).toBe(6);
    expect(
      new Set(generated.preview.shots.map(shot => shot.soundRequirement)).size
    ).toBe(6);
    expect(generated.preview.shots.map(shot => shot.voiceText)).toEqual(
      generated.preview.paragraphs.map(paragraph => paragraph.text)
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(String(firstRequest.messages[0].content)).toContain(
      "不得写旁白、对白、音乐、环境声或音效"
    );
    expect(String(firstRequest.messages[0].content)).toContain(
      "礼物版：每镜优先让核心观众认出两人之间的共同细节"
    );
    expect(
      fetch.mock.calls.map(([, init]) => {
        const request = JSON.parse(String(init?.body));
        const content = String(request.messages[1].content);
        const context = JSON.parse(
          content.slice(content.indexOf("上下文：") + 4)
        );
        return context.paragraphs.length;
      })
    ).toEqual([3, 3]);
  });

  it("routes text storyboard compute to OpenAI Next when configured", async () => {
    ENV.openaiNextApiKey = "test-next-key";
    ENV.openaiNextTextModel = "gpt-5.6-terra";
    const fetch = mockSuccessful302();

    await generatePublishingVideoStoryboardPreview({
      body,
      platform: "xiaohongshu",
      core: null,
      now: 100,
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai-next.com/v1/chat/completions");
    // orchestrator 统一用小写 header 名（HTTP 头本身大小写不敏感）
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-next-key",
    });
    expect(JSON.parse(String(init.body)).model).toBe("gpt-5.6-terra");
  });

  it("sends only allowlisted rewrite context and never Story ids, asset URLs, or operation tokens", async () => {
    const fetch = mockSuccessful302();

    await generatePublishingVideoStoryboardPreview({
      body: "正文 A",
      platform: "x",
      core: {
        revision: 8,
        facts: ["事实"],
        thesis: "判断",
        emotion: "紧张",
        voiceTraits: ["直接"],
        visualConcept: "纸质拼贴",
        updatedAt: 999,
      },
      coverVisualDescription: "旧画布上的暖灰色油画人物",
      now: 100,
    });

    const [, init] = fetch.mock.calls[0]!;
    const serialized = String(init.body);
    expect(serialized).toContain("正文 A");
    expect(serialized).toContain("纸质拼贴");
    expect(serialized).not.toContain("storyId");
    expect(serialized).not.toContain("assetId");
    expect(serialized).not.toContain("operationToken");
    expect(serialized).not.toContain("http://");
    expect(serialized).not.toContain("https://");
  });

  it("caps concurrent 302 storyboard batches for paragraph-heavy drafts", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        await new Promise(resolve => setTimeout(resolve, 5));
        activeRequests -= 1;
        const request = JSON.parse(String(init.body));
        const content = String(request.messages[1].content);
        const context = JSON.parse(
          content.slice(content.indexOf("上下文：") + 4)
        );
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: "gpt-5.4-nano-2026-03-17",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    paragraphs: context.paragraphs.map(
                      (paragraph: { paragraphId: string }) => ({
                        paragraphId: paragraph.paragraphId,
                        scriptText: `${paragraph.paragraphId} 被转写成可执行镜头。`,
                        visualTreatment: `${paragraph.paragraphId} 的独立画面动作。`,
                        shots: [
                          {
                            subject: `${paragraph.paragraphId} 的主体`,
                            action: `${paragraph.paragraphId} 的动作`,
                            imageRequirement: `${paragraph.paragraphId} 的静帧构图`,
                            videoRequirement: `${paragraph.paragraphId} 的运镜节拍`,
                            soundRequirement: "",
                          },
                        ],
                      })
                    ),
                  }),
                },
              },
            ],
          }),
          text: async () => "",
        };
      })
    );

    const generated = await generatePublishingVideoStoryboardPreview({
      body: Array.from(
        { length: 12 },
        (_, index) => `这是并发保护测试的第${index + 1}段。`
      ).join("\n\n"),
      platform: "xiaohongshu",
      core: null,
      now: 100,
    });

    expect(generated.preview.paragraphs).toHaveLength(12);
    expect(maxActiveRequests).toBeLessThanOrEqual(2);
  });

  it("falls back to a complete local script when the model output is incomplete or copy-equal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  paragraphs: [
                    {
                      paragraphId: "wrong",
                      scriptText: "正文 A",
                      visualTreatment: "",
                      shots: [],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        text: async () => "",
      }))
    );

    const generated = await generatePublishingVideoStoryboardPreview({
      body: "正文 A\n\n正文 B",
      platform: "xiaohongshu",
      core: null,
      now: 100,
    });

    expect(generated.modelLabel).toContain("保底");
    expect(generated.preview.paragraphs).toHaveLength(2);
    expect(generated.preview.segments).toHaveLength(2);
    expect(generated.preview.shots).toHaveLength(4);
    expect(validatePublishingVideoPreview(generated.preview)).toEqual([]);
    expect(
      generated.preview.segments.map(segment => segment.scriptText)
    ).not.toContain("正文 A");
  });
});

describe("assignNarrativeBeats —— 分批标注后的全局归一", () => {
  const paras = (n: number) =>
    canonicalizePublishingVideoParagraphs(
      Array.from({ length: n }, (_, i) => `第 ${i + 1} 段正文内容。`).join("\n\n")
    );
  const rewritesFor = (
    ps: ReturnType<typeof canonicalizePublishingVideoParagraphs>,
    beats: Array<string | undefined>
  ) =>
    ps.map((p, i) => ({
      paragraphId: p.paragraphId,
      scriptText: "s",
      visualTreatment: "v",
      beat: beats[i] as never,
      shots: [],
    }));

  it("首段强制开场、末段强制收束，覆盖模型的错误标注", () => {
    const ps = paras(5);
    const out = assignNarrativeBeats(
      ps,
      rewritesFor(ps, ["转折", "起势", "转折", "起势", "开场"])
    );
    expect(out[0].beat).toBe("开场");
    expect(out[4].beat).toBe("收束");
  });

  it("模型完全没标时，中间段兜底为起势并补出一个转折", () => {
    const ps = paras(6);
    const out = assignNarrativeBeats(
      ps,
      rewritesFor(ps, [undefined, undefined, undefined, undefined, undefined, undefined])
    );
    expect(out[0].beat).toBe("开场");
    expect(out[5].beat).toBe("收束");
    const middle = out.slice(1, 5).map(r => r.beat);
    expect(middle).toContain("转折");
    expect(middle.every(b => b === "起势" || b === "转折")).toBe(true);
  });

  it("多批各自 claim 转折时全部保留 —— 转折段可以有多镜", () => {
    const ps = paras(6);
    const out = assignNarrativeBeats(
      ps,
      rewritesFor(ps, [undefined, "转折", "起势", "转折", "起势", undefined])
    );
    expect(out.filter(r => r.beat === "转折")).toHaveLength(2);
  });

  it("已有转折时不再额外补", () => {
    const ps = paras(5);
    const out = assignNarrativeBeats(
      ps,
      rewritesFor(ps, [undefined, "起势", "转折", "起势", undefined])
    );
    expect(out.filter(r => r.beat === "转折")).toHaveLength(1);
  });

  it("极短正文（1-2 段）不抛错", () => {
    const one = paras(1);
    expect(assignNarrativeBeats(one, rewritesFor(one, [undefined]))[0].beat).toBe("开场");
    const two = paras(2);
    const out = assignNarrativeBeats(two, rewritesFor(two, [undefined, undefined]));
    expect(out[0].beat).toBe("开场");
    expect(out[1].beat).toBe("收束");
  });

  it("四段之外的值被当作未标注处理", () => {
    const ps = paras(4);
    const out = assignNarrativeBeats(ps, rewritesFor(ps, [undefined, "高潮", "乱写", undefined]));
    expect(out.every(r => ["开场", "起势", "转折", "收束"].includes(r.beat as string))).toBe(true);
  });
});
