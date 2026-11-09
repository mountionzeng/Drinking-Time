import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  states: [] as unknown[],
  toggle: vi.fn(),
  fallbackOptions: null as null | {
    onError: (text: string) => void;
    onTranscribed: (text: string) => void;
  },
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof React>("react")),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [
    mock.states.length ? mock.states.shift() : value,
    vi.fn(),
  ],
  useEffect: (fn: () => void | (() => void)) => mock.effects.push(fn),
}));
vi.mock("@/features/storyAgent/hooks/useVoiceInput", () => ({
  useVoiceInput: (options: typeof mock.fallbackOptions) => {
    mock.fallbackOptions = options;
    return {
      isBusy: false,
      isRecording: false,
      isTranscribing: false,
      toggleRecording: mock.toggle,
    };
  },
}));
import { MobileVoiceInput } from "./MobileVoiceInput";
import type { LiveRecognition } from "./liveDictation";
let recognition: LiveRecognition;
class FakeRecognition implements LiveRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: LiveRecognition["onstart"] = null;
  onresult: LiveRecognition["onresult"] = null;
  onerror: LiveRecognition["onerror"] = null;
  onend: LiveRecognition["onend"] = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    recognition = this;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.effects = [];
  mock.states = [];
  mock.fallbackOptions = null;
  vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  const props = {
    disabled: false,
    onText: vi.fn(),
    onPreviewChange: vi.fn(),
    onBusyChange: vi.fn(),
    onNoticeChange: vi.fn(),
  };
  const button = MobileVoiceInput(props);
  const cleanup = mock.effects.map(effect => effect());
  return { props, button, dispose: () => cleanup.forEach(fn => fn?.()) };
}
it("the existing mic starts recognition in one tap and a rapid second tap stops the same session", () => {
  const s = setup();
  expect(s.button.props["aria-label"]).toBe("语音输入");
  s.button.props.onClick();
  expect(recognition.start).toHaveBeenCalledOnce();
  expect(s.props.onBusyChange).toHaveBeenCalledWith(true);
  s.button.props.onClick();
  expect(recognition.stop).toHaveBeenCalledOnce();
  s.dispose();
});
it("previews words before stop and discards late callbacks when the chat closes", () => {
  const s = setup();
  s.button.props.onClick();
  const late = recognition.onresult;
  recognition.onresult?.({
    results: [{ 0: { transcript: "纸船" }, isFinal: false }],
  });
  expect(s.props.onPreviewChange).toHaveBeenLastCalledWith("纸船");
  s.dispose();
  late?.({ results: [{ 0: { transcript: "旧故事" }, isFinal: true }] });
  expect(s.props.onText).not.toHaveBeenCalled();
  expect(s.props.onPreviewChange).toHaveBeenLastCalledWith("");
  expect(recognition.abort).toHaveBeenCalledOnce();
});
it("unsupported-browser fallback starts automatically, keeps one icon and sanitizes upstream errors", () => {
  mock.states = [true, "idle"];
  const props = { disabled: false, onText: vi.fn(), onNoticeChange: vi.fn() };
  const fallback = MobileVoiceInput(props);
  const button = fallback.type(fallback.props);
  mock.effects.forEach(effect => effect());
  vi.runAllTimers();
  expect(mock.toggle).toHaveBeenCalledOnce();
  expect(button.props["aria-label"]).toBe("语音输入");
  mock.fallbackOptions?.onError(
    '豆包失败：403 Forbidden {"reqid":"private"}；302 回退失败：500 Internal Server Error'
  );
  expect(props.onNoticeChange).toHaveBeenLastCalledWith(
    "语音转写暂时不可用，请使用键盘听写或稍后重试。"
  );
});
