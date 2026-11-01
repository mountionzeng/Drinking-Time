import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as any[], index: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState(initial: any) { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (next: any) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
}));
const fixture = vi.hoisted(() => ({ session: null as any }));
vi.mock('@/features/publishingAlbum/bookModuleActions', () => ({ useBookModuleActions: (selector: any) => selector(fixture) }));
import { MobileBookModuleActions } from './MobileBookModuleActions';
const module = { storyId: 7, scope: '9:7:chapter:2', moduleId: 'b', kind: 'text' } as any;
function nodes(node: any): any[] { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
const onAction = vi.fn();
function render() { hooks.index = 0; return nodes(MobileBookModuleActions({ module, disabled: false, onAction })); }
beforeEach(() => {
  hooks.states = []; onAction.mockClear(); vi.stubGlobal('React', React);
  fixture.session = { storyId: 7, scope: module.scope, modules: [{id:'a',text:'第一段'},{id:'b',text:'第二段'}], convert:vi.fn(), merge:vi.fn() };
});
it('opens conversion for exactly the selected module', () => {
  render().find(node => node.props?.children === '生成音乐')!.props.onClick();
  expect(fixture.session.convert).toHaveBeenCalledWith('b', 'music');
  expect(onAction).toHaveBeenCalledOnce();
});
it('lets touch users choose modules before merging', () => {
  render().find(node => node.props?.children === '合并模块')!.props.onClick();
  const inputs = render().filter(node => node.type === 'input');
  expect(inputs.map(node => node.props.checked)).toEqual([false, true]);
  inputs[0].props.onChange({ target: { checked: true } });
  const confirm = render().filter(node => node.type === 'button').at(-1)!;
  expect(confirm.props.disabled).toBe(false);
  confirm.props.onClick();
  expect(fixture.session.merge).toHaveBeenCalledWith(['b', 'a']);
});
it('rejects commands from another editor scope', () => {
  fixture.session.scope = '9:8:chapter:2';
  expect(render()).toEqual([]);
});
it('keeps the chat open when the editor rejects a stale operation', () => {
  fixture.session.convert.mockImplementation(() => { throw new Error('文章已变化'); });
  render().find(node => node.props?.children === '生成图片')!.props.onClick();
  expect(render().some(node => node.props?.role === 'alert' && node.props.children === '文章已变化')).toBe(true);
  expect(onAction).not.toHaveBeenCalled();
});
