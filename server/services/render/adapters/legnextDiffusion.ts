/** Legnext /v1/diffusion adapter — pure request building and response parsing. */
import { providerErrorFromBody, type ProviderErrorDetail } from "../../providerError";

export const LEGNEXT_BASE = "https://api.legnext.ai/api";
export const LEGNEXT_RECEIPT_PREFIX = "legnext:";
export const LEGNEXT_MAX_PROMPT_CHARS = 8192;

/** Fixed V7 Fast price profile. Never forward model/speed switches from generated prose. */
export function legnextPrompt(text: string, aspectRatio = "3:4") {
  return text.replace(/--(?:version|v|quality|q|ar|aspect)\s+\S+/gi, "")
    .replace(/--(?:turbo|fast|relax|draft|hd)\b/gi, "").trim() + ` --v 7 --fast --ar ${aspectRatio}`;
}

/** Reference URLs and --iw/--oref/--sref are appended exactly like the original inline code. */
export function legnextDiffusionPrompt(input: {
  text: string;
  aspectRatio: "3:4" | "16:9";
  referenceUrls?: string[];
  imageWeight?: number;
  characterRefUrl?: string;
  characterWeight?: number;
  styleRefUrl?: string;
}): string {
  let prompt = legnextPrompt(input.text, input.aspectRatio);
  // Callers de-duplicate their source images before uploading; keep the order given.
  const refs = input.referenceUrls ?? [];
  if (refs.length) prompt = refs.join(" ") + " " + prompt + ` --iw ${input.imageWeight ?? 0.5}`;
  if (input.characterRefUrl) prompt += ` --oref ${input.characterRefUrl} --ow ${input.characterWeight ?? 100}`;
  if (input.styleRefUrl) prompt += ` --sref ${input.styleRefUrl}`;
  return prompt;
}

export function buildLegnextDiffusionRequest(prompt: string): { url: string; body: { text: string } } {
  return { url: `${LEGNEXT_BASE}/v1/diffusion`, body: { text: prompt } };
}

/** HTTP statuses Legnext uses for refusals that never created a job (nothing charged). */
export const LEGNEXT_REFUSAL_STATUSES = [400, 401, 402, 403, 422, 429] as const;

export function parseLegnextSubmit(json: unknown): { receipt: string } | null {
  const jobId = json && typeof json === "object" ? (json as { job_id?: unknown }).job_id : undefined;
  if (typeof jobId !== "string" || !/^[a-f0-9-]{36}$/i.test(jobId)) return null;
  return { receipt: LEGNEXT_RECEIPT_PREFIX + jobId };
}

export type LegnextJobState =
  | { kind: "failed"; providerError: ProviderErrorDetail }
  | { kind: "pending" }
  | { kind: "completed"; imageUrls: unknown[] };

export function parseLegnextJob(task: unknown, editMode?: "retexture"): LegnextJobState {
  const record = task && typeof task === "object" ? (task as { status?: unknown; error?: unknown; output?: { image_urls?: unknown; image_url?: unknown } }) : {};
  if (record.status === "failed") return { kind: "failed", providerError: providerErrorFromBody("legnext", record.error ?? record) };
  if (record.status !== "completed") return { kind: "pending" };
  const urls = record.output?.image_urls ?? (editMode === "retexture" && typeof record.output?.image_url === "string" ? [record.output.image_url] : undefined);
  return Array.isArray(urls) ? { kind: "completed", imageUrls: urls } : { kind: "pending" };
}
