import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { directVideoPrompt } from "./videoPromptDirector";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  videoPrompt302Model: ENV.videoPrompt302Model,
  videoPrompt302TimeoutMs: ENV.videoPrompt302TimeoutMs,
};

beforeEach(() => {
  ENV.api302Key = "test-302-key";
  ENV.api302BaseUrl = "https://api.302.ai";
  ENV.videoPrompt302Model = "gpt-5.4-nano-2026-03-17";
  ENV.videoPrompt302TimeoutMs = "30000";
});

afterEach(() => {
  ENV.api302Key = saved.api302Key;
  ENV.api302BaseUrl = saved.api302BaseUrl;
  ENV.videoPrompt302Model = saved.videoPrompt302Model;
  ENV.videoPrompt302TimeoutMs = saved.videoPrompt302TimeoutMs;
  vi.unstubAllGlobals();
});

describe("directVideoPrompt", () => {
  it("asks the configured 302 vision model to turn the frame into a short MJ motion prompt", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gpt-5.4-nano-2026-03-17",
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
                continuity: "保持人物、暖光和原构图不变。",
                recommendedMotion: "low",
                finalPrompt:
                  "The seated man breathes slowly and lowers his gaze slightly. A very gentle push-in preserves his face, pose, warm window light, and original composition, with natural micro-movements only.",
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

    expect(result.source).toBe("302-vision");
    expect(result.model).toBe("gpt-5.4-nano-2026-03-17");
    expect(result.prompt).toContain("breathing feels faint and steady");
    expect(result.prompt).toContain("A very gentle push-in");
    expect(result.prompt).toContain("Preserve identity");
    expect(result.prompt).not.toContain("warm window light");
    expect(result.prompt).not.toContain("gaze subtly shifts");
    expect(result.prompt).not.toContain("shallow depth");
    expect(result.prompt.split(/\s+/).length).toBeLessThanOrEqual(65);
    expect(result.analysis?.narrativeIntent).toContain("平静陈述");
    expect(result.analysis?.recommendedMotion).toBe("low");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.302.ai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-302-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5.4-nano-2026-03-17");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,AAAA",
        detail: "high",
      },
    });
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
      prompt: "subtle natural motion, stable camera",
      model: "gpt-5.4-nano-2026-03-17",
    });
    expect(result.fallbackReason).toContain("503");
  });

  it("does not call 302 when the director model is explicitly disabled", async () => {
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
    expect(result.fallbackReason).toBe("VIDEO_PROMPT_302_MODEL 未配置");
    expect(fetch).not.toHaveBeenCalled();
  });
});
