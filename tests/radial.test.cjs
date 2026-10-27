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
test('secondary tier extends straight out of its parent cell and subdivides exactly the parent span (StarPie model)', () => {
  const arc = viewModule.resolveSubringArc(8, 2, 3, 0);
  assert.deepEqual(arc, { center: 0, span: 45, start: -22.5 });
  // Child count never widens or narrows the tier: it always matches the parent sector.
  assert.equal(viewModule.resolveSubringArc(4, 0, 1).span, 90);
  assert.equal(viewModule.resolveSubringArc(4, 0, 12).span, 90);
  assert.equal(viewModule.resolveSubringArc(8, -1, 3), null);
  assert.equal(viewModule.resolveSubringArc(4, 1, 2, 20).center, 20);
  assert.equal(viewModule.arcHitIndex(-20, arc, 3), 0);
  assert.equal(viewModule.arcHitIndex(0, arc, 3), 1);
  assert.equal(viewModule.arcHitIndex(22, arc, 3), 2);
  assert.equal(viewModule.arcHitIndex(23, arc, 3), -1);
  assert.equal(viewModule.arcHitIndex(-23, arc, 3), -1);
  // Wrap-around across -180/180 and agreement between painted sector centres and hit testing.
  const west = viewModule.resolveSubringArc(4, 3, 2);
  assert.equal(viewModule.arcHitIndex(170, west, 2), 0);
  assert.equal(viewModule.arcHitIndex(-170, west, 2), 1);
  for (let i = 0; i < 3; i++) assert.equal(viewModule.arcHitIndex(viewModule.sectorGeometry(i, 3, 200, 150, 3, 0, arc).angle, arc, 3), i);
  // Full-ring geometry is unchanged when no arc is supplied.
  assert.equal(viewModule.sectorGeometry(1, 4, 100, 40, 3, 0).angle, 0);
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

test('normalizer validates shape independently of persisted schema migration', () => {
  const old = { version: 1, enabled: true, touchMode: 'multiTap', radius: 100, menus: [{ id: 'main', label: 'Old', items: [{ label: 'One', action: { type: 'future', id: 'card' } }, { label: 'Two', submenu: 'child' }] }, { id: 'child', label: 'Child', items: [{ label: 'Three', action: { type: 'plugin', id: 'next' } }] }] };
  const original = JSON.stringify(old), next = configModule.normalizeRadialConfig(old);
  assert.equal(next.version, 3); assert.equal(next.enabled, true); assert.equal(next.touchMode, 'multiTap'); assert.equal(next.radius, 100);
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

  // StarPie model: 4 children subdivide the parent's own 90deg span (north), i.e. -135deg..-45deg, 22.5deg each.
  assert.equal(subring.dataset.layout, 'fan');
  const at = deg => ({ clientX: 400 + Math.cos(deg * Math.PI / 180) * 155, clientY: 300 + Math.sin(deg * Math.PI / 180) * 155 });
  // Child 0 is the counter-clockwise edge of the parent cell.
  d.emit('pointermove', at(-124));
  assert.equal(subItems[0].classes.has('is-selected'), true);

  // Empty child 1 clears the hit, and so does the outer band beyond the parent span (east), while parent stays locked.
  d.emit('pointermove', at(-101));
  assert.equal(subItems.some(n => n.classes.has('is-selected')), false, 'empty secondary sector clears hit selection');
  d.emit('pointermove', at(-150));
  assert.equal(subItems.some(n => n.classes.has('is-selected')), false, 'just outside the parent span never selects a child');
  d.emit('pointermove', { clientX: 555, clientY: 300 });
  assert.equal(ring.all().some(n => n.classes?.has('stcj-radial-subring')), true, 'parent submenu stays locked while moving in outer subring');
  assert.equal(subItems.some(n => n.classes.has('is-selected')), false, 'outside the parent span never selects a child');

  // Child 2 sits just clockwise of the parent direction.
  d.emit('pointermove', at(-79));
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

  // Continuous drag from primary sector 0 straight outward into the fan's clockwise child (sector 2) and release -> executes secondary action in one gesture
  d.emit('pointerdown', { clientX: 400, clientY: 300 });
  d.emit('pointermove', { clientX: 400, clientY: 220 });
  d.emit('pointermove', at(-79));
  d.emit('pointerup', at(-79));
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

  const actionsPage = mount.querySelector('[data-stcj-page=actions]');
  const findBtn = text => actionsPage.all().find(n => n.tagName === 'BUTTON' && n.textContent === text);
  const canvasCell = (tier, i) => actionsPage.all().find(n => n.dataset?.editTier === tier && n.dataset.editIndex === String(i));
  assert.equal(actionsPage.querySelector('.stcj-editor-breadcrumb'), null);
  assert.equal(findBtn('+ 添加二级动作'), undefined, 'must select a parent first');
  assert.equal(actionsPage.querySelector('.stcj-radial-subring'), null, 'no unrelated child is rendered');
  canvasCell('main', 5).emit('click');
  assert.ok(actionsPage.querySelector('.stcj-radial-subring'));
  canvasCell('sub', 0).emit('click');
  let name = actionsPage.querySelector('[aria-label="动作名称"]'); name.value = '子动作改名'; name.emit('change');
  assert.equal(savedConfig.menus.find(m => m.id === 'favorites').items[0].label, '子动作改名');
  findBtn('删除此子动作').emit('click');
  assert.equal(savedConfig.menus.find(m => m.id === 'favorites').items.length, 2);
  findBtn('↶ 撤销').emit('click'); assert.equal(savedConfig.menus.find(m => m.id === 'favorites').items.length, 3);
  findBtn('↷ 重做').emit('click'); assert.equal(savedConfig.menus.find(m => m.id === 'favorites').items.length, 2);
  canvasCell('main', 0).emit('click');
  name = actionsPage.querySelector('[aria-label="动作名称"]'); name.value = '复制源'; name.emit('change');
  findBtn('📋 复制动作').emit('click'); canvasCell('main', 1).emit('click'); findBtn('📥 粘贴动作').emit('click');
  assert.equal(savedConfig.menus[0].items[1].label, '复制源');
  findBtn('↶ 撤销').emit('click'); assert.notEqual(savedConfig.menus[0].items[1].label, '复制源');
  findBtn('↷ 重做').emit('click'); assert.equal(savedConfig.menus[0].items[1].label, '复制源');
  findBtn('4 方位').emit('click'); assert.equal(savedConfig.menus[0].items.length, 6, 'shrink waits for confirmation');
  findBtn('取消缩减').emit('click'); assert.equal(savedConfig.menus[0].items.length, 6);
  findBtn('4 方位').emit('click'); findBtn('确认缩减').emit('click'); assert.equal(savedConfig.menus[0].items.length, 4);
  assert.ok(savedConfig.menus.some(m => m.id === 'favorites'), 'unbound child data retained');
  findBtn('↶ 撤销').emit('click'); assert.equal(savedConfig.menus[0].items.length, 6);
  findBtn('↷ 重做').emit('click'); assert.equal(savedConfig.menus[0].items.length, 4);
  canvasCell('main', 0).emit('click'); findBtn('+ 添加二级动作').emit('click');
  const parent = savedConfig.menus[0].items[0], child = savedConfig.menus.find(m => m.id === parent.submenu);
  assert.ok(child); assert.equal(child.items[0].action.id, 'prev', 'former direct action retained');
  assert.equal(child.items.length, 2); assert.equal(r.executed.length, 0, 'editor never runs actions');

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


test('v3 migration resets only radial including old schemes and runs once', () => {
  for (const version of [undefined, 1, 2]) {
    const settings = { 'ST-Chat-Jumper': { toolbar: { order: ['prev'] }, favorites: ['keep'], other: 42, radial: { version, enabled: true, schemes: [{ id: 'legacy' }], menus: [] } }, unrelated: { token: 'keep' } };
    const toolbar = settings['ST-Chat-Jumper'].toolbar;
    const before = structuredClone(settings); delete before['ST-Chat-Jumper'].radial;
    assert.equal(configModule.migrateRadialSettings(settings), true);
    assert.equal(settings['ST-Chat-Jumper'].radial.version, 3);
    assert.deepEqual(settings['ST-Chat-Jumper'].radial.schemes, []);
    assert.equal(settings['ST-Chat-Jumper'].radial.enabled, false);
    const radial = settings['ST-Chat-Jumper'].radial; radial.enabled = true;
    assert.equal(configModule.migrateRadialSettings(settings), false);
    assert.equal(settings['ST-Chat-Jumper'].radial, radial);
    assert.equal(radial.enabled, true);
    assert.equal(settings['ST-Chat-Jumper'].toolbar, toolbar);
    const after = structuredClone(settings); delete after['ST-Chat-Jumper'].radial;
    assert.deepEqual(after, before);
  }
});
test('runtime and preview child bounds share 1.04R to 1.55R independent of child scale', () => {
  for (const radius of [56, 80, 120, 200, 260]) for (const scale of [70, 100, 130]) {
    const expected = { subInner: radius * 1.04, subOuter: radius * 1.55 };
    assert.deepEqual(viewModule.resolveSubringBounds(radius, radius * .46, { scale }, false), expected);
    assert.deepEqual(viewModule.resolveSubringBounds(radius, radius * .65, { scale }, true), expected);
  }
});
test('legacy JSON imports are gated on the current schema', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/radial-settings.js'), 'utf8');
  assert.ok(source.includes('raw.version !== RADIAL_CONFIG_VERSION'));
  assert.ok(!source.includes('同页二级起始旋转'));
});

function editorReviewFixture() {
  const r = runtime();
  r.config.menus[0].items[0] = { label:'Shared first', submenu:'favorites' };
  const dialog = new Element('dialog'), mount = new Element('div'); dialog.append(mount);r.document.body.append(dialog);
  let saved = r.config, writes=0;
  const feature = radialSettingsModule.createFeature({dependencies:{
    getRadialConfig:()=>saved,saveRadialConfig:next=>{saved=configModule.normalizeRadialConfig(next);writes++;},
    listShortcutActions:()=>[{type:'plugin',id:'prev',label:'prev'}],cancelRadial:()=>{},
    createRadialView:opts=>viewModule.createFeature().createRadialView(opts),loadFavoritesPreviewMode:()=> 'swipe_default',saveFavoritesPreviewMode:()=>{}
  }});
  feature.mountRadialSettings(mount);
  const actions=mount.querySelector('[data-stcj-page=actions]');
  return {r,mount,actions,feature,saved:()=>saved,writes:()=>writes,cell:(tier,i)=>actions.all().find(n=>n.dataset.editTier===tier&&n.dataset.editIndex===String(i))};
}
test('center deselection refreshes appearance and stale child controls cannot mutate or record history', () => {
  const f=editorReviewFixture(); f.cell('main',5).click(); f.cell('sub',0).click();
  const stale=f.mount.querySelector('[aria-label="独立二级外观"]'); assert.ok(stale);
  const before=JSON.stringify(f.saved()), writes=f.writes();
  f.actions.querySelector('.stcj-radial-center').click();
  assert.equal(f.mount.querySelector('[aria-label="独立二级外观"]'),null);
  stale.checked=true; assert.doesNotThrow(()=>stale.emit('change'));
  assert.equal(JSON.stringify(f.saved()),before);assert.equal(f.writes(),writes);
  const undo=f.actions.all().find(n=>n.textContent==='↶ 撤销'); assert.equal(undo.disabled,true);
  f.feature.destroyRadialSettings(); f.r.services.destroyRadial();
});
test('shared appearance selector identifies the parent and isolates only the selected second parent', () => {
  const f=editorReviewFixture();
  const picker=f.mount.querySelector('[aria-label="外观编辑轮盘"]');
  assert.ok(picker.children.some(n=>n.value==='parent:0')); assert.ok(picker.children.some(n=>n.value==='parent:5'));
  picker.value='parent:5';picker.emit('change');
  const independent=f.mount.querySelector('[aria-label="独立二级外观"]'); independent.checked=true;independent.emit('change');
  const c=f.saved(),first=c.menus[0].items[0],second=c.menus[0].items[5];
  assert.equal(first.submenu,'favorites'); assert.notEqual(second.submenu,'favorites');
  assert.equal(c.menus.find(m=>m.id==='favorites').appearance,null);assert.ok(c.menus.find(m=>m.id===second.submenu).appearance);
  f.feature.destroyRadialSettings();f.r.services.destroyRadial();
});
