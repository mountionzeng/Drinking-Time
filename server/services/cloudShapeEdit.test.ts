import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildCloudEditMask, cloudShapePrompt, compareCloudCandidate } from './cloudShapeEdit';
import { cloudShapeDecision, isCloudAppearanceEdit, isFrameRegionChat } from '../../shared/frameRegionReview';

async function png(data: Buffer, width = 20, height = 16, channels: 1 | 3 | 4 = 1) {
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}
describe('cloud appearance editing', () => {
  it('reduces crowding rather than repeating an old request to add clouds', () => {
    const prompt=cloudShapePrompt('云再多一点\n云还是太密集了，高光白色，阴影五颜六色，纹理不要重复');
    expect(prompt).toContain('Reduce cloud count and crowding');
    expect(prompt).toContain('open gaps');
    expect(prompt).not.toContain('Increase cloud quantity');
    expect(prompt).not.toContain('Preserve the current number');
    expect(prompt.length).toBeLessThanOrEqual(2000);
  });
  it('enforces white highlights and rich colored shadows from persisted direction', () => {
    const prompt=cloudShapePrompt('再厚一点',{quantity:'slightly_more',textureRepetition:'reduce',highlights:'white',shadows:'colorful'});
    expect(prompt).toContain('near-white');
    expect(prompt).toContain('multicolored shadows');
    expect(prompt).toContain('same airplane count');
    expect(prompt.length).toBeLessThanOrEqual(2000);
  });
  it('routes cloud quantity and non-repeating texture separately from size', () => {
    expect(isCloudAppearanceEdit('云再多一点，纹理不要那么重复')).toBe(true);
    expect(isFrameRegionChat('纹理不要那么重复', { phase:'image_review', activeTarget:'cloud',tasks:[] } as any)).toBe(true);
    const prompt = cloudShapePrompt('云再多一点，纹理不要那么重复');
    expect(prompt).toContain('secondary cloud');
    expect(prompt).toContain('cloned');
    expect(prompt).not.toContain('Do not add new objects');
  });
  it('recognizes a contextual short follow-up without broadening to another object', () => {
    expect(isCloudAppearanceEdit('更大一点，更厚一点，白一点，但是饱和度要高')).toBe(true);
    expect(isCloudAppearanceEdit('云范围扩大一点')).toBe(false);
    expect(isFrameRegionChat('再厚一点', { phase:'scope_review', activeTarget:'cloud',tasks:[] } as any)).toBe(true);
    expect(cloudShapeDecision('确认生成云层')).toBe('generate');
    expect(cloudShapeDecision('确认了吗')).toBeNull();
  });
  it('adds bounded room to grow while excluding protected objects at the original dimensions', async () => {
    const region = Buffer.alloc(320), protectedPixels = Buffer.alloc(320);
    for (let y=5;y<11;y++) for(let x=5;x<11;x++) region[y*20+x]=255;
    protectedPixels[7*20+11]=255;
    const result = await buildCloudEditMask(await png(region), await png(protectedPixels), 2);
    const pixels = await sharp(result.mask).raw().toBuffer();
    expect(result).toMatchObject({width:20,height:16,growthPixels:2});
    expect(pixels[(7*20+11)*4+3]).toBe(255);
    expect(pixels[(7*20+12)*4+3]).toBe(0);
    expect(pixels[3]).toBe(255);
    expect((await sharp(result.mask).metadata()).width).toBe(20);
  });
  it('rejects mismatched masks and an unresolved cloud', async () => {
    await expect(buildCloudEditMask(await png(Buffer.alloc(320)),await png(Buffer.alloc(320)),2)).rejects.toThrow();
    await expect(buildCloudEditMask(await png(Buffer.alloc(320,255)),await png(Buffer.alloc(4),2,2),2)).rejects.toThrow();
  });
  it('keeps whitening distinct from colored saturation, with no contradictory fixed object scale', () => {
    const prompt=cloudShapePrompt('更大一点，更厚一点，白一点，但是饱和度要高');
    expect(prompt).toContain('highlights'); expect(prompt).toContain('midtones');
    expect(prompt).toContain('Do not globally'); expect(prompt).toContain('larger');
    expect(cloudShapePrompt('x'.repeat(8000)).length).toBeLessThanOrEqual(2000);
  });
  it('validates unchanged protected pixels and dimensions before delivering a candidate', async () => {
    const src=Buffer.alloc(320*3,80), out=Buffer.from(src), alpha=Buffer.alloc(320*4,255);
    alpha[7*4+3]=0; out[7*3]=120;
    expect(await compareCloudCandidate(await png(src,20,16,3),await png(out,20,16,3),await png(alpha,20,16,4))).toEqual({changedPixels:1,outsideChangedPixels:0});
    out[0]=200;
    await expect(compareCloudCandidate(await png(src,20,16,3),await png(out,20,16,3),await png(alpha,20,16,4))).rejects.toThrow();
  });
});
