import { ENV } from "../_core/env";
import { estimateShotVideoCost } from "../../shared/shotDirector";
import { guardComputeFetch, ComputeAccessError } from "./computeRequestAccess";
import { refreshViduTransition, viduSubmissionStateForHttpStatus } from "./videoTransition302";
import type { ShotVideoSubmitResult, ShotVideoTaskRefreshResult } from "./videoGen";

export const VIDU_SINGLE_MODEL = "viduq2-pro-fast";
export const VIDU_SINGLE_PATH = "/vidu/ent/v2/img2video";

export async function submitViduSingleVideo(input: { prompt: string; sourceImage: string; durationSec: number },
  options: { fetcher?: typeof fetch } = {}): Promise<ShotVideoSubmitResult> {
  try {
    estimateShotVideoCost({ durationSec: input.durationSec, motion: "low", priceProfile: "vidu-economy" });
    if (!ENV.api302Key) throw new Error("视频服务尚未配置");
    if (!input.sourceImage.trim()) throw new Error("请先选择当前镜头图片");
    if (!input.prompt.trim() || input.prompt.length > 2000) throw new Error("经济视频要求须为1至2000个字符，请精简后提交");
  } catch (error) {
    return { status: "error", submissionState: "not_submitted", message: error instanceof Error ? error.message : "视频参数无效" };
  }
  const body = { model: VIDU_SINGLE_MODEL, images: [input.sourceImage], prompt: input.prompt,
    duration: input.durationSec, resolution: "720p", audio: false };
  const url = `${(ENV.api302BaseUrl || "https://api.302.ai").replace(/\/+$/, "")}${VIDU_SINGLE_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await guardComputeFetch(options.fetcher ?? globalThis.fetch)(url, {
      method: "POST", headers: { Authorization: `Bearer ${ENV.api302Key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const json = await response.json() as { task_id?: string; err_code?: string; message?: string };
    if (!response.ok) return { status: "error", message: json.message || `经济视频提交失败 HTTP ${response.status}`,
      submissionState: viduSubmissionStateForHttpStatus(response.status) };
    if (typeof json.task_id !== "string" || !json.task_id.trim()) return { status: "error", submissionState: "unknown",
      message: "经济视频未返回任务编号，已停止自动重试，请核对任务" };
    return { status: "ok", taskId: json.task_id, prompt: input.prompt, submitUrl: url, submittedParameters: body };
  } catch (error) {
    return { status: "error", submissionState: error instanceof ComputeAccessError ? "not_submitted" : "unknown",
      message: error instanceof Error ? error.message : "经济视频提交结果未知" };
  } finally { clearTimeout(timer); }
}

/** Read the existing receipt only. A temporary query failure must not trigger a new purchase. */
export async function refreshViduSingleVideo(taskId: string, options: { fetcher?: typeof fetch } = {}): Promise<ShotVideoTaskRefreshResult> {
  const result = await refreshViduTransition(taskId, options);
  if (result.status === "available" || result.status === "processing") return result;
  return { status: result.status === "task_failed" ? "failed" : "timeout", taskId, message: result.message };
}
