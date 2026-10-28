import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('@/features/storyAgent/StoryAgentContext', () => ({ useStoryAgentActions: () => ({ setActiveSelection: mock.select }) }));
vi.mock('../CreationEditorContext', () => ({ useCreationEditor: () => ({
  activeStoryId: 7, shots: [], selectedShot: null, selectedShotNo: null,
  materialState: { shots: [], warehouseImages: [{ id: 19, storyId: 7, imageUrl: '/api/images/test.png', prompt: '虚构测试图' }] },
}) }));
import MaterialWarehousePanel from './MaterialWarehousePanel';
import { chatImageRefsStore } from '@/features/storyAgent/chatImageRefsStore';

beforeEach(() => { vi.stubGlobal('React', React); chatImageRefsStore.getState().scopeToStory(7); chatImageRefsStore.getState().clear(); mock.select.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); chatImageRefsStore.getState().clear(); });

function draw(videoActions: boolean, insertIntoLayout = false) {
  let select: (() => void) | undefined;
  let preview: (() => void) | undefined;
  let hover: ((event: {pointerType:string}) => void) | undefined;
  const create = React.createElement;
  vi.spyOn(React, 'createElement').mockImplementation(((type: any, props: any, ...children: any[]) => {
    if (type === 'button' && props?.['aria-label'] === '使用图片 19') select = props.onClick;
    if (type === 'button' && props?.['aria-label'] === '预览图片 19') { preview = props.onClick; hover = props.onPointerEnter; }
    return create(type, props, ...children);
  }) as typeof React.createElement);
  const html = renderToStaticMarkup(<MaterialWarehousePanel variant="drawer" videoActions={videoActions} insertIntoLayout={insertIntoLayout} onClose={vi.fn()} />);
  return { html, select: () => select!(), preview: () => preview!(), hover: () => hover!({pointerType:"mouse"}) };
}

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
  const view = draw(true);
  expect(view.html).toContain('绑定到当前镜头');
  view.select();
  expect(mock.select).toHaveBeenCalledWith(expect.objectContaining({ imageId: 19, storyId: 7 }));
  expect(chatImageRefsStore.getState().refs).toEqual([]);
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
