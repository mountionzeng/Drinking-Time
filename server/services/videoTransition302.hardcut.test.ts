/**
 * 2026-08-19：viduq2-turbo 的首尾帧成片实际返回 1440×1440，但硬切这一步把 `size`
 * 写死成 720，两个调用方（剪辑转场工作流、generate-302-turn-transition 脚本）都照抄了
 * 这个值。结果是按 1080p 计费（65 credits / 4 秒），落盘却只有 720p。
 *
 * 这组用例锁住「硬切尺寸跟着源视频走」，别再让付过钱的分辨率被本地重编码丢掉。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probeVideoFileMetadata = vi.fn();
vi.mock("./videoConform", () => ({ probeVideoFileMetadata }));

const { hardCutToLastFrame } = await import("./videoTransition302");

let directory = "";
let ffmpegStubPath = "";
let recordedArgsPath = "";

/** 假 ffmpeg：把收到的参数原样写到文件，再生成一个占位输出，好断言 filter 串。 */
async function writeFfmpegStub() {
  recordedArgsPath = path.join(directory, "ffmpeg-args.txt");
  ffmpegStubPath = path.join(directory, "ffmpeg-stub.sh");
  await fs.writeFile(
    ffmpegStubPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(recordedArgsPath)}\n` +
      `for arg in "$@"; do last="$arg"; done\n` +
      `printf 'video' > "$last"\n`,
    "utf8"
  );
  await fs.chmod(ffmpegStubPath, 0o755);
}

async function runHardCut(size?: number) {
  await hardCutToLastFrame(
    {
      generatedVideoPath: path.join(directory, "generated.mp4"),
      lastFramePath: path.join(directory, "last.png"),
      outputPath: path.join(directory, "final.mp4"),
      totalDurationSec: 4,
      cutAtSec: 3.2,
      ...(size == null ? {} : { size }),
    },
    { ffmpegPath: ffmpegStubPath }
  );
  const recorded = await fs.readFile(recordedArgsPath, "utf8");
  const args = recorded.split("\n");
  return args[args.indexOf("-filter_complex") + 1];
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "hardcut-size-"));
  await writeFfmpegStub();
  await fs.writeFile(path.join(directory, "generated.mp4"), "source");
  await fs.writeFile(path.join(directory, "last.png"), "frame");
});

afterEach(async () => {
  vi.restoreAllMocks();
  probeVideoFileMetadata.mockReset();
  await fs.rm(directory, { recursive: true, force: true });
});

describe("硬切保留源视频分辨率", () => {
  it("省略 size 时按源视频真实尺寸硬切，不再压回 720", async () => {
    probeVideoFileMetadata.mockResolvedValue({
      width: 1440,
      height: 1440,
      durationSec: 4.125,
      aspectRatio: "1:1",
    });

    const filter = await runHardCut();

    expect(probeVideoFileMetadata).toHaveBeenCalledWith(
      path.join(directory, "generated.mp4")
    );
    expect(filter).toContain("scale=1440:1440");
    expect(filter).toContain("crop=1440:1440");
    expect(filter).not.toContain("720");
  });

  it("探测失败时退回 720 而不是整条链路报错", async () => {
    probeVideoFileMetadata.mockRejectedValue(new Error("ffprobe 不可用"));

    const filter = await runHardCut();

    expect(filter).toContain("scale=720:720");
  });

  it("调用方显式指定 size 时以指定值为准，不再多探一次", async () => {
    const filter = await runHardCut(1080);

    expect(probeVideoFileMetadata).not.toHaveBeenCalled();
    expect(filter).toContain("scale=1080:1080");
  });
});
