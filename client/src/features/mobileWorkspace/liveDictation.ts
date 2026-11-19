export type DictationState = "idle" | "requesting" | "listening" | "stopping";
type RecognitionResult = {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
};
export interface LiveRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export function liveRecognitionConstructor():
  | (new () => LiveRecognition)
  | undefined {
  if (typeof window === "undefined") return undefined;
  const browser = window as unknown as {
    SpeechRecognition?: new () => LiveRecognition;
    webkitSpeechRecognition?: new () => LiveRecognition;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
function speechError(code: string, hasDraftText: boolean) {
  if (["not-allowed", "service-not-allowed", "NotAllowedError"].includes(code))
    return "请在浏览器设置中允许麦克风和语音识别，再点话筒。";
  if (code === "audio-capture")
    return "无法使用麦克风，请检查是否被其他应用占用。";
  if (code === "no-speech") return "没有听清，请靠近话筒再说一次。";
  const outcome = hasDraftText ? "已识别的文字在聊天输入框里。" : "本次没有识别到文字。";
  return (code === "network" ? "语音识别连接中断。" : "实时听写暂时不可用。") + outcome;
}
/** One explicit tap, one recognition session. Never restart or submit paid work automatically. */
export function startLiveDictation(
  recognition: LiveRecognition,
  callbacks: {
    onText: (text: string) => void;
    onPreview: (text: string) => void;
    onState: (state: DictationState) => void;
    onError: (message: string) => void;
  }
) {
  let active = true,
    stopping = false,
    hasDraftText = false,
    committed = 0,
    preview = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const detach = () => {
    clearTimeout(timer);
    recognition.onstart =
      recognition.onresult =
      recognition.onerror =
      recognition.onend =
        null;
  };
  const abort = () => {
    try {
      recognition.abort();
    } catch {
      /* Already stopped. */
    }
  };
  const finish = () => {
    if (!active) return;
    active = false;
    detach();
    callbacks.onPreview("");
    if (preview.trim()) callbacks.onText(preview.trim());
    callbacks.onState("idle");
    abort();
  };
  const stop = () => {
    if (!active || stopping) return;
    stopping = true;
    callbacks.onState("stopping");
    clearTimeout(timer);
    timer = setTimeout(finish, 1500);
    try {
      recognition.stop();
    } catch {
      finish();
    }
  };
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => {
    if (!active || stopping) return;
    clearTimeout(timer);
    timer = setTimeout(stop, 10 * 60_000);
    callbacks.onState("listening");
  };
  recognition.onresult = event => {
    if (!active) return;
    const results = Array.from(event.results);
    const final: string[] = [];
    while (committed < results.length && results[committed].isFinal) {
      final.push(results[committed][0].transcript);
      committed++;
    }
    preview = results
      .slice(committed)
      .map(result => result[0].transcript)
      .join("");
    callbacks.onPreview(preview);
    const text = final.join("").trim();
    if (text) {
      hasDraftText = true;
      callbacks.onText(text);
    }
  };
  recognition.onerror = event => {
    if (!active) return;
    const message = speechError(event.error, hasDraftText || Boolean(preview.trim()));
    finish();
    callbacks.onError(message);
  };
  recognition.onend = () => {
    if (!active) return;
    const endedEmpty = !stopping && !hasDraftText && !preview.trim();
    finish();
    if (endedEmpty) callbacks.onError("听写已结束，本次没有识别到文字。");
  };
  callbacks.onState("requesting");
  timer = setTimeout(() => {
    if (!active) return;
    callbacks.onError("浏览器听写启动超时。可以点输入框使用系统听写，或在 Chrome 中打开此页再试。");
    finish();
  }, 15_000);
  try {
    recognition.start();
  } catch (error) {
    callbacks.onError(speechError(error instanceof Error ? error.name : "", false));
    finish();
  }
  return {
    stop,
    cancelStart: finish,
    dispose: () => {
      if (!active) return;
      active = false;
      detach();
      abort();
    },
  };
}
