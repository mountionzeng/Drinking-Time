import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CaptureReceipt } from "@shared/materialCapture";
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof React>("react")),
  useRef: (value: unknown) => ({ current: value }),
}));
import { MobileCaptureButton, MobileCaptureReceipts, type CaptureController } from "./MobileCaptureAttachments";

function receipt(id: string, storyId: number | null, status: CaptureReceipt["status"] = "saved"): CaptureReceipt {
  return { id, storyId, status, manifest: { origin: "chat", text: id, files: [] },
    progress: { evidence: [] }, createdAt: new Date(0), updatedAt: new Date(0) };
}
function render(overrides: Partial<CaptureController> = {}, storyId = 1215) {
  const capture = {
    history: [receipt("current-story", 1215), receipt("other-story", 1214)],
    active: false, selectedCaptureId: null, hasMore: false, busy: false,
    resume: vi.fn(), loadMore: vi.fn(), ...overrides,
  } as CaptureController;
  return renderToStaticMarkup(<MobileCaptureReceipts capture={capture} storyId={storyId} />);
}

describe("capture receipts in a story conversation", () => {
  it("opens the file picker in the paperclip tap and keeps collection controls available", () => {
    const capture = { ready:true, busy:false, activate:vi.fn(), addFiles:vi.fn() } as unknown as CaptureController;
    const tree = MobileCaptureButton({capture});
    const [input, button] = tree.props.children;
    const click = vi.fn();
    input.props.ref.current = {click};
    button.props.onClick();
    expect(capture.activate).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(input.props.multiple).toBe(true);
    const file = new File(["audio"], "voice.m4a", {type:"audio/mp4"});
    const target = {files:[file],value:"voice.m4a"};
    input.props.onChange({target});
    expect(capture.addFiles).toHaveBeenCalledWith([file]);
    expect(target.value).toBe("");
    input.props.onChange({target:{files:[],value:""}});
    expect(capture.addFiles).toHaveBeenCalledOnce();
  });
  it.each(["busy", "locked", "recording"])("does not reopen the picker while %s", flag => {
    const capture = {ready:true,[flag]:true,activate:vi.fn(),addFiles:vi.fn()} as unknown as CaptureController;
    const [input,button] = MobileCaptureButton({capture}).props.children;
    const click = vi.fn();
    input.props.ref.current = {click};
    button.props.onClick();
    expect(button.props.disabled).toBe(true);
    expect(click).not.toHaveBeenCalled();
    expect(capture.activate).not.toHaveBeenCalled();
  });
  it("prevents switching to material capture while dictation owns the microphone", () => {
    const capture = {ready:true,busy:false,activate:vi.fn()} as unknown as CaptureController;
    expect(renderToStaticMarkup(<MobileCaptureButton capture={capture} disabled />)).toContain('disabled=""');
    expect(renderToStaticMarkup(<MobileCaptureButton capture={capture} />)).not.toContain('disabled=""');
  });
  it("shows only records linked to the current story", () => {
    const html = render();
    expect(html).toContain("current-story");
    expect(html).not.toContain("other-story");
  });
  it("does not leak the previous story's records after switching stories", () => {
    const html = render({}, 1214);
    expect(html).toContain("other-story");
    expect(html).not.toContain("current-story");
  });
  it("preserves account collection and the unbound entry", () => {
    expect(render({ active: true })).toContain("other-story");
    expect(render({}, 0)).toContain("other-story");
  });
  it.each(["received", "processing", "ready", "uncertain"] as const)("retains %s tasks with an account label", status => {
    const html = render({ history: [receipt("unfinished", null, status)] });
    expect(html).toContain("unfinished");
    expect(html).toContain("账号素材任务");
  });
  it("preserves explicitly requested deep links to another story", () => {
    const html = render({ selectedCaptureId: "other-story" });
    expect(html).toContain("other-story");
    expect(html).toContain("当前链接打开的素材");
    expect(html).toContain("/m?storyId=1214");
  });
  it("keeps pagination reachable when loaded account records do not match", () => {
    const html = render({ history: [receipt("other-story", 1214)], hasMore: true });
    expect(html).not.toContain("other-story");
    expect(html).toContain("继续查看更早的素材");
  });
});
