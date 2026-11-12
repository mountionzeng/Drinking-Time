import * as frames from "./editingTransitionWorkflow";
import * as vidu from "./videoTransition302";
import * as director from "./videoPromptDirector";
import { compileVideoPromptEngineering } from "./videoPromptEngineering";
import {
  estimateStartEndShotVideo,
  startEndShotVideoJob,
} from "./startEndShotVideoWorkflow";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  resetMemoryStateForTesting,
  createStory,
  createGeneratedImage,
  createImageSignal,
  updateStory,
} from "../db";
import { fromYuan } from "../../shared/computeMoney";
import { grantCredit, getAccountBalance } from "./computeLedger";
import * as media from "./mediaComputeBilling";
import { generateBilledStoryboardVoice } from "./storyboardVoiceBilling";
import { StoryVoice302Error, generateStoryVoice302 } from "./storyVoice302";
import { startShotVideoJob, refreshVideoTakeStatus } from "./videoJobs";
import { reconcileMediaBilling } from "./mediaBillingRecovery";
import { ENV } from "../_core/env";

const voice = {
  audioUrl: "https://file.302.ai/test.mp3",
  provider: "openai",
  voice: "alloy",
};
const input = {
  userId: 1,
  storyId: 1,
  key: "user1-story1-shot1-hello",
  text: "你好",
  provider: "openai",
  voice: "alloy",
};
const savedEnv = { ...ENV };
beforeEach(async () => {
  resetMemoryStateForTesting();
  vi.spyOn(media, "mediaBillingEnabled").mockReturnValue(true);
  await grantCredit({
    userId: 1,
    amountMinor: fromYuan(10),
    idempotencyKey: "test-fund",
  });
});
afterEach(() => {
  Object.assign(ENV, savedEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("durable storyboard billing", () => {
  it("charges the narration quote once and recovers the receipt without a second supplier call", async () => {
    const generate = vi.fn(async () => voice);
    expect(await generateBilledStoryboardVoice(input, generate)).toEqual(voice);
    expect(await generateBilledStoryboardVoice(input, generate)).toEqual(voice);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: 0,
      lifetimeSpentMinor: fromYuan(0.02),
    });
  });
  it("rejects insufficient funds before contacting the supplier", async () => {
    const generate = vi.fn(async () => voice);
    await expect(
      generateBilledStoryboardVoice({ ...input, userId: 2 }, generate)
    ).rejects.toThrow("余额不足");
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(["submission_unknown"] as const)(
    "handles %s without another paid request",
    async outcome => {
      const generate = vi.fn(async () => {
        throw new StoryVoice302Error(outcome, "test failure");
      });
      await expect(
        generateBilledStoryboardVoice(input, generate)
      ).rejects.toThrow("test failure");
      await expect(
        generateBilledStoryboardVoice(input, generate)
      ).rejects.toThrow();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(await getAccountBalance(1)).toMatchObject({
        lifetimeSpentMinor: 0,
        reservedMinor: fromYuan(0.02),
      });
    }
  );
  it("releases the hold immediately when 302 answers HTTP 500 without audio", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const generate = (i: Parameters<typeof generateStoryVoice302>[0]) =>
      generateStoryVoice302({ ...i, apiKey: "k", baseUrl: "https://api.302ai.cn", fetcher: async () => new Response(JSON.stringify({ error: "internal" }), { status: 500 }) });
    await expect(generateBilledStoryboardVoice(input, generate)).rejects.toMatchObject({ outcome: "not_charged_failure" });
    expect(await getAccountBalance(1)).toMatchObject({ reservedMinor: 0, lifetimeSpentMinor: 0 });
  });
  it("keeps the hold when 302 times out", async () => {
    const generate = (i: Parameters<typeof generateStoryVoice302>[0]) =>
      generateStoryVoice302({ ...i, apiKey: "k", baseUrl: "https://api.302ai.cn", timeoutMs: 5, fetcher: ((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); }))) as never });
    await expect(generateBilledStoryboardVoice(input, generate)).rejects.toMatchObject({ outcome: "submission_unknown" });
    expect(await getAccountBalance(1)).toMatchObject({ reservedMinor: fromYuan(0.02), lifetimeSpentMinor: 0 });
  });
  it("allows an explicit retry after a proven uncharged rejection", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(
        new StoryVoice302Error("not_charged_failure", "rejected")
      )
      .mockResolvedValue(voice);
    await expect(
      generateBilledStoryboardVoice(input, generate)
    ).rejects.toThrow("rejected");
    expect((await getAccountBalance(1)).reservedMinor).toBe(0);
    expect(await generateBilledStoryboardVoice(input, generate)).toEqual(voice);
    await generateBilledStoryboardVoice(input, generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect((await getAccountBalance(1)).lifetimeSpentMinor).toBe(
      fromYuan(0.02)
    );
  });
  it("concurrent identical requests have one durable submission owner", async () => {
    let resolve!: (result: typeof voice) => void;
    const generate = vi.fn(
      () =>
        new Promise<typeof voice>(done => {
          resolve = done;
        })
    );
    const first = generateBilledStoryboardVoice(input, generate);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await expect(
      generateBilledStoryboardVoice(input, generate)
    ).rejects.toThrow("不会重复提交");
    resolve(voice);
    await first;
    expect((await getAccountBalance(1)).lifetimeSpentMinor).toBe(
      fromYuan(0.02)
    );
  });
  it("restart recovery settles a saved narration result without generating again", async () => {
    const operationId = media.mediaOperationId("voice", 1, input.key);
    await media.reserveMedia({
      ...input,
      operationId,
      requestHash: operationId,
      maxCostMinor: fromYuan(0.02),
    });
    await media.recordMediaResult(operationId, "openai", voice);
    await reconcileMediaBilling();
    const generate = vi.fn(async () => voice);
    expect(await generateBilledStoryboardVoice(input, generate)).toEqual(voice);
    expect(generate).not.toHaveBeenCalled();
    expect((await getAccountBalance(1)).reservedMinor).toBe(0);
  });
});

async function videoInput() {
  ENV.api302Key = "test-key";
  ENV.video302Model = "test-model";
  ENV.video302SubmitPath = "/302/submit/{model}";
  ENV.video302PollPath = "/302/task/{taskId}";
  ENV.video302Motion = "low";
  const story = await createStory({
    userId: 1,
    projectId: null,
    title: "计费测试",
    body: {
      shots: [
        {
          stableShotId: "shot-1",
          shotIdentity: "shot-1",
          shotNo: 1,
          action: "人物转身",
        },
      ],
    },
  });
  const image = await createGeneratedImage({
    userId: 1,
    projectId: null,
    storyId: story.id,
    shotNo: "SH01",
    shotIdentity: "shot-1",
    imageUrl: "data:image/png;base64,QQ==",
    imageKey: null,
    prompt: "人物",
    generationType: "initial",
    isCurrent: true,
  });
  await createImageSignal({
    userId: 1,
    storyId: story.id,
    imageId: image.id,
    action: "swipe_right",
    metadata: null,
  });
  return {
    storyId: story.id,
    shotNo: 1,
    stableShotId: "shot-1",
    imageId: image.id,
    prompt: "人物转身",
    directorPromptApproved: true,
    durationSec: 8,
  };
}
describe("video submission and reconciliation with the real ledger", () => {
  it("reserves the economy quote, records its provider and recovers once after default changes", async () => {
    const request = { ...await videoInput(), durationSec: 5, renderMode: "economy" as const };
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(String(url)).toContain("/vidu/ent/v2/img2video");
        expect(JSON.parse(String(init.body))).toMatchObject({ model: "viduq2-pro-fast", duration: 5, resolution: "720p" });
        return new Response('{"task_id":"economy-receipt"}');
      }
      expect(String(url)).toContain("/vidu/ent/v2/tasks/economy-receipt/creations");
      return new Response('{"state":"success","creations":[{"url":"https://file.302.ai/test.mp4"}]}');
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await startShotVideoJob(request, 1);
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ok", take: { model: "viduq2-pro-fast", parameterSnapshot: { renderMode: "economy", resolution: "720p", candidateCount: 1 } } });
    expect(await getAccountBalance(1)).toMatchObject({ reservedMinor: fromYuan(0.54), lifetimeSpentMinor: 0 });
    ENV.video302SubmitPath = "/mj-turbo/submit/video";
    await startShotVideoJob(request, 1);
    await reconcileMediaBilling();
    await reconcileMediaBilling();
    expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
    expect(await getAccountBalance(1)).toMatchObject({ reservedMinor: 0, lifetimeSpentMinor: fromYuan(0.54) });
  });

  it("does not repay an economy submission with an unknown response", async () => {
    const request = { ...await videoInput(), durationSec: 2, renderMode: "economy" as const };
    const fetcher = vi.fn(async () => { throw new Error("network disconnected"); });
    vi.stubGlobal("fetch", fetcher);
    expect(await startShotVideoJob(request, 1)).toMatchObject({ status: "error", take: { status: "unfollowable" } });
    await startShotVideoJob(request, 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await getAccountBalance(1)).toMatchObject({ reservedMinor: fromYuan(0.34), lifetimeSpentMinor: 0 });
  });

  it("does not submit video when the remaining balance cannot cover its quote", async () => {
    const request = await videoInput();
    await media.reserveMedia({ userId: 1, storyId: request.storyId, operationId: "other-hold", requestHash: "other", maxCostMinor: fromYuan(10) });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await startShotVideoJob(request, 1);
    expect(result).toMatchObject({ status: "error", error: expect.stringContaining("余额不足") });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("holds before submit, reuses duplicate requests and settles after background query", async () => {
    const request = await videoInput();
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST")
        return new Response(JSON.stringify({ taskId: "task-1" }));
      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          video_url: "https://file.302.ai/test.mp4",
        })
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const [first, duplicate] = await Promise.all([
      startShotVideoJob(request, 1),
      startShotVideoJob(request, 1),
    ]);
    expect(first.status, JSON.stringify(first)).toBe("ok");
    expect(["ok", "error"]).toContain(duplicate.status);
    expect(
      fetcher.mock.calls.filter(call => call[1]?.method === "POST")
    ).toHaveLength(1);
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: fromYuan(1.4),
      lifetimeSpentMinor: 0,
    });
    await reconcileMediaBilling();
    await reconcileMediaBilling();
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: 0,
      lifetimeSpentMinor: fromYuan(1.4),
    });
  });
  it.each([400, 504])(
    "HTTP %s is classified without text guessing",
    async status => {
      const request = await videoInput();
      const fetcher = vi.fn(async () => new Response("{}", { status }));
      vi.stubGlobal("fetch", fetcher);
      const result = await startShotVideoJob(request, 1);
      expect(result.status).toBe("error");
      await startShotVideoJob(request, 1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await getAccountBalance(1)).toMatchObject({
        lifetimeSpentMinor: 0,
        reservedMinor: status === 400 ? 0 : fromYuan(1.4),
      });
    }
  );
  it("does not release the supplier charge when the local video download fails", async () => {
    const request = await videoInput();
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST")
        return new Response(
          JSON.stringify({ taskId: "task-download-failure" })
        );
      if (String(_url).includes("file.302.ai"))
        return new Response("", { status: 503 });
      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          video_url: "https://file.302.ai/test.mp4",
        })
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await startShotVideoJob(request, 1);
    expect(result.status, JSON.stringify(result)).toBe("ok");
    if (result.status !== "ok") return;
    await refreshVideoTakeStatus(result.take.id, 1);
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: 0,
      lifetimeSpentMinor: fromYuan(1.4),
    });
  });
  it("recovers a submitted video on the snapshot route after API302_BASE_URL changes", async () => {
    ENV.api302BaseUrl = "https://api.302.ai";
    const request = await videoInput();
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST")
        return new Response(JSON.stringify({ taskId: "task-snap" }));
      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          video_url: "https://file.302.ai/test.mp4",
        })
      );
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await startShotVideoJob(request, 1)).toMatchObject({ status: "ok" });
    ENV.api302BaseUrl = "https://api.302ai.cn";
    ENV.video302SubmitPath = "/mj-turbo/submit/video";
    ENV.video302PollPath = "/mj-turbo/task/{taskId}/fetch";
    await reconcileMediaBilling();
    const pollUrls = fetcher.mock.calls
      .filter(call => call[1]?.method !== "POST")
      .map(call => String(call[0]));
    expect(pollUrls).toContain("https://api.302.ai/302/task/task-snap");
    expect(pollUrls.some(url => url.includes("api.302ai.cn") || url.includes("mj-turbo"))).toBe(false);
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: 0,
      lifetimeSpentMinor: fromYuan(1.4),
    });
  });

  it("recovers an economy video on the submitted host after API302_BASE_URL changes", async () => {
    ENV.api302BaseUrl = "https://api.302.ai";
    const request = { ...await videoInput(), durationSec: 5, renderMode: "economy" as const };
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === "POST")
        return new Response('{"task_id":"economy-host"}');
      expect(String(url)).toBe("https://api.302.ai/vidu/ent/v2/tasks/economy-host/creations");
      return new Response('{"state":"success","creations":[{"url":"https://file.302.ai/test.mp4"}]}');
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await startShotVideoJob(request, 1)).toMatchObject({ status: "ok" });
    ENV.api302BaseUrl = "https://api.302ai.cn";
    ENV.video302SubmitPath = "/mj-turbo/submit/video";
    ENV.video302PollPath = "/mj-turbo/task/{taskId}/fetch";
    await reconcileMediaBilling();
    await reconcileMediaBilling();
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: 0,
      lifetimeSpentMinor: fromYuan(0.54),
    });
  });

  it("keeps the video hold when the status query fails", async () => {
    ENV.api302BaseUrl = "https://api.302.ai";
    const request = await videoInput();
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST")
        return new Response(JSON.stringify({ taskId: "task-qfail" }));
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await startShotVideoJob(request, 1)).toMatchObject({ status: "ok" });
    await reconcileMediaBilling();
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: fromYuan(1.4),
      lifetimeSpentMinor: 0,
    });
  });

  it("releases the video hold when the provider confirms failure", async () => {
    ENV.api302BaseUrl = "https://api.302.ai";
    const request = await videoInput();
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST")
        return new Response(JSON.stringify({ taskId: "task-failed" }));
      return new Response(
        JSON.stringify({ status: "FAILURE", failReason: "prompt parameter error" })
      );
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await startShotVideoJob(request, 1)).toMatchObject({ status: "ok" });
    await reconcileMediaBilling();
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: 0,
      lifetimeSpentMinor: 0,
    });
  });
});

async function startEndInput() {
  const request = await videoInput();
  const image = await createGeneratedImage({
    userId: 1,
    projectId: null,
    storyId: request.storyId,
    shotNo: "SH01",
    shotIdentity: "shot-1",
    imageUrl: "data:image/png;base64,Qg==",
    imageKey: null,
    prompt: "转身后",
    generationType: "initial",
    isCurrent: false,
  });
  await updateStory(request.storyId, 1, {
    body: {
      shots: [
        {
          stableShotId: "shot-1",
          shotIdentity: "shot-1",
          shotNo: 1,
          action: "人物快速转身",
          generationParams: {
            frameMode: "start_end",
            firstFrameImageId: request.imageId,
            lastFrameImageId: image.id,
            durationSec: 3,
            resolution: "1080p",
          },
        },
      ],
    },
  });
  const frame = {
    bytes: new Uint8Array([1]),
    path: "/tmp/fake-frame.png",
    contentType: "image/png",
  };
  vi.spyOn(frames, "prepareStoryImagePairForVidu").mockResolvedValue({
    temporaryDir: "/tmp/fake",
    firstFrame: frame,
    lastFrame: frame,
    cleanup: async () => {},
  });
  vi.spyOn(director, "directVideoPrompt").mockResolvedValue({
    prompt: "turn",
    source: "deterministic-fallback",
    model: "",
    analysis: null,
    materialProfile: null,
    engineering: compileVideoPromptEngineering({
      shotNo: 1,
      draftPrompt: "turn",
      fallbackPrompt: "turn",
    }),
  });
  vi.spyOn(vidu, "uploadFileToVidu").mockResolvedValue(
    "https://file.302.ai/frame.png"
  );
  const estimate = await estimateStartEndShotVideo(
    { storyId: request.storyId, stableShotId: request.stableShotId },
    1
  );
  return {
    storyId: request.storyId,
    stableShotId: request.stableShotId,
    confirmedEstimatedCny: estimate.estimatedCny,
  };
}

describe("start/end video billing", () => {
  it("claims once, holds the confirmed quote, and settles the same task with the browser closed", async () => {
    const request = await startEndInput();
    const submit = vi
      .spyOn(vidu, "submitViduTransition")
      .mockResolvedValue({
        taskId: "vidu-task",
        submitUrl: "https://api.302.ai/vidu",
        submittedParameters: {
          model: "viduq2-turbo",
          images: [],
          prompt: "turn",
          duration: 3,
          resolution: "1080p",
          movement_amplitude: "auto",
        },
      });
    vi.spyOn(vidu, "refreshViduTransition").mockResolvedValue({
      status: "available",
      taskId: "vidu-task",
      videoUrl: "https://file.302.ai/vidu.mp4",
    });
    const results = await Promise.all([
      startEndShotVideoJob(request, 1),
      startEndShotVideoJob(request, 1),
    ]);
    expect(results.every(result => result.status === "ok"), JSON.stringify(results)).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(vidu.uploadFileToVidu).toHaveBeenCalledTimes(2);
    expect((await getAccountBalance(1)).reservedMinor).toBe(
      fromYuan(request.confirmedEstimatedCny)
    );
    await reconcileMediaBilling();
    await reconcileMediaBilling();
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: 0,
      lifetimeSpentMinor: fromYuan(request.confirmedEstimatedCny),
    });
  });
  it("keeps uncertain upload costs reserved and never submits again on retry", async () => {
    const request = await startEndInput();
    vi.mocked(vidu.uploadFileToVidu).mockRejectedValue(
      new Error("connection lost")
    );
    const submit = vi.spyOn(vidu, "submitViduTransition");
    expect((await startEndShotVideoJob(request, 1)).status).toBe("error");
    await startEndShotVideoJob(request, 1);
    expect(vidu.uploadFileToVidu).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(await getAccountBalance(1)).toMatchObject({
      reservedMinor: fromYuan(request.confirmedEstimatedCny),
      lifetimeSpentMinor: 0,
    });
  });
});
