/** 302 flux-schnell draft adapter — pure request building. */
export function buildFluxSchnellDraftRequest(input: {
  baseUrl: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
}): { url: string; body: Record<string, unknown> } {
  const url = new URL(`/302/submit/${encodeURIComponent(input.model)}`, `${input.baseUrl.replace(/\/+$/, "")}/`);
  return {
    url: url.toString(),
    body: {
      prompt: input.prompt,
      image_size: input.aspectRatio === "3:4" ? { width: 768, height: 1024 } : { width: 1024, height: 1024 },
      num_inference_steps: 4,
    },
  };
}
