import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterWriting } from "./ChapterWriting";
import type { Chapter } from "./useChapters";
vi.stubGlobal('React', React);
vi.mock('@/features/writingCompanion/DesktopWritingContext', () => ({ DesktopWritingContext: () => null }));
const chapter = { id: 2, storyId: 1, version: 4, title: '标题', blocks: { body: '已保存正文' } } as Chapter;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.stubGlobal('React', React); });
describe('chapter writing', () => {
  it('restores only the current account and chapter draft', () => {
    const read = vi.fn(() => JSON.stringify({ title: '本机标题', body: '正在写的内容' }));
    vi.stubGlobal('localStorage', { getItem: read });
    const html = renderToStaticMarkup(<ChapterWriting chapter={chapter} scope="account9:story1" handle={{ current: null }} save={vi.fn()} onChange={vi.fn()} disabled={false} />);
    expect(read).toHaveBeenCalledWith('chapter-writing:account9:story1:2');
    expect(html).toContain('正在写的内容');
    expect(html).toContain('章节正文');
    expect(html).not.toContain('已保存正文');
  });
  it('keeps unsaved writing in cache when saving fails', async () => {
    const cache = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) });
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const create = React.createElement;
    let change: any, submit: any;
    vi.spyOn(React, 'createElement').mockImplementation(((type: any, props: any, ...children: any[]) => {
      if (type === 'textarea' && props?.['aria-label'] === '文字模块 1') change = props.onChange;
      if (type === 'button' && children.includes('保存章节')) submit = props.onClick;
      return create(type, props, ...children);
    }) as typeof React.createElement);
    renderToStaticMarkup(<ChapterWriting chapter={chapter} scope="account9:story1" handle={{ current: null }} save={save} onChange={vi.fn()} disabled={false} />);
    change({ currentTarget: { value: '未保存修改', selectionStart: 5 } });
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ title: '标题', body: '未保存修改' }));
    expect(cache.get('chapter-writing:account9:story1:2')).toContain('未保存修改');
  });
});
