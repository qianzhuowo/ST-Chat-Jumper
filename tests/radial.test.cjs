const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let configModule, radialModule, registryModule, viewModule, radialSettingsModule;
before(async () => {
  configModule = await import('../src/radial-config.js');
  radialModule = await import('../src/radial.js');
  viewModule = await import('../src/radial-view.js');
  registryModule = await import('../src/action-registry.js');
  radialSettingsModule = await import('../src/radial-settings.js');
});
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, values = {}) {
    const event = { target: chatTarget, pointerId: 1, pointerType: 'mouse', button: 2, isPrimary: true, clientX: 400, clientY: 300, altKey: true, cancelable: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; }, ...values };
    for (const fn of this.listeners.get(type) || []) { fn(event); if (event.stopped) break; }
    return event;
  }
  count() { return [...this.listeners.values()].reduce((n, s) => n + s.size, 0); }
}
class Element extends Target {
  constructor(tag = 'div') {
    super();
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.style = { setProperty(key, value) { this[key] = value; }, getPropertyValue(key) { return this[key] || ''; } };
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(n => n && this.classes.add(n)),
      remove: (...names) => names.forEach(n => this.classes.delete(n)),
      toggle: (name, on) => { const next = on === undefined ? !this.classes.has(name) : !!on; if (next) this.classes.add(name); else this.classes.delete(name); return next; },
      contains: name => this.classes.has(name),
    };
    this.isConnected = true;
  }
  set className(val) { this._className = val; this.classes = new Set(String(val || '').split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  append(...children) {
    for (const c of children) {
      if (c && typeof c === 'object') { this.children.push(c); c.parent = this; c.parentNode = this; }
    }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  checkValidity() { return true; }
  reportValidity() {}
  focus() {}
  select() {}
  scrollIntoView() {}
  click() { this.emit('click'); }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (sel === 'dialog' && cur.tagName === 'DIALOG') return cur;
      cur = cur.parent;
    }
    return null;
  }
  all() {
    const out = [];
    const walk = node => { for (const c of node.children || []) { out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(sel) {
    return this.all().filter(n => {
      if (sel === 'select') return n.tagName === 'SELECT';
      if (sel === 'button') return n.tagName === 'BUTTON';
      if (sel === '[data-panel-theme-btn]') return n.dataset?.panelThemeBtn != null;
      if (sel.startsWith('[aria-label="') && sel.endsWith('"]')) return n.getAttribute('aria-label') === sel.slice(13, -2);
      if (sel.startsWith('[data-settings-page=') && sel.endsWith(']')) return n.dataset?.settingsPage === sel.slice(20, -1);
      if (sel.startsWith('[data-stcj-page=') && sel.endsWith(']')) return n.dataset?.stcjPage === sel.slice(16, -1);
      if (sel.startsWith('.')) return n.classes?.has(sel.slice(1));
      return false;
    });
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const chatTarget = { closest: selector => selector === '#chat' ? chatTarget : null };
const inputTarget = { closest: selector => selector === '#chat' ? chatTarget : inputTarget };
function runtime(overrides = {}) {
  const document = new Target(); document.body = new Element('body'); document.createElement = tag => new Element(tag); document.createElementNS = (_, tag) => new Element(tag); document.createTextNode = text => { const t = new Element('#text'); t.textContent = text; return t; }; document.activeElement = new Element();
  const window = new Target();
  Object.assign(globalThis, { document, window, innerWidth: 1000, innerHeight: 700 });
  const config = { ...configModule.defaultRadialConfig(), enabled: true, mouseEnabled: true, ...overrides };
  const executed = [];
  const services = radialModule.createFeature({ dependencies: { ...viewModule.createFeature(), getRadialConfig: () => config, executeShortcutAction: async a => executed.push(a) } });
  services.installRadialGestures();
  return { document, window, config, services, executed, opened: () => document.body.children.length > 0 };
}
test('keyboard defaults avoid browser single-modifier shortcuts and accept safe combinations', () => {
  const defaults = configModule.defaultRadialConfig();
  assert.equal(defaults.keyModifier, 'altShift');
  assert.equal(configModule.normalizeRadialConfig({ keyModifier: 'ctrlShift' }).keyModifier, 'ctrlShift');
  assert.equal(configModule.normalizeRadialConfig({ keyModifier: 'meta' }).keyModifier, defaults.keyModifier);
});

test('secondary ring rotation aligns its first sector with the owning primary sector', () => {
  assert.equal(viewModule.resolveSubringRotation(8, 0, 0, 0), 0);
  assert.equal(viewModule.resolveSubringRotation(8, 2, 0, 0), 90);
  assert.equal(viewModule.resolveSubringRotation(4, 1, 20, 5), 115);
});


test('radial defaults are opt-in, normalization is bounded, cycle-safe and immutable', () => {
  const defaults = configModule.defaultRadialConfig(); assert.equal(defaults.enabled, false); assert.equal(defaults.mouseEnabled, false); assert.equal(defaults.touchMode, 'off');
  const raw = { enabled: 'true', radius: Infinity, cancelDistance: 20, deadZone: 900, threshold: -3, key: '<script>', menus: [{ id: 'main', items: [{ submenu: 'main' }, { submenu: 'child' }] }, { id: 'child', items: [{ submenu: 'main' }, { action: { type: 'future', id: 'command' } }] }, { id: 'child' }] };
  const snapshot = JSON.stringify(raw); const result = configModule.normalizeRadialConfig(raw);
  assert.equal(result.enabled, false); assert.equal(result.threshold, 8); assert.equal(result.deadZone, 60); assert.equal(result.key, 'j'); assert.equal(result.radius, 120); assert.ok(result.cancelDistance >= result.radius + 40);
  assert.equal(result.menus.length, 2); assert.equal(result.menus[0].items[0].submenu, undefined); assert.equal(result.menus[0].items[1].submenu, 'child'); assert.equal(result.menus[1].items[0].submenu, undefined); assert.equal(result.menus[1].items[1].action.type, 'future'); assert.equal(JSON.stringify(raw), snapshot);
});
test('radial persistence coexists with legacy ST/TT extension settings', () => {
  let saves = 0; const extensionSettings = { 'ST-Chat-Jumper': { buttons: [{ id: 'next', enabled: false }], globalHidden: true, rangeStep: 7 } };
  global.window = { SillyTavern: { getContext: () => ({ extensionSettings, saveSettingsDebounced: () => saves++ }) } };
  const s = configModule.createFeature(); s.saveRadialConfig({ enabled: true });
  assert.equal(s.getRadialConfig().enabled, true); assert.equal(saves, 1); assert.equal(extensionSettings['ST-Chat-Jumper'].globalHidden, true); assert.equal(extensionSettings['ST-Chat-Jumper'].rangeStep, 7); assert.equal(extensionSettings['ST-Chat-Jumper'].buttons[0].enabled, false);
});
test('geometry handles sector boundaries, dead zone, outer cancel and tiny viewports', () => {
  const center = { x: 100, y: 100 };
  assert.equal(radialModule.radialHitTest(100, 50, center, 4, 20, 200), 0); assert.equal(radialModule.radialHitTest(150, 100, center, 4, 20, 200), 1); assert.equal(radialModule.radialHitTest(100, 150, center, 4, 20, 200), 2); assert.equal(radialModule.radialHitTest(50, 100, center, 4, 20, 200), 3);
  assert.equal(radialModule.radialHitTest(100, 100, center, 4, 20, 200), -1); assert.equal(radialModule.radialHitTest(400, 100, center, 4, 20, 200), -1); assert.equal(radialModule.radialHitTest(100, 20, center, 0, 20, 200), -1);
  assert.deepEqual(radialModule.radialCenter(0, 700, 120, 1000, 700), { x: 132, y: 568 }); assert.deepEqual(radialModule.radialCenter(0, 0, 120, 120, 100), { x: 60, y: 50 });
});
test('right click without drag remains native; modified drag opens and releases direct action', () => {
  const r = runtime(); const d = r.document;
  d.emit('pointerdown'); d.emit('pointerup'); assert.equal(r.opened(), false); assert.equal(!!d.emit('contextmenu').defaultPrevented, false);
  d.emit('pointerdown', { altKey: false }); d.emit('pointermove', { clientY: 200 }); assert.equal(r.opened(), false);
  d.emit('pointerdown'); d.emit('pointermove', { clientY: 200 }); assert.equal(r.opened(), true); assert.equal(d.emit('contextmenu').defaultPrevented, true);
  d.emit('pointerup', { clientY: 200 }); assert.equal(r.opened(), false); assert.equal(r.executed[0].id, 'prev');
  d.emit('pointerdown'); d.emit('pointerup'); assert.equal(!!d.emit('contextmenu').defaultPrevented, false, 'next ordinary right click is never swallowed'); r.services.destroyRadial();
});
test('input exclusion, center/outer/Escape/scroll/blur/cancel cleanup never execute actions', () => {
  const r = runtime(); const d = r.document;
  d.emit('pointerdown', { target: inputTarget }); d.emit('pointermove', { clientY: 200 }); assert.equal(r.opened(), false);
  for (const type of ['scroll', 'pointercancel']) { d.emit('pointerdown'); d.emit('pointermove', { clientY: 200 }); assert.equal(r.opened(), true); d.emit(type); assert.equal(r.opened(), false); }
  d.emit('pointerdown'); d.emit('pointermove', { clientY: 200 }); d.emit('pointermove', { clientY: 300 }); d.emit('pointerup'); assert.equal(r.opened(), false);
  d.emit('pointerdown'); d.emit('pointermove', { clientY: 20 }); d.emit('pointerup', { clientY: 20 }); assert.equal(r.opened(), false);
  r.services.openRadial(); d.emit('keydown', { key: 'Escape' }); assert.equal(r.opened(), false);
  r.services.openRadial(); r.window.emit('blur'); assert.equal(r.opened(), false); assert.equal(r.executed.length, 0);
  r.services.installRadialGestures(); r.services.destroyRadial(); assert.equal(d.count(), 0); assert.equal(r.window.count(), 0);
});
test('keyboard invocation ignores text inputs, supports click-mode selection and cancellation', () => {
  const r = runtime(); r.document.emit('keydown', { key: 'j', target: inputTarget }); assert.equal(r.opened(), false);
  r.document.emit('keydown', { key: 'j', altKey: true, shiftKey: true }); assert.equal(r.opened(), true);
  r.document.emit('keydown', { key: 'ArrowRight' }); r.document.emit('keydown', { key: 'Enter' }); assert.equal(r.executed[0].id, 'prev'); assert.equal(r.opened(), false); r.services.destroyRadial();
});
test('submenu release enters a separately configured wheel, never executes a parent action', () => {
  const r = runtime({ menus: [{ id: 'main', label: 'main', items: [{ label: 'child', submenu: 'child' }] }, { id: 'child', label: 'child', items: [{ label: 'next', action: { type: 'plugin', id: 'next' } }] }] });
  r.document.emit('pointerdown'); r.document.emit('pointermove', { clientY: 200 }); r.document.emit('pointerup', { clientY: 200 }); assert.equal(r.opened(), true); assert.equal(r.executed.length, 0);
  r.document.emit('keydown', { key: 'ArrowRight' }); r.document.emit('keydown', { key: 'Enter' }); assert.equal(r.executed[0].id, 'next'); r.services.destroyRadial();
});
test('touch scroll cancels pending hold and multitap opens only after configured count', async () => {
  const r = runtime({ touchMode: 'longPress', longPress: 300 });
  r.document.emit('pointerdown', { pointerType: 'touch', button: 0 }); r.document.emit('pointermove', { pointerType: 'touch', clientY: 330 }); await new Promise(resolve => setTimeout(resolve, 320)); assert.equal(r.opened(), false);
  r.config.touchMode = 'multiTap';
  for (let n = 0; n < 2; n++) { r.document.emit('pointerdown', { pointerType: 'touch', button: 0 }); r.document.emit('pointerup', { pointerType: 'touch', button: 0 }); assert.equal(r.opened(), n === 1); }
  assert.equal(r.executed.length, 0); r.services.destroyRadial();
});
test('touch longpress can remain open for point selection; destroy cancels pending timers', async () => {
  const r = runtime({ touchMode: 'longPress', longPress: 300 });
  r.document.emit('pointerdown', { pointerType: 'touch', button: 0, clientX: 20 }); await new Promise(resolve => setTimeout(resolve, 320)); assert.equal(r.opened(), true);
  let picks = 0; r.document.addEventListener('pointerup', () => picks++);
  r.document.emit('pointerup', { pointerType: 'touch', button: 0, clientX: 20 }); assert.equal(r.opened(), true); assert.equal(picks, 0, 'activated release cannot leak to pin-pick');
  const click = r.document.emit('click', { clientX: 20 }); assert.equal(click.defaultPrevented, true, 'compatibility click is consumed even on overlay');
  r.services.cancelRadial(); r.document.emit('pointerdown', { pointerType: 'touch', button: 0 }); r.services.destroyRadial(); await new Promise(resolve => setTimeout(resolve, 320)); assert.equal(r.opened(), false);
});
test('registry dispatches without toolbar DOM and fails closed for unknown future providers', async () => {
  const calls = [], info = [];
  const s = registryModule.createFeature({ dependencies: { handleAction: id => calls.push(id), toastInfo: msg => info.push(msg) } });
  assert.equal(await s.executeShortcutAction({ type: 'plugin', id: 'next' }), true); assert.deepEqual(calls, ['next']);
  await s.executeShortcutAction({ type: 'plugin', id: 'toggleFavPanel' }); assert.equal(calls[1], 'openFavoritesManager');
  assert.equal(await s.executeShortcutAction({ type: 'host', id: 'unknown' }), false); assert.equal(info.length, 1);
  const unregister = s.registerShortcutAction({ type: 'host', id: 'future', label: 'future', execute: () => calls.push('future') });
  assert.throws(() => s.registerShortcutAction({ type: 'host', id: 'future', execute() {} }), /Duplicate/);
  await s.executeShortcutAction({ type: 'host', id: 'future' }); assert.equal(calls.at(-1), 'future'); unregister(); assert.equal(await s.executeShortcutAction({ type: 'host', id: 'future' }), false);
});

test('v1 migrates to v2 without losing gesture settings, slot order or future actions', () => {
  const old = { version: 1, enabled: true, touchMode: 'multiTap', radius: 100, menus: [{ id: 'main', label: 'Old', items: [{ label: 'One', action: { type: 'future', id: 'card' } }, { label: 'Two', submenu: 'child' }] }, { id: 'child', label: 'Child', items: [{ label: 'Three', action: { type: 'plugin', id: 'next' } }] }] };
  const original = JSON.stringify(old), next = configModule.normalizeRadialConfig(old);
  assert.equal(next.version, 2); assert.equal(next.enabled, true); assert.equal(next.touchMode, 'multiTap'); assert.equal(next.radius, 100);
  assert.deepEqual(next.menus[0].items.map(i => i.label), ['One', 'Two']); assert.equal(next.menus[0].items[0].action.type, 'future'); assert.equal(next.menus[0].items[1].submenu, 'child'); assert.equal(next.menus[1].appearance, null);
  assert.equal(next.appearance.theme, 'graphite'); assert.deepEqual(next.schemes, []); assert.equal(JSON.stringify(old), original);
});
test('appearance validates colors and inherited palette names, and always retains a visible label or icon', () => {
  for (const theme of ['__proto__', 'constructor', 'toString', 'unknown']) {
    const a = configModule.normalizeRadialAppearance({ theme }); assert.equal(a.theme, 'graphite');
    for (const key of ['surface', 'highlight', 'accent', 'border', 'text', 'center']) assert.match(a[key], /^#[0-9a-f]{6}$/i);
  }
  const a = configModule.normalizeRadialAppearance({ theme: 'porcelain', surface: 'url(javascript:bad)', accent: '#123456', gap: 999, rotation: -999, showLabels: false, showIcons: false, centerSymbol: '123456' });
  assert.equal(a.surface, '#f6f8fb'); assert.equal(a.accent, '#123456'); assert.equal(a.gap, 16); assert.equal(a.rotation, -180); assert.equal(a.showLabels, true); assert.equal(a.centerSymbol, '123');
});
test('imported main appearance becomes the single editable global appearance, while children remain independent', () => {
  const config = configModule.normalizeRadialConfig({ appearance: { theme: 'graphite' }, menus: [{ id: 'main', appearance: { theme: 'porcelain' }, items: [] }, { id: 'child', appearance: { theme: 'forest' }, items: [] }] });
  assert.equal(config.appearance.theme, 'porcelain'); assert.equal(config.menus[0].appearance, null); assert.equal(config.menus[1].appearance.theme, 'forest');
  config.appearance.surface = '#112233'; const main = viewModule.resolveWheelAppearance(config, config.menus[0], 120); const child = viewModule.resolveWheelAppearance(config, config.menus[1], 120);
  assert.equal(main.surface, '#112233'); assert.notEqual(child.surface, '#112233');
});
test('small wheel geometry caps the effective cancel zone and keeps the painted ring selectable', () => {
  const config = configModule.normalizeRadialConfig({ radius: 80, deadZone: 60, appearance: { scale: 70 } });
  const radius = 56, a = viewModule.resolveWheelAppearance(config, config.menus[0], radius), inner = radius * a.innerRatio / 100;
  assert.equal(a.innerRatio, 65); assert.ok(inner < radius);
  assert.equal(radialModule.radialHitTest(100, 50, { x: 100, y: 100 }, 4, inner, 160), 0);
  assert.equal(radialModule.radialHitTest(100, 80, { x: 100, y: 100 }, 4, inner, 160), -1);
  const r = runtime({ radius: 80, deadZone: 60, appearance: { scale: 70 } }); r.document.emit('pointerdown'); r.document.emit('pointermove', { clientY: 250 }); r.document.emit('pointerup', { clientY: 250 }); assert.equal(r.executed[0]?.id, 'prev'); r.services.destroyRadial();
});
test('named schemes are bounded snapshots with normalized menus, not recursive configurations', () => {
  const menus = [{ id: 'main', items: [{ label: 'Saved', icon: '◇', color: '#123456', action: { type: 'plugin', id: 'next' } }] }];
  const result = configModule.normalizeRadialConfig({ schemes: [{ id: 'one', label: 'One', menus, radius: 900, appearance: { theme: 'forest' }, schemes: [{ id: 'nested' }] }, { id: 'one' }, { id: '../invalid' }] });
  assert.equal(result.schemes.length, 1); assert.equal(result.schemes[0].radius, 200); assert.equal(result.schemes[0].menus[0].items[0].icon, '◇'); assert.equal(result.schemes[0].appearance.theme, 'forest'); assert.equal(result.schemes[0].schemes, undefined);
  menus[0].items[0].label = 'Changed'; assert.equal(result.schemes[0].menus[0].items[0].label, 'Saved');
});
test('original annular geometry is finite for 1, 4, 8 and 12 sectors and matches rotated hit testing', () => {
  for (const count of [1, 4, 8, 12]) for (let index = 0; index < count; index++) {
    const geometry = viewModule.sectorGeometry(index, count, 120, 55, 3, 30); assert.match(geometry.path, /^M /); assert.ok(geometry.path.includes(' A ')); assert.ok(!/NaN|Infinity/.test(geometry.path + geometry.polygon)); assert.ok(geometry.polygon.includes('%'));
  }
  assert.equal(viewModule.sectorGeometry(0, 0, 120, 55).path, '');
  assert.equal(radialModule.radialHitTest(150, 100, { x: 100, y: 100 }, 4, 20, 200, 90), 0);
});
test('shared wheel preview only selects configured sectors and exposes semantic controls', () => {
  const r = runtime(); let picked = -1, back = 0;
  const view = viewModule.createFeature().createRadialView({ menu: { id: 'main', label: 'Preview', items: [{ label: '<unsafe>', icon: '◇' }, { label: 'Child', submenu: 'child' }] }, appearance: configModule.defaultRadialAppearance(), radius: 120, preview: true, onChoose: i => { picked = i; }, onCenter: () => back++ });
  assert.equal(view.buttons.length, 2); assert.ok(view.buttons[0].style.clipPath.startsWith('polygon('));
  view.buttons[1].emit('click'); assert.equal(picked, 1); view.setSelected(1); assert.equal(view.buttons[1].classes.has('is-selected'), true);
  view.center.emit('click'); assert.equal(back, 1); assert.equal(r.executed.length, 0); r.services.destroyRadial();
});

test('co-screen submenu renders primary and secondary rings together, locks parent in outer ring, clears empty sectors, and unlocks with inward hysteresis', () => {
  const r = runtime({
    menus: [
      {
        id: 'main',
        label: '主轮盘',
        items: [
          { label: '打开子轮盘', submenu: 'child' },
          { label: '下一条', action: { type: 'plugin', id: 'next' } },
          { label: '空主扇区' },
          { label: '上一条', action: { type: 'plugin', id: 'prev' } },
        ],
      },
      {
        id: 'child',
        label: '子轮盘',
        items: [
          { label: '子动作北', action: { type: 'plugin', id: 'recent1' } },
          { label: '空子扇区东' },
          { label: '子动作南', action: { type: 'plugin', id: 'showRange' } },
          { label: '子动作西', action: { type: 'plugin', id: 'resetRange' } },
        ],
      },
    ],
  });
  const d = r.document;
  // Drag north (sector 0 of main -> submenu 'child')
  d.emit('pointerdown', { clientX: 400, clientY: 300 });
  d.emit('pointermove', { clientX: 400, clientY: 220 });
  assert.equal(r.opened(), true);
  const overlay = d.body.children[0];
  const ring = overlay.children[0];
  // Both primary items and secondary .stcj-radial-subring co-exist in the same ring (no screen jump)
  const primaryItems = ring.all().filter(n => n.classes?.has('stcj-radial-item'));
  const subring = ring.all().find(n => n.classes?.has('stcj-radial-subring'));
  const subItems = ring.all().filter(n => n.classes?.has('stcj-radial-subitem'));
  assert.equal(primaryItems.length, 4);
  assert.ok(subring, 'co-screen subring is mounted inside the primary ring');
  assert.equal(subItems.length, 4);
  assert.equal(primaryItems[0].classes.has('is-submenu-open'), true);

  // Move into outer secondary ring north (radius ~ 155px -> clientY = 145)
  d.emit('pointermove', { clientX: 400, clientY: 145 });
  assert.equal(subItems[0].classes.has('is-selected'), true);

  // Move angularly in outer secondary ring to East (empty secondary sector 1: clientX = 555, clientY = 300)
  // Parent sector 0 remains locked (submenu stays open), and empty secondary sector clears selection to prevent mis-trigger
  d.emit('pointermove', { clientX: 555, clientY: 300 });
  assert.equal(ring.all().some(n => n.classes?.has('stcj-radial-subring')), true, 'parent submenu stays locked while moving in outer subring');
  assert.equal(subItems.some(n => n.classes.has('is-selected')), false, 'empty secondary sector clears hit selection');

  // Move in outer secondary ring to South (sector 2: clientX = 400, clientY = 455) -> selects secondary sector 2 while parent 0 remains locked
  d.emit('pointermove', { clientX: 400, clientY: 455 });
  assert.equal(subItems[2].classes.has('is-selected'), true);
  assert.equal(primaryItems[0].classes.has('is-submenu-open'), true);

  // Retreat back inside primary inner ring East (distance 70px <= unlockRadius: clientX = 470, clientY = 300) -> inward hysteresis unlocks parent and switches to primary sector 1 ('next')
  d.emit('pointermove', { clientX: 470, clientY: 300 });
  const ringAfterUnlock = overlay.children[0];
  const primaryAfterUnlock = ringAfterUnlock.all().filter(n => n.classes?.has('stcj-radial-item'));
  assert.equal(ringAfterUnlock.all().some(n => n.classes?.has('stcj-radial-subring')), false, 'retreating inside primary unlock radius closes submenu');
  assert.equal(primaryAfterUnlock[1].classes.has('is-selected'), true);

  // Move to empty primary sector South (sector 2: clientX = 400, clientY = 370) -> empty primary sector clears hit and release does not execute anything
  d.emit('pointermove', { clientX: 400, clientY: 370 });
  assert.equal(primaryAfterUnlock.some(n => n.classes.has('is-selected')), false, 'empty primary sector clears hit selection');
  d.emit('pointerup', { clientX: 400, clientY: 370 });
  assert.equal(r.executed.length, 0, 'releasing on empty sector never executes an action');

  // Continuous drag from primary sector 0 directly into secondary outer ring South (sector 2) and release -> executes secondary action in one gesture
  d.emit('pointerdown', { clientX: 400, clientY: 300 });
  d.emit('pointermove', { clientX: 400, clientY: 220 });
  d.emit('pointermove', { clientX: 400, clientY: 455 });
  d.emit('pointerup', { clientX: 400, clientY: 455 });
  assert.equal(r.executed.length, 1);
  assert.equal(r.executed[0].id, 'showRange');

  // Edge clamping & non-shifting center: opening at top-left edge (10, 10) reserves total subOuter radius and does not shift center when submenu opens
  r.services.openRadial(10, 10);
  const edgeRingBefore = d.body.children[0].children[0];
  const leftBefore = parseFloat(edgeRingBefore.style.left);
  const topBefore = parseFloat(edgeRingBefore.style.top);
  const primaryBtn0 = edgeRingBefore.all().find(n => n.classes?.has('stcj-radial-item'));
  primaryBtn0.emit('click');
  const edgeRingAfter = d.body.children[0].children[0];
  const leftAfter = parseFloat(edgeRingAfter.style.left);
  const topAfter = parseFloat(edgeRingAfter.style.top);
  assert.equal(leftBefore, leftAfter, 'wheel center X does not shift when co-screen submenu opens');
  assert.equal(topBefore, topAfter, 'wheel center Y does not shift when co-screen submenu opens');
  const subringEl = edgeRingAfter.all().find(n => n.classes?.has('stcj-radial-subring'));
  const subOuterRadius = parseFloat(subringEl.style.width) / 2;
  assert.ok(leftAfter - subOuterRadius >= 12 && topAfter - subOuterRadius >= 12, 'expanded outer subring fits inside viewport edge margin');
  r.services.destroyRadial();
});

test('settings UI supports same-page primary/secondary free editing, co-screen preview, theme sync, copy/paste, undo/redo, and simple mode', () => {
  const r = runtime();
  const dialog = new Element('dialog');
  dialog.dataset.consoleMode = 'pro';
  dialog.dataset.sidebarCollapsed = 'false';
  const themeHostBtn = new Element('button'); themeHostBtn.dataset.panelThemeBtn = 'host';
  const themeLightBtn = new Element('button'); themeLightBtn.dataset.panelThemeBtn = 'light';
  const themeDarkBtn = new Element('button'); themeDarkBtn.dataset.panelThemeBtn = 'dark';
  const mount = new Element('div');
  dialog.append(themeHostBtn, themeLightBtn, themeDarkBtn, mount);
  r.document.body.append(dialog);

  let savedCount = 0;
  let savedConfig = r.config;
  const settingsFeature = radialSettingsModule.createFeature({
    dependencies: {
      getRadialConfig: () => savedConfig,
      saveRadialConfig: next => { savedConfig = configModule.normalizeRadialConfig(next); savedCount++; },
      listShortcutActions: () => [
        { type: 'plugin', id: 'prev', label: '上一条' },
        { type: 'plugin', id: 'next', label: '下一条' },
        { type: 'plugin', id: 'recent1', label: '最近收藏' },
        { type: 'plugin', id: 'showRange', label: '区间选择' },
      ],
      cancelRadial: () => r.services.cancelRadial(),
      openRadial: () => r.services.openRadial(),
      createRadialView: opts => viewModule.createFeature().createRadialView(opts),
      loadFavoritesPreviewMode: () => 'swipe_default',
      saveFavoritesPreviewMode: () => {},
    },
  });
  settingsFeature.mountRadialSettings(mount);

  // 1. Sidebar theme button syncs with dropdown and vice-versa
  themeLightBtn.emit('click');
  assert.equal(dialog.dataset.panelTheme, 'light');
  assert.equal(savedConfig.panelTheme, 'light');
  const panelThemeSelect = mount.querySelector('[aria-label="设置窗口主题"]');
  assert.equal(panelThemeSelect.value, 'light');
  panelThemeSelect.value = 'dark';
  panelThemeSelect.emit('change');
  assert.equal(dialog.dataset.panelTheme, 'dark');
  assert.equal(savedConfig.panelTheme, 'dark');
  assert.equal(themeDarkBtn.classes.has('is-active'), true);

  // 2. Same-page co-screen preview and inline secondary wheel free editor on actions page
  const actionsPage = mount.querySelector('[data-stcj-page=actions]');
  assert.ok(actionsPage);
  const inlineSubwheel = actionsPage.all().find(n => n.dataset?.inlineSubwheel === 'true');
  assert.ok(inlineSubwheel, 'inline secondary wheel workbench exists on the same actions page');
  const previewSubring = actionsPage.all().find(n => n.classes?.has('stcj-radial-subring'));
  assert.ok(previewSubring, 'live preview renders primary and secondary rings co-screen');

  // Edit secondary wheel name, sector label, action, count, and independent appearance on the same actions page
  const subNameInput = actionsPage.querySelector('[aria-label="二级轮盘名称"]');
  subNameInput.value = '快捷收藏子盘';
  subNameInput.emit('change');
  assert.equal(savedConfig.menus.find(m => m.id === 'favorites').label, '快捷收藏子盘');

  const subLabelInput = actionsPage.querySelector('[aria-label="二级扇区标签"]');
  subLabelInput.value = '同页改名子扇区';
  subLabelInput.emit('change');
  assert.equal(savedConfig.menus.find(m => m.id === 'favorites').items[0].label, '同页改名子扇区');

  const subIndepToggle = actionsPage.querySelector('[aria-label="同页独立二级外观"]');
  subIndepToggle.checked = true;
  subIndepToggle.emit('change');
  assert.ok(savedConfig.menus.find(m => m.id === 'favorites').appearance);
  const subThemeSelect = actionsPage.querySelector('[aria-label="同页二级配色方案"]');
  subThemeSelect.value = 'forest';
  subThemeSelect.emit('change');
  assert.equal(savedConfig.menus.find(m => m.id === 'favorites').appearance.theme, 'forest');

  // 3. Copy & Paste sector + Undo & Redo
  const findBtn = text => actionsPage.all().find(n => n.tagName === 'BUTTON' && n.textContent === text);
  const slot1Input = actionsPage.querySelector('[aria-label="扇区 1 标签"]');
  slot1Input.value = '主扇区复制源';
  slot1Input.emit('change');
  findBtn('📋 复制扇区').emit('click');
  findBtn('下一槽 ▶').emit('click');
  findBtn('📥 粘贴扇区').emit('click');
  assert.equal(savedConfig.menus[0].items[1].label, '主扇区复制源');

  // Undo & Redo
  findBtn('↶ 撤销').emit('click');
  assert.notEqual(savedConfig.menus[0].items[1].label, '主扇区复制源');
  findBtn('↷ 重做').emit('click');
  assert.equal(savedConfig.menus[0].items[1].label, '主扇区复制源');

  // 4. Simple mode toggle does not lose or alter saved config
  const snapshotBeforeSimple = JSON.stringify(savedConfig);
  dialog.dataset.consoleMode = 'simple';
  assert.equal(JSON.stringify(savedConfig), snapshotBeforeSimple);
  assert.ok(savedCount > 0);
  settingsFeature.destroyRadialSettings();
  r.services.destroyRadial();
});

test('sidebar collapse toggle syncs aria-expanded and retains accessible names for icon-only tabs, and CSS contains responsive breakpoints', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const settingsUiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings-ui.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(__dirname, '..', 'radial.css'), 'utf8');

  assert.match(settingsUiSource, /id="stcj-sidebar-toggle"[^>]*aria-expanded="true"/);
  assert.match(settingsUiSource, /sidebarToggle\.setAttribute\('aria-expanded',\s*String\(!nextCollapsed\)\)/);
  assert.match(settingsUiSource, /sidebarToggle\.setAttribute\('aria-label',\s*nextCollapsed\s*\?\s*'展开侧边导航'\s*:\s*'收起侧边导航'\)/);
  for (const [pageId, label] of [
    ['triggers', '触发与安全'],
    ['appearance', '外观与形态'],
    ['actions', '扇区与动作'],
    ['toolbar', '悬浮条与导航'],
    ['schemes', '方案与备份'],
    ['about', '关于与致谢'],
  ]) {
    assert.match(settingsUiSource, new RegExp(`data-settings-page="${pageId}"[^>]*aria-label="${label}"`), `tab ${pageId} has accessible name`);
  }
  assert.match(cssSource, /@media\(max-width:1050px\)/);
  assert.match(cssSource, /@media\(max-width:850px\)/);
  assert.match(cssSource, /@media\(max-width:600px\)/);
  assert.match(cssSource, /\.stcj-radial-subring\b/);
  assert.match(cssSource, /\.stcj-inline-subwheel-card\b/);
});
