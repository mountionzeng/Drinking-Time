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
function setup() {
  const onTranscribed = vi.fn();
  const onError = vi.fn();
  let voice!: ReturnType<typeof useVoiceInput>;
  function Harness() {
    voice = useVoiceInput({ onTranscribed, onError });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const cleanups = mock.effects.map(fn => fn());
  return {
    voice,
    onTranscribed,
    onError,
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
