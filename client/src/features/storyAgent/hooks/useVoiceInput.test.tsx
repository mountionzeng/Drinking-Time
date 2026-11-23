import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  transcribe: vi.fn(),
  transcribeLocal: vi.fn(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof React>("react")),
  useEffect: (fn: () => void | (() => void)) => mock.effects.push(fn),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    voice: {
      transcribe: { useMutation: () => ({ mutateAsync: mock.transcribe }) },
      transcribeLocal: { useMutation: () => ({ mutateAsync: mock.transcribeLocal }) },
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
  const preferences = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
    removeItem: (key: string) => preferences.delete(key),
  });
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
function setup(preferLive = false, allowLocalTranscription = false) {
  const onTranscribed = vi.fn();
  const onError = vi.fn();
  const onPreview = vi.fn();
  let voice!: ReturnType<typeof useVoiceInput>;
  function Harness() {
    voice = useVoiceInput({ onTranscribed, onError, onPreview, preferLive, allowLocalTranscription });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const cleanups = mock.effects.splice(0).map(fn => fn());
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

it("discards a late microphone grant after cancelling and starting a new request", async () => {
  const first = deferred<typeof stream>();
  const second = deferred<typeof stream>();
  const stopFirst = vi.fn();
  vi.mocked(navigator.mediaDevices.getUserMedia)
    .mockReturnValueOnce(first.promise as any)
    .mockReturnValueOnce(second.promise as any);
  const chat = setup();
  chat.voice.toggleRecording();
  chat.voice.toggleRecording();
  chat.voice.toggleRecording();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  first.resolve({ getTracks: () => [{ stop: stopFirst }] });
  await first.promise;
  expect(stopFirst).toHaveBeenCalledOnce();
  chat.voice.toggleRecording(); // Cancel the second request after the first has settled.
  second.resolve(stream);
  await second.promise;
  expect(stop).toHaveBeenCalledOnce();
  expect(mock.transcribe).not.toHaveBeenCalled();
  expect(chat.onTranscribed).not.toHaveBeenCalled();
  chat.cleanup();
});

function liveBrowser(autoStart = true) {
  let recognition!: LiveRecognition;
  class Recognition implements LiveRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onstart: LiveRecognition["onstart"] = null;
    onresult: LiveRecognition["onresult"] = null;
    onerror: LiveRecognition["onerror"] = null;
    onend: LiveRecognition["onend"] = null;
    start = vi.fn(() => { if (autoStart) this.onstart?.(); });
    stop = vi.fn(() => this.onend?.());
    abort = vi.fn();
    constructor() { recognition = this; }
  }
  vi.stubGlobal("window", { webkitSpeechRecognition: Recognition });
  return () => recognition;
}

it("cancels a stalled live start on the second tap and allows a new session", () => {
  const current = liveBrowser(false);
  const chat = setup(true);
  chat.voice.toggleRecording();
  const first = current();
  chat.voice.toggleRecording();
  expect(first.abort).toHaveBeenCalledOnce();
  chat.voice.toggleRecording();
  expect(current()).not.toBe(first);
  expect(current().start).toHaveBeenCalledOnce();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(mock.transcribe).not.toHaveBeenCalled();
  chat.cleanup();
});

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

it("distinguishes a blocked speech service from a microphone permission denial", () => {
  const current = liveBrowser();
  const chat = setup(true, true);
  chat.voice.toggleRecording();
  current().onerror?.({ error: "service-not-allowed" });
  expect(chat.onError).toHaveBeenCalledWith(expect.stringContaining("未开放实时语音识别"));
  expect(chat.onError).toHaveBeenCalledWith(expect.stringContaining("本机录音"));
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(mock.transcribe).not.toHaveBeenCalled();
  chat.cleanup();
});

it("offers local recording on live permission denial without opening the microphone", () => {
  const current = liveBrowser();
  const chat = setup(true, true);
  chat.voice.toggleRecording();
  current().onerror?.({ error: "not-allowed" });
  expect(chat.onError).toHaveBeenCalledWith(expect.stringContaining("本机录音"));
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  chat.cleanup();
});

it("remembers working local dictation across chat mounts and still waits for an explicit tap", async () => {
  const current = liveBrowser();
  const first = setup(true, true);
  mock.transcribeLocal.mockResolvedValueOnce({ text: "第一段" });
  await first.voice.startLocalRecording();
  recorder.ondataavailable?.({ data: new Blob(["test"]) });
  first.voice.stopRecording();
  await vi.waitFor(() => expect(first.onTranscribed).toHaveBeenCalledWith("第一段"));
  first.cleanup();
  const next = setup(true, true);
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  next.voice.toggleRecording();
  await Promise.resolve();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  expect(current()).toBeUndefined();
  expect(recorder.state).toBe("recording");
  next.cleanup();

  const remote = setup(true, false);
  remote.voice.toggleRecording();
  expect(current().start).toHaveBeenCalledOnce();
  expect(mock.transcribe).not.toHaveBeenCalled();
  remote.cleanup();
});

it.each(["denied", "decoder unavailable"] as const)("keeps live dictation available when local recording fails (%s)", async failure => {
  const current = liveBrowser();
  const first = setup(true, true);
  if (failure === "denied") {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  } else {
    mock.transcribeLocal.mockResolvedValueOnce({ error: "本机语音模型尚未安装。" });
  }
  await first.voice.startLocalRecording();
  if (failure !== "denied") {
    recorder.ondataavailable?.({ data: new Blob(["test"]) });
    first.voice.stopRecording();
  }
  await vi.waitFor(() => expect(first.onError).toHaveBeenCalledOnce());
  first.cleanup();
  const next = setup(true, true);
  next.voice.toggleRecording();
  expect(current().start).toHaveBeenCalledOnce();
  expect(mock.transcribe).not.toHaveBeenCalled();
  next.cleanup();
});

it("requests the device again on explicit retry after a permission change", async () => {
  const device = vi.mocked(navigator.mediaDevices.getUserMedia);
  device.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const chat = setup(false, true);
  await chat.voice.startLocalRecording();
  expect(chat.onError).toHaveBeenCalledOnce();
  expect(device).toHaveBeenCalledTimes(1);
  await chat.voice.startLocalRecording();
  expect(device).toHaveBeenCalledTimes(2);
  expect(recorder.state).toBe("recording");
  expect(mock.transcribe).not.toHaveBeenCalled();
  chat.cleanup();
});

it("offers keyboard dictation after a Mac recording denial even when site permission cannot be queried", async () => {
  const current = liveBrowser();
  vi.stubGlobal("navigator", {
    platform: "MacIntel",
    mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
  });
  const chat = setup(true, true);
  chat.voice.toggleRecording();
  current().onerror?.({ error: "not-allowed" });
  expect(chat.onError).toHaveBeenLastCalledWith(expect.stringContaining("本机录音"));
  await chat.voice.startLocalRecording();
  expect(chat.onError).toHaveBeenLastCalledWith(expect.stringContaining("听写键"), "keyboard");
  expect(mock.transcribeLocal).not.toHaveBeenCalled();
  chat.cleanup();
});

it("skips the unavailable local retry after live access fails and the browser reports the site denied", async () => {
  const current = liveBrowser();
  const device = vi.fn();
  const permission = { state: "denied" };
  vi.stubGlobal("navigator", {
    platform: "MacIntel", mediaDevices: { getUserMedia: device },
    permissions: { query: vi.fn().mockResolvedValue(permission) },
  });
  const chat = setup(true, true);
  chat.voice.toggleRecording();
  current().onerror?.({ error: "not-allowed" });
  await vi.waitFor(() => expect(chat.onError).toHaveBeenLastCalledWith(expect.stringContaining("听写键"), "keyboard"));
  expect(device).not.toHaveBeenCalled();
  permission.state = "prompt";
  chat.voice.toggleRecording();
  current().onerror?.({ error: "service-not-allowed" });
  await vi.waitFor(() => expect(chat.onError).toHaveBeenLastCalledWith(expect.stringContaining("本机录音")));
  chat.cleanup();
});

it("drops a late permission diagnosis after leaving the story", async () => {
  const current = liveBrowser();
  const permission = deferred<{ state: string }>();
  vi.stubGlobal("navigator", {
    platform: "MacIntel", mediaDevices: { getUserMedia: vi.fn() },
    permissions: { query: () => permission.promise },
  });
  const chat = setup(true, true);
  chat.voice.toggleRecording();
  current().onerror?.({ error: "not-allowed" });
  chat.cleanup();
  permission.resolve({ state: "denied" });
  await permission.promise;
  expect(chat.onError).not.toHaveBeenCalled();
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

it.each([
  ["NotAllowedError", "网站设置中允许麦克风"],
  ["NotReadableError", "麦克风暂时无法读取"],
  ["NotFoundError", "没有找到可用的麦克风"],
])("reports %s instead of silently ignoring a microphone tap", async (name, message) => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new DOMException("synthetic denial", name));
  const chat = setup(true);
  chat.voice.toggleRecording();
  await Promise.resolve();
  expect(chat.onError).toHaveBeenCalledWith(expect.stringContaining(message));
  expect(mock.transcribe).not.toHaveBeenCalled();
  expect(chat.onTranscribed).not.toHaveBeenCalled();
  chat.cleanup();
});

it("explains missing recording APIs without requesting a microphone or sending audio", () => {
  vi.stubGlobal("MediaRecorder", undefined);
  const chat = setup(true);
  chat.voice.toggleRecording();
  expect(chat.onError).toHaveBeenCalledWith(expect.stringContaining("当前浏览器不支持录音"));
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(mock.transcribe).not.toHaveBeenCalled();
  chat.cleanup();
});

it("stops a synthetic recording and only appends its transcription to the draft", async () => {
  mock.transcribe.mockResolvedValue({ text: "合成测试文字" });
  const chat = setup();
  chat.voice.toggleRecording();
  await Promise.resolve();
  expect(recorder.state).toBe("recording");
  recorder.ondataavailable?.({ data: new Blob(["synthetic audio; no microphone accessed"]) });
  chat.voice.stopRecording();
  await vi.waitFor(() => expect(chat.onTranscribed).toHaveBeenCalledWith("合成测试文字"));
  expect(recorder.state).toBe("inactive");
  expect(stop).toHaveBeenCalled();
  expect(chat.onError).not.toHaveBeenCalled();
  chat.cleanup();
});

it("transcribes an explicitly selected recording locally and ignores duplicate or late completions", async () => {
  const pending = deferred<{text: string}>();
  mock.transcribeLocal.mockReturnValueOnce(pending.promise);
  const chat = setup(true, true);
  const file = new File(["audio"], "test.wav", { type: "audio/wav" });
  const first = chat.voice.transcribeLocalFile(file);
  await chat.voice.transcribeLocalFile(file);
  expect(mock.transcribeLocal).toHaveBeenCalledOnce();
  chat.cleanup();
  pending.resolve({ text: "旧稿" });
  await first;
  expect(chat.onTranscribed).not.toHaveBeenCalled();
  expect(mock.transcribe).not.toHaveBeenCalled();
});

it("routes a stopped local microphone recording only to the offline recognizer", async () => {
  mock.transcribeLocal.mockResolvedValueOnce({ text: "公园散步" });
  const chat = setup(true, true);
  chat.voice.toggleRecording();
  await Promise.resolve();
  recorder.ondataavailable?.({ data: new Blob(["synthetic"]) });
  chat.voice.stopRecording();
  await vi.waitFor(() => expect(chat.onTranscribed).toHaveBeenCalledWith("公园散步"));
  expect(mock.transcribeLocal).toHaveBeenCalledOnce();
  expect(mock.transcribe).not.toHaveBeenCalled();
  chat.cleanup();
});

it("can record locally on the first tap despite an available live recognition service", async () => {
  const current = liveBrowser();
  const chat = setup(true, true);
  mock.transcribeLocal.mockResolvedValueOnce({ text: "输入框里的文字" });
  chat.voice.startLocalRecording();
  await Promise.resolve();
  expect(current()).toBeUndefined();
  expect(recorder.state).toBe("recording");
  recorder.ondataavailable?.({ data: new Blob(["synthetic"]) });
  chat.voice.stopRecording();
  await vi.waitFor(() => expect(chat.onTranscribed).toHaveBeenCalledWith("输入框里的文字"));
  expect(mock.transcribe).not.toHaveBeenCalled();
  chat.cleanup();
});

it("keeps a local decoder error actionable and never tries a remote transcription", async () => {
  const chat = setup(true, true);
  mock.transcribeLocal.mockResolvedValueOnce({ error: "无法读取这段录音" });
  await chat.voice.transcribeLocalFile(new File(["invalid"], "sample.wav"));
  expect(chat.onError).toHaveBeenCalledWith("无法读取这段录音");
  expect(chat.onTranscribed).not.toHaveBeenCalled();
  expect(mock.transcribe).not.toHaveBeenCalled();
  chat.cleanup();
});
