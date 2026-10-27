const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let editor, config, bindCanvasSwap;
before(async () => { editor = await import('../src/radial-editor.js'); config = await import('../src/radial-config.js'); ({ bindCanvasSwap } = await import('../src/radial-canvas-edit.js')); });
const slot = (id, label) => ({ label, showLabel: true, action: { type: 'plugin', id } });
function fixture() {
  const c = config.defaultRadialConfig();
  c.menus[0].items[1] = slot('next', '下一楼'); c.menus[0].items[5] = { label: '收藏', showLabel: true, submenu: 'favorites' };
  c.menus.push({ id: 'favorites', label: '收藏', appearance: null, items: [slot('togglePin', '点选收藏'), slot('toggleFavPanel', '最近收藏'), slot('openFavoritesManager', '收藏管理')] });
  return c;
}
test('v4 editing preserves orphan groups and binds new children only to a selected parent', () => {
  const c = fixture(), before = structuredClone(c);
  assert.throws(() => editor.addChild(c, -1)); assert.deepEqual(c, before);
  assert.equal(editor.selectedChild(c, 0), null);
  const child = editor.addChild(c, 0); assert.equal(c.menus[0].items[0].submenu, child.id);
  assert.equal(child.items[0].action.id, 'prev'); assert.equal(c.version, 4);
  editor.resizePrimary(c, 4); assert.ok(editor.archivedChildren(c).some(m => m.id === 'favorites'));
  assert.equal(c.menus.find(m => m.id === 'favorites').items.length, 3);
  assert.ok(editor.affectedByShrink(before, 4).some(s => s.includes('3 个子动作')));
});
test('shared v3 children clone on edit and swap carries the parent binding', () => {
  const c = fixture(); c.menus[0].items[0] = { label: 'shared', submenu: 'favorites' };
  const original = structuredClone(editor.selectedChild(c, 5));
  const isolated = editor.ownChild(c, 0); isolated.items[0].label = 'only this parent';
  assert.notEqual(isolated.id, 'favorites'); assert.deepEqual(editor.selectedChild(c, 5), original);
  editor.swapSlots(c.menus[0].items, 0, 1); assert.equal(c.menus[0].items[1].submenu, isolated.id);
  assert.equal(editor.swapSlots(c.menus[0].items, 0, -1), false);
  for (const count of [4, 8, 12]) { editor.resizePrimary(c, count); assert.equal(c.menus[0].items.length, count); }
  assert.throws(() => editor.resizePrimary(c, 6));
});
test('capacity failure does not mutate a shared group, and archives retain direct parent action on binding', () => {
  const c = fixture(); c.menus[0].items[0] = { label: 'shared', submenu: 'favorites' };
  while (c.menus.length < 17) c.menus.push({ id: 'unused-' + c.menus.length, label: 'unused', items: [] });
  const snapshot = structuredClone(c); assert.throws(() => editor.ownChild(c, 0)); assert.deepEqual(c, snapshot);
  delete c.menus[0].items[0].submenu; delete c.menus[0].items[5].submenu;
  const bound = editor.addChild(c, 1, 'favorites'); assert.equal(bound.items[0].action.id, 'next');
});
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, data = {}) { const e = { button: 0, pointerId: 1, isPrimary: true, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; }, ...data }; for (const fn of this.listeners.get(type) || []) fn(e); return e; }
}
function setup() {
  const win = new Target(), canvas = new Target(); globalThis.window = win;
  const main = [0, 1].map(i => ({ dataset: { editTier: 'main', editIndex: String(i) } }));
  const sub = { dataset: { editTier: 'sub', editIndex: '0' } };
  const nodes = [...main, sub]; nodes.forEach(n => { n.closest = () => n; n.classList = { add() {}, remove() {} }; });
  canvas.contains = n => nodes.includes(n); canvas.querySelectorAll = () => [];
  canvas.classList = { add() {}, remove() {} }; canvas.setPointerCapture = () => {}; canvas.hasPointerCapture = () => false;
  let hit = main[1]; globalThis.document = { elementFromPoint: () => hit };
  const swaps = [], off = bindCanvasSwap(canvas, (...a) => swaps.push(a));
  return { win, canvas, main, sub, swaps, off, hit: n => { hit = n; } };
}
test('Pointer Events mouse and touch swap only within the same tier and consume click after dragging', () => {
  for (const pointerType of ['mouse', 'touch']) {
    const r = setup(); r.canvas.emit('pointerdown', { target: r.main[0], pointerType });
    r.win.emit('pointermove', { clientX: 30, pointerType }); r.win.emit('pointerup', { clientX: 30, pointerType });
    assert.deepEqual(r.swaps, [['main', 0, 1]]); assert.equal(r.canvas.emit('click').stopped, true); r.off();
  }
});
test('drag cancellation, wrong tier, outside drop and ordinary clicks never swap; cleanup removes window listeners', () => {
  for (const cancel of ['pointercancel', 'blur', 'scroll', 'escape', 'outside', 'cross-tier', 'click']) {
    const r = setup(); r.canvas.emit('pointerdown', { target: r.main[0] });
    if (cancel !== 'click') r.win.emit('pointermove', { clientX: 30 });
    if (cancel === 'escape') r.canvas.emit('keydown', { key: 'Escape' });
    else if (cancel === 'outside') r.hit(null);
    else if (cancel === 'cross-tier') r.hit(r.sub);
    else if (cancel !== 'click') r.win.emit(cancel);
    r.win.emit('pointerup', { clientX: 30 }); assert.deepEqual(r.swaps, [], cancel);
    r.off(); assert.equal([...r.win.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  }
});
test('keyboard alternative requests deterministic adjacent swap', () => {
  const r = setup(); r.canvas.emit('keydown', { target: r.main[0], key: 'ArrowRight', altKey: true });
  assert.deepEqual(r.swaps, [['main', 0, 1]]); r.off();
});

test('implicit touch capture transfer ignores old button lost capture but real canvas loss cancels', () => {
  for (const realLoss of [false, true]) {
    const r = setup(); r.canvas.emit('pointerdown', {target:r.main[0],pointerType:'touch'});
    r.win.emit('pointermove', {clientX:15,pointerType:'touch'});
    r.canvas.emit('lostpointercapture', {target:r.main[0],pointerId:1});
    r.canvas.emit('lostpointercapture', {target:r.canvas,pointerId:99});
    if(realLoss) r.canvas.emit('lostpointercapture', {target:r.canvas,pointerId:1});
    r.win.emit('pointermove', {clientX:30,pointerType:'touch'}); r.win.emit('pointerup', {clientX:30,pointerType:'touch'});
    assert.deepEqual(r.swaps,realLoss?[]:[['main',0,1]]);r.off();
  }
});
