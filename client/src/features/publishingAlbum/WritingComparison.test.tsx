import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { afterTextSlice } from './WritingComparison';
import { textChanges } from './textChanges';
import { ChapterTextModules } from './ChapterTextModules';
vi.stubGlobal('React', React);

it('maps additions to paragraph caret offsets including emoji, repeated lines and deletions', () => {
  const before = '旧字\n纸船\n纸船';
  const after = '新😀字\n纸船\n红纸船';
  const changes = textChanges(before, after);
  const first = afterTextSlice(changes, 0, 4);
  expect(first.map(part => part.text).join('')).toBe('新😀字');
  expect(first.some(part => part.kind === 'added')).toBe(true);
  expect(afterTextSlice(changes, 5, 7).map(part => part.text).join('')).toBe('纸船');
  expect(afterTextSlice(changes, 8, 11).map(part => part.text).join('')).toBe('红纸船');
  expect(afterTextSlice(changes, 0, after.length).some(part => part.kind === 'removed')).toBe(false);
});

it('shows selected old text on the left and editable current blocks with additions on the right', () => {
  const html = renderToStaticMarkup(<ChapterTextModules value={"蓝色纸船\n新的一行"} onChange={vi.fn()} disabled={false} selection={{current:null}}
    comparison={{body:'红色纸船',title:'纸船',label:'版本 1',editorName:'Jane'}} />);
  expect(html.indexOf('所选版本原文')).toBeLessThan(html.indexOf('当前版本编辑'));
  expect(html).toMatch(/<del[^>]*>红<\/del>/);
  expect(html).toMatch(/<mark[^>]*>蓝<\/mark>/);
  expect(html).toContain('aria-label="文字模块 2"');
  expect(html).toContain('Jane');
  expect(html).not.toContain('readonly');
  expect(html).not.toContain('修改摘要');
});
