import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterTextModules } from './ChapterTextModules';
import { replaceTextModule, textModuleOffset, textModulePosition } from './moduleTextEditing';
vi.stubGlobal('React', React);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.stubGlobal('React', React); });
function setup(body: string) {
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  const fields: Record<string, any> = {};
  const onChange = vi.fn();
  const create = React.createElement;
  vi.spyOn(React, 'createElement').mockImplementation(((type: any, props: any, ...children: any[]) => {
    if (type === 'textarea') fields[props['aria-label']] = props;
    return create(type, props, ...children);
  }) as typeof React.createElement);
  const html = renderToStaticMarkup(<ChapterTextModules value={body} onChange={onChange} disabled={false} selection={{ current: null }} />);
  return { fields, onChange, html };
}
const key = (name: string, start: number, end = start, composing = false) => ({ key: name, currentTarget: { selectionStart: start, selectionEnd: end }, nativeEvent: { isComposing: composing }, preventDefault: vi.fn() });
describe('paragraph text modules', () => {
  it('renders formulas while keeping their exact editable source and adding no math button',()=>{
    const {html,fields}=setup(String.raw`能量 $E=mc^2$`);
    expect(html).toContain('class="katex"');expect(html).toContain('<math');
    expect(fields['文字模块 1'].value).toBe(String.raw`能量 $E=mc^2$`);
    expect(html).not.toContain('插入公式');
  });
  it('keeps Enter inside a display formula in the same module',()=>{
    const {fields,onChange}=setup('$$x$$\n后文');
    fields['文字模块 1'].onKeyDown(key('Enter',3));
    expect(onChange).toHaveBeenCalledWith('$$x\n$$\n后文');
  });
  it('renders an inline video in the existing book module without nesting playback in a button', () => {
    const { html } = setup('前文\n![图片](https://example.com/image.png "book:0.1,0.2,0.5,0.6,1.5" "video:https://example.com/clip.mp4")\n后文');
    expect(html).toContain('aria-label="文章短视频"');
    expect(html).toContain('poster="https://example.com/image.png"');
    expect(html).toContain('src="https://example.com/clip.mp4"');
    expect(html).toContain('role="button" tabindex="0" aria-label="图片模块 2"');
    expect(html).toContain('文字模块 3');
    expect(html).not.toContain('<button type="button" aria-label="图片模块 2"');
  });

  it('puts format and drag affordances before text without movement menu commands', () => {
    const { html } = setup('第一段');
    expect(html.indexOf('模块 1 格式')).toBeLessThan(html.indexOf('aria-label="文字模块 1"'));
    expect(html).toContain('拖动模块 1');
    expect(html).toContain('aria-label="书页"');
    expect(html).not.toContain('上移');
    expect(html).not.toContain('下移');
    expect(html).not.toContain('移入上方标题');
    expect(html).not.toContain('移出标题');
  });

  it('renders one module per newline including empty and repeated paragraphs', () => {
    const { fields } = setup('第一段\n\n第一段\n');
    expect(Object.values(fields).map(field => field.value)).toEqual(['第一段', '', '第一段', '']);
  });
  it('splits at Enter, replacing only the selected text', () => {
    const { fields, onChange } = setup('甲乙丙丁\n尾段');
    const event = key('Enter', 1, 3);
    fields['文字模块 1'].onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('甲\n丁\n尾段');
  });
  it('does not split while Chinese input is confirming a candidate', () => {
    const { fields, onChange } = setup('中文');
    const event = key('Enter', 2, 2, true);
    fields['文字模块 1'].onKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(onChange).not.toHaveBeenCalled();
  });
  it('merges at the start of a paragraph without deleting text', () => {
    const { fields, onChange } = setup('第一段\n第二段');
    fields['文字模块 2'].onKeyDown(key('Backspace', 0));
    expect(onChange).toHaveBeenCalledWith('第一段第二段');
  });
  it('merges forward at Delete and keeps the following paragraphs', () => {
    const { fields, onChange } = setup('甲\n乙\n丙');
    fields['文字模块 1'].onKeyDown(key('Delete', 1));
    expect(onChange).toHaveBeenCalledWith('甲乙\n丙');
  });
  it('splits pasted lines, preserves trailing slots and maps the cursor to the whole chapter', () => {
    const next = replaceTextModule('开头\n结尾', 1, '甲\r\n乙\r\n', 6);
    expect(next.body).toBe('开头\n甲\n乙\n');
    expect(textModuleOffset(next.body, 2)).toBe(5);
    expect(textModulePosition(next.body, next.position)).toEqual({ index: 3, cursor: 0 });
  });
});
