import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startLiveDictation, type LiveRecognition } from "./liveDictation";

function setup() {
  const recognition: LiveRecognition = {
    lang: "",
    continuous: false,
    interimResults: false,
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
  const callbacks = {
    onText: vi.fn(),
    onPreview: vi.fn(),
    onState: vi.fn(),
    onError: vi.fn(),
  };
  const session = startLiveDictation(recognition, callbacks);
  const result = (...parts: [string, boolean][]) =>
    recognition.onresult?.({
      results: parts.map(([transcript, isFinal]) => ({
        0: { transcript },
        isFinal,
      })),
    });
  return { recognition, callbacks, session, result };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("starts within the original tap and shows interim corrections without duplicating final text", () => {
  const s = setup();
  expect(s.recognition.start).toHaveBeenCalledOnce();
  expect(s.recognition.interimResults).toBe(true);
  s.recognition.onstart?.();
  s.result(["小纸", false]);
  expect(s.callbacks.onPreview).toHaveBeenLastCalledWith("小纸");
  expect(s.callbacks.onText).not.toHaveBeenCalled();
  s.result(["小纸船", true], ["在窗", false]);
  expect(s.callbacks.onText).toHaveBeenCalledWith("小纸船");
  expect(s.callbacks.onPreview).toHaveBeenLastCalledWith("在窗");
  s.result(["小纸船", true], ["在窗边", true]);
  s.result(["小纸船", true], ["在窗边", true]);
  s.recognition.onend?.();
  expect(s.callbacks.onText.mock.calls).toEqual([["小纸船"], ["在窗边"]]);
  expect(s.callbacks.onState).toHaveBeenLastCalledWith("idle");
});

it("waits for a final result after stop, preserving the last preview if the browser never ends", () => {
  const s = setup();
  s.recognition.onstart?.();
  s.result(["窗边", false]);
  s.session.stop();
  s.session.stop();
  expect(s.recognition.stop).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(2000);
  expect(s.callbacks.onText.mock.calls).toEqual([["窗边"]]);
  expect(s.recognition.abort).toHaveBeenCalled();
  s.recognition.onend?.();
  expect(s.callbacks.onText).toHaveBeenCalledOnce();
});

it("uses a late final correction rather than the interim words after stopping", () => {
  const s = setup();
  s.recognition.onstart?.();
  s.result(["纸传", false]);
  s.session.stop();
  s.result(["纸船", true]);
  s.recognition.onend?.();
  vi.runAllTimers();
  expect(s.callbacks.onText.mock.calls).toEqual([["纸船"]]);
});

it("keeps recognized words on a network error and does not leak provider details or retry", () => {
  const s = setup();
  s.result(["已说的话", false]);
  s.recognition.onerror?.({ error: "network" });
  expect(s.callbacks.onText.mock.calls).toEqual([["已说的话"]]);
  expect(s.callbacks.onError).toHaveBeenCalledWith(
    expect.stringContaining("连接中断")
  );
  expect(s.recognition.start).toHaveBeenCalledOnce();
});

it("ignores captured callbacks after unmount or account switch and aborts capture", () => {
  const s = setup();
  const lateResult = s.recognition.onresult,
    lateStart = s.recognition.onstart;
  s.session.dispose();
  lateStart?.();
  lateResult?.({ results: [{ 0: { transcript: "旧会话" }, isFinal: true }] });
  vi.runAllTimers();
  expect(s.callbacks.onText).not.toHaveBeenCalled();
  expect(s.recognition.abort).toHaveBeenCalledOnce();
});

it("handles a synchronous permission failure without leaving the control busy", () => {
  const s = setup();
  s.session.dispose();
  s.recognition.start = () => {
    throw new DOMException("denied", "NotAllowedError");
  };
  startLiveDictation(s.recognition, s.callbacks);
  expect(s.callbacks.onError).toHaveBeenLastCalledWith(
    expect.stringContaining("麦克风")
  );
  expect(s.callbacks.onState).toHaveBeenLastCalledWith("idle");
});

it("ends stalled permission requests and limits a recording to ten minutes", () => {
  const s = setup();
  vi.advanceTimersByTime(15_000);
  expect(s.callbacks.onState).toHaveBeenLastCalledWith("idle");
  const active = setup();
  active.recognition.onstart?.();
  vi.advanceTimersByTime(10 * 60_000);
  expect(active.recognition.stop).toHaveBeenCalledOnce();
  vi.runAllTimers();
  expect(active.callbacks.onState).toHaveBeenLastCalledWith("idle");
});
