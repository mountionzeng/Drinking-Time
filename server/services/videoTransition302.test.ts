import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import {
  ViduSubmissionError,
  buildHardCutArgs,
  buildViduTransitionBody,
  downloadVideoToFile,
  estimateViduQ2TransitionCny,
  estimateViduQ2TransitionCost,
  hardCutToLastFrame,
  refreshViduTransition,
  submitViduTransition,
  uploadFileTo302,
  uploadFileToVidu,
  viduSubmissionStateForHttpStatus,
  waitForViduTransition,
} from "./videoTransition302";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  ENV.api302Key = saved.api302Key;
  ENV.api302BaseUrl = saved.api302BaseUrl;
});

describe("videoTransition302", () => {
  it("estimates the agreed two-second 720p sample without hidden variants", () => {
    expect(
      estimateViduQ2TransitionCost({
        durationSec: 2,
        resolution: "720p",
      })
    ).toEqual({
      credits: 10,
      videoPtc: 0.05,
      uploadPtc: 0.002,
      totalPtc: 0.052,
    });
    expect(
      estimateViduQ2TransitionCost({
        durationSec: 2,
        resolution: "720p",
        uploadCount: 0,
      })
    ).toEqual({
      credits: 10,
      videoPtc: 0.05,
      uploadPtc: 0,
      totalPtc: 0.05,
    });
    expect(
      estimateViduQ2TransitionCny({
        durationSec: 2,
        resolution: "720p",
      })
    ).toEqual({
      currency: "CNY",
      estimatedCny: 0.35,
    });
    expect(
      estimateViduQ2TransitionCny({
        durationSec: 5,
        resolution: "1080p",
      })
    ).toEqual({
      currency: "CNY",
      estimatedCny: 2.54,
    });
  });

  it("builds a strict two-image Vidu request", () => {
    expect(
      buildViduTransitionBody({
        prompt: "woman turns quickly",
        firstImageUrl: "https://file.302.ai/first.png",
        lastImageUrl: "https://file.302.ai/last.webp",
        durationSec: 2,
        resolution: "720p",
      })
    ).toEqual({
      model: "viduq2-turbo",
      images: [
        "https://file.302.ai/first.png",
        "https://file.302.ai/last.webp",
      ],
      prompt: "woman turns quickly",
      duration: 2,
      resolution: "720p",
      movement_amplitude: "auto",
    });
  });

  it("accepts official data URLs so Vidu does not have to download images", () => {
    const firstImage = "data:image/png;base64,iVBORw0KGgo=";
    const lastImage = "data:image/webp;base64,UklGRg==";
    expect(
      buildViduTransitionBody({
        prompt: "woman turns quickly",
        firstImageUrl: firstImage,
        lastImageUrl: lastImage,
        durationSec: 2,
        resolution: "720p",
      }).images
    ).toEqual([firstImage, lastImage]);
  });

  it("uploads local bytes without exposing the API key in the result", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            code: 200,
            data: "https://file.302.ai/first.png",
            message: "success",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    await expect(
      uploadFileTo302(
        {
          fileName: "first.png",
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
        },
        { fetcher }
      )
    ).resolves.toBe("https://file.302.ai/first.png");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.302.ai/302/upload-file",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer test-302-key" },
        body: expect.any(FormData),
      })
    );
  });

  it("uploads image bytes through Vidu storage and returns an ssupload URI", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const responses = [
      new Response(
        JSON.stringify({
          id: "resource/one",
          put_url: "https://storage.example.test/upload?signature=secret",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      new Response(null, {
        status: 200,
        headers: { etag: '"d035e206"' },
      }),
      new Response(JSON.stringify({ uri: "ssupload:?id=resource-one" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    const fetcher = vi.fn<typeof fetch>(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    });

    await expect(
      uploadFileToVidu(
        {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
        },
        { fetcher }
      )
    ).resolves.toBe("ssupload:?id=resource-one");
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://api.302.ai/vidu/tools/v2/files/uploads",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-302-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scene: "vidu" }),
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://storage.example.test/upload?signature=secret",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([1, 2, 3]),
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "https://api.302.ai/vidu/tools/v2/files/uploads/resource%2Fone/finish",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ etag: '"d035e206"' }),
      })
    );
  });

  it("retries one transient transport failure while creating a Vidu upload session", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const responses = [
      new Response(
        JSON.stringify({
          id: "resource/retried",
          put_url: "https://storage.example.test/upload?signature=secret",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      new Response(null, {
        status: 200,
        headers: { etag: '"retried-etag"' },
      }),
      new Response(JSON.stringify({ uri: "ssupload:?id=resource-retried" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (fetcher.mock.calls.length === 1) {
        throw Object.assign(new Error("fetch failed"), {
          cause: new Error("other side closed"),
        });
      }
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    });

    await expect(
      uploadFileToVidu(
        { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" },
        { fetcher }
      )
    ).resolves.toBe("ssupload:?id=resource-retried");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("preserves the upload stage and undici cause after retry exhaustion", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new Error("fetch failed"), {
        cause: new Error("other side closed"),
      });
    });

    await expect(
      uploadFileToVidu(
        { bytes: new Uint8Array([1]), contentType: "image/png" },
        { fetcher }
      )
    ).rejects.toThrow(
      "Vidu 创建图片上传会话失败：fetch failed（Error: other side closed）"
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("falls back to the generic 302 upload after Vidu session transport failures", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (fetcher.mock.calls.length <= 2) {
        throw Object.assign(new Error("fetch failed"), {
          cause: new Error(
            "Client network socket disconnected before secure TLS connection was established"
          ),
        });
      }
      return new Response(
        JSON.stringify({ data: "https://file.302.ai/vidu-frame.png" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    await expect(
      uploadFileToVidu(
        { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" },
        { fetcher }
      )
    ).resolves.toBe("https://file.302.ai/vidu-frame.png");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      "https://api.302.ai/302/upload-file"
    );
  });

  it("rejects unsafe Vidu upload URLs before sending image bytes", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: "resource-one",
            put_url: "http://127.0.0.1/file",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    await expect(
      uploadFileToVidu(
        { bytes: new Uint8Array([1]), contentType: "image/png" },
        { fetcher }
      )
    ).rejects.toThrow("必须使用 HTTPS");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("submits once and returns a resumable Vidu task id", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ task_id: "task-302-1", state: "created" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const result = await submitViduTransition(
      {
        prompt: "woman turns quickly",
        firstImageUrl: "https://file.302.ai/first.png",
        lastImageUrl: "https://file.302.ai/last.webp",
        durationSec: 2,
        resolution: "720p",
      },
      { fetcher }
    );

    expect(result).toMatchObject({
      taskId: "task-302-1",
      submitUrl: "https://api.302.ai/vidu/ent/v2/start-end2video",
    });
    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.images).toHaveLength(2);
  });

  it("treats an ambiguous paid submission as unknown and blocks blind retry", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("socket closed");
    });

    await expect(
      submitViduTransition(
        {
          prompt: "woman turns quickly",
          firstImageUrl: "https://file.302.ai/first.png",
          lastImageUrl: "https://file.302.ai/last.webp",
          durationSec: 2,
          resolution: "720p",
        },
        { fetcher }
      )
    ).rejects.toMatchObject<ViduSubmissionError>({
      submissionState: "unknown",
    });
    expect(viduSubmissionStateForHttpStatus(400)).toBe("not_submitted");
    expect(viduSubmissionStateForHttpStatus(503)).toBe("unknown");
  });

  it("preserves the undici cause for an ambiguous paid submission", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new Error("fetch failed"), {
        cause: new Error("other side closed"),
      });
    });

    await expect(
      submitViduTransition(
        {
          prompt: "woman turns quickly",
          firstImageUrl: "https://file.302.ai/first.png",
          lastImageUrl: "https://file.302.ai/last.webp",
          durationSec: 2,
          resolution: "720p",
        },
        { fetcher }
      )
    ).rejects.toMatchObject({
      message: "fetch failed（Error: other side closed）",
      submissionState: "unknown",
    });
  });

  it("reads the completed creation url from the Vidu task endpoint", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            state: "success",
            creations: [{ url: "https://file.302.ai/transition.mp4" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    await expect(
      refreshViduTransition("task-302-1", { fetcher })
    ).resolves.toEqual({
      status: "available",
      taskId: "task-302-1",
      videoUrl: "https://file.302.ai/transition.mp4",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.302.ai/vidu/ent/v2/tasks/task-302-1/creations",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("builds a deterministic hard cut to the untouched last frame", () => {
    const args = buildHardCutArgs({
      generatedVideoPath: "/tmp/generated.mp4",
      lastFramePath: "/tmp/last.webp",
      outputPath: "/tmp/final.mp4",
      totalDurationSec: 2,
      cutAtSec: 1.4,
      size: 720,
      fps: 30,
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("trim=duration=1.4");
    expect(filter).toContain("trim=duration=0.6");
    expect(filter).toContain("concat=n=2:v=1:a=0");
    expect(args).toContain("/tmp/last.webp");
    expect(args).toContain("-an");
    expect(
      args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)
    ).toEqual(["-frames:v", "60"]);
  });

  it("retries temporary query failures without calling them task failures", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const responses = [
      new Response(JSON.stringify({ err_code: "busy" }), { status: 503 }),
      new Response(JSON.stringify({ state: "processing", creations: [] }), {
        status: 200,
      }),
      new Response(
        JSON.stringify({
          state: "success",
          creations: [{ url: "https://file.302.ai/transition.mp4" }],
        }),
        { status: 200 }
      ),
    ];
    const fetcher = vi.fn<typeof fetch>(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    });

    await expect(
      waitForViduTransition("task-302-1", {
        fetcher,
        pollMs: 1,
        timeoutMs: 1_000,
        sleep: async () => undefined,
      })
    ).resolves.toEqual({
      status: "available",
      taskId: "task-302-1",
      videoUrl: "https://file.302.ai/transition.mp4",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("marks a timed-out paid submission as unknown", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );

    await expect(
      submitViduTransition(
        {
          prompt: "woman turns quickly",
          firstImageUrl: "https://file.302.ai/first.png",
          lastImageUrl: "https://file.302.ai/last.webp",
          durationSec: 2,
          resolution: "720p",
        },
        { fetcher, timeoutMs: 1 }
      )
    ).rejects.toMatchObject({ submissionState: "unknown" });
  });

  it("keeps the paid submission deadline active while reading its body", async () => {
    vi.useFakeTimers();
    ENV.api302Key = "test-302-key";
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"task_id":"unfinished')
            );
            requestSignal?.addEventListener(
              "abort",
              () => {
                controller.error(new DOMException("aborted", "AbortError"));
              },
              { once: true }
            );
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const pending = submitViduTransition(
      {
        prompt: "woman turns quickly",
        firstImageUrl: "https://file.302.ai/first.png",
        lastImageUrl: "https://file.302.ai/last.webp",
        durationSec: 2,
        resolution: "720p",
      },
      { fetcher, timeoutMs: 20 }
    ).then(
      value => ({ value }),
      error => ({ error })
    );
    await vi.advanceTimersByTimeAsync(21);

    expect(requestSignal?.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({
      error: { submissionState: "unknown" },
    });
  });

  it("treats a blank task id as an ambiguous paid submission", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ task_id: "   ", state: "created" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    await expect(
      submitViduTransition(
        {
          prompt: "woman turns quickly",
          firstImageUrl: "https://file.302.ai/first.png",
          lastImageUrl: "https://file.302.ai/last.webp",
          durationSec: 2,
          resolution: "720p",
        },
        { fetcher }
      )
    ).rejects.toMatchObject({ submissionState: "unknown" });
  });

  it("keeps the query deadline active while reading its body", async () => {
    vi.useFakeTimers();
    ENV.api302Key = "test-302-key";
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"state":"'));
            requestSignal?.addEventListener(
              "abort",
              () => {
                controller.error(new DOMException("aborted", "AbortError"));
              },
              { once: true }
            );
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const pending = refreshViduTransition("task-302-1", {
      fetcher,
      timeoutMs: 20,
    });
    await vi.advanceTimersByTimeAsync(21);

    expect(requestSignal?.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({
      status: "retryable",
      taskId: "task-302-1",
    });
  });

  it("retries partial file writes until every byte is persisted", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "video-transition-302-partial-write-")
    );
    const outputPath = path.join(directory, "generated.mp4");
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const realOpen = nodeFs.promises.open.bind(nodeFs.promises);
    let writeCalls = 0;
    vi.spyOn(nodeFs.promises, "open").mockImplementation(
      async (filePath, flags, mode) => {
        const handle = await realOpen(filePath, flags, mode);
        const realWrite = handle.write.bind(handle);
        Object.defineProperty(handle, "write", {
          configurable: true,
          value: async (buffer: Uint8Array) => {
            writeCalls += 1;
            return realWrite(buffer, 0, Math.min(buffer.byteLength, 2), null);
          },
        });
        return handle;
      }
    );
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(payload, { status: 200 })
    );

    await downloadVideoToFile(
      "https://file.302.ai/transition.mp4",
      outputPath,
      { fetcher }
    );

    expect(writeCalls).toBeGreaterThan(1);
    await expect(fs.readFile(outputPath)).resolves.toEqual(
      Buffer.from(payload)
    );
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("streams downloads into a temporary file and preserves old output on limits", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "video-transition-302-")
    );
    const outputPath = path.join(directory, "generated.mp4");
    await fs.writeFile(outputPath, "old-video");
    const oversizedFetcher = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array([1, 2, 3]))
    );

    await expect(
      downloadVideoToFile("https://file.302.ai/video.mp4", outputPath, {
        fetcher: oversizedFetcher,
        maxBytes: 2,
      })
    ).rejects.toThrow("超过 200MB");
    await expect(fs.readFile(outputPath, "utf8")).resolves.toBe("old-video");

    const okFetcher = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array([4, 5, 6]))
    );
    await downloadVideoToFile("https://file.302.ai/video.mp4", outputPath, {
      fetcher: okFetcher,
      maxBytes: 3,
    });
    await expect(fs.readFile(outputPath)).resolves.toEqual(
      Buffer.from([4, 5, 6])
    );
  });

  it("preserves an existing final output when ffmpeg cannot start", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "video-transition-302-ffmpeg-")
    );
    const outputPath = path.join(directory, "final.mp4");
    await fs.writeFile(outputPath, "old-final");

    await expect(
      hardCutToLastFrame(
        {
          generatedVideoPath: path.join(directory, "generated.mp4"),
          lastFramePath: path.join(directory, "last.webp"),
          outputPath,
          totalDurationSec: 2,
          cutAtSec: 1.4,
        },
        { ffmpegPath: path.join(directory, "missing-ffmpeg") }
      )
    ).rejects.toThrow();
    await expect(fs.readFile(outputPath, "utf8")).resolves.toBe("old-final");
  });
});
