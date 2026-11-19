import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import type { Request } from "express";
import { LOCAL_VOICE_MAX_BYTES, LOCAL_VOICE_MAX_SECONDS } from "../../shared/localVoiceInput";
import { isLoopbackHost } from "../_core/authMode";

export function isLocalDictationRequest(req: Request) {
  const isLocal = (host?: string) => isLoopbackHost(host) || host === "[::1]";
  if (process.env.NODE_ENV !== "development" || !isLocal(req.hostname)) return false;
  const address = req.socket.remoteAddress;
  if (!isLocal(address) && address !== "::ffff:127.0.0.1") return false;
  try {
    return !req.headers.origin || isLocal(new URL(req.headers.origin).hostname);
  } catch {
    return false;
  }
}

let running = false;

export async function transcribeLocalVoice(base64: string): Promise<{ text: string } | { error: string }> {
  const audio = Buffer.from(base64, "base64");
  if (!audio.length || audio.length > LOCAL_VOICE_MAX_BYTES) {
    return { error: "请选择 8 MB 以内的录音。" };
  }
  if (running) return { error: "本机正在转写另一段录音，请稍后重试。" };
  running = true;
  try {
    const model = process.env.BOOK_VIDEO_WHISPER_MODEL || path.join(homedir(), ".cache/whisper/base.pt");
    const output = await new Promise<string>((resolve, reject) => {
      const worker = execFile(process.env.BOOK_VIDEO_PYTHON || "python3", [
        path.resolve("scripts/transcribe-chat-audio.py"), model, String(LOCAL_VOICE_MAX_SECONDS),
      ], { timeout: 150_000, killSignal: "SIGKILL", maxBuffer: 256 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
      // A missing model or an early process exit can close stdin before all bytes are written.
      worker.stdin?.on("error", () => {});
      worker.stdin?.end(audio);
    });
    const result = JSON.parse(output);
    if (typeof result.text === "string") return { text: result.text };
    if (typeof result.error === "string") return { error: result.error };
    throw new Error("Unexpected local transcription result");
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "本机转写未完成，请检查本机语音模型和音频解码环境。" });
  } finally {
    running = false;
  }
}
