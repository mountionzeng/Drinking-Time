"""Local foreground/background edge estimate for color transfer.

This is a bounded, reviewable matting approximation, not ground-truth alpha.
"""
import numpy as np
from scipy.ndimage import binary_dilation, binary_erosion, distance_transform_edt

from recolor_selection import linear_rgb
from scene_palette import encode, palette_target, shadow_strength


def boundary_matte(rgb, objects, source_colors, protected, radius=4, semantic=None):
    shape=rgb.shape[:2]
    if rgb.dtype!=np.uint8 or rgb.shape!=(*shape,3) or any(a.shape!=shape or a.dtype!=bool for a in [objects,source_colors,protected]):
        raise ValueError('Expected matching original-size RGB and boolean masks')
    if not isinstance(radius,int) or radius<1:
        raise ValueError('Invalid boundary radius')
    if semantic is not None and (semantic.shape!=shape or semantic.dtype!=bool):
        raise ValueError('Expected matching semantic support')
    interior=binary_erosion(objects,iterations=radius,border_value=1)
    core=interior&source_colors&~protected
    band=binary_dilation(objects,iterations=radius)&~interior
    allowed=(objects|band)&source_colors&~protected
    if semantic is not None:
        allowed &= objects|semantic
    unknown=allowed&~core
    background=~binary_dilation(objects,iterations=radius*2)&~protected
    if not core.any() or not background.any():
        raise ValueError('Insufficient foreground/background anchors; do not guess edge coverage')
    _,fi=distance_transform_edt(~core,return_indices=True)
    _,bi=distance_transform_edt(~background,return_indices=True)
    linear=linear_rgb(rgb)
    foreground=linear[tuple(fi)]
    backdrop=linear[tuple(bi)]
    direction=foreground-backdrop
    denominator=(direction**2).sum(axis=-1)
    alpha=np.clip(((linear-backdrop)*direction).sum(axis=-1)/np.maximum(denominator,1e-9),0,1)
    prediction=backdrop+alpha[...,None]*direction
    residual=np.sqrt(((linear-prediction)**2).mean(axis=-1))
    reliable=unknown&(denominator>.0025)&(residual<=.06)&(alpha>=.03)
    alpha[~reliable]=0
    alpha[core]=1
    return {'coverage':alpha,'core':core,'edge':reliable,'allowed':allowed,
            'unresolved':unknown&~reliable,'foreground_indices':fi,'residual':residual}


def transfer_edges(rgb, objects, source_colors, protected, model, radius=4, semantic=None,
                   minimum_shadow_strength=.4):
    matte=boundary_matte(rgb,objects,source_colors,protected,radius,semantic)
    original=linear_rgb(rgb)
    output=rgb.copy()
    core=matte['core'];edge=matte['edge'];active=core|edge
    strength=shadow_strength(rgb,model,minimum_shadow_strength,objects&~protected)
    matte['color_strength']=strength
    delta=np.zeros_like(original)
    delta[core]=palette_target(rgb[core],model,strength[core])-original[core]
    # Remove the old foreground color's contribution and add the new one once.
    # The old soft-mask route mixed blue back in at this step.
    indices=tuple(axis[edge] for axis in matte['foreground_indices'])
    foreground_rgb=rgb[indices]
    delta[edge]=matte['coverage'][edge,None]*(palette_target(foreground_rgb,model,strength[indices])-original[indices])
    # Fit the change to gamut without clipping individual channels or changing Y.
    limit=np.ones_like(original)
    np.divide(1-original,delta,out=limit,where=delta>1e-12)
    negative=np.ones_like(original)
    np.divide(-original,delta,out=negative,where=delta< -1e-12)
    scale=np.clip(np.minimum(limit,negative).min(axis=-1),0,1)
    changed=original+delta*scale[...,None]
    output[active]=encode(changed[active])
    return output,matte
