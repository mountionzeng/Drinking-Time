import { describe, expect, it } from "vitest";
import { captureRecordingError } from "./captureRecordingError";
describe("recording permission guidance", () => {
  it("explains denied browser and system permissions with a file fallback", () => {
    const text = captureRecordingError(new DOMException("Permission denied", "NotAllowedError"));
    expect(text).toContain("麦克风");
    expect(text).toContain("Chrome");
    expect(text).toContain("录音文件");
    expect(text).not.toContain("Permission denied");
  });
  it("distinguishes missing and busy microphones", () => {
    expect(captureRecordingError({name:"NotFoundError"})).toContain("未找到");
    expect(captureRecordingError({name:"NotReadableError"})).toContain("占用");
  });
  it("does not expose arbitrary browser errors", () => {
    expect(captureRecordingError(new Error("internal details"))).not.toContain("internal details");
  });
});
