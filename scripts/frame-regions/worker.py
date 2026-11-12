"""Offline region proposals and reviewed palette edits. JSON in/out; no network."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

import numpy as np
from PIL import Image
from scipy.ndimage import binary_closing, label

PROMPTS = ['tree foliage', 'paper airplane', 'clouds', 'buildings', 'ground', 'tree trunks', 'interface panel']
INDEX = {'forest': 0, 'plane': 1, 'cloud': 2, 'city': 3}


def select(maps, target, threshold, area):
    index = INDEX[target]
    other = [i for i in range(len(PROMPTS)) if i != index]
    score = maps[index]
    mask = (score >= threshold) & (score > maps[other].max(axis=0) + .015)
    mask = binary_closing(mask, iterations=1)
    components, _ = label(mask)
    counts = np.bincount(components.ravel()); counts[0] = 0
    mask = counts[components] >= max(16, mask.size * .00002)
    h, w = mask.shape
    if area == 'left': mask[:, w // 2:] = False
    elif area == 'right': mask[:, :w // 2] = False
    elif area == 'top': mask[h // 2:] = False
    elif area == 'bottom': mask[:h // 2] = False
    protected = (maps[other].max(axis=0) > .4) & (maps[other].max(axis=0) > score + .08)
    mask &= ~protected
    # A handful of pixels is not a useful object proposal. Leave it unresolved.
    if mask.sum() < max(64, mask.size * .001):
        mask[:] = False
    return mask, protected, float(score[mask].sum() / mask.size)


def model_fingerprint(model_path):
    digest = hashlib.sha256(b'clipseg-shared-vision-v1')
    digest.update(json.dumps(PROMPTS).encode())
    for name in ['model.safetensors', 'config.json', 'preprocessor_config.json',
                 'tokenizer_config.json', 'special_tokens_map.json', 'merges.txt', 'vocab.json']:
        digest.update(name.encode())
        with (model_path / name).open('rb') as source:
            for chunk in iter(lambda: source.read(4 * 1024 * 1024), b''):
                digest.update(chunk)
    return digest.hexdigest()


def shared_vision_logits(model, pixels, conditional):
    # The image encoder runs once, while the decoder retains one output per label.
    vision = model.clip.vision_model(pixel_values=pixels, output_hidden_states=True,
                                    interpolate_pos_encoding=True, return_dict=True)
    activations = [vision.hidden_states[i + 1].expand(len(conditional), -1, -1)
                   for i in model.extract_layers]
    return model.decoder(activations, conditional, return_dict=True).logits


def cached_maps(cache, key, shape, compute):
    file = cache / (key + '.npy')
    if file.is_file():
        try:
            maps = np.load(file, allow_pickle=False)
            if maps.shape == shape and maps.dtype == np.float32 and np.isfinite(maps).all():
                file.touch()
                return maps
        except (ValueError, OSError):
            pass
    maps = compute()
    with tempfile.NamedTemporaryFile(dir=cache, suffix='.tmp', delete=False) as temp:
        temp_path = Path(temp.name)
        try:
            np.save(temp, maps, allow_pickle=False)
            temp.flush()
            temp_path.replace(file)
        finally:
            temp_path.unlink(missing_ok=True)
    # Disposable private inference cache, bounded to 384 MiB.
    total = 0
    for old in sorted(cache.glob('*.npy'), key=lambda p: p.stat().st_mtime, reverse=True):
        total += old.stat().st_size
        if total > 384 * 1024 * 1024:
            old.unlink(missing_ok=True)
    return maps


def inspect(request):
    model_path = Path(request['modelPath'])
    if not (model_path / 'model.safetensors').is_file():
        raise ValueError('Local recognition model is not installed; no paid fallback was submitted')
    cache = Path(request['cachePath'])
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    fingerprint = model_fingerprint(model_path)
    model = processor = None
    conditionals = {}
    maps_by_id, images_by_id, keys_by_id = {}, {}, {}
    def predict(image, prompts=PROMPTS):
        nonlocal model, processor
        import torch
        if model is None:
            from transformers import CLIPSegForImageSegmentation, CLIPSegProcessor
            torch.set_num_threads(4)
            processor = CLIPSegProcessor.from_pretrained(model_path, local_files_only=True)
            model = CLIPSegForImageSegmentation.from_pretrained(model_path, local_files_only=True, use_safetensors=True).eval()
        if tuple(prompts) not in conditionals:
            text = processor(text=prompts, padding=True, return_tensors='pt')
            with torch.inference_mode():
                conditionals[tuple(prompts)] = model.get_conditional_embeddings(batch_size=len(prompts), **text)
        conditional = conditionals[tuple(prompts)]
        with torch.inference_mode():
            pixels = processor(images=image, return_tensors='pt')['pixel_values']
            logits = shared_vision_logits(model, pixels, conditional)
            return torch.nn.functional.interpolate(logits[:, None], size=(image.height, image.width), mode='bilinear', align_corners=False).sigmoid()[:, 0].numpy()
    for frame in request['frames']:
        image = Image.open(frame['path']).convert('RGB')
        key = hashlib.sha256((fingerprint + hashlib.sha256(Path(frame['path']).read_bytes()).hexdigest()).encode()).hexdigest()
        images_by_id[frame['imageId']], keys_by_id[frame['imageId']] = image, key
        maps_by_id[frame['imageId']] = cached_maps(cache, key, (len(PROMPTS), image.height, image.width), lambda: predict(image))
    cloud_refiner = cloud_fingerprint = None
    if any(task['target'] == 'cloud' for task in request['tasks']):
        from cloud_regions import CloudBoundaryRefiner, boundary_fingerprint, tiled_maps, REVISION
        cloud_path = Path(request['cloudModelPath'])
        if not (cloud_path / 'model.safetensors').is_file():
            raise ValueError('Cloud boundary model is not installed; existing regions are retained')
        cloud_refiner, cloud_fingerprint = CloudBoundaryRefiner(cloud_path), boundary_fingerprint(cloud_path)
    def proposed(frame, task):
        image_id = frame['imageId']
        if task['target'] != 'cloud':
            result = select(maps_by_id[image_id], task['target'], task['threshold'], task['area'])
            if task['target'] != 'forest' or result[0].any():
                return (*result, result[0])
            # Keep existing successful foliage recognition. A stylized tree can fail
            # that label entirely; reuse the reviewed tree/SAM2 method in that case.
            from tree_regions import refine_trees, PROMPTS as TREE_PROMPTS, REVISION as TREE_REVISION
            from cloud_regions import boundary_fingerprint
            image, key = images_by_id[image_id], keys_by_id[image_id]
            model_path = Path(request['cloudModelPath'])
            tree_key = hashlib.sha256((key + TREE_REVISION).encode()).hexdigest()
            maps = cached_maps(cache, tree_key, (2, image.height, image.width), lambda: predict(image, TREE_PROMPTS))
            boundary_key = hashlib.sha256((tree_key + boundary_fingerprint(model_path) + str(task['threshold']) + str(task.get('greenEdit', False))).encode()).hexdigest()
            refined = cached_maps(cache, boundary_key, (3, image.height, image.width), lambda: refine_trees(image, maps, task['threshold'], model_path, task.get('greenEdit', False)))
            mask, protected, objects = refined.astype(bool)
            height, width = mask.shape
            if task['area'] == 'left': mask[:, width//2:] = False
            elif task['area'] == 'right': mask[:, :width//2] = False
            elif task['area'] == 'top': mask[height//2:] = False
            elif task['area'] == 'bottom': mask[:height//2] = False
            return mask, protected, float(maps[0][mask].sum() / mask.size), objects
        image, key = images_by_id[image_id], keys_by_id[image_id]
        tiles_key = hashlib.sha256((key + REVISION + ':tiles').encode()).hexdigest()
        maps = cached_maps(cache, tiles_key, (len(PROMPTS), image.height, image.width), lambda: tiled_maps(image, predict))
        boundary_key = hashlib.sha256((tiles_key + cloud_fingerprint + str(task['threshold'])).encode()).hexdigest()
        result = cached_maps(cache, boundary_key, (2, image.height, image.width), lambda: cloud_refiner.refine(image, maps, task['threshold']))
        mask, protected = result.astype(bool)
        height, width = mask.shape
        if task['area'] == 'left': mask[:, width // 2:] = False
        elif task['area'] == 'right': mask[:, :width // 2] = False
        elif task['area'] == 'top': mask[height // 2:] = False
        elif task['area'] == 'bottom': mask[:height // 2] = False
        return mask, protected, float(maps[2][mask].sum() / mask.size), mask
    output = []
    for task in request['tasks']:
        frames = [f for f in request['frames'] if (f['imageId'] == task['imageId'] if task.get('imageId') else f['imageId'] in task.get('allowedImageIds', [r['imageId'] for r in request['frames']]))]
        candidates = [(f, proposed(f, task)) for f in frames]
        frame, (mask, protected, score, objects) = max(candidates, key=lambda pair: pair[1][2])
        rgb = np.asarray(Image.open(frame['path']).convert('RGB'))
        overlay = rgb.copy()
        overlay[mask] = np.rint(rgb[mask] * .55 + np.array([232, 60, 144]) * .45).astype(np.uint8)
        stem = Path(request['output']) / task['target']
        mask_path, protect_path, overlay_path = [str(stem) + suffix for suffix in ['-mask.png', '-protected.png', '-overlay.png']]
        Image.fromarray(mask.astype(np.uint8) * 255).save(mask_path)
        Image.fromarray(protected.astype(np.uint8) * 255).save(protect_path)
        Image.fromarray(overlay).save(overlay_path)
        object_path = str(stem) + '-objects.png'
        Image.fromarray(objects.astype(np.uint8) * 255).save(object_path)
        output.append({'target': task['target'], 'imageId': frame['imageId'], 'maskPath': mask_path, 'objectPath': object_path,
                       'protectedPath': protect_path, 'overlayPath': overlay_path, 'selectedPixels': int(mask.sum())})
    return output


def recolor(request):
    from edge_transfer import transfer_edges
    from scene_palette import fit_palette
    from recolor_selection import linear_rgb, XYZ
    rgb = np.asarray(Image.open(request['source']).convert('RGB'))
    mask = np.asarray(Image.open(request['mask']).convert('L')) > 0
    protected = np.asarray(Image.open(request['protected']).convert('L')) > 0
    objects = np.asarray(Image.open(request.get('objects', request['mask'])).convert('L')) > 0
    if any(part.shape != rgb.shape[:2] for part in [mask, protected, objects]) or (mask & ~objects).any():
        raise ValueError('Edit scope must belong to matching original-size object masks')
    model, _ = fit_palette(rgb, objects, protected, source_mask=mask)
    result, _ = transfer_edges(rgb, objects, mask, protected, model, radius=2, minimum_shadow_strength=.4)
    result[~mask] = rgb[~mask]; result[protected] = rgb[protected]
    changed = np.any(result != rgb, axis=-1)
    luminance = np.abs(np.einsum('...j,j->...', linear_rgb(result) - linear_rgb(rgb), XYZ[1]))
    if changed.sum() < max(16, mask.sum() * .01):
        raise ValueError('Color change is too small; no successful candidate delivered')
    if luminance.max() > .0045 or changed[~mask].any() or changed[protected].any():
        raise ValueError('Protected pixels or luminance validation failed')
    path = str(Path(request['output']) / 'candidate.png')
    Image.fromarray(result).save(path)
    return {'path': path, 'changedPixels': int(changed.sum()), 'outsideChangedPixels': 0, 'maxLuminanceDrift': float(luminance.max())}


if __name__ == '__main__':
    try:
        request = json.loads(sys.stdin.read())
        result = inspect(request) if request['operation'] == 'inspect' else recolor(request)
        print(json.dumps({'result': result}))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
