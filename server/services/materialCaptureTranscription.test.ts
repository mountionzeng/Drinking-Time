import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../_core/env", () => ({ENV:{doubaoSpeechApiKey:"test-key"}}));
import { submitCaptureTranscription, queryCaptureTranscription } from "./materialCaptureTranscription";
afterEach(() => vi.unstubAllGlobals());
const reply = (code:string, body:unknown={}) => new Response(JSON.stringify(body),{headers:{"X-Api-Status-Code":code}});
describe("capture standard ASR", () => {
  it("submits private inline audio once and queries the same durable id", async () => {
    const fetcher=vi.fn().mockResolvedValueOnce(reply("20000000")).mockResolvedValueOnce(reply("20000002")).mockResolvedValueOnce(reply("20000000",{result:{text:"纸船"}}));
    vi.stubGlobal("fetch",fetcher);
    await submitCaptureTranscription("durable-id",Buffer.from("audio"),"audio/mp4");
    expect(await queryCaptureTranscription("durable-id")).toBeNull();
    expect(await queryCaptureTranscription("durable-id")).toBe("纸船");
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(expect.arrayContaining([expect.stringContaining("/submit"),expect.stringContaining("/query")]));
    expect(fetcher.mock.calls.filter(c=>c[0].endsWith("/submit"))).toHaveLength(1);
    for(const [,init] of fetcher.mock.calls) expect(init.headers["X-Api-Request-Id"]).toBe("durable-id");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).audio).toEqual({format:"m4a",data:Buffer.from("audio").toString("base64")});
  });
  it("does not invent success on denied or empty results",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(reply("45000000")).mockResolvedValueOnce(reply("20000000",{result:{text:""}})));
    await expect(queryCaptureTranscription("same-id")).rejects.toThrow();
    await expect(queryCaptureTranscription("same-id")).rejects.toThrow();
  });
});
