import fs from "node:fs";
import path from "node:path";
import { localImageDir } from "./imageGen";

export function localVideoDir(): string {
  return path.join(path.dirname(localImageDir()), "videos");
}

export async function materializeVideoUrl(
  url: string,
  takeId: number
): Promise<
  | { status: "ok"; videoKey: string; videoUrl: string }
  | { status: "error"; message: string }
> {
  if (url.startsWith("/api/videos/")) {
    return {
      status: "ok",
      videoKey: url.split("/").pop() ?? `take-${takeId}.mp4`,
      videoUrl: url,
    };
  }
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return { status: "error", message: "测试环境不下载视频" };
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        status: "error",
        message: `视频托管失败：${response.status}`,
      };
    }
    const type = response.headers.get("content-type") ?? "video/mp4";
    const extension = type.includes("webm") ? "webm" : "mp4";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 200 * 1024 * 1024) {
      return { status: "error", message: "视频文件为空或超过 200MB" };
    }
    const file = `take-${takeId}.${extension}`;
    fs.mkdirSync(localVideoDir(), { recursive: true });
    fs.writeFileSync(path.join(localVideoDir(), file), bytes);
    return {
      status: "ok",
      videoKey: file,
      videoUrl: `/api/videos/${file}`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "视频托管失败",
    };
  }
}
