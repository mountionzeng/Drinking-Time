import {describe,it,expect} from 'vitest';
import sharp from 'sharp';
import {shortcutCaptureInput} from './materialCaptureShortcut';
const encode=(value:string|Buffer)=>Buffer.from(value).toString('base64');
describe('system-share payload',()=>{
  it('preserves mixed text and photo bytes, with stable per-account retry identity',async()=>{
    const bytes=await sharp({create:{width:3,height:3,channels:3,background:'red'}}).jpeg().toBuffer();
    const raw={encodedItems:[encode('虚构素材：雨中的纸船。'),encode(bytes),encode('https://example.invalid/a')].join('\n')};
    const input=shortcutCaptureInput(1,raw);
    expect(input.text).toBe('虚构素材：雨中的纸船。\n\nhttps://example.invalid/a');
    expect(input.files[0].base64).toBe(encode(bytes));
    expect(shortcutCaptureInput(1,raw)).toEqual(input);
    expect(shortcutCaptureInput(2,raw).id).not.toBe(input.id);
  });
  it('rejects malformed bytes, unsupported binaries and HEIC with an actionable reason',()=>{
    expect(()=>shortcutCaptureInput(1,{encodedItems:'@@@'})).toThrow();
    expect(()=>shortcutCaptureInput(1,{encodedItems:encode(Buffer.from([0,1,2,3,255]))})).toThrow();
    expect(()=>shortcutCaptureInput(1,{encodedItems:encode(Buffer.from('\0\0\0\0ftypheic00000000000000000'))})).toThrow(/HEIC/);
  });
});
