import { createWorkspaceStore } from '../../miniprogram/src/core/workspaceState';
import { createMockTransport, DEMO_RECOVERY_SCOPE } from '../../miniprogram/src/services/mockTransport';
import { createWxStorage } from '../../miniprogram/src/services/storage';
import { presentWorkspace } from '../../miniprogram/src/core/workspacePresentation';
import { paintMobile, type Stop } from './mobileLayout';

// Canvas/keyboard belong to the game runtime; business state remains shared.
declare const wx: any;
const canvas = wx.createCanvas();
const info = wx.getSystemInfoSync();
const width = info.windowWidth;
const height = info.windowHeight;
canvas.width = width * info.pixelRatio;
canvas.height = height * info.pixelRatio;
const ctx = canvas.getContext('2d');
ctx.scale(info.pixelRatio, info.pixelRatio);
const store = createWorkspaceStore({ scope: DEMO_RECOVERY_SCOPE, runtimeMode: 'mock', transport: createMockTransport(), storage: createWxStorage() });
let editing: 'chat' | 'body' | null = null;
let draft = '';
const chatDrafts = new Map<number, string>();
let activeStoryId: number | null = null;
let expanded = false;
let stop: Stop = 'peek';
let currentTop = 0;
let character: any = null;
const avatar = wx.createImage();
avatar.onload = () => { character = avatar; draw(); };
avatar.src = 'character.png';
let offset = 0;
let maxOffset = 0;
let touchStart: { clientY: number } | null = null;
let targets: Array<{ y: number; x?: number; w?: number; run: () => void }> = [];
function text(value: string, y: number, color = '#302d28') {
  ctx.fillStyle = color; ctx.font = '16px sans-serif'; ctx.fillText(value, 20, y);
}
function button(label: string, y: number, run: () => void) {
  ctx.fillStyle = '#e9ddcb'; ctx.fillRect(16, y, width - 32, 42);
  text(label, y + 27); targets.push({ y, run });
}
function input(kind: 'chat' | 'body') {
  editing = kind;
  wx.showKeyboard({ defaultValue: kind === 'body' ? store.getState().document.body : draft, maxLength: 20000, multiple: true, confirmHold: false, confirmType: 'done', fail: () => { editing = null; wx.showToast({ title: '键盘打开失败', icon: 'none' }); } });
}
function draw() {
  const state = store.getState();
  if (state.activeStoryId !== activeStoryId) {
    if (activeStoryId !== null) chatDrafts.set(activeStoryId, draft);
    activeStoryId = state.activeStoryId;
    draft = activeStoryId === null ? '' : chatDrafts.get(activeStoryId) ?? '';
    offset = 0;
  }
  const ui = presentWorkspace(state);
  targets = [];
  ctx.fillStyle = '#f7f0e5'; ctx.fillRect(0, 0, width, height);
  text('DK · 演示工作区（未连接真实账号）', 90, '#996229');
  button(ui.story.activeTitle || '正在读取故事…', 103, () => {
    wx.showActionSheet({ itemList: state.stories.map(story => story.title), success: async (result: { tapIndex: number }) => {
      const story = state.stories[result.tapIndex];
      if (!story) return;
      await store.selectStory(story.id);
      if (presentWorkspace(store.getState()).story.showsSwitchDialog) {
        wx.showModal({ title: '正文尚未保存', content: '是否放弃修改并切换故事？取消会保留当前草稿。', confirmText: '放弃并切换', success: (choice: { confirm: boolean }) => { void store.resolveStorySwitch(choice.confirm ? 'discard' : 'cancel'); } });
      }
      offset = 0; draw();
    } });
  });
  text(ui.document.label, 151);
  const lines: string[] = [];
  let line = '';
  const content = expanded ? state.messages.map(m => (m.role === 'user' ? '我：' : '演示：') + m.content).join('\n\n') : state.document.body;
  for (const char of content) {
    if (char === '\n' || ctx.measureText(line + char).width > width - 40) { lines.push(line); line = ''; }
    if (char !== '\n') line += char;
  }
  lines.push(line);
  const count = Math.max(1, Math.floor((height - 460) / 25));
  maxOffset = Math.max(0, lines.length - count);
  offset = Math.min(offset, maxOffset);
  lines.slice(offset, offset + count).forEach((value, i) => text(value, 183 + i * 25));
  button('编辑正文', height - 250, () => input('body'));
  button(ui.document.canSave ? '保存演示正文' : ui.document.label, height - 202, () => {
    if (ui.document.canSave) void store.saveDocument();
    else if (ui.document.canCopyBoth) wx.setClipboardData({ data: '【本机】\n' + ui.document.localBody + '\n【服务端】\n' + (ui.document.serverBody ?? '') });
  });
  button(expanded ? '收起聊聊' : '展开聊聊', height - 154, () => { expanded = !expanded; offset = 0; draw(); });
  button(draft ? '发送：' + draft.slice(0, 12) : '写一句话…', height - 106, () => {
    if (!draft) return input('chat');
    if (!ui.chat.canSend) { wx.showToast({title: ui.chat.label, icon:'none'}); return; }
    const message = draft; draft = ''; void store.sendMessage(message);
  });
  if (ui.chat.canLookupUnknown) button('查询上一轮结果', height - 58, () => { void store.lookupUnknownTurn(); });
  else if (ui.chat.canRetryTurn) button('重试上一轮', height - 58, () => { void store.retryTurn(); });
  else if (draft) button('继续修改这句话', height - 58, () => input('chat'));
  const old = targets;
  const layout = paintMobile(ctx, width, height, stop, state.document.body,
    state.messages.map(m => (m.role === 'user' ? '我：' : '演示：') + m.content).join('\n\n'),
    ui.story.activeTitle || '', ui.document.label, draft, offset, character);
  currentTop = layout.top; maxOffset = layout.maxOffset;
  const stories = old[0].run;
  targets = [
    {y: height - 145, x: 16, w: width - 86, run: () => input('chat')},
    {y: height - 145, x: width - 70, w: 60, run: () => {
      if (!draft.trim() || !ui.chat.canSend) return;
      const value = draft; draft = ''; void store.sendMessage(value);
    }},
    {y: currentTop + 12, run: () => { stop = stop === 'peek' ? 'half' : 'peek'; expanded = stop !== 'peek'; offset = 0; draw(); }},
    {y: height - 72, x: 0, w: width * .7, run: stories},
    {y: height - 72, x: width * .7, w: width * .3, run: () => wx.showModal({title:'演示账号',content:'真实登录、余额和个人信息尚未接入。',showCancel:false})},
  ];
  if (currentTop > 210) targets.push(
    {y: currentTop - 50, x: width - 170, w: 90, run: () => input('body')},
    {y: currentTop - 50, x: width - 80, w: 75, run: old[2].run},
  );
}
wx.onKeyboardInput((event: { value: string }) => {
  if (editing === 'body') store.editDocument(event.value);
  else if (editing === 'chat') draft = event.value;
});
wx.onKeyboardComplete((event: { value?: string }) => {
  if (typeof event.value === 'string') {
    if (editing === 'body') store.editDocument(event.value);
    else if (editing === 'chat') draft = event.value;
  }
  editing = null; draw();
});
wx.onTouchStart((event: any) => { touchStart = event.touches[0] ?? null; });
wx.onTouchEnd((event: any) => {
  if (editing) return;
  const touch = event.changedTouches[0];
  if (touch && touchStart && Math.abs(touch.clientY - touchStart.clientY) > 12) {
    if (touchStart.clientY >= currentTop && touchStart.clientY <= currentTop + 55) {
      const up = touch.clientY < touchStart.clientY;
      stop = up ? (stop === 'peek' ? 'half' : 'full') : (stop === 'full' ? 'half' : 'peek');
      expanded = stop !== 'peek'; offset = 0; draw(); touchStart = null; return;
    }
    if (touchStart.clientY > 164 && touchStart.clientY < height - 260) {
      offset = Math.max(0, Math.min(maxOffset, offset + Math.round((touchStart.clientY - touch.clientY) / 25))); draw();
    }
    touchStart = null; return;
  }
  touchStart = null;
  if (!touch || touch.clientX < 16 || touch.clientX > width - 16) return;
  targets.find(target => touch.clientY >= target.y && touch.clientY <= target.y + 42 && touch.clientX >= (target.x ?? 16) && touch.clientX <= (target.x ?? 16) + (target.w ?? width - 32))?.run();
});
wx.onHide(() => store.onHide());
wx.onShow(() => { void store.onShow(); });
store.subscribe(draw);
draw();
void store.start();
