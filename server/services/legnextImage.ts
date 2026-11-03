import { downloadLegnextImage } from "./legnextImageDownload";
import { createHash } from "node:crypto";
import { assertComputeRequestAccess } from "./computeRequestAccess";
import { storeImageBytes, type ImageGenResult } from "./imageGen";

const BASE = "https://api.legnext.ai/api";
const PREFIX = "legnext:";
const pending = (id: string): ImageGenResult => ({ status: "error", providerTaskId: id, message: "图片任务已受理，请稍后恢复同一任务，不会重复购买。" });
export const isLegnextReceipt = (id: string) => id.startsWith(PREFIX);

/** Fixed V7 Fast price profile. Never forward model/speed switches from generated prose. */
export function legnextPrompt(text: string) {
  return text.replace(/--(?:version|v|quality|q|ar|aspect)\s+\S+/gi, "")
    .replace(/--(?:turbo|fast|relax|draft|hd)\b/gi, "").trim() + " --v 7 --fast --ar 3:4";
}

export async function resumeLegnextImage(id: string): Promise<ImageGenResult> {
  const job = id.slice(PREFIX.length);
  if (!isLegnextReceipt(id) || !/^[a-f0-9-]{36}$/i.test(job)) return { status: "error", message: "图片任务标识无效" };
  try {
    const response = await fetch(`${BASE}/v1/job/${job}`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return pending(id);
    const task = await response.json();
    if (task.status === "failed") return { status: "error", providerTaskId: id, message: "供应商确认本次图片生成失败，请联系支持核对费用。" };
    if (task.status !== "completed") return pending(id); // retry is a provider-owned, nonterminal state.
    const urls: unknown = task.output?.image_urls;
    if (!Array.isArray(urls) || urls.length !== 4) return pending(id);
    const candidates = [];
    for (const [index, value] of urls.entries()) {
      const url = new URL(String(value));
      if (url.protocol !== "https:" || url.hostname !== "images.sexapi.ai" || url.port || url.username || url.password) return pending(id);
      const bytes = await downloadLegnextImage(url);
      if (bytes.length > 25 * 1024 * 1024 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return pending(id);
      const key = createHash("sha256").update(job).digest("hex");
      const saved = await storeImageBytes(bytes, "image/png", { storageKey: `generated/legnext-${key}-${index}.png` });
      if (!saved.imageUrl) return pending(id);
      candidates.push({ imageUrl: saved.imageUrl, imageKey: saved.imageKey });
    }
    return { status: "ok", ...candidates[0], candidates };
  } catch { return pending(id); } // No raw errors containing capability URLs or credentials.
}

/** `inlinePoll: false` returns right after the receipt is durable; the image task worker fetches the result. */
export async function generateLegnextImage(text: string, onAccepted: (id: string) => Promise<void>, options: { inlinePoll?: boolean } = {}): Promise<ImageGenResult> {
  const key = process.env.LEGNEXT_API_KEY?.trim();
  if (!key) return { status: "error", message: "MJ 新供应商尚未配置，请联系管理员。" };
  const prompt = legnextPrompt(text);
  if (prompt.length > 8192) return { status: "error", message: "图片描述过长，请缩短后再试。" };
  await assertComputeRequestAccess();
  let receipt: string | undefined;
  try {
    // Exactly one POST. Network errors and malformed receipts are not permission to buy again.
    const response = await fetch(`${BASE}/v1/diffusion`, {
      method: "POST", headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: prompt }), redirect: "error", signal: AbortSignal.timeout(45_000),
    });
    if ([400, 401, 403, 402, 422, 429].includes(response.status)) return { status: "error", message: `MJ 供应商拒绝请求（HTTP ${response.status}），请联系管理员核对。` };
    if (!response.ok) throw new Error("unknown");
    const task = await response.json();
    if (typeof task.job_id !== "string" || !/^[a-f0-9-]{36}$/i.test(task.job_id)) throw new Error("unknown");
    receipt = PREFIX + task.job_id;
    await onAccepted(receipt); // Durable before the first poll.
    if (options.inlinePoll === false) return pending(receipt);
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await resumeLegnextImage(receipt);
      if (result.status === "ok" || result.message?.includes("供应商确认")) return result;
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    return pending(receipt);
  } catch {
    return receipt ? pending(receipt) : { status: "error", submissionUncertain: true, message: "图片提交结果暂未确认，请勿重复生成；请联系支持核对。" };
  }
}
