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
