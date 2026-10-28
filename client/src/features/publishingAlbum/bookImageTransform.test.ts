import { expect, it } from 'vitest';
import { bookImageModule, transformBookImage } from './bookImageTransform';
import { bookImageText, readBookImage } from './bookImageBlock';
import { transformModule, type ModuleHandle } from './imagePackModules';
import { layoutBookBlocks } from './bookBlockLayout';
import { newWritingBlock } from './chapterBlockTree';
const text = bookImageText('/api/image.png', {x:0,y:0,width:1,height:1},1,{x:120,y:80,width:400,height:300});
it.each<ModuleHandle>(['move','nw','ne','sw','se','left','right','top','bottom'])('uses the original layout transform for %s and persists it', handle=>{
  const module = bookImageModule(text,1)!;
  const expected = transformModule(module,handle,40,30);
  const restored = readBookImage(transformBookImage(text,module,handle,40,30))!;
  for (const key of ['x','y','width','height'] as const) expect(restored.frame![key]).toBeCloseTo(expected.rect[key],3);
  if(expected.kind==='image') expect(restored.crop.x).toBeCloseTo(expected.crop.x,3);
  expect(restored.url).toBe('/api/image.png');
});
it('reserves moved and resized image space so text never overlaps',()=>{
  const module=bookImageModule(text,1)!;
  for(const handle of ['move','se','bottom'] as const) {
    const changed=transformBookImage(text,module,handle,2000,2000);
    const layouts=layoutBookBlocks([newWritingBlock('前文'),newWritingBlock(changed),newWritingBlock('后文')]);
    const picture=layouts[1].placement, following=layouts[2].placement;
    expect(picture.rect.y+picture.rect.height).toBeLessThanOrEqual(1152.01);
    expect(following.page>picture.page || following.rect.y>picture.rect.y+picture.rect.height).toBe(true);
  }
});

it('fits legacy image handles to the actual image instead of the whole text row',()=>{
  const image=newWritingBlock(bookImageText('/api/tall.png'));
  const result=layoutBookBlocks([image],{'/api/tall.png':0.5});
  expect(result[0].placement.rect.width).toBe(150);
  expect(result[0].placement.rect.height).toBe(300);
});
