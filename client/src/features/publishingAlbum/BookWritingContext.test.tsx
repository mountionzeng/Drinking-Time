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
import { useBookMediaSession } from './bookMediaSession';
import { useBookModuleActions } from './bookModuleActions';
import { newWritingBlock } from './chapterBlockTree';
import { BookImageImportBoundary } from './BookImageImportBoundary';
import { captureBookImageAnchor } from './bookImageInsert';

function nodes(node: any): any[] { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function textField(canvas: any, index: number) { return nodes(canvas.children(canvas.blocks[index], index, {})).find(node => node.type === 'textarea').props; }
function render(fn: () => any) { hooks.state = hooks.ref = 0; hooks.effects = []; const tree = fn(); hooks.effects.forEach(fn => fn()); return tree; }
beforeEach(() => {
  hooks.states = []; hooks.refs = [];
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});

it('inserts multiple uploaded images at the captured cursor as one undoable edit', () => {
  let value = '甲乙丙丁\n尾段';
  const draw = () => nodes(render(() => ChapterTextModules({ value, onChange: next => { value = next; }, disabled: false,
    selection: { current: null }, contextSource: { storyId: 7, scope: 'import', chapterId: '2' } })));
  let tree = draw();
  const boundary = tree.find(node => node.type === BookImageImportBoundary).props;
  const anchor = captureBookImageAnchor(boundary.blocks, boundary.blocks[0].id, 2);
  boundary.onInsert(anchor, ['/api/images/a.png', '/api/images/b.png']);
  tree = draw();
  expect(value).toBe('甲乙\n![图片](/api/images/a.png)\n![图片](/api/images/b.png)\n丙丁\n尾段');
  const canvas = tree.find(node => node.type === BookBlockCanvas).props;
  textField(canvas, 0).onKeyDown({ key: 'z', ctrlKey: true, nativeEvent: {}, currentTarget: { selectionStart: 0, selectionEnd: 0 }, preventDefault: vi.fn() });
  hooks.refs.forEach(ref => { if (ref?.current?.start !== undefined) ref.current = null; });
  draw();
  expect(value).toBe('甲乙丙丁\n尾段');
});

it('applies a captured chat rewrite through the editor undo flow, not the later selection', () => {
  let value='前文\n中文原文\nEnglish original\n后文';
  const selection={current:null} as any;
  const context=vi.fn();
  const draw=()=>nodes(render(()=>ChapterTextModules({value,onChange:next=>{value=next;},disabled:false,selection,onContextChange:context,contextSource:{storyId:7,scope:'rewrite',chapterId:'2'}}))).find(node=>node.type===BookBlockCanvas).props;
  let canvas=draw();
  canvas.onSelectionChange([canvas.blocks[1].id,canvas.blocks[2].id]);canvas=draw();
  const target=useBookModuleActions.getState().session!.captureRewrite!(context.mock.lastCall![0])!;
  canvas.onSelect(canvas.blocks[3].id);canvas=draw();
  useBookModuleActions.getState().session!.replaceRewrite!(target,'新中文\nNew English');
  canvas=draw();
  expect(value).toBe('前文\n新中文\nNew English\n后文');
  expect(()=>useBookModuleActions.getState().session!.replaceRewrite!(target,'重复')).toThrow('原文已变化');
  textField(canvas,1).onKeyDown({key:'z',ctrlKey:true,nativeEvent:{},currentTarget:{selectionStart:0,selectionEnd:0},preventDefault:vi.fn()});
  hooks.refs.forEach(ref=>{if(ref?.current?.start!==undefined)ref.current=null;});
  draw();
  expect(value).toBe('前文\n中文原文\nEnglish original\n后文');
  expect(()=>useBookModuleActions.getState().session!.replaceRewrite!({...target,scope:'different'},'新')).toThrow('对应的文章');
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
  const field = (index: number) => textField(canvas, index);
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
  const blurredField = { selectionStart: 0, selectionEnd: 2, ownerDocument: { activeElement: null } };
  field(0).onSelect({ currentTarget: blurredField }); canvas = draw();
  expect(onContextChange.mock.lastCall?.[0]).toBeNull();
  expect(selection.current).toBeNull();
  const focusedField = { ...blurredField, ownerDocument: {} as any };
  focusedField.ownerDocument.activeElement = focusedField;
  field(0).onSelect({ currentTarget: focusedField }); canvas = draw();
  expect(onContextChange.mock.lastCall?.[0]?.text).toBe('第一段');
  expect(selection.current).toEqual({ start: 0, end: 2 });
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
  editor.selection.current = { start: 0, end: 2 };
  expect(context.getSnapshot().selection).toEqual({ start: 0, end: 2 });
  editor.onContextChange(null);
  expect(editor.selection.current).toBeNull();
  expect(context.getSnapshot()).toMatchObject({ draft:'新内容', cursor:3 });
  expect(context.getSnapshot().module).toBeUndefined();
  expect(context.getSnapshot().selection).toBeUndefined();
  editor.selection.current = { start: 0, end: 2 };
  editor.onContextChange({ ...module, scope: 'other-story' });
  expect(context.getSnapshot().module).toBeUndefined();
  expect(context.getSnapshot().selection).toBeUndefined();
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
  const paper = { closest: () => null };
  canvas.props.ref.current = { focus: vi.fn(), setPointerCapture: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  all.find(node => node.props?.['aria-label'] === '文章缩放视图').props.onPointerDown({ ...event, pointerType: 'mouse', target: paper, currentTarget: paper });
  expect(onSelect).toHaveBeenLastCalledWith(null);
  canvas.props.onKeyDown({ key:'Escape' });
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

it('marquee from the page gutter exposes a shared resize handle and reports the entire selection', () => {
  const blocks=['第一块','第二块','未选'].map(text=>newWritingBlock(text));
  const onSelectionChange=vi.fn(), onCommit=vi.fn();
  const draw=()=>render(()=>BookBlockCanvas({blocks,disabled:false,activeId:null,onSelect:vi.fn(),onSelectionChange,onCommit,children:()=>null}));
  let tree=draw();
  let canvas=nodes(tree).find(node=>node.props?.['aria-label']==='书页');
  canvas.props.ref.current={focus:vi.fn(),setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,top:0}),querySelectorAll:(selector:string)=>selector==='[data-book-math-preview]'?[]:blocks.map((block,i)=>({dataset:{bookBlock:block.id},getBoundingClientRect:()=>({left:20,right:200,top:50+i*70,bottom:100+i*70})}))};
  const event={button:0,pointerId:1,pointerType:'mouse',clientX:5,clientY:40,target:{closest:()=>null},preventDefault:vi.fn(),stopPropagation:vi.fn(),currentTarget:{focus:vi.fn()}};
  nodes(tree).find(node=>node.props?.['aria-label']==='文章缩放视图').props.onPointerDown(event);
  canvas.props.onPointerMove({...event,clientX:210,clientY:175}); canvas.props.onPointerUp(event);
  tree=draw();
  expect(onSelectionChange).toHaveBeenLastCalledWith([blocks[0].id,blocks[1].id]);
  const handle=nodes(tree).find(node=>node.props?.['aria-label']==='选中模块整体右下角缩放');
  expect(handle).toBeDefined(); handle.props.onPointerDown(event);
  canvas=nodes(tree).find(node=>node.props?.['aria-label']==='书页');
  canvas.props.onPointerMove({...event,clientX:85,clientY:40});canvas.props.onPointerUp(event);
  const next=onCommit.mock.lastCall?.[0];
  expect(next[0].book.fontSize).toBe(36);expect(next[1].book.fontSize).toBe(36);expect(next[2]).toBe(blocks[2]);
});
it('forwards multiselection from canvas to the writing conversation and returns to one block when typing', () => {
  const value='第一块\n第二块';const onContextChange=vi.fn();
  const draw=()=>render(()=>ChapterTextModules({value,onChange:vi.fn(),disabled:false,selection:{current:null},onContextChange,contextSource:{storyId:7,scope:'group',chapterId:'2'}}));
  let tree=draw();let canvas=nodes(tree).find(node=>node.type===BookBlockCanvas).props;
  canvas.onSelectionChange(canvas.blocks.map((block:any)=>block.id));tree=draw();
  expect(onContextChange.mock.lastCall?.[0].selection.count).toBe(2);
  expect(onContextChange.mock.lastCall?.[0].text).toContain('第二块');
  canvas=nodes(tree).find(node=>node.type===BookBlockCanvas).props;
  textField(canvas,0).onFocus({currentTarget:{selectionStart:0,selectionEnd:0}});draw();
  expect(onContextChange.mock.lastCall?.[0].selection).toBeUndefined();
  expect(onContextChange.mock.lastCall?.[0].text).toBe('第一块');
});

it('mixed image/text selection closes the single-image edit session', () => {
  const value='![图片](https://example.com/image.png)\n配图文字';
  const draw=()=>render(()=>ChapterTextModules({value,onChange:vi.fn(),disabled:false,selection:{current:null},formatScope:'test-group',prepareMedia:async()=>{},contextSource:{storyId:7,scope:'mixed',chapterId:'2'}}));
  let tree=draw();let canvas=nodes(tree).find(node=>node.type===BookBlockCanvas).props;
  canvas.onSelect(canvas.blocks[0].id); tree=draw();
  expect(useBookMediaSession.getState().session?.moduleId).toBe(canvas.blocks[0].id);
  canvas=nodes(tree).find(node=>node.type===BookBlockCanvas).props;
  canvas.onSelectionChange(canvas.blocks.map((block:any)=>block.id));draw();
  expect(useBookMediaSession.getState().session).toBeNull();
});

it('inserts a conversion after its source, retains the original, and rejects a changed source', async()=>{
 const {BookModuleConvert}=await import('./BookModuleConvert');
 let value='第一段\n第二段';const prepareMedia=vi.fn(async()=>{});
 const draw=()=>render(()=>ChapterTextModules({value,onChange:next=>{value=next;},disabled:false,selection:{current:null},prepareMedia,contextSource:{storyId:7,scope:'test',chapterId:'2'}}));
 let tree=draw(),canvas=nodes(tree).find(n=>n.type===BookBlockCanvas).props;
 canvas.onConvert(canvas.blocks[0].id,'music');tree=draw();
 let conversion=nodes(tree).find(n=>n.type===BookModuleConvert).props;
 await conversion.prepare();conversion.onInsert('生成的结果');
 expect(value).toBe('第一段\n生成的结果\n第二段');
 tree=draw();canvas=nodes(tree).find(n=>n.type===BookBlockCanvas).props;canvas.onConvert(canvas.blocks[0].id,'image');
 tree=draw();conversion=nodes(tree).find(n=>n.type===BookModuleConvert).props;
 canvas=nodes(tree).find(n=>n.type===BookBlockCanvas).props;
 canvas.onCommit(canvas.blocks.map((b:any,i:number)=>i===0?{...b,text:'已改写'}:b),canvas.blocks[0].id,false);draw();
 expect(()=>conversion.onInsert('不应插入')).toThrow('原模块已变化');
 expect(value).not.toContain('不应插入');
});

it('editing a merged multiline module preserves its boundary, context, saving and undo',async()=>{
 const {writingStyleOf,restoreStyledBlocks}=await import('./chapterBlockTree');
 let initial=['甲\n\n乙','尾段'].map(t=>newWritingBlock(t));
 let value=initial.map(b=>b.text).join('\n'),writingStyle=writingStyleOf(initial);
 const context=vi.fn(),selection={current:null} as any;
 const draw=()=>nodes(render(()=>ChapterTextModules({value,writingStyle,onFormattedChange:(body,style)=>{value=body;writingStyle=style;},onChange:vi.fn(),disabled:false,selection,onContextChange:context,contextSource:{storyId:7,scope:'merged',chapterId:'2'}}))).find(n=>n.type===BookBlockCanvas).props;
 let canvas=draw();
 textField(canvas,0).onChange({currentTarget:{value:'甲改\n\n乙',selectionStart:2}});
 canvas=draw();expect(canvas.blocks).toHaveLength(2);expect(context.mock.lastCall?.[0].text).toBe('甲改\n\n乙');
 expect(restoreStyledBlocks(value,writingStyle).map(b=>b.text)).toEqual(['甲改\n\n乙','尾段']);
 textField(canvas,1).onFocus({currentTarget:{selectionStart:1,selectionEnd:1}});
 expect(selection.current.start).toBe('甲改\n\n乙\n'.length+1);
 textField(canvas,0).onKeyDown({key:'z',ctrlKey:true,nativeEvent:{},currentTarget:{selectionStart:2,selectionEnd:2},preventDefault:vi.fn()});
 hooks.refs.forEach(ref=>{if(ref?.current?.start!==undefined)ref.current=null;});
 canvas=draw();expect(canvas.blocks.map((b:any)=>b.text)).toEqual(['甲\n\n乙','尾段']);
});

it('mobile module commands reuse conversion and merge, preserve lines and reject stale editors', async () => {
  const { useBookModuleActions } = await import('./bookModuleActions');
  const { BookModuleConvert } = await import('./BookModuleConvert');
  let value = '第一段\n第二段\n第三段';
  const draw = () => render(() => ChapterTextModules({ value, onChange: next => { value = next; },
    prepareMedia: async () => {}, disabled: false, selection: { current: null },
    contextSource: { storyId: 7, scope: '9:7:chapter:2', chapterId: '2' },
  }));
  draw();
  const first = useBookModuleActions.getState().session!;
  const [a, b, c] = first.modules;
  first.convert(b.id, 'image');
  let tree = draw();
  expect(nodes(tree).find(node => node.type === BookModuleConvert).props.source).toEqual({ id: b.id, text: '第二段', kind: 'image' });
  expect(() => first.merge([a.id, b.id])).toThrow('文章已变化');
  useBookModuleActions.getState().session!.convert(c.id, 'music');
  tree = draw();
  expect(nodes(tree).find(node => node.type === BookModuleConvert).props.source).toMatchObject({ id: c.id, text: '第三段', kind: 'music' });
  useBookModuleActions.getState().session!.merge([b.id, a.id]);
  tree = draw();
  const canvas = nodes(tree).find(node => node.type === BookBlockCanvas).props;
  expect(canvas.blocks).toHaveLength(2);
  expect(canvas.blocks[0]).toMatchObject({ id: a.id, text: '第一段\n第二段' });
  expect(value).toBe('第一段\n第二段\n第三段');
});

it('applies generated prose through the mounted book editor, saving the original before the new version', async () => {
  let version = 3;
  const save = vi.fn(async (draft: any) => ({ id: 2, storyId: 7, version: ++version, title: draft.title, blocks: { body: draft.body, writingStyle: draft.writingStyle } }));
  const tree = render(() => ChapterWriting({ chapter: {id:2,storyId:7,version:3,title:'原题',blocks:{body:'原稿'}} as any,
    scope:'9:7',handle:{current:null},save,onChange:vi.fn(),disabled:false }));
  const context = nodes(tree).find(node => node.type === DesktopWritingContext).props;
  const editor = nodes(tree).find(node => node.type === ChapterTextModules).props;
  editor.onChange('未保存的旧稿');
  const expected = context.getSnapshot();
  await context.applyGenerated('生成的新稿', expected);
  expect(save.mock.calls.map(call => call[0].body)).toEqual(['未保存的旧稿','生成的新稿']);
  expect(save.mock.calls[1][0].title).toBe('原题');
  expect(context.getSnapshot().draft).toBe('生成的新稿');
  await expect(context.applyGenerated('不能覆盖', expected)).rejects.toThrow('书稿已变化');
  expect(save).toHaveBeenCalledTimes(2);
});

vi.mock("@/features/uiLanguage/UiLanguage", async (importOriginal) => {
 const actual = await importOriginal<typeof import("@/features/uiLanguage/UiLanguage")>();
 return {...actual, useUiText: () => (source: string, values?: readonly (string | number | null | undefined)[]) => actual.translateUi("zh", source, values), useUiLanguage: () => ({ language: "zh", setLanguage: () => {} })};
});

it('shows imported chapters numbered and folded without writing the source document', () => {
  const blocks = [
    { ...newWritingBlock('First'), id: 'chapter-a', format: 'heading1' as const },
    { ...newWritingBlock('Original text', 'chapter-a'), id: 'text-a' },
    { ...newWritingBlock('Photo', 'chapter-a'), id: 'photo-a' },
    { ...newWritingBlock('Second'), id: 'chapter-b', format: 'heading1' as const },
    { ...newWritingBlock('Other text', 'chapter-b'), id: 'text-b' },
  ];
  const original = JSON.stringify(blocks), onCommit = vi.fn();
  const draw = () => render(() => BookBlockCanvas({ blocks, importedChapterIds: ['chapter-a', 'chapter-b'], disabled: false,
    activeId: null, onSelect: vi.fn(), onCommit, children: block => <span>{block.text}</span> }));
  let tree = draw();
  expect(nodes(tree).filter(node => node.props?.['aria-expanded'] === false)).toHaveLength(2);
  expect(nodes(tree).some(node => node.props?.['data-book-block'] === 'text-a')).toBe(false);
  nodes(tree).find(node => node.props?.['aria-expanded'] === false).props.onClick();
  tree = draw();
  expect(nodes(tree).some(node => node.props?.['data-book-block'] === 'text-a')).toBe(true);
  expect(nodes(tree).some(node => node.props?.['data-book-block'] === 'photo-a')).toBe(true);
  expect(nodes(tree).some(node => node.props?.['data-book-block'] === 'text-b')).toBe(false);
  nodes(tree).find(node => node.props?.['aria-label'] === '收起第一章').props.onClick();
  tree = draw();
  expect(nodes(tree).some(node => node.props?.['data-book-block'] === 'text-a')).toBe(false);
  expect(onCommit).not.toHaveBeenCalled();
  expect(JSON.stringify(blocks)).toBe(original);
});

it('adds text inside an opened imported chapter even if its saved fold flag was closed', () => {
  let value = 'First';
  let style: any = [{ id: 'chapter-a', parentId: null, format: 'heading1', collapsed: true, lineCount: 1 }];
  const draw = () => render(() => ChapterTextModules({ value, onChange: next => { value = next; }, disabled: false,
    importedChapterIds: ['chapter-a'], writingStyle: style,
    onFormattedChange: (next, nextStyle) => { value = next; style = nextStyle; }, selection: { current: null } }));
  let tree = draw();
  const canvas = nodes(tree).find(node => node.type === BookBlockCanvas).props;
  const field = textField(canvas, 0);
  field.onKeyDown({ key: 'Enter', nativeEvent: {}, currentTarget: { selectionStart: 5, selectionEnd: 5 }, preventDefault: vi.fn() });
  hooks.refs.forEach(ref => { if (ref?.current?.start !== undefined) ref.current = null; });
  tree = draw();
  const after = nodes(tree).find(node => node.type === BookBlockCanvas).props.blocks;
  expect(after).toHaveLength(2);
  expect(after[1].parentId).toBe('chapter-a');
});

it.each(['image', 'audio'] as const)('inserts %s inside an open imported chapter with an old saved fold flag', kind => {
  let value = 'First';
  let style: any = [{ id: 'chapter-a', parentId: null, format: 'heading1', collapsed: true, lineCount: 1 }];
  const imageInsert = { current: null } as any;
  const draw = () => render(() => ChapterTextModules({ value, onChange: next => { value = next; }, disabled: false,
    importedChapterIds: ['chapter-a'], writingStyle: style, imageInsert,
    contextSource: { storyId: 7, scope: 'account:story', chapterId: '2' }, prepareMedia: async () => {},
    onFormattedChange: (next, nextStyle) => { value = next; style = nextStyle; }, selection: { current: null } }));
  let tree = draw();
  nodes(tree).find(node => node.type === BookBlockCanvas).props.onSelect('chapter-a');
  tree = draw();
  if (kind === 'image') imageInsert.current('/uploads/sample.png');
  else nodes(tree).find(node => node.type?.name === 'BookMusicInsert').props.onInsert('audio fixture');
  hooks.refs.forEach(ref => { if (ref?.current?.start !== undefined) ref.current = null; });
  tree = draw();
  const after = nodes(tree).find(node => node.type === BookBlockCanvas).props.blocks;
  expect(after).toHaveLength(2);
  expect(after[1].parentId).toBe('chapter-a');
});
