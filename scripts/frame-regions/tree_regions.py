"""Fallback for stylized trees missed by the foliage label.

Uses the previously reviewed tree/SAM2 method with automatic semantic points.
No picture-specific coordinates, cached user mask, or output color is embedded.
"""
import numpy as np
from scipy.ndimage import label

REVISION = 'tree-semantic-sam2-v2'
PROMPTS = ['tree', 'paper airplane']


def tree_points(maps, threshold, colors=None):
    coarse = (maps[0] >= threshold) & (maps[0] > maps[1] + .05)
    height, width = coarse.shape
    step = max(8, round(min(height, width) / 40))
    points = [[x, y] for y in range(step//2, height, step)
              for x in range(step//2, width, step) if coarse[y, x] and (colors is None or colors[y, x])]
    if len(points) > 256:
        points = [points[i] for i in np.linspace(0, len(points)-1, 256, dtype=int)]
    return points, coarse


def tree_instance(variants, scores, coarse, colors=None):
    accepted = []
    for index, (mask, score) in enumerate(zip(variants, scores)):
        area = int(mask.sum())
        if score >= .7 and 64 <= area <= .12*mask.size and coarse[mask].mean() >= .75 and (colors is None or colors[mask].mean() >= .2):
            accepted.append((float(score), index))
    return None if not accepted else variants[max(accepted)[1]]


def refine_trees(image, maps, threshold, model_path, green_edit=False):
    import torch
    from transformers import Sam2Model, Sam2Processor
    from selection import color_mask
    # The local scene-green operation handles cool tree foliage. Intersect color
    # with recognized objects; blue sky/ground alone never becomes editable.
    colors = color_mask(image, (175, 265), .08) if green_edit else None
    points, coarse = tree_points(maps, threshold, colors)
    objects = np.zeros(coarse.shape, bool)
    protected = (maps[1] >= .35) & (maps[1] > maps[0] + .05)
    if not points:
        return np.stack([objects, protected, objects]).astype(np.float32)
    torch.set_num_threads(4)
    processor = Sam2Processor.from_pretrained(model_path, local_files_only=True)
    model = Sam2Model.from_pretrained(model_path, local_files_only=True, use_safetensors=True).eval()
    with torch.inference_mode():
        pixels = processor(images=image, return_tensors='pt')
        embeddings = model.get_image_embeddings(pixels.pixel_values)
        def masks_at(batch):
            inputs = processor(images=image, input_points=[[[p] for p in batch]],
                               input_labels=[[[1] for _ in batch]], return_tensors='pt')
            inputs.pop('pixel_values')
            outputs = model(**inputs, image_embeddings=embeddings)
            for i in range(len(batch)):
                masks = processor.post_process_masks(outputs.pred_masks[:, i:i+1].cpu(), inputs['original_sizes'])[0][0].numpy().astype(bool)
                yield masks, outputs.iou_scores[0, i].cpu().numpy()
        for start in range(0, len(points), 8):
            for variants, scores in masks_at(points[start:start+8]):
                selected = tree_instance(variants, scores, coarse, colors)
                if selected is not None:
                    objects |= selected
        components, count = label(protected)
        plane_points = []
        for i in range(1, count+1):
            part = components == i
            if part.sum() < 16:
                continue
            y, x = np.unravel_index(np.argmax(np.where(part, maps[1], -1)), part.shape)
            plane_points.append([int(x), int(y)])
        for start in range(0, len(plane_points), 8):
            for variants, scores in masks_at(plane_points[start:start+8]):
                index = int(scores.argmax())
                if scores[index] >= .7 and variants[index].sum() < .1*coarse.size:
                    protected |= variants[index]
    objects &= ~protected
    edit = objects if colors is None else objects & colors
    return np.stack([edit, protected, objects]).astype(np.float32)
