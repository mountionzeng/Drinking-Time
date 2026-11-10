"""Offline alignment of known narration. Never downloads a model or rewrites text.

ASR only locates short windows. Teacher-forced Whisper attention aligns the exact
manuscript inside each window; cuts must land in measured silence. Failure leaves
the current video untouched. Requires openai-whisper, torch and a cached base.pt.
"""
import difflib
import json
import os
import sys

import numpy as np
import torch
import whisper
from whisper.audio import log_mel_spectrogram, pad_or_trim
from whisper.timing import find_alignment
from whisper.tokenizer import get_tokenizer


def letters(text):
    return "".join(c.lower() for c in text if c.isalnum())


def align(audio_path, lines, model_path):
    if not os.path.isfile(model_path):
        raise ValueError("本机没有语音对齐模型，请配置 BOOK_VIDEO_WHISPER_MODEL；不会自动下载或付费。")
    if not lines or len(lines) > 300 or any(not letters(line) for line in lines):
        raise ValueError("台词为空或超过本次对齐范围，请拆分作品。")
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    model = whisper.load_model(model_path, device="cpu")
    audio = whisper.load_audio(audio_path)
    duration = len(audio) / 16000
    if duration <= 0 or duration > 1200:
        raise ValueError("自动对齐支持二十分钟以内的整书台词。")
    transcript = model.transcribe(audio, word_timestamps=True, fp16=False,
                                  condition_on_previous_text=False, temperature=0, verbose=None)
    tokenizer = get_tokenizer(model.is_multilingual, language=transcript["language"], task="transcribe")
    recognized, times = "", []
    for segment in transcript["segments"]:
        for word in segment.get("words", []):
            text = letters(word["word"])
            recognized += text
            times.extend([(word["start"], word["end"])] * len(text))
    reference = "".join(letters(line) for line in lines)
    matcher = difflib.SequenceMatcher(None, reference, recognized, autojunk=False)
    matches = {a + i: b + i for a, b, count in matcher.get_matching_blocks() for i in range(count)}
    if len(matches) / max(1, len(reference)) < 0.45:
        raise ValueError("旁白与当前台词无法可靠对齐，请检查音频版本。")
    anchors, cursor = [], 0
    for line in lines:
        count = len(letters(line))
        hits = [times[matches[i]] for i in range(cursor, cursor + count) if i in matches]
        if len(hits) < min(2, count):
            raise ValueError("有一段台词无法定位，当前视频保留。")
        anchors.append((hits[0][0], hits[-1][1]))
        cursor += count

    # 10 ms RMS windows. No cuts through phonemes, even if recognition is wrong.
    frame_count = len(audio) // 160
    rms = np.sqrt(np.mean(audio[:frame_count * 160].reshape(-1, 160) ** 2, axis=1))
    silent = rms < 10 ** (-38 / 20)
    silences, beginning = [], None
    for i, quiet in enumerate(np.append(silent, False)):
        if quiet and beginning is None:
            beginning = i
        elif not quiet and beginning is not None:
            if i - beginning >= 18:
                silences.append((beginning / 100, i / 100))
            beginning = None

    def boundary(estimate, lower, upper):
        choices = [(a + b) / 2 for a, b in silences if lower < (a + b) / 2 < upper]
        if not choices:
            raise ValueError("句间没有安全停顿，无法自动切分这段旁白。")
        value = min(choices, key=lambda x: abs(x - estimate))
        if abs(value - estimate) > 1.2:
            raise ValueError("语音边界不确定，当前视频保留。")
        return value

    rough_cuts = [0.0]
    for i in range(len(lines) - 1):
        rough_cuts.append(boundary((anchors[i][1] + anchors[i + 1][0]) / 2,
                                   max(rough_cuts[-1] + 0.1, anchors[i][0]), anchors[i + 1][1]))
    rough_cuts.append(duration)

    # Each attention window is <= 28 seconds; exact text tokens are never ASR output.
    forced, lo = [], 0
    while lo < len(lines):
        hi = lo + 1
        while hi < len(lines) and rough_cuts[hi + 1] - rough_cuts[lo] <= 28:
            hi += 1
        start, end = rough_cuts[lo], rough_cuts[hi]
        if end - start > 29:
            raise ValueError("单段台词太长，请按句分段后重试。")
        tokens, ranges = [], []
        for line in lines[lo:hi]:
            encoded = tokenizer.encode(line)
            ranges.append((len(tokens), len(tokens) + len(encoded)))
            tokens.extend(encoded)
        if len(tokens) > 420:
            raise ValueError("单段台词超出语音对齐范围。")
        chunk = audio[round(start * 16000):round(end * 16000)]
        mel = log_mel_spectrogram(pad_or_trim(chunk), n_mels=model.dims.n_mels)
        words = find_alignment(model, tokenizer, tokens, mel, len(chunk) // 160)
        indexed, index = [], 0
        for word in words:
            indexed.append((index, index + len(word.tokens), word))
            index += len(word.tokens)
        for a, b in ranges:
            selected = [w for x, y, w in indexed if x < b and y > a and letters(w.word)]
            if not selected:
                raise ValueError("台词对齐结果不完整。")
            probability = float(np.mean([w.probability for w in selected]))
            if probability < 0.15 or selected[-1].end <= selected[0].start:
                raise ValueError("台词对齐置信度不足，当前视频保留。")
            forced.append((start + selected[0].start, start + selected[-1].end, probability))
        lo = hi

    cuts = [0.0]
    for i in range(len(lines) - 1):
        cut = boundary((forced[i][1] + forced[i + 1][0]) / 2,
                       max(cuts[-1] + 0.1, anchors[i][0]), anchors[i + 1][1])
        if abs(cut - rough_cuts[i + 1]) > 0.6:
            raise ValueError("两次语音定位结果不一致，当前视频保留。")
        cuts.append(cut)
    cuts.append(duration)
    result = []
    for i, text in enumerate(lines):
        first, last = round(cuts[i] * 100), min(frame_count, round(cuts[i + 1] * 100))
        active = np.flatnonzero(~silent[first:last])
        if not len(active):
            raise ValueError("台词对应音频为空。")
        speech_start = max(cuts[i], (first + int(active[0])) / 100)
        speech_end = min(cuts[i + 1], (first + int(active[-1]) + 1) / 100)
        result.append({"text": text, "start": speech_start, "end": speech_end,
                       "cutStart": max(cuts[i], speech_start - 0.08),
                       "cutEnd": min(cuts[i + 1], speech_end + 0.12),
                       "probability": forced[i][2]})
    return result


if __name__ == "__main__":
    try:
        request = json.load(open(sys.argv[1], encoding="utf-8"))
        result = align(request["audioPath"], request["lines"], request["modelPath"])
        with open(sys.argv[2], "w", encoding="utf-8") as output:
            json.dump(result, output, ensure_ascii=False)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
