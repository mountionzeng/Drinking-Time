import { ENV } from "../_core/env";
import { assertComputeRequestAccess } from "./computeRequestAccess";
import { toPublicImageUrl, resume302MidjourneyTask, type ImageGenResult } from "./imageGen";
import { legnextRetexturePrompt } from "./legnextImage";

const pending = (id: string): ImageGenResult => ({ status: "error", errorCode: "timeout_pending", providerTaskId: id,
  message: "302 MJ 编辑任务已受理，正在取回原任务；不会重复购买。" });

/** Official external-image edit, not Imagine with an image prompt. Exactly one POST. */
export async function generate302MjEdit(image: string, text: string, onAccepted: (id: string) => Promise<void>): Promise<ImageGenResult> {
  if (!ENV.api302Key) return { status: "error", message: "302 MJ 尚未配置，本次未提交。" };
  const prompt = legnextRetexturePrompt(text);
  if (!image || !prompt || prompt.length > 8192) return { status: "error", message: "原图或修改要求无效，本次未提交。" };
  let publicImage: string | undefined;
  try { publicImage = await toPublicImageUrl(image); } catch { /* fail closed before purchase */ }
  if (!publicImage?.startsWith("https://")) return { status: "error", message: "参考图上传失败，本次未提交图片任务。" };
  await assertComputeRequestAccess();
  let receipt: string | undefined;
  try {
    const response = await fetch(new URL("/mj/submit/edits", ENV.api302BaseUrl), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${ENV.api302Key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, image: publicImage }),
    });
    if (response.status === 404)
      return { status: "error", message: "302 MJ 原图编辑地址不可用（HTTP 404）。本次未收到任务号；原图保留，未自动重试。" };
    if ([400, 401, 402, 403, 422, 429].includes(response.status))
      return { status: "error", message: `302 MJ 编辑接口拒绝请求（HTTP ${response.status}），未自动重试。` };
    if (!response.ok) throw new Error("Uncertain submission");
    const result = await response.json();
    const exactId = typeof result.result === "string" || Number.isSafeInteger(result.result);
    if ([1, 22].includes(result.code) && exactId && /^(?:\d+|[a-f\d-]{36})$/i.test(String(result.result ?? ""))) {
      receipt = String(result.result);
      await onAccepted(receipt);
      return pending(receipt);
    }
    // Only a documented business refusal proves no task exists; malformed responses remain unknown.
    if (typeof result.code === "number" && ![1, 22].includes(result.code) && !result.result)
      return { status: "error", message: `302 MJ 未受理本次编辑（状态 ${result.code}），原图保留，没有自动重试。` };
    throw new Error("Uncertain receipt");
  } catch {
    return receipt ? pending(receipt) : { status: "error", submissionUncertain: true,
      message: "302 MJ 提交结果暂未确认，请核对原任务，不要重复购买。" };
  }
}

export async function resume302MjEdit(id: string): Promise<ImageGenResult> {
  const result = await resume302MidjourneyTask(id, { mjTimeoutMs: 8000, mjPollIntervalMs: 1000 });
  if (result.status === "ok") return result;
  if (result.providerConfirmedFailure) return { status: "error", providerTaskId: id, providerConfirmedFailure: true,
    message: "302 MJ 确认本次编辑失败。原图保留，没有自动重试。" };
  return pending(id); // Poll/download errors never become permission to repurchase.
}
