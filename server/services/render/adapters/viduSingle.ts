/** 302 Vidu Q2 Pro Fast (economy shot video) adapter — pure request building. */
export const VIDU_SINGLE_MODEL = "viduq2-pro-fast";
export const VIDU_SINGLE_PATH = "/vidu/ent/v2/img2video";
export const VIDU_SINGLE_POLL_PATH = "/vidu/ent/v2/tasks/{taskId}/creations";
/** Known 302 origin for historical Vidu tasks with no stored host. Not read from the current env. */
export const DEFAULT_302_BASE_URL = "https://api.302.ai";

export function buildViduSingleRequest(input: { baseUrl: string; prompt: string; sourceImage: string; durationSec: number }) {
  return {
    url: `${(input.baseUrl || DEFAULT_302_BASE_URL).replace(/\/+$/, "")}${VIDU_SINGLE_PATH}`,
    body: {
      model: VIDU_SINGLE_MODEL,
      images: [input.sourceImage],
      prompt: input.prompt,
      duration: input.durationSec,
      resolution: "720p",
      audio: false,
    },
  };
}
