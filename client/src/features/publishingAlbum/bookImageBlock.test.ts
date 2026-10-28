import { describe, expect, it } from 'vitest';
import { bookImageText, bookImageUrl, readBookImage } from './bookImageBlock';
import { newWritingBlock, restoreWritingBlocks, blockBody } from './chapterBlockTree';
import { layoutBookBlocks } from './bookBlockLayout';

describe('inline book pictures', () => {
  it('restores from the saved manuscript even without this browser metadata', () => {
    const body = `前一段\n${bookImageText('/api/images/a.png')}\n后一段`;
    const blocks = restoreWritingBlocks(body,null);
    expect(bookImageUrl(blocks[1].text)).toBe('/api/images/a.png');
    expect(blockBody(blocks)).toBe(body);
    const layout = layoutBookBlocks(blocks);
    expect(layout[1].placement.rect.height).toBe(300);
    expect(layout[2].placement.rect.y).toBeGreaterThan(layout[1].placement.rect.y+300);
  });
  it('encodes URL parentheses and never treats executable URLs or ordinary prose as images', () => {
    expect(bookImageUrl(bookImageText('https://example.com/a(1).png'))).toBe('https://example.com/a%281%29.png');
    expect(bookImageUrl('![图片](javascript:alert(1))')).toBeNull();
    expect(bookImageUrl('普通文字')).toBeNull();
    expect(() => bookImageText('javascript:alert(1)')).toThrow();
  });
  it('reserves scaled image space without overlapping later text', () => {
    const image = newWritingBlock(bookImageText('/api/images/a.png'));
    image.text=bookImageText('/api/images/a.png',{x:0,y:0,width:1,height:1},2);
    const result=layoutBookBlocks([image,newWritingBlock('下一段')]);
    expect(result[0].placement.rect.height).toBe(600);
    expect(result[1].placement.rect.y).toBeGreaterThan(648);
  });
});

it('persists crop and scale without changing the original image URL', () => {
 const text=bookImageText('/api/images/a.png',{x:.2,y:.1,width:.6,height:.8},1.5);
 expect(readBookImage(text)).toEqual({url:'/api/images/a.png',crop:{x:.2,y:.1,width:.6,height:.8},scale:1.5});
 expect(readBookImage('![图片](/api/a.png "book:0.9,0,0.5,1,1")')).toBeNull();
});
