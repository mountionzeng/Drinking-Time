import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  transcribe: vi.fn(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof React>("react")),
  useEffect: (fn: () => void | (() => void)) => mock.effects.push(fn),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    voice: {
      transcribe: { useMutation: () => ({ mutateAsync: mock.transcribe }) },
    },
  },
}));
import { useVoiceInput } from "./useVoiceInput";
import type { LiveRecognition } from "@/features/mobileWorkspace/liveDictation";
const stop = vi.fn();
const stream = { getTracks: () => [{ stop }] };
let recorder: FakeRecorder;
class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => Promise<void>;
  constructor() {
    recorder = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    void this.onstop?.();
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mock.effects = [];
  vi.clearAllMocks();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:audio/webm;base64,YXVkaW8=";
      onload?: () => void;
      readAsDataURL() {
        this.onload?.();
      }
    }
  );
});
afterEach(() => vi.unstubAllGlobals());
function setup(preferLive = false) {
  const onTranscribed = vi.fn();
  const onError = vi.fn();
  const onPreview = vi.fn();
  let voice!: ReturnType<typeof useVoiceInput>;
  function Harness() {
    voice = useVoiceInput({ onTranscribed, onError, onPreview, preferLive });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const cleanups = mock.effects.map(fn => fn());
  return {
    voice,
    onTranscribed,
    onError,
    onPreview,
    cleanup: () => cleanups.forEach(fn => fn?.()),
  };
}
it("stops a late microphone grant after the chat unmounts without recording", async () => {
  const permission = deferred<typeof stream>();
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
    permission.promise as any
  );
  const chat = setup();
  chat.voice.toggleRecording();
  chat.cleanup();
  permission.resolve(stream);
  await permission.promise;
  await Promise.resolve();
  expect(stop).toHaveBeenCalled();
  expect(mock.transcribe).not.toHaveBeenCalled();
  expect(chat.onTranscribed).not.toHaveBeenCalled();
});

function liveBrowser() {
  let recognition!: LiveRecognition;
  class Recognition implements LiveRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onstart: LiveRecognition["onstart"] = null;
    onresult: LiveRecognition["onresult"] = null;
    onerror: LiveRecognition["onerror"] = null;
    onend: LiveRecognition["onend"] = null;
    start = vi.fn(() => this.onstart?.());
    stop = vi.fn(() => this.onend?.());
    abort = vi.fn();
    constructor() { recognition = this; }
  }
  vi.stubGlobal("window", { webkitSpeechRecognition: Recognition });
  return () => recognition;
}

it("previews desktop dictation immediately and commits final text without calling the old transcription provider", () => {
  const current = liveBrowser();
  const chat = setup(true);
  chat.voice.toggleRecording();
  const recognition = current();
  expect(recognition.start).toHaveBeenCalledOnce();
  expect(recognition.lang).toBe("zh-CN");
  recognition.onresult?.({ results: [{ isFinal: false, 0: { transcript: "那把旧" } }] });
  expect(chat.onPreview).toHaveBeenLastCalledWith("那把旧");
  expect(chat.onTranscribed).not.toHaveBeenCalled();
  recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: "那把旧伞" } }] });
  expect(chat.onTranscribed).toHaveBeenCalledWith("那把旧伞");
  expect(chat.onPreview).toHaveBeenLastCalledWith("");
  chat.voice.stopRecording();
  expect(recognition.stop).toHaveBeenCalledOnce();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(mock.transcribe).not.toHaveBeenCalled();
  chat.cleanup();
});

it("aborts desktop live dictation on leaving and ignores late results", () => {
  const current = liveBrowser();
  const chat = setup(true);
  chat.voice.toggleRecording();
  const recognition = current();
  const lateResult = recognition.onresult;
  chat.cleanup();
  lateResult?.({ results: [{ isFinal: true, 0: { transcript: "不能写到另一个故事" } }] });
  expect(recognition.abort).toHaveBeenCalled();
  expect(chat.onTranscribed).not.toHaveBeenCalled();
});

it("does not silently fall back to a paid service when live speech is denied", () => {
  const current = liveBrowser();
  const chat = setup(true);
  chat.voice.toggleRecording();
  current().onerror?.({ error: "not-allowed" });
  expect(chat.onError).toHaveBeenCalledWith(expect.stringContaining("允许麦克风"));
  expect(mock.transcribe).not.toHaveBeenCalled();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  chat.cleanup();
});

it("keeps a short actionable error instead of leaking provider response JSON", async () => {
  mock.transcribe.mockRejectedValue(new Error('403 Forbidden {"header":{"code":45000030}}'));
  const chat = setup();
  chat.voice.toggleRecording();
  await Promise.resolve();
  recorder.ondataavailable?.({ data: new Blob(["audio"]) });
  recorder.state = "inactive";
  await recorder.onstop?.();
  expect(chat.onError).toHaveBeenCalledWith("语音转写暂时不可用，请使用键盘听写或稍后重试。");
  chat.cleanup();
});
it("does not append a late transcription to another chat", async () => {
  const response = deferred<{ text: string }>();
  mock.transcribe.mockReturnValue(response.promise);
  const chat = setup();
  chat.voice.toggleRecording();
  await Promise.resolve();
  recorder.ondataavailable?.({ data: new Blob(["audio"]) });
  recorder.state = "inactive";
  const finished = recorder.onstop?.();
  await Promise.resolve();
  expect(mock.transcribe).toHaveBeenCalledOnce();
  chat.cleanup();
  response.resolve({ text: "只属于原故事" });
  await finished;
  expect(chat.onTranscribed).not.toHaveBeenCalled();
  expect(chat.onError).not.toHaveBeenCalled();
});
it("returns recognized words for confirmation and releases the microphone", async () => {
  mock.transcribe.mockResolvedValue({ text: "  想起那把旧伞  " });
  const chat = setup();
  chat.voice.toggleRecording();
  await Promise.resolve();
  recorder.ondataavailable?.({ data: new Blob(["audio"]) });
  recorder.state = "inactive";
  await recorder.onstop?.();
  expect(chat.onTranscribed).toHaveBeenCalledWith("想起那把旧伞");
  expect(stop).toHaveBeenCalled();
  chat.cleanup();
});
