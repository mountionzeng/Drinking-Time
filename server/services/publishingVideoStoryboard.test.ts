import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";

import {
  generatePublishingVideoStoryboardPreview,
} from "./publishingVideoStoryboard";
import { validatePublishingVideoPreview } from "../../shared/publishingVideoStoryboard";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  videoPrompt302Model: ENV.videoPrompt302Model,
  videoPrompt302TimeoutMs: ENV.videoPrompt302TimeoutMs,
  publishingVideoStoryboard302TimeoutMs:
    ENV.publishingVideoStoryboard302TimeoutMs,
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
    vi.clearAllMocks();
  });

  afterEach(() => {
    ENV.api302Key = saved.api302Key;
    ENV.api302BaseUrl = saved.api302BaseUrl;
    ENV.videoPrompt302Model = saved.videoPrompt302Model;
    ENV.videoPrompt302TimeoutMs = saved.videoPrompt302TimeoutMs;
    ENV.publishingVideoStoryboard302TimeoutMs =
      saved.publishingVideoStoryboard302TimeoutMs;
    vi.unstubAllGlobals();
  });

  it("rewrites all six paragraphs into at least six mapped shots", async () => {
    const fetch = mockSuccessful302();

    const generated = await generatePublishingVideoStoryboardPreview({
      body,
      platform: "xiaohongshu",
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
    expect(new Set(generated.preview.shots.map(shot => shot.imageRequirement)).size).toBe(6);
    expect(new Set(generated.preview.shots.map(shot => shot.videoRequirement)).size).toBe(6);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.map(([, init]) => {
        const request = JSON.parse(String(init?.body));
        const content = String(request.messages[1].content);
        const context = JSON.parse(content.slice(content.indexOf("上下文：") + 4));
        return context.paragraphs.length;
      })
    ).toEqual([3, 3]);
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
    expect(generated.preview.segments.map(segment => segment.scriptText)).not.toContain(
      "正文 A"
    );
  });
});
