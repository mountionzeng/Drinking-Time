"""Offline chat dictation. Read one short recording from stdin; emit only JSON."""
import json
import subprocess
import sys
from pathlib import Path


def transcribe(model_path, max_seconds):
    if not model_path.is_file():
        return {"error": "本机语音模型尚未安装。"}
    # No filenames, playlists, nested file references or network protocols.
    # Decode at most one extra second so overlong input is rejected, not truncated.
    audio = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "pipe",
         "-format_whitelist", "wav,aiff,mov,mp3,ogg,matroska,webm,flac,aac",
         "-i", "pipe:0", "-map", "0:a:0", "-t", str(max_seconds + 1),
         "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"],
        input=sys.stdin.buffer.read(), capture_output=True, timeout=20,
    )
    if audio.returncode or not audio.stdout:
        return {"error": "无法读取这段录音，请选择 WAV、M4A、MP3 或 WebM 音频。"}
    if len(audio.stdout) > 2 * 16000 * max_seconds:
        return {"error": "录音超过两分钟，请分段转写。"}

    import numpy as np
    samples = np.frombuffer(audio.stdout, dtype="<i2").astype(np.float32) / 32768
    if np.max(np.abs(samples)) < 0.0003:
        return {"text": ""}

    import torch
    import whisper
    torch.set_num_threads(4)
    model = whisper.load_model(str(model_path.resolve()), device="cpu")
    result = model.transcribe(samples, language="zh", initial_prompt="这是一段简体中文的语音记录。",
                              fp16=False, verbose=None,
                              condition_on_previous_text=False)
    text = "".join(s["text"] for s in result["segments"] if s["no_speech_prob"] < 0.8)
    return {"text": text.strip()}


if __name__ == "__main__":
    print(json.dumps(transcribe(Path(sys.argv[1]), int(sys.argv[2])), ensure_ascii=False))
