"""Deterministic recoloring test for the user-confirmed soft-mask workflow.

Changes Lab hue, preserves luminance, compresses chroma to fit sRGB, then
blends in linear RGB. No generative API and no learned color preference.
"""
from __future__ import annotations


import numpy as np


XYZ = np.array([[.4124564,.3575761,.1804375],
                [.2126729,.7151522,.0721750],
                [.0193339,.1191920,.9503041]])
WHITE = np.array([.95047,1.,1.08883])
DELTA = 6/29


def linear_rgb(rgb):
    s = rgb.astype(float)/255
    return np.where(s<=.04045, s/12.92, ((s+.055)/1.055)**2.4)


def to_lab(linear):
    xyz = np.einsum('...j,ij->...i', linear, XYZ)/WHITE
    f = np.where(xyz>DELTA**3, np.cbrt(xyz), xyz/(3*DELTA**2)+4/29)
    return np.stack([116*f[...,1]-16, 500*(f[...,0]-f[...,1]),
                     200*(f[...,1]-f[...,2])], axis=-1)


def from_lab(lab):
    fy = (lab[...,0]+16)/116
    f = np.stack([fy+lab[...,1]/500, fy, fy-lab[...,2]/200], axis=-1)
    xyz = np.where(f>DELTA, f**3, 3*DELTA**2*(f-4/29))*WHITE
    return np.einsum('...j,ij->...i', xyz, np.linalg.inv(XYZ))
