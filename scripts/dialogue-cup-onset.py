"""Locate a known cup mascot by matching its painted body shape and colour at 30 fps."""
import json
from pathlib import Path
import re
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SIZE = 192
FPS = 30
TEMPLATES = Path(__file__).resolve().parents[1] / "docs/prototypes/liaohuier-miniapp/assets"
KINDS = {"fire", "wood", "earth", "water", "metal"}


def crop_body(mask):
    boxes = ndimage.find_objects(ndimage.label(mask)[0])
    if not boxes:
        return None
    return max(boxes, key=lambda box: np.count_nonzero(mask[box]))


def describe(kind):
    rgba = np.asarray(Image.open(TEMPLATES / ("cup-" + kind + ".png")).convert("RGBA"))
    rgb = rgba[:, :, :3].astype(float)
    pixels = rgba[:, :, :3][rgba[:, :, 3] >= 200]
    paint, counts = np.unique(pixels, axis=0, return_counts=True)
    tone = paint[counts.argmax()].astype(float)
    mask = (np.max(np.abs(rgb - tone), axis=2) < 20) & (rgba[:, :, 3] > 180)
    body = ndimage.binary_fill_holes(mask[crop_body(mask)])
    return tone, body


def candidates(rgb, spec):
    tone, body = spec
    # Preserve paint hue under modest exposure changes.
    intensity = rgb.mean(axis=2)
    chroma = rgb - intensity[:, :, None]
    mask = (np.max(np.abs(chroma - (tone - tone.mean())), axis=2) < 19) & (np.abs(intensity - tone.mean()) < 43)
    labels, count = ndimage.label(mask)
    if count == 0:
        return []
    found = []
    for label, box in enumerate(ndimage.find_objects(labels), 1):
        if box is None:
            continue
        y, x = box
        width, height = x.stop - x.start, y.stop - y.start
        if not (4 <= width <= SIZE * .8 and 1 <= height <= SIZE * .8):
            continue
        patch = ndimage.binary_fill_holes(labels[box] == label)
        if patch.sum() < 6:
            continue
        reference_h = max(1, round(width * body.shape[0] / body.shape[1]))
        border = y.start == 0 or y.stop == SIZE or x.start == 0 or x.stop == SIZE
        score = 0.
        if width >= 9 and height >= 7 and .68 <= height / reference_h <= 1.4:
            resized = np.asarray(Image.fromarray(body).resize((width, height), Image.Resampling.NEAREST))
            score = np.count_nonzero(resized & patch) / np.count_nonzero(resized | patch)
            # The outline and facial marks must have the same dark ink as the reference mascot.
            border_box = rgb[max(0,y.start-2):min(SIZE,y.stop+2), max(0,x.start-2):min(SIZE,x.stop+2)]
            if (border_box.mean(axis=2) < intensity[box][patch].mean() - 35).sum() < max(3,width*.5):
                score = 0.
        found.append((score, (x.start+x.stop)/2, (y.start+y.stop)/2, width, height, border))
    return found


def locate(frames, kinds):
    matches = []
    for kind in kinds:
        spec = describe(kind)
        # Check coarse frames for a complete, recognisable body before tracking its entrance.
        hits = [i for i in range(0,len(frames)-3,4)
                if any(c[0] >= .86 for c in candidates(frames[i],spec))
                and any(c[0] >= .86 for c in candidates(frames[i+3],spec))]
        if not hits:
            continue
        start = hits[0]
        targets = [c for c in candidates(frames[start],spec) if c[0] >= .86]
        if len(targets) != 1:
            raise ValueError("画面中有多个相似的杯子，请指定一个入画时间。")
        prev = targets[0]
        for i in range(start-1,-1,-1):
            viable = [c for c in candidates(frames[i],spec)
                      if (c[0] >= .78 or c[5]) and abs(c[1]-prev[1]) <= max(9,prev[3]*.8)
                      and abs(c[2]-prev[2]) <= max(14,prev[3])
                      and .35 <= c[3]/prev[3] <= 2]
            if len(viable) != 1:
                break
            start, prev = i, viable[0]
        # A one-pixel leading outline may precede the coloured paint at the top edge.
        if start >= 2 and prev[5] and prev[2] < 4:
            x, width = round(prev[1]), round(prev[3])
            xs = slice(max(0,x-width), min(SIZE,x+width))
            for leading in range(start-1, max(0,start-9), -1):
                darker = frames[leading-1,:3,xs].mean(axis=2) - frames[leading,:3,xs].mean(axis=2)
                if np.count_nonzero(darker > 30) >= max(6,width):
                    start = leading
                    break
                # Slow playback may hold the first ink edge across several frames.
                if np.max(np.abs(darker)) > 12:
                    break
        matches.append((kind,start))
    if len(matches) != 1:
        raise ValueError("画面中的茶杯无法唯一定位，请补充颜色或给出原视频中它出现的秒数。")
    return matches[0]


def main():
    request = json.load(sys.stdin)
    kinds = request["kinds"]
    if not kinds or not set(kinds) <= KINDS:
        raise ValueError("未知的画面参考。")
    duration = float(request["duration"])
    if not 0 < duration <= 20:
        raise ValueError("请给出原视频中物体出现的秒数。")
    # Keep native presentation timestamps. Rounding a 24 fps source up to a
    # timeline tick before a slow motion edit can shift the entrance by several frames.
    filters = (f"select='isnan(prev_selected_t)+gt(floor(t*{FPS}+0.000001),floor(prev_selected_t*{FPS}+0.000001))',"
               f"scale={SIZE}:{SIZE}:force_original_aspect_ratio=decrease,"
               f"pad={SIZE}:{SIZE}:(ow-iw)/2:(oh-ih)/2,showinfo=checksum=0")
    args = ["ffmpeg", "-nostdin", "-nostats", "-v", "info", "-protocol_whitelist", "file,pipe",
            "-ss", str(request["start"]), "-t", str(duration), "-i", request["file"],
            "-an", "-vf", filters, "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    decoded = subprocess.run(args, capture_output=True, timeout=18, check=True)
    frames = np.frombuffer(decoded.stdout,dtype=np.uint8).reshape(-1,SIZE,SIZE,3)
    log = decoded.stderr.decode(errors="replace")
    time_base = re.search(r"config in time_base: (\d+)/(\d+)", log)
    pts = re.findall(r"\bn:\s*\d+\s+pts:\s*(-?\d+)\s+pts_time:", log)
    if not time_base or len(pts) != len(frames):
        raise ValueError("无法读取原视频的帧时间。")
    kind, frame = locate(frames,kinds)
    offset_sec = int(pts[frame]) * int(time_base[1]) / int(time_base[2])
    print(json.dumps({"kind":kind,"offsetSec":offset_sec}))


if __name__ == "__main__":
    try:
        main()
    except ValueError as exc:
        print(json.dumps({"error":str(exc)}))
