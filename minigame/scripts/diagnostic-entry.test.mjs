import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('./diagnostic-entry.js', import.meta.url), 'utf8');
function run(load) {
  const dialogs = [], timers = [], GameGlobal = {};
  const context = {GameGlobal, wx:{showModal: v => dialogs.push(v)}, console:{info(){}}, setTimeout: fn => timers.push(fn), require: path => {assert.equal(path, './app.js'); load(GameGlobal);}};
  vm.runInNewContext(source, context);
  return {dialogs, timers, GameGlobal};
}
test('module parse failure reports without Canvas or private error text', () => {
  const r = run(() => {throw new SyntaxError('SECRET must not appear');});
  assert.match(r.dialogs[0].content, /loading-app \/ SyntaxError/);
  assert.doesNotMatch(r.dialogs[0].content, /SECRET/);
  r.timers[0](); assert.equal(r.dialogs.length, 1);
});
test('records failing stage before size or paint', () => {
  const r = run(g => {g.__dkBootMark('reading-size'); throw new TypeError('private');});
  assert.match(r.dialogs[0].content, /reading-size \/ TypeError/);
});
test('records successful draw separately from module completion', () => {
  const r = run(g => {g.__dkBootMark('login-background-painted');g.__dkBootMark('first-draw-returned');});
  assert.equal(r.dialogs.length, 0);r.timers[0]();
  assert.match(r.dialogs[0].content, /login-background-painted > first-draw-returned > app-returned/);
  r.GameGlobal.__dkBootMark('later');r.timers[0]();assert.equal(r.dialogs.length, 1);
});
test('bounded trace retains latest stage without accumulating after report', () => {
  const r = run(g => {for(let i=0;i<100;i++)g.__dkBootMark('stage-'+i);});
  r.timers[0]();assert.ok(r.dialogs[0].content.length < 400);assert.match(r.dialogs[0].content,/stage-99/);
});
