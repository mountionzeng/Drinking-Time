import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], state: 0, ref: 0, effects: [] as Array<() => void> }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState(initial: any) { const i = hooks.state++; if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? initial() : initial; return [hooks.states[i], (next: any) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef(initial: any) { const i = hooks.ref++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
  useMemo: (fn: () => any) => fn(), useCallback: (fn: any) => fn, useEffect() {},
  useLayoutEffect: (fn: () => void) => { hooks.effects.push(fn); },
}));
import { ChapterTextModules } from './ChapterTextModules';
import { BookBlockCanvas } from './BookBlockCanvas';
import { ChapterWriting } from './ChapterWriting';
import { DesktopWritingContext } from '../writingCompanion/DesktopWritingContext';
import { newWritingBlock } from './chapterBlockTree';

function nodes(node: any): any[] { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function render(fn: () => any) { hooks.state = hooks.ref = 0; hooks.effects = []; const tree = fn(); hooks.effects.forEach(fn => fn()); return tree; }
beforeEach(() => {
  hooks.states = []; hooks.refs = [];
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});

it('tracks focus, typing, Enter and canvas selection through the existing context callback', () => {
  let value = '第一段\n重复\n重复';
  const selection = { current: null } as any;
  const onContextChange = vi.fn();
  const draw = () => {
    const tree = render(() => ChapterTextModules({ value, onChange: next => { value = next; }, disabled: false, selection,
      contextSource: { storyId: 7, scope: 'a:7:v1', chapterId: '2' }, onContextChange }));
    return nodes(tree).find(node => node.type === BookBlockCanvas).props;
  };
  let canvas = draw();
  const field = (index: number) => canvas.children(canvas.blocks[index], index, {}).props;
  field(2).onFocus({ currentTarget: { selectionStart: 1, selectionEnd: 1 } });
  canvas = draw();
  expect(onContextChange.mock.lastCall?.[0]).toMatchObject({ text: '重复', line: { position: { index: 2 } } });
  const id = canvas.activeId;
  field(2).onChange({ currentTarget: { value: '最新输入', selectionStart: 4 } });
  canvas = draw();
  expect(onContextChange.mock.lastCall?.[0]).toMatchObject({ moduleId: id, text: '最新输入' });
  // Moving focus to chat does not call any deselection handler on the editor.
  expect(field(2).onBlur).toBeUndefined();
  canvas.onSelect(canvas.blocks[0].id); canvas = draw();
  expect(onContextChange.mock.lastCall?.[0]?.text).toBe('第一段');
  canvas.onSelect(null); canvas = draw();
  expect(onContextChange.mock.lastCall?.[0]).toBeNull();
  field(1).onKeyDown({ key: 'Enter', nativeEvent: {}, currentTarget: { selectionStart: 1, selectionEnd: 1 }, preventDefault: vi.fn() });
  // Avoid DOM focus in the hook harness; the browser check covers real focus restoration.
  hooks.refs.forEach(ref => { if (ref?.current?.start !== undefined) ref.current = null; });
  canvas = draw();
  expect(onContextChange.mock.lastCall?.[0]?.text).toBe('复');
});

it('the chapter chat snapshot carries the selected block and rejects an old version scope', () => {
  const tree = render(() => ChapterWriting({ chapter: { id: 2, storyId: 7, version: 3, title: '标题', blocks: { body: '原文' } } as any,
    scope: 'account1:story7', handle: { current: null }, save: vi.fn(), onChange: vi.fn(), disabled: false }));
  const context = nodes(tree).find(node => node.type === DesktopWritingContext).props;
  const editor = nodes(tree).find(node => node.type === ChapterTextModules).props;
  const module = { storyId: 7, scope: editor.contextSource.scope, moduleId: 'b2', text: '新内容' };
  editor.onChange('新内容'); editor.onContextChange(module);
  expect(context.getSnapshot()).toMatchObject({ draft: '新内容', module });
  editor.onContextChange({ ...module, scope: 'other-story' });
  expect(context.getSnapshot().module).toBeUndefined();
});

it('keeps block identity, heading format, undo and chat target while editing beside an older version', () => {
  let value = '标题\n蓝色纸船';
  let compare = false;
  const onContextChange = vi.fn();
  const draw = () => render(() => ChapterTextModules({value, onChange: next => { value = next; }, disabled:false,
    selection: {current:null}, contextSource:{storyId:7,scope:'a:7',chapterId:'2'}, onContextChange,
    comparison: compare ? {body:'标题\n红色纸船',title:'纸船',label:'版本 1'} : undefined}));
  let tree = draw();
  let canvas = nodes(tree).find(node => node.type === BookBlockCanvas).props;
  const id = canvas.blocks[1].id;
  canvas.onCommit(canvas.blocks.map((block: any, index: number) => index === 0 ? {...block,format:'heading1'} : block), id, false);
  compare = true; tree = draw();
  let field = nodes(tree).find(node => node.type === 'textarea' && node.props['aria-label'] === '文字模块 2').props;
  field.onChange({currentTarget:{value:'绿色纸船',selectionStart:4}});
  tree = draw();
  expect(value).toBe('标题\n绿色纸船');
  expect(onContextChange.mock.lastCall?.[0]).toMatchObject({moduleId:id,text:'绿色纸船'});
  field = nodes(tree).find(node => node.type === 'textarea' && node.props['aria-label'] === '文字模块 2').props;
  field.onKeyDown({key:'z',ctrlKey:true,nativeEvent:{},currentTarget:{selectionStart:4,selectionEnd:4},preventDefault:vi.fn()});
  hooks.refs.forEach(ref => { if (ref?.current?.start !== undefined) ref.current = null; });
  compare = false; tree = draw();
  canvas = nodes(tree).find(node => node.type === BookBlockCanvas).props;
  expect(value).toBe('标题\n蓝色纸船');
  expect(canvas.blocks[0].format).toBe('heading1');
  expect(canvas.blocks[1].id).toBe(id);
});

it('canvas format focus, drag and resize select the same block; blank paper clears it', () => {
  const block = newWritingBlock('纸船');
  const onSelect = vi.fn(), onCommit = vi.fn();
  const tree = render(() => BookBlockCanvas({ blocks: [block], disabled: false, activeId: block.id, onSelect, onCommit, children: () => null }));
  const all = nodes(tree);
  all.find(node => node.props?.['data-book-block']).props.onFocusCapture();
  expect(onSelect).toHaveBeenLastCalledWith(block.id);
  const button = all.find(node => node.props?.['aria-label'] === '模块 1 右下角缩放').props;
  const event = { button: 0, pointerId: 1, clientX: 10, clientY: 20, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { focus: vi.fn(), setPointerCapture: vi.fn() } };
  button.onPointerDown(event);
  expect(onSelect).toHaveBeenLastCalledWith(block.id);
  const canvas = all.find(node => node.props?.['aria-label'] === '书页');
  canvas.props.onPointerMove({ ...event, clientX: 50, clientY: 60 }); canvas.props.onPointerUp(event);
  expect(onCommit.mock.lastCall?.[1]).toBe(block.id);
  const paper = {};
  all.find(node => node.type === 'section').props.onPointerDown({ target: paper, currentTarget: paper });
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

it('pointer dragging inserts a paragraph into a heading; cancelling leaves the manuscript untouched', () => {
  const heading = { ...newWritingBlock('标题'), format: 'heading2' as const, collapsed: true };
  const paragraph = newWritingBlock('纸船');
  const onCommit = vi.fn();
  const tree = render(() => BookBlockCanvas({ blocks: [heading, paragraph], disabled: false, activeId: paragraph.id, onSelect: vi.fn(), onCommit, children: () => null }));
  const canvas = nodes(tree).find(node => node.props?.['aria-label'] === '书页');
  canvas.props.ref.current = { setPointerCapture: vi.fn(), querySelectorAll: () => [
    { dataset: { bookBlock: heading.id }, getBoundingClientRect: () => ({ top: 20, bottom: 80 }) },
    { dataset: { bookBlock: paragraph.id }, getBoundingClientRect: () => ({ top: 100, bottom: 160 }) },
  ] };
  const handle = nodes(tree).find(node => node.props?.['aria-label'] === '拖动模块 2').props;
  const event = { button: 0, pointerId: 1, clientX: 30, clientY: 130, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { focus: vi.fn() } };
  handle.onPointerDown(event);
  canvas.props.onPointerMove({ ...event, clientY: 50 });
  canvas.props.onPointerCancel(event);
  expect(onCommit).not.toHaveBeenCalled();
  handle.onPointerDown(event);
  canvas.props.onPointerMove({ ...event, clientY: 50 });
  canvas.props.onPointerUp(event);
  expect(onCommit.mock.lastCall?.[0]).toMatchObject([{ id: heading.id, collapsed: false }, { id: paragraph.id, parentId: heading.id }]);
  expect(onCommit.mock.lastCall?.[1]).toBe(paragraph.id);
});
