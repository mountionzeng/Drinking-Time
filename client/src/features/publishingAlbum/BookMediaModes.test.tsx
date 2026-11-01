import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {BookMediaModes, type BookMediaMode} from './BookMediaModes';
const render=(mode: BookMediaMode, disabled=false)=>renderToStaticMarkup(<BookMediaModes mode={mode} disabled={disabled} onChange={()=>{}}/>);
describe('book image operation hierarchy',()=>{
  it('keeps local editing inside image editing, not as a third operation',()=>{
    const html=render('region');
    const primary=html.split('aria-label="修改范围"')[0];
    expect(primary).toContain('aria-pressed="true">改图片');
    expect(primary).toContain('变成小视频');
    expect(primary).not.toContain('只改局部');
    expect(html).toContain('aria-pressed="true">只改局部');
  });
  it('does not show image selection while creating video',()=>{
    expect(render('video')).not.toContain('修改范围');
    expect(render('video')).toContain('aria-pressed="true">变成小视频');
  });
  it('prevents changing operation or scope while a task is running',()=>{
    expect(render('region',true).match(/disabled=""/g)).toHaveLength(4);
  });
});
