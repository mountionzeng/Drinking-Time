import { ENV } from "../_core/env";
import { guardComputeFetch } from "./computeRequestAccess";

const endpoint = "https://openspeech.bytedance.com/api/v3/auc/bigmodel";
function headers(id: string) {
  if (!ENV.doubaoSpeechApiKey) throw new Error("录音转写服务未配置");
  return { "Content-Type": "application/json", "X-Api-Key": ENV.doubaoSpeechApiKey,
    "X-Api-Resource-Id": "volc.seedasr.auc", "X-Api-Request-Id": id };
}
/** Caller persists id BEFORE submission. An ambiguous submission is only queried, never replayed. */
export async function submitCaptureTranscription(id: string, bytes: Buffer, mime: string) {
  const format = ({ "audio/mpeg":"mp3", "audio/mp4":"m4a", "audio/wav":"wav", "audio/webm":"webm", "audio/ogg":"ogg" } as Record<string,string>)[mime];
  if (!format) throw new Error("不支持的录音格式");
  const response = await guardComputeFetch(fetch)(`${endpoint}/submit`, { method:"POST", headers: {...headers(id), "X-Api-Sequence":"-1"}, signal:AbortSignal.timeout(20_000),
    body:JSON.stringify({ user:{uid:"material-capture"}, audio:{format,data:bytes.toString("base64")}, request:{model_name:"bigmodel"} }) });
  if (!response.ok || response.headers.get("X-Api-Status-Code") !== "20000000") throw new Error("录音提交未确认");
}
export async function queryCaptureTranscription(id: string): Promise<string | null> {
  // Querying an existing task does not submit paid work.
  const response = await fetch(`${endpoint}/query`, {method:"POST",headers:headers(id),body:"{}",signal:AbortSignal.timeout(15_000)});
  const code = response.headers.get("X-Api-Status-Code");
  if (code === "20000001" || code === "20000002") return null;
  if (!response.ok || code !== "20000000") throw new Error("录音查询未完成");
  const body = await response.json() as {result?:{text?:unknown}};
  if (typeof body.result?.text !== "string" || !body.result.text.trim()) throw new Error("录音没有识别出文字");
  return body.result.text;
}
