import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { directImagePrompt } from "./imagePromptDirector";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  imagePrompt302Model: ENV.imagePrompt302Model,
  imagePrompt302TimeoutMs: ENV.imagePrompt302TimeoutMs,
};

beforeEach(() => {
  ENV.api302Key = "test-302-key";
  ENV.api302BaseUrl = "https://api.302.ai";
  ENV.imagePrompt302Model = "gpt-5.4-nano-2026-03-17";
  ENV.imagePrompt302TimeoutMs = "30000";
});

afterEach(() => {
  ENV.api302Key = saved.api302Key;
  ENV.api302BaseUrl = saved.api302BaseUrl;
  ENV.imagePrompt302Model = saved.imagePrompt302Model;
  ENV.imagePrompt302TimeoutMs = saved.imagePrompt302TimeoutMs;
  vi.unstubAllGlobals();
});

describe("directImagePrompt", () => {
  it("uses a character reference for identity without copying its background", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gpt-5.4-nano-2026-03-17",
        choices: [
          {
            message: {
              content: JSON.stringify({
                referenceRead: "短卷发、胡茬、灰褐衬衫的成年男子。",
                narrativeIntent: "表现疲惫但平静的状态。",
                referenceUse: "character",
                mustPreserve: ["脸部特征", "发型", "服装"],
                allowedChanges: ["姿势", "场景", "光线"],
                compositionPlan: "沙发边缘的中近景单人构图。",
                lightingPlan: "暖色下午侧光。",
                finalPrompt:
                  "A tired adult man with short curly hair and light stubble sits at the edge of a sofa, leaning forward with both hands resting on his knees. Warm afternoon side light, quiet cinematic realism, intimate medium close-up.",
                negativePrompt: "text, watermark, collage",
                confidence: 0.9,
              }),
            },
          },
        ],
      }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetch);

    const result = await directImagePrompt({
      imageInput: "data:image/png;base64,AAAA",
      fallbackPrompt: "fallback storyboard prompt",
      referencePurpose: "character",
      shotNo: 2,
      storyTitle: "一个人陷入持续的昏睡",
      narrativePrompt: "人物坐在沙发边缘，下午暖光",
    });

    expect(result.source).toBe("302-vision");
    expect(result.prompt).toContain("short curly hair");
    expect(result.prompt).toContain(
      "Preserve only the referenced character's identity"
    );
    expect(result.prompt).toContain("exactly one cinematic frame");
    expect(result.prompt).not.toContain("--");
    expect(result.analysis?.referenceUse).toBe("character");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.302.ai/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5.4-nano-2026-03-17");
    expect(body.messages[1].content[1].image_url.url).toBe(
      "data:image/png;base64,AAAA"
    );
  });

  it("preserves composition and lighting when revising a current frame", async () => {
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
                  referenceRead: "人物坐在沙发边缘。",
                  narrativeIntent: "让窗外更亮但保持疲惫感。",
                  referenceUse: "current-frame",
                  mustPreserve: ["人物", "构图", "服装"],
                  allowedChanges: ["窗外亮度"],
                  compositionPlan: "保持原构图。",
                  lightingPlan: "提高窗外亮度。",
                  finalPrompt:
                    "The same seated man remains in the original pose and framing while the exterior window light becomes slightly brighter, preserving the subdued interior mood and cinematic realism.",
                  negativePrompt: "text, watermark",
                  confidence: 0.88,
                }),
              },
            },
          ],
        }),
        text: async () => "",
      }))
    );

    const result = await directImagePrompt({
      imageInput: "data:image/png;base64,BBBB",
      fallbackPrompt: "fallback edit prompt",
      referencePurpose: "current-frame",
      narrativePrompt: "窗外再亮一点，人物不要看镜头",
    });

    expect(result.prompt).toContain(
      "Preserve the referenced subject, setting, spatial composition, clothing, and lighting"
    );
  });

  it("falls back to the existing prompt when visual analysis fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => "temporarily unavailable",
      }))
    );

    const result = await directImagePrompt({
      imageInput: "data:image/png;base64,CCCC",
      fallbackPrompt: "existing prompt remains usable",
      referencePurpose: "scene-style",
      narrativePrompt: "保留场景气氛",
    });

    expect(result).toMatchObject({
      source: "deterministic-fallback",
      prompt: "existing prompt remains usable",
      model: "gpt-5.4-nano-2026-03-17",
    });
    expect(result.fallbackReason).toContain("503");
  });
});
