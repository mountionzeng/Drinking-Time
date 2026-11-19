import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof React>("react")),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({ useUiText: () => (text: string) => text }));
import { ChatComposerTools } from "./ChatComposerTools";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
function setup(overrides: Partial<Parameters<typeof ChatComposerTools>[0]> = {}) {
  const props = { horizontal: true, showAttachments: true, isReplying: false,
    isImportingMedia: false, soundDirectorActive: false,
    voice: { status: "idle" as const },
    onFiles: vi.fn(), onVoice: vi.fn(), ...overrides };
  const tree = ChatComposerTools(props);
  const [attachment, voice] = tree.props.children.props.children;
  const [button, input] = attachment.props.children;
  const click = vi.fn();
  input.props.ref.current = { click };
  return { props, tree, button, input, voice, click };
}

it("opens the picker synchronously during a reply without sending or replacing the text draft", () => {
  const c = setup({ isReplying: true });
  expect(c.button.props.disabled).toBe(false);
  c.button.props.onClick();
  expect(c.click).toHaveBeenCalledOnce();
  expect(c.props.onFiles).not.toHaveBeenCalled();
  expect(c.props.onVoice).not.toHaveBeenCalled();
});

it("lets dictation start while a reply is pending", () => {
  const c = setup({ isReplying: true });
  expect(c.voice.props.disabled).toBe(false);
  c.voice.props.onClick();
  expect(c.props.onVoice).toHaveBeenCalledOnce();
  expect(c.click).not.toHaveBeenCalled();
});

it("keeps stop available when a reply or import begins while recording", () => {
  const c = setup({ isReplying: true, isImportingMedia: true,
    voice: { status: "recording" } });
  expect(c.voice.props.disabled).toBe(false);
  expect(c.voice.props["aria-label"]).toBe("停止录音");
  c.voice.props.onClick();
  expect(c.props.onVoice).toHaveBeenCalledOnce();
});

it("stages selected test files, treats cancel as a no-op and resets for reselection", () => {
  const c = setup();
  const file = new File(["synthetic test attachment"], "chat-controls-test.txt", { type: "text/plain" });
  const target = { files: [file], value: "chat-controls-test.txt" };
  c.input.props.onChange({ target });
  expect(c.props.onFiles).toHaveBeenCalledWith([file]);
  expect(target.value).toBe("");
  c.input.props.onChange({ target: { files: null, value: "" } });
  expect(c.props.onFiles).toHaveBeenCalledOnce();
  c.input.props.onChange({ target });
  expect(c.props.onFiles).toHaveBeenCalledTimes(2);
  expect(c.input.props.multiple).toBe(true);
  expect(c.input.props.accept).toBe("*/*");
});

it.each([
  { isImportingMedia: true },
  { soundDirectorActive: true },
  { voice: { status: "transcribing" as const } },
])("preserves attachment locks while another operation owns the draft: %j", overrides => {
  const c = setup(overrides);
  expect(c.button.props.disabled).toBe(true);
  c.button.props.onClick();
  c.input.props.onChange({ target: { files: [new File(["test"], "test.txt")], value: "test.txt" } });
  expect(c.click).not.toHaveBeenCalled();
  expect(c.props.onFiles).not.toHaveBeenCalled();
});

it.each([
  { isImportingMedia: true },
  { voice: { status: "transcribing" as const } },
])("does not begin a second recording while busy: %j", overrides => {
  const c = setup(overrides);
  expect(c.voice.props.disabled).toBe(true);
  c.voice.props.onClick();
  expect(c.props.onVoice).not.toHaveBeenCalled();
});

it("leaves cancellation available while the browser is starting even during a reply", () => {
  const c = setup({ isReplying: true, isImportingMedia: true, voice: { status: "requesting" } });
  expect(c.voice.props["aria-label"]).toBe("取消语音输入");
  expect(c.voice.props.disabled).toBe(false);
  c.voice.props.onClick();
  expect(c.props.onVoice).toHaveBeenCalledOnce();
});

it("renders both accessible controls in the original dock", () => {
  const c = setup();
  const html = renderToStaticMarkup(c.tree);
  expect(html).toContain("chat-dock-tools");
  expect(html).toContain('aria-label="添加图片、视频或文件 / Add files"');
  expect(html).toContain('aria-label="开始录音"');
  expect(html).not.toContain('disabled=""');
});
