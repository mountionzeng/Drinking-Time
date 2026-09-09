import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const handlers = {};
const storage = new Map();
let keyboard;
let labels = [];
const ctx = {
  scale() {}, fillRect(x,y,w,h) { if(x === 0 && y === 0) labels = []; },
  fillText(value,x,y) { labels.push({ value, y }); },
  measureText(value) { return { width: [...value].length * 9 }; },
  beginPath() {}, moveTo() {}, quadraticCurveTo() {}, stroke() {}, drawImage() {},
};
const wx = {
  createImage: () => ({}),
  createCanvas: () => ({ getContext: () => ctx }),
  getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
  getStorageSync: key => storage.get(key),
  setStorageSync: (key,value) => storage.set(key,value),
  removeStorageSync: key => storage.delete(key),
  getStorageInfoSync: () => ({keys: [...storage.keys()]}),
  showKeyboard: options => { keyboard = options; }, showToast() {},
};
for (const event of ['KeyboardInput','KeyboardComplete','TouchStart','TouchEnd','Hide','Show']) wx['on'+event] = fn => { handlers[event] = fn; };
const flush = () => new Promise(resolve => setImmediate(resolve));
vm.runInNewContext(readFileSync(new URL('../dist/game.js', import.meta.url),'utf8'), { wx, console, setTimeout, clearTimeout, Date, Map, Set });
await flush();
function tap(label) {
  const target = labels.find(item => item.value === label);
  assert.ok(target, `missing action: ${label}`);
  const touch = {clientX: label === '编辑正文' ? 250 : label === '保存' || label === '发送' ? 340 : 25,clientY: target.y - 10};
  handlers.TouchStart({touches:[touch]}); handlers.TouchEnd({changedTouches:[touch]});
}
tap('编辑正文');
assert.equal(keyboard.multiple, true);
handlers.KeyboardComplete({value:'小游戏键盘最终确认文字'});
tap('保存'); await flush();
assert.ok(labels.some(item=>item.value.includes('小游戏键盘最终确认文字')));
tap('说说这件小事…'); handlers.KeyboardComplete({value:'这是一条测试聊天'});
tap('这是一条测试聊天'); assert.equal(keyboard.defaultValue,'这是一条测试聊天');
handlers.KeyboardComplete({value:'修改后的聊天'});
tap('发送'); await flush();
tap('拉开看全部 ⌃');
assert.ok(labels.some(item=>item.value.includes('修改后的聊天')));
handlers.Hide();
console.log('小游戏运行冒烟通过：启动、键盘最终值、正文保存、聊天改稿、发送、切换视图、后台保存');
