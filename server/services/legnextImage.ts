import { downloadLegnextImage } from "./legnextImageDownload";
import { createHash } from "node:crypto";
import { assertComputeRequestAccess } from "./computeRequestAccess";
import { storeImageBytes, toPublicImageUrl, type ImageGenResult } from "./imageGen";

const BASE = "https://api.legnext.ai/api";
const PREFIX = "legnext:";
const pending = (id: string): ImageGenResult => ({ status: "error", errorCode: "timeout_pending", providerTaskId: id, message: "图片任务已受理，请稍后恢复同一任务，不会重复购买。" });
export const isLegnextReceipt = (id: string) => id.startsWith(PREFIX);

/** Fixed V7 Fast price profile. Never forward model/speed switches from generated prose. */
export function legnextPrompt(text: string, aspectRatio = "3:4") {
  return text.replace(/--(?:version|v|quality|q|ar|aspect)\s+\S+/gi, "")
    .replace(/--(?:turbo|fast|relax|draft|hd)\b/gi, "").trim() + ` --v 7 --fast --ar ${aspectRatio}`;
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
    // Validate the entire batch before downloading. Four independent candidates
    // can arrive together; waiting for each CDN transfer added four latencies.
    const imageUrls = urls.map(value => {
      const url = new URL(String(value));
      if (url.protocol !== "https:" || url.hostname !== "images.sexapi.ai" || url.port || url.username || url.password) throw new Error("Unexpected image host");
      return url;
    });
    const key = createHash("sha256").update(job).digest("hex");
    const outputs = await Promise.allSettled(imageUrls.map(async (url, index) => {
      const bytes = await downloadLegnextImage(url);
      if (bytes.length > 25 * 1024 * 1024 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error("Invalid image");
      const saved = await storeImageBytes(bytes, "image/png", { storageKey: `generated/legnext-${key}-${index}.png` });
      if (!saved.imageUrl) throw new Error("Image not saved");
      return { imageUrl: saved.imageUrl, imageKey: saved.imageKey };
    }));
    // Drain every transfer before releasing the task lease, including failures.
    if (outputs.some(output => output.status === "rejected")) return pending(id);
    const candidates = outputs.flatMap(output => output.status === "fulfilled" ? [output.value] : []);
    return { status: "ok", ...candidates[0], candidates, providerTaskId: id };
  } catch { return pending(id); } // No raw errors containing capability URLs or credentials.
}

/** `inlinePoll: false` returns right after the receipt is durable; the image task worker fetches the result. */
type LegnextOptions = { inlinePoll?: boolean; aspectRatio?: string; referenceImageUrl?: string; referenceContextImageUrls?: string[]; characterRef?: string; styleRef?: string; characterWeight?: number; imageWeight?: number };
export async function generateLegnextImage(text: string, onAccepted: (id: string) => Promise<void>, options: LegnextOptions = {}): Promise<ImageGenResult> {
  const key = process.env.LEGNEXT_API_KEY?.trim();
  if (!key) return { status: "error", message: "MJ 新供应商尚未配置，请联系管理员。" };
  let prompt = legnextPrompt(text, options.aspectRatio === "16:9" ? "16:9" : "3:4");
  try {
    const refs = [options.referenceImageUrl, ...(options.referenceContextImageUrls ?? [])].filter((v): v is string => Boolean(v));
    const sources = [...new Set([...refs, options.characterRef, options.styleRef].filter((v): v is string => Boolean(v)))];
    // One image commonly supplies both composition and style. Upload it once,
    // and prepare distinct references concurrently before the single paid POST.
    const uploaded = new Map(await Promise.all(sources.map(async source => {
      const url = await toPublicImageUrl(source);
      if (!url || !/^https:\/\//i.test(url)) throw new Error("参考图上传未返回可读取的 HTTPS 地址");
      return [source, url] as const;
    })));
    if (refs.length) prompt = [...new Set(refs)].map(source => uploaded.get(source)!).join(" ") + " " + prompt + ` --iw ${options.imageWeight ?? 0.5}`;
    if (options.characterRef) prompt += ` --oref ${uploaded.get(options.characterRef)} --ow ${options.characterWeight ?? 100}`;
    if (options.styleRef) prompt += ` --sref ${uploaded.get(options.styleRef)}`;
  } catch {
    return { status: "error", message: "参考图暂时无法上传到模型可读取的位置，请稍后重试。本次没有提交图片任务。" };
  }
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
    const deadline = Date.now() + 90_000;
    for (let attempt = 0; attempt < 12 && Date.now() < deadline; attempt++) {
      const result = await resumeLegnextImage(receipt);
      if (result.status === "ok" || result.message?.includes("供应商确认")) return result;
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    return pending(receipt);
  } catch {
    return receipt ? pending(receipt) : { status: "error", submissionUncertain: true, message: "图片提交结果暂未确认，请勿重复生成；请联系支持核对。" };
  }
}
