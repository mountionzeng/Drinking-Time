import { downloadLegnextImage } from "./legnextImageDownload";
import { createHash } from "node:crypto";
import { assertComputeRequestAccess } from "./computeRequestAccess";
import { storeImageBytes, toPublicImageUrl, type ImageGenResult } from "./imageGen";
import { providerErrorFromBody, shortProviderReason } from "./providerError";
import {
  buildLegnextDiffusionRequest,
  legnextDiffusionPrompt,
  legnextPrompt,
  LEGNEXT_BASE as BASE,
  LEGNEXT_MAX_PROMPT_CHARS,
  LEGNEXT_RECEIPT_PREFIX as PREFIX,
  LEGNEXT_REFUSAL_STATUSES,
  parseLegnextJob,
  parseLegnextSubmit,
} from "./render/adapters/legnextDiffusion";
export { legnextPrompt } from "./render/adapters/legnextDiffusion";
const pending = (id: string): ImageGenResult => ({ status: "error", errorCode: "timeout_pending", providerTaskId: id, message: "图片任务已受理，请稍后恢复同一任务，不会重复购买。" });
export const isLegnextReceipt = (id: string) => id.startsWith(PREFIX);


export async function resumeLegnextImage(id: string, editMode?: "retexture"): Promise<ImageGenResult> {
  const jobId = id.slice(PREFIX.length);
  if (!isLegnextReceipt(id) || !/^[a-f0-9-]{36}$/i.test(jobId)) return { status: "error", message: "图片任务标识无效" };
  try {
    const response = await fetch(`${BASE}/v1/job/${jobId}`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return pending(id);
    const task = await response.json();
    const job = parseLegnextJob(task, editMode);
    if (job.kind === "failed") {
      const providerError = job.providerError;
      const invalidPrompt = /Invalid_Prompt_Parameter|invalid prompt parameter/i.test(String(task.error?.raw_message ?? task.error?.message ?? ""));
      const reason = shortProviderReason(providerError);
      return { status: "error", providerTaskId: id, providerError, message: invalidPrompt
        ? "供应商确认本次图片生成失败：MJ 拒绝了精修参数，未生成图片。原图保留，没有自动重试。"
        : `供应商确认本次图片生成失败${reason ? `（${reason}）` : ""}，请联系支持核对费用。` };
    }
    if (job.kind === "pending") return pending(id);
    const urls = job.imageUrls;
    if (editMode === "retexture" ? urls.length < 1 || urls.length > 4 : urls.length !== 4) return pending(id);
    // Validate the entire batch before downloading. Four independent candidates
    // can arrive together; waiting for each CDN transfer added four latencies.
    const imageUrls = urls.map(value => {
      const url = new URL(String(value));
      if (url.protocol !== "https:" || url.hostname !== "images.sexapi.ai" || url.port || url.username || url.password) throw new Error("Unexpected image host");
      return url;
    });
    const key = createHash("sha256").update(jobId).digest("hex");
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

export const LEGNEXT_RETEXTURE_MAX_PROMPT_CHARS = 1000;

/** Retexture has its own editor. Follow its minimal documented payload: prose only, without diffusion model/speed flags. */
export function legnextRetexturePrompt(text: string) {
  return text.replace(/--[a-z][\w-]*(?:\s+(?!--)\S+)?/gi, "").replace(/\s+/g, " ").trim();
}

/** Printable ASCII only (space..~). Retexture prompts with anything else are not submitted. */
export function isPlainAsciiPrompt(text: string) {
  return /^[\x20-\x7E]*$/.test(text);
}

/** `inlinePoll: false` returns right after the receipt is durable; the image task worker fetches the result. */
export type LegnextOptions = { editMode?: "retexture"; inlinePoll?: boolean; aspectRatio?: string; referenceImageUrl?: string; referenceContextImageUrls?: string[]; characterRef?: string; styleRef?: string; characterWeight?: number; imageWeight?: number };
export async function generateLegnextImage(text: string, onAccepted: (id: string) => Promise<void>, options: LegnextOptions = {}): Promise<ImageGenResult> {
  const key = process.env.LEGNEXT_API_KEY?.trim();
  if (!key) return { status: "error", message: "MJ 新供应商尚未配置，请联系管理员。" };
  const retexture = options.editMode === "retexture";
  if (retexture && (!options.referenceImageUrl || options.referenceContextImageUrls?.length || options.characterRef || options.styleRef))
    return { status: "error", message: "原图精修需要唯一底图，不能混入其他参考图。本次未提交。" };
  // Retexture retains the uploaded canvas; do not impose the old 16:9 diffusion preset.
  let prompt = retexture
    ? legnextRetexturePrompt(text)
    : legnextPrompt(text, options.aspectRatio === "16:9" ? "16:9" : "3:4");
  if (retexture && prompt.length > LEGNEXT_RETEXTURE_MAX_PROMPT_CHARS)
    return { status: "error", message: `原图精修描述超过 ${LEGNEXT_RETEXTURE_MAX_PROMPT_CHARS} 字，本次未提交。请缩短修改要求后再试。` };
  // Never strip characters silently: a non-ASCII remixPrompt (Chinese, full-width punctuation) is refused before the paid POST.
  if (retexture && !isPlainAsciiPrompt(prompt))
    return { status: "error", message: "MJ 原图精修目前只接受纯英文提示词（不能含中文或全角标点），本次未提交。" };
  let baseImageUrl: string | undefined;
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
    if (retexture) baseImageUrl = uploaded.get(options.referenceImageUrl!);
    if (!retexture) {
    prompt = legnextDiffusionPrompt({
      text,
      aspectRatio: options.aspectRatio === "16:9" ? "16:9" : "3:4",
      referenceUrls: [...new Set(refs)].map(source => uploaded.get(source)!),
      imageWeight: options.imageWeight,
      characterRefUrl: options.characterRef ? uploaded.get(options.characterRef) : undefined,
      characterWeight: options.characterWeight,
      styleRefUrl: options.styleRef ? uploaded.get(options.styleRef) : undefined,
    });
    }
  } catch {
    return { status: "error", message: "参考图暂时无法上传到模型可读取的位置，请稍后重试。本次没有提交图片任务。" };
  }
  if (prompt.length > LEGNEXT_MAX_PROMPT_CHARS) return { status: "error", message: "图片描述过长，请缩短后再试。" };
  await assertComputeRequestAccess();
  let receipt: string | undefined;
  try {
    // Exactly one POST. Network errors and malformed receipts are not permission to buy again.
    const request = retexture ? { url: `${BASE}/v1/retexture`, body: { imgUrl: baseImageUrl, remixPrompt: prompt } } : buildLegnextDiffusionRequest(prompt);
    const response = await fetch(request.url, {
      method: "POST", headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(request.body), redirect: "error", signal: AbortSignal.timeout(45_000),
    });
    if ((LEGNEXT_REFUSAL_STATUSES as readonly number[]).includes(response.status)) {
      const providerError = providerErrorFromBody("legnext", await response.json().catch(() => null), response.status);
      return { status: "error", providerError, message: `MJ 供应商拒绝请求（${shortProviderReason(providerError)}），请联系管理员核对。` };
    }
    if (!response.ok) throw new Error("unknown");
    const accepted = parseLegnextSubmit(await response.json());
    if (!accepted) throw new Error("unknown");
    receipt = accepted.receipt;
    await onAccepted(receipt); // Durable before the first poll.
    if (options.inlinePoll === false) return pending(receipt);
    const deadline = Date.now() + 90_000;
    for (let attempt = 0; attempt < 12 && Date.now() < deadline; attempt++) {
      const result = await resumeLegnextImage(receipt, options.editMode);
      if (result.status === "ok" || result.message?.includes("供应商确认")) return result;
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    return pending(receipt);
  } catch {
    return receipt ? pending(receipt) : { status: "error", submissionUncertain: true, message: "图片提交结果暂未确认，请勿重复生成；请联系支持核对。" };
  }
}
