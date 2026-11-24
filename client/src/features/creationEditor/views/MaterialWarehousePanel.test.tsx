vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({}),
  creationAgent: { chatFrameReferences: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  storyAgent: { chatImageRevisions: { useQuery: () => ({ data: [] }) }, warehouseImageAttempts: { useQuery: () => ({ data: [] }) } },
  timelineMedia: { audioAssetLibrary: { useQuery: () => ({ data: [] }) } },
} }));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ select: vi.fn(), images: undefined as Array<{id:number;storyId:number;imageUrl:string;createdAt?:string}> | undefined }));
vi.mock('@/features/storyAgent/StoryAgentContext', () => ({ useStoryAgentActions: () => ({ setActiveSelection: mock.select }) }));
vi.mock('../CreationEditorContext', () => ({ useCreationEditor: () => ({
  activeStoryId: 7, shots: [], selectedShot: null, selectedShotNo: null,
  materialState: { storyId: 7, shots: [], warehouseImages: mock.images ?? [{ id: 19, storyId: 7, imageUrl: '/api/images/test.png', prompt: '虚构测试图' }] },
}) }));
import MaterialWarehousePanel from './MaterialWarehousePanel';
import { chatImageRefsStore } from '@/features/storyAgent/chatImageRefsStore';

beforeEach(() => { mock.images = undefined; vi.stubGlobal('React', React); chatImageRefsStore.getState().scopeToStory(7); chatImageRefsStore.getState().clear(); mock.select.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); chatImageRefsStore.getState().clear(); });

function draw(videoActions: boolean, insertIntoLayout = false) {
  const close = vi.fn();
  let select: (() => void) | undefined;
  let preview: (() => void) | undefined;
  let hover: ((event: {pointerType:string}) => void) | undefined;
  let edit: ((event: {preventDefault: () => void}) => void) | undefined;
  const create = React.createElement;
  vi.spyOn(React, 'createElement').mockImplementation(((type: any, props: any, ...children: any[]) => {
    if (type === 'button' && props?.['aria-label'] === '使用图片 19') select = props.onClick;
    if (type === 'button' && props?.['aria-label'] === '预览图片 19') { preview = props.onClick; hover = props.onPointerEnter; }
    if (type === 'button' && props?.['aria-label'] === '编辑图片 / Edit image 19') edit = props.onClick;
    return create(type, props, ...children);
  }) as typeof React.createElement);
  const html = renderToStaticMarkup(<MaterialWarehousePanel variant="drawer" videoActions={videoActions} insertIntoLayout={insertIntoLayout} onClose={close} />);
  return { html, close, select: () => select!(), edit: () => edit!({preventDefault: vi.fn()}), preview: () => preview!(), hover: () => hover!({pointerType:"mouse"}) };
}

it('puts newest images at the left, with missing dates last and stable ties', () => {
  mock.images = [
    {id:19,storyId:7,imageUrl:'/old.png',createdAt:'2026-11-10T00:00:00Z'},
    {id:21,storyId:7,imageUrl:'/unknown.png'},
    {id:22,storyId:7,imageUrl:'/latest.png',createdAt:'2026-11-15T00:00:00Z'},
    {id:20,storyId:7,imageUrl:'/same-time.png',createdAt:'2026-11-15T00:00:00Z'},
  ];
  const {html}=draw(false);
  expect(html.indexOf('预览图片 22')).toBeLessThan(html.indexOf('预览图片 20'));
  expect(html.indexOf('预览图片 20')).toBeLessThan(html.indexOf('预览图片 19'));
  expect(html.indexOf('预览图片 19')).toBeLessThan(html.indexOf('预览图片 21'));
  expect(chatImageRefsStore.getState().refs).toEqual([]);
});

it('uses the existing warehouse in book/image views and adds the chosen image to chat without changing the writing target', () => {
  const view = draw(false);
  expect(view.html).toContain('素材仓库悬浮窗');
  expect(view.html).toContain('预览图片 19');
  expect(view.html).not.toContain('绑定到当前镜头');
  view.select(); view.select();
  expect(chatImageRefsStore.getState().refs).toMatchObject([{ imageId: 19, imageUrl: '/api/images/test.png' }]);
  expect(chatImageRefsStore.getState().refs).toHaveLength(1);
  expect(mock.select).not.toHaveBeenCalled();
});

it('previewing an image does not insert it or change the writing selection', () => {
  const dispatchEvent=vi.fn(); vi.stubGlobal('window',{dispatchEvent});
  const view=draw(false,true);
  view.preview();
  expect(dispatchEvent).not.toHaveBeenCalled();
  expect(mock.select).not.toHaveBeenCalled();
  expect(chatImageRefsStore.getState().refs).toEqual([]);
});

it('preserves video selection and shot binding when opened from video', () => {
  const dispatchEvent=vi.fn(); vi.stubGlobal('window',{dispatchEvent});
  const view = draw(true);
  expect(view.html).toContain('绑定到当前镜头');
  view.edit();
  expect(view.close).not.toHaveBeenCalled();
  expect(mock.select).toHaveBeenCalledWith(expect.objectContaining({ imageId: 19, storyId: 7 }));
  expect(chatImageRefsStore.getState().refs).toEqual([]);
  expect(dispatchEvent.mock.calls[0][0].detail).toEqual({ kind: 'clear', storyId: 7 });
  expect(dispatchEvent.mock.calls[1][0].type).toBe('dt:open-creation-chat');
  expect(dispatchEvent.mock.calls[1][0].detail).toMatchObject({ preserveSelection: true, focusComposer: true, imageId: 19, storyId: 7 });
  expect(view.html).not.toContain('使用图片 19');
});

it('requests insertion into the current layout using only story and image identity', () => {
  const dispatchEvent = vi.fn((event: Event) => { event.preventDefault(); return false; });
  vi.stubGlobal('window', { dispatchEvent });
  const view = draw(false, true);
  view.select();
  const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
  expect(event.type).toBe('dt:insert-warehouse-image');
  expect(event.detail).toEqual({ storyId: 7, imageId: 19 });
  expect(chatImageRefsStore.getState().refs).toEqual([]);
});

it('hover previews without inserting or replacing the thumbnail grid', () => {
  const dispatchEvent=vi.fn(); vi.stubGlobal('window',{dispatchEvent});
  const view=draw(false,true);
  view.hover();
  expect(dispatchEvent).not.toHaveBeenCalled();
  expect(view.html).toContain('84px');
  expect(view.html).toContain('flex-nowrap');
  expect(view.html).toContain('overflow-x-auto');
  expect(view.html).not.toContain('grid-cols-');
  expect(view.html).not.toContain('← 全部图片');
  expect(chatImageRefsStore.getState().refs).toEqual([]);
});
