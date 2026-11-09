import { expect, it } from "vitest";
import { captureFileMime, validateCaptureFiles } from "./materialCaptureDraft";

it.each(["video/quicktime", ""])("gives a short import path for iPhone MOV files (%s)", type => {
  const file = new File(["video"], "IMG_0006.mov", { type });
  expect(() => validateCaptureFiles([file])).toThrow("这是视频，请从“…”里的“导入本地文件”添加。");
});

it("keeps supported images and audio containers available", () => {
  expect(captureFileMime(new File(["audio"], "voice.mp4", { type: "audio/mp4" }))).toBe("audio/mp4");
  expect(captureFileMime(new File(["audio"], "voice.m4a", { type: "audio/x-m4a" }))).toBe("audio/mp4");
  expect(() => validateCaptureFiles([new File(["image"], "photo.png", { type: "image/png" })])).not.toThrow();
});
