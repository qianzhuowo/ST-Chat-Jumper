import { resolveWheelAppearance } from './radial-view.js';
import { normalizeRadialAppearance } from './radial-config.js';
export const requiredServices = ['getRadialConfig', 'executeShortcutAction', 'createRadialView'];

export function radialHitTest(x, y, center, count, deadZone, cancelDistance, rotation = 0) {
  const dx = x - center.x, dy = y - center.y;
  const distance = Math.hypot(dx, dy);
  if (!count || distance < deadZone || distance > cancelDistance) return -1;
  return Math.floor(((Math.atan2(dy, dx) + Math.PI / 2 - rotation * Math.PI / 180 + Math.PI / count + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * count) % count;
}
export function radialCenter(x, y, radius, width, height) {
  const margin = radius + 12;
  return { x: width < margin * 2 ? width / 2 : Math.max(margin, Math.min(width - margin, x)), y: height < margin * 2 ? height / 2 : Math.max(margin, Math.min(height - margin, y)) };
}
export function isRadialExcluded(target) {
  return !target?.closest || !!target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="button"], [role="combobox"], [role="slider"], summary, iframe, audio, video, [draggable="true"], [role="dialog"], dialog, .popup, #stcj-root, #stcj-settings-window, #stcj-settings-panel, .stcj-favorites-modal');
}
export function createFeature({ dependencies }) {
  let detach = null, pending = null, active = null, holdTimer = null, submenuTimer = null;
  let taps = null, consumed = null, lastPoint = null, previousFocus = null;
  const clearHold = () => { clearTimeout(holdTimer); holdTimer = null; };
  const clearSubmenu = () => { clearTimeout(submenuTimer); submenuTimer = null; };
  function cancelRadial() {
    clearHold(); clearSubmenu(); pending = null;
    if (active) {
      active.overlay.remove(); active = null;
      if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
      previousFocus = null;
    }
  }
  function available(target, config) {
    return config.enabled && !isRadialExcluded(target) && (config.scope === 'page' || !!target.closest('#chat'));
  }
  function menuById(id) { return active?.config.menus.find(m => m.id === id); }
  function render() {
    const a = active;
    a.appearance = normalizeRadialAppearance(a.menu.appearance || a.config.appearance);
    a.radius = Math.min(a.config.radius * a.appearance.scale / 100, Math.max(12, (Math.min(innerWidth, innerHeight) - 32) / 2));
    a.appearance = resolveWheelAppearance(a.config, a.menu, a.radius);
    a.center = radialCenter(a.origin.x, a.origin.y, a.radius, innerWidth, innerHeight);
    a.overlay.replaceChildren();
    a.view = dependencies.createRadialView({ menu: a.menu, appearance: a.appearance, radius: a.radius,
      onChoose: i => { if (a.pointerId == null) choose(i); },
      onCenter: () => { if (a.menu.id === 'main') cancelRadial(); else enterMenu('main'); }, selected: a.selected });
    const ring = a.view.element;
    ring.style.left = a.center.x + 'px'; ring.style.top = a.center.y + 'px';
    a.overlay.append(ring); a.buttons = a.view.buttons;
    const hint = document.createElement('div'); hint.className = 'stcj-radial-hint';
    hint.textContent = a.menu.label + ' · ' + (a.pointerId != null ? '松手执行 / 中心取消' : '点击选择 / 方向键、Enter') + ' · Esc 取消';
    hint.style.top = Math.min(innerHeight - 32, a.center.y + a.radius + 8) + 'px'; a.overlay.append(hint);
  }
  function enterMenu(id) {
    const menu = menuById(id); if (!menu) return;
    clearSubmenu(); active.menu = menu; active.selected = -1; active.enterPoint = lastPoint ? { ...lastPoint } : null; render();
  }
  function choose(index) {
    if (!active) return;
    const item = active.menu.items[index];
    if (item?.submenu) { active.pointerId = null; enterMenu(item.submenu); return; }
    cancelRadial();
    if (item?.action) void dependencies.executeShortcutAction(item.action);
  }
  function openRadial(x = innerWidth / 2, y = innerHeight / 2, pointerId = null, touch = false) {
    cancelRadial();
    const config = dependencies.getRadialConfig(); if (!config.enabled) return false;
    const radius = Math.min(config.radius, Math.max(12, (Math.min(innerWidth, innerHeight) - 32) / 2));
    const overlay = document.createElement('div'); overlay.id = 'stcj-radial'; overlay.className = 'stcj-radial-overlay';
    overlay.tabIndex = -1; overlay.setAttribute('aria-label', 'Chat Jumper 快捷轮盘');
    previousFocus = document.activeElement;
    active = { config, center: radialCenter(x, y, radius, innerWidth, innerHeight), radius, overlay, pointerId, touch, origin: { x, y }, menu: config.menus.find(m => m.id === 'main'), selected: -1 };
    overlay.addEventListener('click', e => { if (e.target === overlay) cancelRadial(); });
    document.body.append(overlay); render(); overlay.focus({ preventScroll: true });
    return true;
  }
  function selectAt(x, y) {
    const a = active; if (!a) return;
    if (a.touch && a.pointerId != null && Math.hypot(x - a.origin.x, y - a.origin.y) < 10) return;
    // A submenu must receive a fresh movement, never inherit its parent's release.
    if (a.enterPoint && Math.hypot(x - a.enterPoint.x, y - a.enterPoint.y) < 8) return;
    a.enterPoint = null;
    const i = radialHitTest(x, y, a.center, a.menu.items.length, a.radius * a.appearance.innerRatio / 100, Math.max(a.config.cancelDistance, a.radius + 40), a.appearance.rotation);
    if (i === a.selected) return;
    clearSubmenu(); a.selected = i;
    a.buttons.forEach((button, index) => button.classList.toggle('is-selected', index === i));
    if (a.menu.items[i]?.submenu) submenuTimer = setTimeout(() => { if (active === a && a.selected === i) enterMenu(a.menu.items[i].submenu); }, a.config.submenuDelay);
  }
  function installRadialGestures() {
    detach?.();
    const listeners = [];
    const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push(() => target.removeEventListener(type, fn, options)); };
    const modifier = (e, name) => ['alt', 'ctrl', 'shift', 'meta'].every(key => !!e[`${key}Key`] === (key === name));
    const markConsumed = (x, y) => { consumed = { x, y, until: Date.now() + 400 }; };
    on(document, 'pointerdown', e => {
      consumed = null;
      if (active) {
        if (active.pointerId != null && e.pointerId !== active.pointerId) cancelRadial();
        return;
      }
      const c = dependencies.getRadialConfig();
      if (!available(e.target, c) || e.isPrimary === false) { cancelRadial(); taps = null; return; }
      const touch = e.pointerType === 'touch';
      if (touch ? c.touchMode === 'off' : !c.mouseEnabled || e.button !== c.mouseButton || !modifier(e, c.modifier)) return;
      cancelRadial();
      pending = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, time: Date.now(), config: c };
      if (touch && c.touchMode === 'longPress') {
        const p = pending;
        holdTimer = setTimeout(() => { if (pending !== p) return; pending = null; openRadial(p.x, p.y, p.id, true); markConsumed(p.x, p.y); }, c.longPress);
      }
    }, true);
    on(document, 'pointermove', e => {
      lastPoint = { x: e.clientX, y: e.clientY };
      if (pending && e.pointerId === pending.id) {
        const p = pending;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= (p.touch ? 10 : p.config.threshold)) {
          clearHold(); pending = null;
          if (!p.touch) { openRadial(p.x, p.y, p.id); markConsumed(p.x, p.y); }
          else taps = null; // Scrolling always wins before activation.
        }
      }
      if (active && (active.pointerId == null || active.pointerId === e.pointerId)) {
        selectAt(e.clientX, e.clientY);
        if (active.pointerId != null && e.cancelable) e.preventDefault();
      }
    }, { capture: true, passive: false });
    on(document, 'pointerup', e => {
      if (pending?.id === e.pointerId) {
        const p = pending; clearHold(); pending = null;
        if (p.touch && p.config.touchMode === 'multiTap' && Date.now() - p.time < p.config.tapInterval) {
          const now = Date.now();
          if (!taps || now - taps.time > p.config.tapInterval || Math.hypot(taps.x - p.x, taps.y - p.y) > 24) taps = { count: 0, x: p.x, y: p.y };
          taps.count++; taps.time = now;
          if (taps.count >= p.config.tapCount) { e.stopImmediatePropagation(); taps = null; openRadial(p.x, p.y); markConsumed(p.x, p.y); if (e.cancelable) e.preventDefault(); }
        }
      }
      if (active?.pointerId === e.pointerId) {
        markConsumed(e.clientX, e.clientY);
        e.stopImmediatePropagation(); // Activated gestures own this release (including pin-pick listeners).
        const i = active.selected;
        if (e.cancelable) e.preventDefault();
        if (i < 0 && active.touch && Math.hypot(e.clientX - active.origin.x, e.clientY - active.origin.y) < 10) { active.pointerId = null; render(); }
        else if (i < 0) cancelRadial(); else choose(i);
      }
    }, { capture: true, passive: false });
    on(document, 'contextmenu', e => {
      if ((pending?.touch && pending.config.touchMode === 'longPress') || active || (consumed && consumed.until > Date.now() && Math.hypot(e.clientX - consumed.x, e.clientY - consumed.y) < 80)) e.preventDefault();
    }, true);
    on(document, 'click', e => {
      if (consumed && consumed.until > Date.now() && Math.hypot(e.clientX - consumed.x, e.clientY - consumed.y) < 40) { e.preventDefault(); e.stopImmediatePropagation(); consumed = null; }
    }, true);
    on(document, 'keydown', e => {
      if (active) {
        if (e.key === 'Escape' || e.key === 'Tab') { cancelRadial(); if (e.key === 'Escape') e.preventDefault(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); enterMenu('main'); return; }
        if (e.key.startsWith('Arrow')) {
          e.preventDefault(); clearSubmenu();
          const count = active.menu.items.length; if (!count) return;
          active.selected = (active.selected + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + count) % count;
          active.buttons.forEach((b, i) => b.classList.toggle('is-selected', i === active.selected)); return;
        }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active.selected); }
        return;
      }
      const c = dependencies.getRadialConfig();
      if (!e.repeat && c.keyboardEnabled && available(e.target, { ...c, scope: 'page' }) && e.key.toLowerCase() === c.key && modifier(e, c.keyModifier)) {
        e.preventDefault(); openRadial(lastPoint?.x, lastPoint?.y);
      }
    }, true);
    for (const type of ['pointercancel', 'dragstart']) on(document, type, () => { taps = null; cancelRadial(); }, true);
    on(document, 'scroll', () => { taps = null; cancelRadial(); }, true);
    on(document, 'visibilitychange', () => { if (document.hidden) cancelRadial(); });
    on(window, 'blur', cancelRadial); on(window, 'resize', cancelRadial);
    detach = () => { listeners.forEach(remove => remove()); cancelRadial(); consumed = null; taps = null; detach = null; };
    return detach;
  }
  function destroyRadial() { detach?.(); cancelRadial(); }
  return { openRadial, cancelRadial, installRadialGestures, destroyRadial };
}
