import { describe, expect, it } from "vitest";
import { log302FileUrl, redact302FileUrl } from "./provider302FileUrlLog";

describe("302 file url log", () => {
  it("keeps only host and path, dropping query and fragment", () => {
    expect(
      redact302FileUrl("https://file.302.ai/gpt/imgs/a/b.mp3?sig=SECRET&token=x#f")
    ).toBe("https://file.302.ai/gpt/imgs/a/b.mp3");
  });

  it("ignores non-urls and other protocols", () => {
    expect(redact302FileUrl("")).toBeNull();
    expect(redact302FileUrl(42)).toBeNull();
    expect(redact302FileUrl("not a url")).toBeNull();
    expect(redact302FileUrl("data:audio/mp3;base64,AAAA")).toBeNull();
  });

  it("logs with the [302-file-url] prefix and never leaks secrets", () => {
    const lines: string[] = [];
    log302FileUrl("audio", "https://file.302ai.cn/x/y.mp3?Signature=abc", l => lines.push(l));
    log302FileUrl("image", null, l => lines.push(l));
    expect(lines).toEqual(["[302-file-url] kind=audio url=https://file.302ai.cn/x/y.mp3"]);
    expect(lines.join()).not.toContain("abc");
  });

  it("swallows logger failures", () => {
    expect(() =>
      log302FileUrl("video", "https://file.302.ai/v.mp4", () => {
        throw new Error("boom");
      })
    ).not.toThrow();
  });
});
