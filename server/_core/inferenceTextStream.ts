import type { InvokeResult } from "./llm";

/** Only user-visible text is forwarded. Usage belongs to the same streamed request. */
export async function readInferenceTextStream(response: Response, model: string, onText: (text: string) => void, claude = false): Promise<InvokeResult> {
  if (!response.body) throw Error("Empty completion stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", data: string[] = [], content = "", id = "", finish: string | null = null, complete = false;
  let usage: InvokeResult["usage"];
  let inputTokens: number | undefined, outputTokens: number | undefined;
  function packet() {
    if (!data.length) return;
    const payload = data.join("\n");
    data = [];
    if (payload === "[DONE]") { complete = true; return; }
    const event = JSON.parse(payload);
    if (event.error || event.type === "error") throw Error("Completion stream interrupted");
    let delta;
    if (claude) {
      if (event.type === "message_start") {
        id = event.message.id; model = event.message.model ?? model;
        const u = event.message.usage;
        if (u && Number.isSafeInteger(u.input_tokens)) inputTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      }
      if (event.type === "content_block_start" && event.content_block?.type === "text") delta = event.content_block.text;
      if (event.delta?.type === "text_delta") delta = event.delta.text;
      if (event.type === "message_delta") { finish = event.delta?.stop_reason ?? finish; outputTokens = event.usage?.output_tokens ?? outputTokens; }
      if (event.type === "message_stop") complete = true;
    } else {
      const choice = event.choices?.find((c: {index?: number}) => (c.index ?? 0) === 0);
      id = event.id ?? id; model = event.model ?? model;
      delta = choice?.delta?.content; finish = choice?.finish_reason ?? finish;
      if (event.usage) usage = event.usage;
    }
    if (typeof delta === "string" && delta) {
      content += delta;
      if (content.length > 1_000_000) throw Error("Completion stream exceeded size limit");
      onText(delta);
    }
  }
  try {
    while (!complete) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000) throw Error("Completion event exceeded size limit");
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop()!;
      for (const raw of lines) {
        const line = raw.replace(/\r$/, "");
        if (!line) packet();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (done) { packet(); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!complete && !(finish && usage && !claude)) throw Error("Incomplete completion stream");
  if (inputTokens !== undefined && outputTokens !== undefined && Number.isSafeInteger(inputTokens) && Number.isSafeInteger(outputTokens))
    usage = { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens };
  return { id, model, created: Math.floor(Date.now() / 1000), choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }], usage };
}
