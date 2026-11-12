import { ENV } from "../_core/env";
import { assertComputeRequestAccess } from "./computeRequestAccess";
import { materializeImageInput } from "./imageAssets";
import { storeImageBytes, toPublicImageUrl, type ImageGenResult } from "./imageGen";

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
const pending = (id: string): ImageGenResult => ({ status: "error", errorCode: "timeout_pending", providerTaskId: id,
  message: "FLUX Kontext Pro 已受理，正在取回原任务；不会重复购买。 / Retrieving the accepted edit; no new purchase." });

const resultPending = (url: string): ImageGenResult => ({status:"error",errorCode:"timeout_pending",providerResultUrl:url,
  message:"图片已生成，正在保存到仓库；不会重复购买。 / Image generated; saving to Warehouse without repurchasing."});

function safeOutputUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (["file.302.ai", "storage.fonedis.cc"].includes(url.hostname) || /\.(?:bfl\.ai|bfl\.ml)$/.test(url.hostname));
  } catch { return false; }
}

async function refusal(response: Response): Promise<ImageGenResult> {
  // Preserve status and numeric provider code, never echo prompt, credentials or arbitrary provider prose.
  const body = await response.json().catch(() => null);
  const code = body?.error?.err_code ?? body?.err_code;
  const detail = `HTTP ${response.status}${Number.isSafeInteger(code) ? ` / ${code}` : ""}`;
  const definite = [400,401,402,403,404,422,429].includes(response.status);
  return {status:"error", ...(!definite ? {submissionUncertain:true} : {}),
    message: definite ? `FLUX 编辑请求被拒绝（${detail}），没有自动重试。 / Edit rejected; no automatic retry.`
      : `FLUX 提交结果未确认（${detail}），请核对原任务，勿重复购买。 / Submission uncertain; check the original request.`};
}

/** Documented 0.03 PTC synchronous editor. Persist the output URL before any download. */
export async function generate302FluxDevEdit(image: string, prompt: string, onReady: (url: string) => Promise<void>): Promise<ImageGenResult> {
  if (!ENV.api302Key || !image || !prompt.trim() || prompt.length > 16_000)
    return {status:"error",message:"原图、要求或302配置无效，本次未提交。 / Invalid edit input; not submitted."};
  let original: string | undefined;
  try { original = await toPublicImageUrl(image); } catch { /* fail before purchasing */ }
  if (!original?.startsWith("https://")) return {status:"error",message:"原图上传失败，本次未提交。 / Original upload failed; not submitted."};
  await assertComputeRequestAccess();
  let output: string | undefined;
  try {
    const response = await fetch(new URL("/302/submit/flux-kontext-dev", ENV.api302BaseUrl), {
      method:"POST",redirect:"error",signal:AbortSignal.timeout(180_000),
      headers:{Authorization:`Bearer ${ENV.api302Key}`,"Content-Type":"application/json"},
      body:JSON.stringify({image_url:original,prompt,output_format:"png"}),
    });
    if (!response.ok) return await refusal(response);
    const payload = await response.json();
    if (!safeOutputUrl(payload?.images?.[0]?.url)) throw new Error("Missing safe output");
    output = payload.images[0].url;
    await onReady(output!);
    return resultPending(output!);
  } catch {
    return output ? resultPending(output) : {status:"error",submissionUncertain:true,
      message:"FLUX Dev 提交结果未确认，请核对原请求，不会自动重购。 / Submission uncertain; no automatic repurchase."};
  }
}

export async function resume302FluxResult(url: string, id: string): Promise<ImageGenResult> {
  if (!safeOutputUrl(url) || !validId(id)) return resultPending(url);
  try {
    const output = await fetch(url, {method:"GET",redirect:"error",signal:AbortSignal.timeout(30_000)});
    const mime = output.headers.get("content-type")?.split(";")[0].trim();
    if (!output.ok || !mime || !["image/png","image/jpeg","image/webp"].includes(mime)) return resultPending(url);
    const bytes = new Uint8Array(await output.arrayBuffer());
    if (!bytes.length || bytes.length > 25*1024*1024) return resultPending(url);
    const extension = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
    return await storeImageBytes(bytes,mime,{storageKey:`generated/flux-kontext/${id}.${extension}`,requireLocal:true});
  } catch { return resultPending(url); }
}

/** Official 0.04 PTC BFL route; exactly one original-image edit, no hidden vision/expansion/fallback. */
export async function generate302FluxEdit(image: string, prompt: string, onAccepted: (id: string) => Promise<void>): Promise<ImageGenResult> {
  if (!ENV.api302Key || !image || !prompt.trim() || prompt.length > 16_000)
    return { status: "error", message: "FLUX 原图或修改要求无效，或302未配置；本次未提交。 / Edit not submitted: check source, instruction and configuration." };
  let original: string;
  try {
    original = await materializeImageInput(image);
    if (!/^(?:data:image\/(?:png|jpeg|webp);base64,|https:\/\/)/.test(original)) throw new Error("Invalid original");
  } catch {
    return { status: "error", message: "原图读取失败，本次未提交。 / Original unavailable; no edit submitted." };
  }
  await assertComputeRequestAccess();
  let receipt: string | undefined;
  try {
    const response = await fetch(new URL("/flux/v1/flux-kontext-pro", ENV.api302BaseUrl), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${ENV.api302Key}`, "Content-Type": "application/json" },
      // Omit aspect_ratio so the source framing is retained. No style or content expansion.
      body: JSON.stringify({ input_image: original, prompt, prompt_upsampling: false, output_format: "png" }),
    });
    if (!response.ok) return await refusal(response);
    const result = await response.json();
    const acceptedId: unknown = result?.id;
    if (!validId(acceptedId)) throw new Error("Uncertain receipt");
    receipt = acceptedId;
    await onAccepted(acceptedId);
    return pending(acceptedId);
  } catch {
    return receipt ? pending(receipt) : { status: "error", submissionUncertain: true,
      message: "FLUX 提交结果暂未确认，请核对原任务，不要重复购买。 / Submission uncertain; check the original task before retrying." };
  }
}

/** Polling and downloading never resubmit. Only an explicit provider terminal status ends recovery. */
export async function resume302FluxEdit(id: string): Promise<ImageGenResult> {
  if (!validId(id)) return { status: "error", message: "FLUX任务号无效，未提交新任务。 / Invalid task ID; no new task submitted." };
  try {
    const endpoint = new URL("/flux/v1/get_result", ENV.api302BaseUrl);
    endpoint.searchParams.set("id", id);
    const response = await fetch(endpoint, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${ENV.api302Key}` } });
    if (!response.ok) return pending(id);
    const payload = await response.json();
    if (payload?.id !== id) return pending(id);
    if (["Error", "Request Moderated", "Content Moderated"].includes(payload.status))
      return { status: "error", providerTaskId: id, providerConfirmedFailure: true,
        message: "FLUX 确认本次编辑未成功。原图保留，没有自动重试。 / Provider confirmed the edit failed. Original retained; no automatic retry." };
    if (payload.status !== "Ready" || typeof payload.result?.sample !== "string") return pending(id);
    const url = new URL(payload.result.sample);
    const allowedHost = ["file.302.ai", "storage.fonedis.cc"].includes(url.hostname) || /\.(?:bfl\.ai|bfl\.ml)$/.test(url.hostname);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !allowedHost) return pending(id);
    // Never forward the 302 credential to a result URL; do not follow unvalidated redirects.
    const output = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000) });
    const mime = output.headers.get("content-type")?.split(";")[0].trim();
    if (!output.ok || !mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) return pending(id);
    const bytes = new Uint8Array(await output.arrayBuffer());
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) return pending(id);
    const extension = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
    return await storeImageBytes(bytes, mime, { storageKey: `generated/flux-kontext/${id}.${extension}`, requireLocal: true });
  } catch { return pending(id); }
}
