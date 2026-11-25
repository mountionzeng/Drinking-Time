import { expect, it } from "vitest";
import { readInferenceTextStream } from "../_core/inferenceTextStream";
import { beginLiveManuscript, liveManuscripts } from "./liveManuscript";

it("exposes the actual half-written shot before completion, within its story and account", async () => {
  const scope = { userId: 4, storyId: 22 };
  const live = beginLiveManuscript(scope, "sample", "storyboard");
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream({ start(c) { stream = c; } }));
  const data = (event: unknown) => new TextEncoder().encode("data: " + JSON.stringify(event) + "\r\n\r\n");
  const run = readInferenceTextStream(response, "test", live.append);
  const first = '{"chapters":[{"title":"车站","modules":[{"format":"shot","text":"两把伞"},{"format":"text","text":"父亲挪';
  const bytes = data({ choices: [{ index: 0, delta: { content: first, reasoning_content: "private" } }] });
  for (const byte of bytes) stream.enqueue(Uint8Array.of(byte));
  await expect.poll(() => liveManuscripts(scope)[0].lines.at(-1)?.text).toBe("父亲挪");
  expect(liveManuscripts({ ...scope, userId: 5 })).toEqual([]);
  expect(liveManuscripts({ ...scope, storyId: 21 })).toEqual([]);
  stream.enqueue(data({ choices: [{ index: 0, delta: { content: '了挪伞。"}]}]}' }, finish_reason: "stop" }] }));
  stream.enqueue(data({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
  stream.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); stream.close();
  expect((await run).usage?.total_tokens).toBe(30);
  expect(liveManuscripts(scope)[0].lines.map(l=>l.text)).toEqual(["车站","两把伞","父亲挪了挪伞。"]);
  live.fail(); expect(liveManuscripts(scope)).toEqual([]);
});

it("normalizes Claude text and cached input usage and rejects a truncated response", async () => {
  const events = [
    { type:"message_start", message: { id:"i", model:"test", usage:{ input_tokens:10, cache_read_input_tokens:4 } } },
    { type:"content_block_delta", delta:{ type:"thinking_delta", thinking:"private" } },
    { type:"content_block_delta", delta:{ type:"text_delta", text:"正文" } },
    { type:"message_delta", delta:{stop_reason:"end_turn"}, usage:{output_tokens:3} }, {type:"message_stop"},
  ];
  const res = (n: number) => new Response(events.slice(0,n).map(e=>"data: "+JSON.stringify(e)+"\n\n").join(""));
  const text: string[] = [];
  const result = await readInferenceTextStream(res(5), "test", t=>text.push(t), true);
  expect(text).toEqual(["正文"]); expect(result.usage?.total_tokens).toBe(17);
  await expect(readInferenceTextStream(res(3), "test", ()=>{}, true)).rejects.toThrow("Incomplete");
});

it("exposes prose fields only and replaces the running draft with the validated result", () => {
  const scope={userId:1,storyId:3}, job=beginLiveManuscript(scope,"v","text");
  job.append('{"observation":{"note":"private"},"draft":{"title":"伞","body":"雨停');
  expect(liveManuscripts(scope)[0].lines.map(l=>l.text)).toEqual(["伞","雨停"]);
  job.finishText({title:"伞",body:"雨停了。"});
  expect(liveManuscripts(scope)[0]).toMatchObject({complete:true,lines:[{text:"伞"},{text:"雨停了。"}]});
  job.fail();
});

it("shows the original shot number during a single-shot revision and hides reasoning", () => {
  const scope = { userId: 3, storyId: 40 };
  const job = beginLiveManuscript(scope, "shot", "storyboard", { shotNo: 4 });
  job.append("<think>private");
  expect(liveManuscripts(scope)[0].lines).toEqual([]);
  job.append("</think>风声渐弱。");
  expect(liveManuscripts(scope)[0]).toMatchObject({ shotNo: 4, lines: [{ text: "风声渐弱。" }] });
  job.fail();
});
