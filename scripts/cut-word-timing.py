"""Locate a spoken word and its burned-in text locally, then retime only video frames."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

FPS = 30


def command(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=90, **kwargs).stdout


def normalized(text):
    return re.findall(r"[^\W_]+", text.casefold())


def speech_anchor(job):
    import numpy as np
    import torch
    import whisper
    if not Path(job["model"]).is_file():
        raise ValueError("本机缺少语音对齐模型。")
    audio = command(["ffmpeg", "-v", "error", "-protocol_whitelist", "file,pipe",
                     "-ss", str(job["audioStart"]), "-i", job["audio"], "-t", str(job.get("audioFrames", job["frames"]) / FPS),
                     "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"])
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    model = whisper.load_model(job["model"], device="cpu")
    transcript = model.transcribe(np.frombuffer(audio, "<f4").copy(), language="en", fp16=False, verbose=None,
                                  word_timestamps=True, condition_on_previous_text=False, temperature=0)
    matches = [w for seg in transcript["segments"] for w in seg.get("words", [])
               if normalized(w["word"]) == normalized(job["word"]) and w.get("probability", 0) >= .55
               and job["cueStart"] - .4 <= w["start"] + job.get("audioOffset", 0) <= job["cueEnd"] + .4]
    if len(matches) != 1:
        raise ValueError("在这句旁白里没能唯一定位目标词。")
    return matches[0]["start"] + job.get("audioOffset", 0), matches[0]["end"] + job.get("audioOffset", 0)


def contains_word(paths, word):
    if sys.platform == "darwin":
        reader = Path(__file__).with_name("read-video-text.swift")
        rows = json.loads(command(["swift", str(reader), *map(str, paths)]))
        return [any(line["confidence"] >= .55 and word.casefold() in normalized(line["text"])
                    for line in row.get("lines", [])) for row in rows]
    if not shutil.which("tesseract"):
        raise ValueError("本机缺少画面文字识别工具。")
    return [word.casefold() in normalized(command(["tesseract", str(p), "stdout", "-l", "eng", "--psm", "6"]).decode())
            for p in paths]


def screen_anchor(job, folder, speech):
    # Sample in the same 30 fps coordinate system used to render, then refine the first stable match.
    lower = max(0, round((speech - 4) * FPS))
    upper = min(job["frames"] - 1, round((speech + 4) * FPS))
    def scan(indices):
        directory = folder / ("scan-" + str(len(indices)) + "-" + str(indices[0]))
        directory.mkdir()
        select = "+".join("eq(n," + str(i) + ")" for i in indices)
        command(["ffmpeg", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", job["source"], "-an",
                 "-vf", f"fps={FPS},select='{select}',scale='min(iw,800)':-2",
                 "-fps_mode", "vfr", str(directory / "%04d.png")])
        paths = sorted(directory.glob("*.png"))
        if len(paths) != len(indices):
            raise ValueError("画面帧数与剪辑时长不一致。")
        return contains_word(paths, job["word"])
    coarse = list(range(lower, upper + 1, 6))
    found = scan(coarse)
    runs = [i for i in range(1, len(found)-1) if not found[i-1] and found[i] and found[i+1]]
    if not runs or found[0]:
        raise ValueError("在这段视频里没能唯一定位完整词首次出现的画面。")
    i = runs[0]  # Later zoom or motion blur can make the already-visible word temporarily unreadable.
    fine = list(range(coarse[i-1], coarse[i]+3))
    flags = scan(fine)
    for n in range(len(fine)-1):
        if flags[n] and flags[n+1]:
            return fine[n]
    raise ValueError("画面文字的入点不确定。")


def render(job, folder, source_frame, arrival, release):
    frames = job["frames"]
    start = max(0, arrival - 3)
    if arrival <= start or release >= frames - 1 or source_frame >= frames - 1:
        raise ValueError("本镜剩余长度不足以提前画面并保留镜尾。")
    # Frame selection keeps both original endpoints and holds the exact readable frame.
    def source_at(frame):
        if frame < start:
            return frame
        if frame < arrival:
            return start + (frame-start)*(source_frame-start)//(arrival-start)
        if frame <= release:
            return source_frame
        return source_frame + round((frame-release)*(frames-1-source_frame)/(frames-1-release))
    probe = json.loads(command(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                "stream=width,height", "-of", "json", job["source"]]))["streams"][0]
    width,height=probe["width"],probe["height"]
    if width*height > 4096*2160 or width%2 or height%2:
        raise ValueError("暂不支持这段视频的分辨率。")
    decode=["ffmpeg","-v","error","-protocol_whitelist","file,pipe","-i",job["source"],"-vf","fps=30",
            "-an","-pix_fmt","yuv420p","-f","rawvideo","-"]
    encode=["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","yuv420p","-r","30","-s",f"{width}x{height}",
            "-i","pipe:0","-protocol_whitelist","file,pipe","-i",job["source"],"-map","0:v","-map","1:a?",
            "-c:a","copy","-c:v","libx264","-preset","fast","-crf","16","-movflags","+faststart",
            "-t",str(frames/FPS),str(folder/"cut.mp4")]
    size=width*height*3//2
    with subprocess.Popen(decode,stdout=subprocess.PIPE) as reader, subprocess.Popen(encode,stdin=subprocess.PIPE) as writer:
        try:
            index=-1
            for frame in range(frames):
                while index<source_at(frame):
                    raw=reader.stdout.read(size)
                    if len(raw)!=size:
                        raise ValueError("原片在镜尾前中断。")
                    index+=1
                writer.stdin.write(raw)
            writer.stdin.close()
            if writer.wait(timeout=30):
                raise ValueError("视频编码失败。")
        finally:
            reader.stdout.close()
            if reader.poll() is None: reader.terminate()
            if writer.poll() is None: writer.terminate()


if __name__ == "__main__":
    try:
        job=json.load(sys.stdin); folder=Path(job["folder"])
        spoken,end=speech_anchor(job)
        original=screen_anchor(job,folder,spoken)
        arrival=min(round(spoken*FPS),original)-6
        release=max(arrival, min(round((end+.55)*FPS), round(job["cueEnd"]*FPS))) if job["hold"] else arrival
        render(job,folder,original,arrival,release)
        print(json.dumps(dict(original=original,arrival=arrival,release=release,spoken=spoken)))
    except (ValueError, subprocess.SubprocessError, OSError, ImportError) as error:
        print(str(error)[:800], file=sys.stderr)
        print(json.dumps({"error": str(error) if isinstance(error,ValueError) else "本机无法完成音画定位或编码。"}))
