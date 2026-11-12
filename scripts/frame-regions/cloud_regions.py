"""Cloud-only semantic crops plus automatic, bounded SAM2 boundary proposals.

Uses model-derived points, never image-specific coordinates or color constants.
These remain review proposals, not ground-truth masks.
"""
import hashlib
from pathlib import Path

import numpy as np
from scipy.ndimage import binary_closing, distance_transform_edt, label

REVISION = 'cloud-crops-sam2-v1'


def boundary_fingerprint(folder):
    digest = hashlib.sha256(REVISION.encode())
    for name in ['model.safetensors', 'config.json', 'preprocessor_config.json', 'processor_config.json']:
        with (Path(folder) / name).open('rb') as file:
            for chunk in iter(lambda: file.read(4 * 1024 * 1024), b''):
                digest.update(chunk)
    return digest.hexdigest()


def tiled_maps(image, predict):
    """Overlapping crops restore small/faint objects without changing tree inference."""
    width, height = image.size
    tw, th = max(1, round(width * 2 / 3)), max(1, round(height * 2 / 3))
    window = np.maximum(.05, np.hanning(th))[:, None] * np.maximum(.05, np.hanning(tw))[None, :]
    total = np.zeros((7, height, width), np.float32)
    weights = np.zeros((height, width), np.float32)
    for y in sorted({0, height - th}):
        for x in sorted({0, width - tw}):
            total[:, y:y+th, x:x+tw] += predict(image.crop((x, y, x+tw, y+th))) * window
            weights[y:y+th, x:x+tw] += window
    return total / weights


def cloud_support(maps, threshold):
    score = maps[2]
    other = maps[[0, 3, 4, 5, 6]].max(axis=0)
    protected = ((other > .75) & (other > score + .25)) | ((maps[1] > .2) & (maps[1] > score + .08))
    eligible = (score > max(.06, threshold * .25)) & (score > maps[[0, 1, 3, 5, 6]].max(axis=0) + .01) & ~protected
    return eligible, protected


def semantic_points(maps, threshold):
    eligible, protected = cloud_support(maps, threshold)
    quality = distance_transform_edt(eligible) * maps[2]
    height, width = eligible.shape
    seeds = []
    # At most 64 well-spaced prompts, so a broad distant band cannot take every seed.
    ys, xs = np.linspace(0, height, 9, dtype=int), np.linspace(0, width, 9, dtype=int)
    for top, bottom in zip(ys[:-1], ys[1:]):
        for left, right in zip(xs[:-1], xs[1:]):
            tile = quality[top:bottom, left:right]
            if not tile.size:
                continue
            y, x = np.unravel_index(np.argmax(tile), tile.shape)
            if tile[y, x] >= max(.5, min(height, width) / 960):
                seeds.append([int(x + left), int(y + top)])
    return seeds, eligible, protected


def choose_instance(variants, scores, eligible, protected):
    candidates = []
    for index, (mask, score) in enumerate(zip(variants, scores)):
        count = int(mask.sum())
        # Broad background masks must not turn into a whole-scene edit.
        if count < 64 or count > mask.size * .25:
            continue
        support = float(eligible[mask].mean())
        if support < .5 or protected[mask].mean() > .15 or score < .55:
            continue
        candidates.append((float(score) + .15 * support, index))
    return None if not candidates else variants[max(candidates)[1]]


def finish_mask(mask, maps, protected):
    # Discard spill into semantically unrelated trees/ground; preserve aircraft pixels.
    allowed = (maps[2] > .08) & ~protected
    mask = binary_closing(mask & allowed, iterations=1) & allowed
    components, _ = label(mask)
    counts = np.bincount(components.ravel())
    counts[0] = 0
    return counts[components] >= max(32, mask.size * .00004)


class CloudBoundaryRefiner:
    def __init__(self, folder):
        self.folder = folder
        self.model = self.processor = None

    def refine(self, image, maps, threshold):
        points, eligible, protected = semantic_points(maps, threshold)
        union = np.zeros(eligible.shape, bool)
        if not points:
            return np.stack([union, protected]).astype(np.float32)
        import torch
        if self.model is None:
            from transformers import Sam2Model, Sam2Processor
            torch.set_num_threads(4)
            self.processor = Sam2Processor.from_pretrained(self.folder, local_files_only=True)
            self.model = Sam2Model.from_pretrained(self.folder, local_files_only=True, use_safetensors=True).eval()
        inputs = self.processor(images=image, input_points=[[[point] for point in points]],
                                input_labels=[[[1] for _ in points]], return_tensors='pt')
        with torch.inference_mode():
            output = self.model(**inputs)
        # Upsample one prompt at a time: native-size frames must not multiply peak memory by 64.
        for index in range(len(points)):
            variants = self.processor.post_process_masks(output.pred_masks[:, index:index+1].cpu(),
                                                        inputs['original_sizes'])[0][0].numpy().astype(bool)
            selected = choose_instance(variants, output.iou_scores[0, index].cpu().numpy(), eligible, protected)
            if selected is not None:
                union |= selected
        return np.stack([finish_mask(union, maps, protected), protected]).astype(np.float32)
