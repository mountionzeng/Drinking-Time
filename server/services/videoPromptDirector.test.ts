import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { directVideoPrompt, mjSafeVideoPrompt } from "./videoPromptDirector";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  videoPrompt302Model: ENV.videoPrompt302Model,
  videoPrompt302TimeoutMs: ENV.videoPrompt302TimeoutMs,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextVisionModel: ENV.openaiNextVisionModel,
};

beforeEach(() => {
  ENV.api302Key = "test-302-key";
  ENV.api302BaseUrl = "https://api.302.ai";
  ENV.videoPrompt302Model = "gpt-5.4-nano-2026-03-17";
  ENV.videoPrompt302TimeoutMs = "30000";
  ENV.openaiNextApiKey = "";
  ENV.openaiNextBaseUrl = "https://api.openai-next.com";
  ENV.openaiNextVisionModel = "qwen3-vl-plus";
});

afterEach(() => {
  ENV.api302Key = saved.api302Key;
  ENV.api302BaseUrl = saved.api302BaseUrl;
  ENV.videoPrompt302Model = saved.videoPrompt302Model;
  ENV.videoPrompt302TimeoutMs = saved.videoPrompt302TimeoutMs;
  ENV.openaiNextApiKey = saved.openaiNextApiKey;
  ENV.openaiNextBaseUrl = saved.openaiNextBaseUrl;
  ENV.openaiNextVisionModel = saved.openaiNextVisionModel;
  vi.unstubAllGlobals();
});

describe("directVideoPrompt", () => {
  it("asks the configured OpenAI Next vision model to turn frames into a short MJ motion prompt", async () => {
    ENV.openaiNextApiKey = "test-next-key";
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "qwen3-vl-plus",
        choices: [
          {
            message: {
              content: JSON.stringify({
                visualSummary: "疲惫的男子坐在沙发边缘，暖光从右侧进入。",
                narrativeIntent: "让身体的疲惫与平静陈述形成反差。",
                subjectMotion:
                  "He slowly leans a touch forward, eyelids droop slightly, and his breathing feels faint and steady; his gaze subtly shifts downward then settles.",
                cameraMotion:
                  "A very gentle push-in toward his face and upper torso; shallow depth of field remains consistent.",
                cameraRig: "短滑轨或小型摄影车，缓入缓出，不使用手持漂移。",
                motionTimeline:
                  "前 25% 锁住呼吸，中段人物低头后滑轨才轻推，最后 25% 同时减速并收稳。",
                cameraSubjectCoordination:
                  "人物先动，摄影机稍后响应，人物停下时摄影机也停下。",
                preservationConstraints:
                  "保留人物、沙发、窗光、布料纹理和物体位置，不新增内容。",
                continuity: "保持人物、暖光和原构图不变。",
                subjectPosition: "人物位于画面右侧三分之一。",
                facingGazeDirection: "身体朝左，视线向下。",
                shotScaleChange: "中景进入近景，再接远景。",
                lightColorMaterial: "右侧暖光、低饱和布料质感保持一致。",
                materialProfile: {
                  medium: "oil-painting",
                  support: "woven linen canvas",
                  markMaking:
                    "layered impasto brushstrokes with dry-brush edges",
                  pigmentBehavior:
                    "opaque mineral pigment with visible paint thickness",
                  temporalRules:
                    "keep the same canvas tooth, paint thickness, brush direction and hand-painted edge behavior in every frame",
                  prohibitedDrift:
                    "photorealistic conversion, CGI smoothing, plastic skin, texture flicker, changing brushwork",
                  confidence: 0.94,
                },
                actionContinuity: "承接前镜低头动作，在呼吸后停住。",
                transitionStrategy: "用视线匹配接到下一镜。",
                risks: [{ kind: "look", detail: "下一镜视线方向需要保持。" }],
                recommendedMotion: "low",
                finalPrompt:
                  "The seated man holds the opening composition, breathes slowly, then lowers his gaze. Only after his eyes begin to move, a short dolly makes one restrained push toward his upper torso with a gentle ease-in. His body settles first and the dolly eases to a complete stop, preserving the warm window light, shallow depth of field, pose, and spatial continuity.",
                confidence: 0.91,
              }),
            },
          },
        ],
      }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetch);

    const result = await directVideoPrompt({
      imageInput: "data:image/png;base64,AAAA",
      endImageInput: "data:image/png;base64,END",
      middleImageInput: "data:image/png;base64,MIDDLE",
      identityImageInput: "data:image/png;base64,IDENTITY",
      previousImageInput: "data:image/png;base64,PREVIOUS",
      nextImageInput: "data:image/png;base64,NEXT",
      fallbackPrompt: "subtle natural motion, stable camera",
      shotNo: 2,
      draftPrompt: "动作：坐在沙发边缘\n相机运动：稳定轻微推进",
      subtitle: "我最近一直都在昏昏欲睡的状态",
      storyTitle: "一个人陷入持续的昏睡",
      currentShot: {
        intent: "记录身体正在流失能量的瞬间",
        action: "身体微微前倾，手搭在膝盖上",
      },
      previousShot: { intent: "建立困意弥漫的空间" },
      nextShot: { intent: "让房间随时间变暗" },
    });

    expect(result.source).toBe("openai-next-vision");
    expect(result.model).toBe("qwen3-vl-plus");
    expect(result.prompt).toContain("a short dolly");
    expect(result.prompt).toMatch(/^MATERIAL LOCK:/);
    expect(result.prompt).toContain("oil-painting");
    expect(result.prompt).toContain("woven linen canvas");
    expect(result.prompt).toContain("layered impasto brushstrokes");
    expect(result.prompt).toContain("texture flicker");
    expect(result.prompt.split("\n")[0].length).toBeLessThanOrEqual(360);
    expect(result.prompt).toContain("Treat the supplied source frames");
    expect(result.prompt).toContain("warm window light");
    expect(result.prompt).toContain("object count and placement");
    expect(result.prompt).toContain("身体微微前倾，手搭在膝盖上");
    expect(result.engineering.source).toBe("vision-directed");
    expect(result.engineering.continuityOut).toContain("房间随时间变暗");
    expect(result.prompt.split(/\s+/).length).toBeLessThanOrEqual(260);
    expect(result.analysis?.narrativeIntent).toContain("平静陈述");
    expect(result.analysis?.subjectPosition).toContain("右侧三分之一");
    expect(result.analysis?.cameraRig).toContain("短滑轨");
    expect(result.analysis?.motionTimeline).toContain("最后 25%");
    expect(result.analysis?.risks[0]?.kind).toBe("look");
    expect(result.analysis?.recommendedMotion).toBe("low");
    expect(result.materialProfile).toMatchObject({
      medium: "oil-painting",
      support: "woven linen canvas",
      confidence: 0.94,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai-next.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-next-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("qwen3-vl-plus");
    expect(body.max_completion_tokens).toBe(1400);
    expect(body.reasoning_effort).toBe("low");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,AAAA",
        detail: "high",
      },
    });
    expect(body.messages[1].content[3].image_url.url).toContain("END");
    expect(body.messages[1].content[4].text).toContain("中间参考帧");
    expect(body.messages[1].content[5].image_url.url).toContain("MIDDLE");
    expect(body.messages[1].content[6].text).toContain("人物身份基准");
    expect(body.messages[1].content[7].image_url.url).toContain("IDENTITY");
    expect(body.messages[1].content[9].image_url.url).toContain("PREVIOUS");
    expect(body.messages[1].content[11].image_url.url).toContain("NEXT");
    expect(body.messages[0].content).toContain("手持不是默认装饰");
    expect(body.messages[0].content).toContain("脸、发型和服饰的唯一事实来源");
    expect(body.messages[0].content).toContain("高于“既有视频方案”");
    expect(body.messages[0].content).toContain("先判断视觉媒介");
    expect(body.messages[0].content).toContain("materialProfile");
    expect(body.messages[1].content[0].text).toContain("动作：坐在沙发边缘");
    expect(body.messages[1].content[0].text).toContain(
      "身体微微前倾，手搭在膝盖上"
    );
  });

  it("builds a watercolor-specific temporal lock instead of a generic style phrase", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gpt-5.4-nano-2026-03-17",
        choices: [
          {
            message: {
              content: JSON.stringify({
                visualSummary: "水彩纸上的人物与森林。",
                narrativeIntent: "让人物缓慢回头。",
                subjectMotion:
                  "The woman slowly turns her head and settles her gaze.",
                cameraMotion:
                  "The locked camera makes one restrained lateral drift.",
                lightColorMaterial:
                  "透明水彩、冷压纸纹、湿画法晕染和色素沉积必须保持。",
                materialProfile: {
                  medium: "watercolor",
                  support: "cold-pressed watercolor paper",
                  markMaking:
                    "transparent washes, wet-on-wet blooms and dry-brush accents",
                  pigmentBehavior:
                    "granulating pigment with darker pooling at wash edges",
                  temporalRules:
                    "preserve paper tooth, wash transparency, bloom boundaries and pigment granulation in every frame",
                  prohibitedDrift:
                    "oil-paint impasto, photorealism, airbrushed gradients, digital smoothing, texture flicker",
                  confidence: 0.92,
                },
                finalPrompt:
                  "The woman slowly turns her head before the camera answers with one restrained lateral drift, then both settle into the original composition.",
                recommendedMotion: "low",
                confidence: 0.9,
              }),
            },
          },
        ],
      }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetch);

    const result = await directVideoPrompt({
      imageInput: "data:image/png;base64,WATERCOLOR",
      fallbackPrompt: "subtle motion",
      shotNo: 5,
      draftPrompt: "人物慢慢回头，相机轻微侧移",
    });

    expect(result.materialProfile?.medium).toBe("watercolor");
    expect(result.prompt).toMatch(/^MATERIAL LOCK:/);
    expect(result.prompt).toContain("cold-pressed watercolor paper");
    expect(result.prompt).toContain("wet-on-wet blooms");
    expect(result.prompt).toContain("granulating pigment");
    expect(result.prompt).toContain("oil-paint impasto");
    expect(result.prompt.split("\n")[0].length).toBeLessThanOrEqual(360);
  });

  it("rewrites MJ-sensitive cooking vocabulary before submission", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gpt-5.4-nano-2026-03-17",
        choices: [
          {
            message: {
              content: JSON.stringify({
                visualSummary: "厨房里一只锅正在冒蒸汽。",
                narrativeIntent: "建立厨房里的安静余温。",
                subjectMotion:
                  "Steam rises gently from the pot, then thins and drifts upward.",
                cameraMotion: "A slow micro push-in toward the pot.",
                continuity: "保持厨房、暖光和构图。",
                recommendedMotion: "low",
                finalPrompt:
                  "Steam rises gently from the pot while the camera slowly moves toward the pot.",
                confidence: 0.82,
              }),
            },
          },
        ],
      }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetch);

    const result = await directVideoPrompt({
      imageInput: "data:image/png;base64,BBBB",
      fallbackPrompt: "steam rises gently from the cooking pan",
      shotNo: 1,
      draftPrompt: "动作：锅里冒出蒸汽\n相机运动：轻微推进",
    });

    expect(result.source).toBe("302-vision");
    expect(result.prompt).toContain("saucepan");
    expect(result.prompt).not.toMatch(/\bpot\b/i);
  });

  it("keeps the MJ-safe video prompt rewrite narrowly scoped", () => {
    expect(mjSafeVideoPrompt("steam rises from the pot")).toBe(
      "steam rises from the saucepan"
    );
    expect(mjSafeVideoPrompt("a potter shapes clay")).toBe(
      "a potter shapes clay"
    );
  });

  it("falls back without blocking video generation when 302 analysis fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => "temporarily unavailable",
      }))
    );

    const result = await directVideoPrompt({
      imageInput: "data:image/png;base64,AAAA",
      fallbackPrompt: "subtle natural motion, stable camera",
      shotNo: 2,
      draftPrompt: "动作：轻轻呼吸",
    });

    expect(result).toMatchObject({
      source: "deterministic-fallback",
      model: "gpt-5.4-nano-2026-03-17",
    });
    expect(result.prompt).toContain("Editor hard constraints");
    expect(result.prompt).toContain("轻轻呼吸");
    expect(result.engineering.source).toBe("deterministic");
    expect(result.prompt).not.toBe("subtle natural motion, stable camera");
    expect(result.fallbackReason).toContain("503");
  });

  it("does not call a provider when both vision channels are disabled", async () => {
    ENV.videoPrompt302Model = "";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await directVideoPrompt({
      imageInput: "data:image/png;base64,AAAA",
      fallbackPrompt: "subtle natural motion, stable camera",
      shotNo: 2,
      draftPrompt: "动作：轻轻呼吸",
    });

    expect(result.source).toBe("deterministic-fallback");
    expect(result.prompt).toContain("Editor hard constraints");
    expect(result.engineering.version).toBe("video-prompt-engineering/v2");
    expect(result.fallbackReason).toBe(
      "OpenAI Next / 302 视频提示词通道未配置"
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
