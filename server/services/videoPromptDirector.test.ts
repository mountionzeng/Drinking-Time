import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { directVideoPrompt, mjSafeVideoPrompt } from "./videoPromptDirector";

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

    expect(result.source).toBe("302-vision");
    expect(result.model).toBe("gpt-5.4-nano-2026-03-17");
    expect(result.prompt).toContain("a short dolly");
    expect(result.prompt).toContain("Treat the supplied source frames");
    expect(result.prompt).toContain("warm window light");
    expect(result.prompt).toContain("object count and placement");
    expect(result.prompt.split(/\s+/).length).toBeLessThanOrEqual(220);
    expect(result.analysis?.narrativeIntent).toContain("平静陈述");
    expect(result.analysis?.subjectPosition).toContain("右侧三分之一");
    expect(result.analysis?.cameraRig).toContain("短滑轨");
    expect(result.analysis?.motionTimeline).toContain("最后 25%");
    expect(result.analysis?.risks[0]?.kind).toBe("look");
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
    expect(body.messages[1].content[3].image_url.url).toContain("END");
    expect(body.messages[1].content[5].image_url.url).toContain("PREVIOUS");
    expect(body.messages[1].content[7].image_url.url).toContain("NEXT");
    expect(body.messages[0].content).toContain("手持不是默认装饰");
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
