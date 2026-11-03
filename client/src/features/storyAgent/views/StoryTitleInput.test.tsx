import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryTitleInput } from './StoryTitleInput';

vi.stubGlobal('React', React);
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());
function field(save = vi.fn(async (_title: string) => {}), title = 'launch video') {
  let input!: React.ComponentProps<'input'>;
  const create = React.createElement;
  vi.spyOn(React, 'createElement').mockImplementation(((type: any, props: any, ...children: any[]) => {
    if (type === 'input' && props['aria-label'] === '故事名称') input = props;
    return create(type, props, ...children);
  }) as typeof create);
  const html = renderToStaticMarkup(<StoryTitleInput title={title} save={save} />);
  return { html, save, input,
    change: (value: string) => input.onChange!({ target: { value } } as any),
    blur: () => input.onBlur!({} as any),
    key: (key: string, composing = false) => input.onKeyDown!({ key, nativeEvent: { isComposing: composing }, preventDefault: vi.fn(), currentTarget: { blur: () => input.onBlur!({} as any) } } as any),
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('shared story title input', () => {
  it('shows the story title without a second chapter-title field or save button', () => {
    const view = field();
    expect(view.html).toContain('value="launch video"');
    expect(view.html).not.toContain('章节标题');
    expect(view.html).not.toContain('<button');
    view.blur();
    expect(view.save).not.toHaveBeenCalled();
  });
  it('saves trimmed metadata on blur and does not submit a second request on Enter while pending', async () => {
    let finish!: () => void;
    const save = vi.fn((_title: string) => new Promise<void>(resolve => { finish = resolve; }));
    const view = field(save);
    view.change('  新故事名  '); view.blur(); view.key('Enter');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('新故事名');
    finish(); await settle(); view.blur();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('retains edits typed during a pending save and writes them next', async () => {
    let finish!: () => void;
    const save = vi.fn((_title: string) => new Promise<void>(resolve => { finish = resolve; }));
    const view = field(save);
    view.change('第一版'); view.blur();
    view.change('第二版'); finish(); await settle(); view.blur();
    expect(save.mock.calls.map(call => call[0])).toEqual(['第一版', '第二版']);
    finish(); await settle();
  });
  it('keeps a failed edit available for retry, without replacing it with the old title', async () => {
    const save = vi.fn(async (_title: string) => {}).mockRejectedValueOnce(new Error('offline'));
    const view = field(save);
    view.change('仍要保存的标题'); view.blur(); await settle();
    view.key('Enter'); await settle();
    expect(save.mock.calls.map(call => call[0])).toEqual(['仍要保存的标题', '仍要保存的标题']);
  });
  it('does not save blank names, cancelled edits or an IME confirmation keystroke', () => {
    const view = field();
    view.change('   '); view.blur();
    view.change('中文输入中'); view.key('Enter', true);
    view.key('Escape'); view.blur();
    expect(view.save).not.toHaveBeenCalled();
  });
});
