import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ effects: [] as Array<() => any>, states: [] as any[], query: vi.fn(), setDetail: vi.fn(), setList: vi.fn(), save: vi.fn(), refetch: vi.fn(), invalidate: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useRef: (value: any) => ({ current: value }),
  useCallback: (value: any) => value,
  useState: (value: any) => { const index = mock.states.length; mock.states.push(typeof value === 'function' ? value() : value); return [mock.states[index], (next: any) => { mock.states[index] = typeof next === 'function' ? next(mock.states[index]) : next; }]; },
  useEffect: (effect: () => any) => { mock.effects.push(effect); },
}));
const chapter = { id: 2, storyId: 7, version: 3, title: '原稿', layout: null, blocks: { body:'原文', settings:null, coverKey:null, bodyTextureKey:null, illustrations:[] } };
vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({ client:{chapters:{get:{query:mock.query}}}, chapters:{get:{setData:mock.setDetail},list:{setData:mock.setList,invalidate:mock.invalidate}} }),
  chapters: { list:{useQuery:()=>({data:[chapter]})}, get:{useQuery:()=>({data:{chapter,imageUrls:{}},refetch:mock.refetch})}, save:{useMutation:()=>({mutateAsync:mock.save})} },
} }));
import { useChapters } from './useChapters';
let cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mock.states = []; mock.effects = [];
  vi.stubGlobal('window', Object.assign(new EventTarget(),{location:{search:''}}));
  vi.stubGlobal('document', Object.assign(new EventTarget(),{visibilityState:'visible'}));
  mock.query.mockResolvedValue({chapter:{...chapter,version:4},imageUrls:{}});
  mock.refetch.mockResolvedValue({}); mock.invalidate.mockResolvedValue(undefined);
  mock.save.mockResolvedValue({...chapter,version:5});
});
afterEach(() => { cleanups.forEach(clean => clean()); cleanups=[]; vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(canRelease = true) {
  const release = vi.fn(() => canRelease);
  const state = useChapters(7, release);
  cleanups = mock.effects.map(effect => effect()).filter(Boolean);
  return {state,release};
}
it('announces newer saved text even in a clean editor without silently adopting it', async () => {
  const {release,state} = setup();
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(mock.states).toContain(4);
  expect(release).not.toHaveBeenCalled();
  expect(mock.setDetail).not.toHaveBeenCalled();
  expect(state.version()).toBe(3);
  expect(mock.save).not.toHaveBeenCalled();
});
it('preserves dirty text and exposes the external version instead of advancing its save token', async () => {
  const {state} = setup(false);
  await vi.advanceTimersByTimeAsync(15000);
  expect(mock.setDetail).not.toHaveBeenCalled();
  expect(mock.states).toContain(4);
  expect(state.version()).toBe(3);
  await state.saveText({title:'草稿',body:'我的改动'});
  expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:3}));
});
it('rebases only after an explicitly compared version, retaining server CAS protection', async () => {
  const {state} = setup(false);
  await state.saveText({title:'合并稿',body:'复制旧稿后编辑'},4);
  expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:4}));
});
it('ignores late reads after leaving the story and removes polling listeners', async () => {
  let finish!: (value: unknown) => void;
  mock.query.mockImplementation(() => new Promise(resolve => {finish=resolve;}));
  setup(); window.dispatchEvent(new Event('focus'));
  cleanups.forEach(clean => clean()); cleanups=[];
  finish({chapter:{...chapter,version:4},imageUrls:{}});
  await vi.advanceTimersByTimeAsync(30000);
  expect(mock.setDetail).not.toHaveBeenCalled(); expect(mock.query).toHaveBeenCalledTimes(1);
});
it('offline or older responses never discard writing or advance its save version', async () => {
  const {state,release}=setup(false);
  mock.query.mockRejectedValueOnce(new Error('offline'));
  window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0);
  mock.query.mockResolvedValueOnce({chapter:{...chapter,version:2},imageUrls:{}});
  window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0);
  expect(release).not.toHaveBeenCalled(); expect(mock.setDetail).not.toHaveBeenCalled();
  expect(state.version()).toBe(3); expect(mock.save).not.toHaveBeenCalled();
});

it('accepts exactly the compared version only after the editor releases clean text', async () => {
  const {state,release} = setup();
  await state.acceptLatest(4);
  expect(release).toHaveBeenCalledWith(expect.objectContaining({version:4}));
  expect(mock.setDetail).toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
});
it('refuses acceptance if another browser saved again after comparison', async () => {
  const {state,release} = setup();
  mock.query.mockResolvedValue({chapter:{...chapter,version:5},imageUrls:{}});
  await expect(state.acceptLatest(4)).rejects.toThrow('又有新版本');
  expect(release).not.toHaveBeenCalled();
  expect(mock.setDetail).not.toHaveBeenCalled();
});
it('keeps independent local writing when acceptance cannot release the draft', async () => {
  const {state} = setup(false);
  await expect(state.acceptLatest(4)).rejects.toThrow('尚未保存');
  expect(mock.setDetail).not.toHaveBeenCalled();
});
