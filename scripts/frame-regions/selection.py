"""Compose semantic and color masks without changing the source pixels."""
from __future__ import annotations

import numpy as np
from PIL import Image


def color_mask(image: Image.Image, hue_degrees: tuple[float, float],
               min_saturation: float) -> np.ndarray:
    if not (0 <= min_saturation <= 1 and all(0 <= h <= 360 for h in hue_degrees)):
        raise ValueError("Invalid color range")
    hsv = np.asarray(image.convert("HSV"), dtype=float)
    hue, saturation = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255
    low, high = hue_degrees
    hue_match = (hue >= low) & (hue <= high) if low <= high else (hue >= low) | (hue <= high)
    return hue_match & (saturation >= min_saturation) & (saturation > 0)
