import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { localVideoDir } from "./videoMedia";
const exec = promisify(execFile);
export function managedVideoBookPath(url: string): string {
  const match = /^\/api\/videos\/([\w.-]+\.mp4)$/.exec(url);
  if (!match || match[1].includes(".."))
    throw new Error("当前视频不是可读取的本地成片");
  return path.join(localVideoDir(), match[1]);
}
export async function readVideoBookEvidence(input: {
  videoUrl: string;
  sampledSeconds: number[];
  includeImages?: boolean;
}) {
  if (
    input.sampledSeconds.length < 1 ||
    input.sampledSeconds.length > 24 ||
    input.sampledSeconds.some(s => !Number.isFinite(s) || s < 0 || s > 600)
  )
    throw new Error("视频取材时间无效，未调用模型");
  const file = managedVideoBookPath(input.videoUrl);
  const info = await stat(file);
  if (info.size > 1024 * 1024 * 1024)
    throw new Error("请先将超过1GB的视频分成较短作品");
  const bytes = await readFile(file);
  const videoSha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = path.join(localVideoDir(), "book-evidence", videoSha256);
  await mkdir(dir, { recursive: true });
  const probe = JSON.parse(
    (
      await exec(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        { timeout: 20000 }
      )
    ).stdout
  );
  if (
    !(Number(probe.format?.duration) > 0) ||
    Number(probe.format.duration) > 600.1
  )
    throw new Error("本次支持10分钟以内的视频");
  let transcript = "";
  if (
    probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio")
  ) {
    const transcriptFile = path.join(dir, "transcript-v1.json");
    try {
      await access(transcriptFile);
    } catch {
      const model =
        process.env.BOOK_VIDEO_WHISPER_MODEL ||
        (process.env.NODE_ENV === "production"
          ? path.join(process.cwd(), ".runtime/book-video-audio/base.pt")
          : path.join(os.homedir(), ".cache/whisper/base.pt"));
      const python =
        process.env.BOOK_VIDEO_PYTHON ||
        (process.env.NODE_ENV === "production"
          ? path.join(process.cwd(), ".runtime/book-video-audio/bin/python")
          : "python3");
      const pending = `${transcriptFile}.${randomUUID()}.tmp`;
      try {
        await exec(
          python,
          [
            path.join(process.cwd(), "scripts/transcribe-video-book.py"),
            file,
            model,
            pending,
          ],
          { timeout: 600000, maxBuffer: 1024 * 1024 }
        );
        const parsed = JSON.parse(await readFile(pending, "utf8"));
        if (typeof parsed.text !== "string")
          throw new Error("invalid transcript");
        await rename(pending, transcriptFile);
      } catch {
        throw new Error(
          "本地音轨转写未完成，请核对转写环境后重试；未调用文字模型"
        );
      } finally {
        await rm(pending, { force: true });
      }
    }
    transcript = JSON.parse(await readFile(transcriptFile, "utf8")).text;
    if (transcript.length > 15000)
      throw new Error("视频转写超过15000字，请拆分作品后继续");
  }
  const images: string[] = [];
  for (const sec of input.includeImages === false ? [] : input.sampledSeconds) {
    const image = path.join(dir, `frame-${Math.round(sec * 1000)}.jpg`);
    try {
      await access(image);
    } catch {
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-ss",
          sec.toFixed(6),
          "-i",
          file,
          "-frames:v",
          "1",
          "-vf",
          "scale=768:768:force_original_aspect_ratio=decrease",
          "-q:v",
          "3",
          image,
        ],
        { timeout: 30000, maxBuffer: 1024 * 1024 }
      );
    }
    images.push(
      `data:image/jpeg;base64,${(await readFile(image)).toString("base64")}`
    );
  }
  await writeFile(
    path.join(dir, "source.json"),
    JSON.stringify({ videoSha256, sampledSeconds: input.sampledSeconds })
  );
  return { transcript, images, videoSha256 };
}
