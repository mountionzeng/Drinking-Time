"""Learn a conditional color palette from this image, without fitting model weights."""
from __future__ import annotations

import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion, gaussian_filter

from recolor_selection import from_lab, linear_rgb, to_lab
from selection import color_mask


def encode(linear):
    if not np.isfinite(linear).all():
        raise ValueError('Nonfinite color conversion')
    linear=np.clip(linear,0,1)
    srgb=np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055)
    return np.rint(srgb*255).astype(np.uint8)


def fit_palette(rgb, objects, protected, minimum_samples=64, max_chroma_gain=1.25,
                source_mask=None):
    if rgb.dtype!=np.uint8 or rgb.shape!=(*objects.shape,3) or protected.shape!=objects.shape:
        raise ValueError('Expected matching original-size inputs')
    if objects.dtype!=bool or protected.dtype!=bool:
        raise ValueError('Expected boolean masks')
    if not np.isfinite(max_chroma_gain) or max_chroma_gain<=0:
        raise ValueError('Invalid chroma gain')
    image=Image.fromarray(rgb)
    interior=binary_erosion(objects,iterations=2)&~protected
    # This categorical selector finds existing green; it is not an output hue.
    reference=interior&color_mask(image,(75,165),.12)
    if source_mask is not None and (source_mask.shape!=objects.shape or source_mask.dtype!=bool):
        raise ValueError('Expected matching source mask')
    source=interior&(color_mask(image,(175,265),.08) if source_mask is None else source_mask)
    if min(reference.sum(),source.sum())<minimum_samples:
        raise ValueError('Insufficient same-object green/source samples; request a reference rather than invent a palette')
    lab=to_lab(linear_rgb(rgb))
    ref,src=lab[reference],lab[source]
    lightness=np.arange(5.,100.,5.)
    quantiles=np.linspace(.05,.95,19)
    rows=[]
    for level in lightness:
        groups=[]
        for pixels in [src,ref]:
            distance=np.abs(pixels[:,0]-level)
            width=max(4.,float(np.partition(distance,min(511,len(distance)-1))[min(511,len(distance)-1)]))
            groups.append(pixels[distance<=width])
        local_src,local_ref=groups
        source_c=np.hypot(local_src[:,1],local_src[:,2])
        ref_c=np.hypot(local_ref[:,1],local_ref[:,2])
        ordered=local_ref[np.argsort(ref_c,kind='stable')]
        target_ab=[]
        for q in quantiles:
            center=round(q*(len(ordered)-1))
            radius=max(8,round(.04*len(ordered)))
            nearby=ordered[max(0,center-radius):min(len(ordered),center+radius+1)]
            # Conditional hue is from actual green pixels, not a fixed angle.
            direction=nearby[:,1:]/np.maximum(np.hypot(nearby[:,1],nearby[:,2])[:,None],1e-8)
            direction=direction.mean(axis=0)
            direction/=max(float(np.linalg.norm(direction)),1e-8)
            target_ab.append(direction*np.quantile(ref_c,q))
        x=np.quantile(source_c,quantiles)
        target_ab=np.asarray(target_ab)
        c=np.linalg.norm(target_ab,axis=-1)
        limited=limit_chroma_gain(x,c,max_chroma_gain)
        target_ab*= (limited/np.maximum(c,1e-8))[:,None]
        rows.append({'source_chroma':x.tolist(),
                     'target_ab':target_ab.tolist(),
                     'reference_lightness_range':np.percentile(local_ref[:,0],[5,95]).tolist()})
    return {'method':'same-object-green-lightness-conditioned-quantile-transfer-v1',
            'reference_pixels':int(reference.sum()),'source_pixels':int(source.sum()),
            'max_chroma_gain':max_chroma_gain,
            'shadow_smoothing_sigma_px':2.,
            'lightness':lightness.tolist(),'quantiles':quantiles.tolist(),'rows':rows,
            'reference_chroma_quantiles':np.percentile(np.hypot(ref[:,1],ref[:,2]),[10,50,90]).tolist(),
            'source_shadow_lightness_knots':np.percentile(src[:,0],[20,65]).tolist(),
            'reference_lightness_quantiles':np.percentile(ref[:,0],[10,50,90]).tolist()},reference


def limit_chroma_gain(source, target, maximum):
    """Keep the scene median; do not amplify fine chroma noise to match extremes."""
    limited=target.copy()
    middle=len(target)//2
    for i in range(middle+1,len(target)):
        limited[i]=np.clip(limited[i],limited[i-1],limited[i-1]+maximum*(source[i]-source[i-1]))
    for i in range(middle-1,-1,-1):
        limited[i]=np.clip(limited[i],limited[i+1]-maximum*(source[i+1]-source[i]),limited[i+1])
    return limited


def shadow_strength(rgb, model, minimum=.4, support=None):
    """Darkness-based edit strength, not a physical shadow detector."""
    if not np.isfinite(minimum) or not 0<=minimum<=1:
        raise ValueError('Shadow strength must be in [0,1]')
    lightness=to_lab(linear_rgb(rgb))[...,0]
    if support is not None:
        if support.shape!=lightness.shape or support.dtype!=bool:
            raise ValueError('Invalid shadow support')
        sigma=model.get('shadow_smoothing_sigma_px',2.)
        weight=gaussian_filter(support.astype(float),sigma=sigma)
        local=gaussian_filter(lightness*support,sigma=sigma)/np.maximum(weight,1e-8)
        lightness=np.where(weight>1e-6,local,lightness)
    low,high=model['source_shadow_lightness_knots']
    if high-low<1:
        return np.ones(lightness.shape)
    t=np.clip((lightness-low)/(high-low),0,1)
    return minimum+(1-minimum)*t*t*(3-2*t)


def color_wheel_blend(source_ab, target_ab, strength):
    """Shortest hue arc; interpolate chroma rather than averaging RGB to gray."""
    if strength.shape!=source_ab.shape[:-1] or not np.isfinite(strength).all() or np.any((strength<0)|(strength>1)):
        raise ValueError('Invalid color-wheel strength')
    source_c=np.linalg.norm(source_ab,axis=-1)
    target_c=np.linalg.norm(target_ab,axis=-1)
    source_h=np.arctan2(source_ab[...,1],source_ab[...,0])
    target_h=np.arctan2(target_ab[...,1],target_ab[...,0])
    source_h=np.where(source_c<1e-6,target_h,source_h)
    delta=(target_h-source_h+np.pi)%(2*np.pi)-np.pi
    hue=source_h+strength*delta
    chroma=source_c*(1-strength)+target_c*strength
    return np.stack([np.cos(hue)*chroma,np.sin(hue)*chroma],axis=-1)


def palette_target(rgb, model, strength=None):
    lab=to_lab(linear_rgb(rgb))
    flat=lab.reshape(-1,3)
    chroma=np.hypot(flat[:,1],flat[:,2])
    levels=np.array(model['lightness'])
    ab=np.empty((len(flat),2))
    # Bilinear interpolation across lightness and source-chroma ranks.
    hi=np.clip(np.searchsorted(levels,flat[:,0],side='right'),1,len(levels)-1)
    lo=hi-1
    weight=np.clip((flat[:,0]-levels[lo])/(levels[hi]-levels[lo]),0,1)
    for i in range(len(levels)-1):
        use=lo==i
        if not use.any():continue
        matches=[]
        for j in [i,i+1]:
            row=model['rows'][j]
            x=np.array(row['source_chroma'])
            y=np.array(row['target_ab'])
            # A flat source still receives the middle reference color, not an endpoint.
            if np.ptp(x)<1e-5:
                matches.append(np.broadcast_to(y[len(y)//2],(int(use.sum()),2)))
            else:
                unique=np.unique(x)
                values=np.array([y[x==v].mean(axis=0) for v in unique])
                matches.append(np.stack([np.interp(chroma[use],unique,values[:,k]) for k in range(2)],axis=-1))
        ab[use]=matches[0]*(1-weight[use,None])+matches[1]*weight[use,None]
    if strength is not None:
        if strength.shape!=rgb.shape[:-1]:
            raise ValueError('Color-wheel strength dimensions differ')
        ab=color_wheel_blend(flat[:,1:],ab,strength.reshape(-1))
    target=flat.copy();target[:,1:]=ab
    low,high=np.zeros(len(flat)),np.ones(len(flat))
    for _ in range(18):
        mid=(low+high)/2
        trial=target.copy();trial[:,1:]*=mid[:,None]
        linear=from_lab(trial)
        valid=((linear>=0)&(linear<=1)).all(axis=1)
        low=np.where(valid,mid,low);high=np.where(valid,high,mid)
    target[:,1:]*=low[:,None]
    return from_lab(target).reshape(rgb.shape)


def apply_palette(rgb,alpha,model):
    if alpha.shape!=rgb.shape[:2] or not np.isfinite(alpha).all() or np.any((alpha<0)|(alpha>1)):
        raise ValueError('Invalid alpha')
    active=alpha>0
    output=rgb.copy()
    if active.any():
        target=palette_target(rgb[active],model)
        source=linear_rgb(rgb[active])
        output[active]=encode(source*(1-alpha[active,None])+target*alpha[active,None])
    return output
