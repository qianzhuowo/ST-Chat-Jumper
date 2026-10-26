import { resolveSubringBounds, resolveWheelAppearance, arcHitIndex } from './radial-view.js';
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
  function computeWheelMetrics(config, menu, origin, activeSubmenu = null) {
    const baseApp = normalizeRadialAppearance(menu.appearance || config.appearance);
    const desiredRadius = config.radius * baseApp.scale / 100;
    const maxViewportRadius = Math.max(12, (Math.min(innerWidth, innerHeight) - 32) / 2);
    const submenus = [
      ...(activeSubmenu ? [activeSubmenu] : []),
      ...(menu.items || []).map(item => item?.submenu && config.menus.find(m => m.id === item.submenu)).filter(Boolean),
    ];
    const calcTotal = r => {
      if (!submenus.length) return r;
      const app = resolveWheelAppearance(config, menu, r);
      const inner = r * app.innerRatio / 100;
      let maxOuter = r;
      for (const sub of submenus) {
        const subApp = resolveWheelAppearance(config, sub, r);
        const { subOuter } = resolveSubringBounds(r, inner, subApp, false);
        if (subOuter > maxOuter) maxOuter = subOuter;
      }
      return maxOuter;
    };
    const unscaledTotal = calcTotal(desiredRadius);
    const scaleFactor = unscaledTotal > maxViewportRadius ? maxViewportRadius / unscaledTotal : 1;
    const radius = Math.max(12, desiredRadius * scaleFactor);
    const totalRadius = Math.min(maxViewportRadius, calcTotal(radius));
    const center = radialCenter(origin.x, origin.y, totalRadius, innerWidth, innerHeight);
    return { radius, totalRadius, center };
  }
  function render() {
    const a = active;
    const metrics = computeWheelMetrics(a.config, a.menu, a.origin, a.submenu);
    a.radius = metrics.radius;
    a.totalRadius = metrics.totalRadius;
    a.center = metrics.center;
    a.appearance = resolveWheelAppearance(a.config, a.menu, a.radius);
    a.subAppearance = a.submenu ? resolveWheelAppearance(a.config, a.submenu, a.radius) : null;
    a.overlay.replaceChildren();
    a.view = dependencies.createRadialView({
      menu: a.menu,
      appearance: a.appearance,
      radius: a.radius,
      selected: a.selected,
      submenu: a.submenu,
      subAppearance: a.subAppearance,
      subSelected: a.subSelected,
      parentIndex: a.lockedParentIndex,
      activeTier: 'main',
      onChoose: i => { if (a.pointerId == null) chooseMain(i); },
      onSubChoose: i => { if (a.pointerId == null) chooseSub(i); },
      onCenter: () => {
        if (a.submenu) closeSubmenu();
        else cancelRadial();
      },
    });
    const ring = a.view.element;
    ring.style.left = a.center.x + 'px';
    ring.style.top = a.center.y + 'px';
    a.overlay.append(ring);
    a.buttons = a.view.buttons;
    a.subButtons = a.view.subButtons || [];
    const hint = document.createElement('div');
    hint.className = 'stcj-radial-hint';
    const outerRadius = a.view.subringBounds ? a.view.subringBounds.subOuter : a.radius;
    const titleLabel = a.submenu ? `${a.menu.label} › ${a.submenu.label} (同屏二级)` : a.menu.label;
    hint.textContent = titleLabel + ' · ' + (a.pointerId != null ? '外滑选子轮盘 / 内退解锁 / 中心取消' : '点击选择 / 方向键、Enter') + ' · Esc 取消';
    hint.style.top = Math.min(innerHeight - 32, a.center.y + outerRadius + 8) + 'px';
    a.overlay.append(hint);
  }
  function openSubmenu(id, parentIndex, focusSub = false) {
    const sub = menuById(id);
    if (!sub) return;
    clearSubmenu();
    const changed = active.submenu?.id !== sub.id || active.lockedParentIndex !== parentIndex;
    active.submenu = sub;
    active.lockedParentIndex = parentIndex;
    active.selected = parentIndex;
    if (changed) active.subSelected = -1;
    if (focusSub) {
      active.focusTier = 'sub';
      active.enterPoint = lastPoint ? { ...lastPoint } : null;
    }
    if (changed) render();
  }
  function closeSubmenu() {
    if (!active) return;
    clearSubmenu();
    active.submenu = null;
    active.subSelected = -1;
    active.lockedParentIndex = -1;
    active.enteredSubring = false;
    active.focusTier = 'main';
    render();
  }
  function chooseMain(index) {
    if (!active) return;
    const item = active.menu.items[index];
    if (item?.submenu) {
      active.pointerId = null;
      openSubmenu(item.submenu, index, true);
      render();
      return;
    }
    cancelRadial();
    if (item?.action) void dependencies.executeShortcutAction(item.action);
  }
  function chooseSub(index) {
    if (!active?.submenu) return;
    const item = active.submenu.items[index];
    if (!item?.action) {
      // Empty secondary slot clears hit and never executes a parent or stale action.
      cancelRadial();
      return;
    }
    cancelRadial();
    void dependencies.executeShortcutAction(item.action);
  }
  function openRadial(x = innerWidth / 2, y = innerHeight / 2, pointerId = null, touch = false) {
    cancelRadial();
    const config = dependencies.getRadialConfig(); if (!config.enabled) return false;
    const menu = config.menus.find(m => m.id === 'main');
    const metrics = computeWheelMetrics(config, menu, { x, y });
    const overlay = document.createElement('div'); overlay.id = 'stcj-radial'; overlay.className = 'stcj-radial-overlay';
    overlay.tabIndex = -1; overlay.setAttribute('aria-label', 'Chat Jumper 快捷轮盘');
    previousFocus = document.activeElement;
    active = {
      config,
      center: metrics.center,
      radius: metrics.radius,
      totalRadius: metrics.totalRadius,
      overlay,
      pointerId,
      touch,
      origin: { x, y },
      menu,
      selected: -1,
      submenu: null,
      subAppearance: null,
      subSelected: -1,
      lockedParentIndex: -1,
      enteredSubring: false,
      focusTier: 'main',
    };
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
    const inner1 = a.radius * a.appearance.innerRatio / 100;
    const primaryCancel = Math.max(a.config.cancelDistance, a.radius + 40);
    const distance = Math.hypot(x - a.center.x, y - a.center.y);

    // 1. Center deadzone clears both primary and secondary hits.
    if (distance < inner1) {
      clearSubmenu();
      a.selected = -1;
      a.subSelected = -1;
      a.enteredSubring = false;
      a.lockedParentIndex = -1;
      a.focusTier = 'main';
      if (a.submenu) { a.submenu = null; render(); }
      else { a.view.setSelected(-1); a.view.setSubSelected(-1); }
      return;
    }

    // 2. If a submenu is open on the same screen, handle outer ring hit-testing, parent lock & inward hysteresis unlock.
    if (a.submenu) {
      const bounds = a.view.subringBounds || resolveSubringBounds(a.radius, inner1, a.subAppearance, false);
      const outerCancel = Math.max(primaryCancel, bounds.subOuter + 36);
      const unlockRadius = Math.max(inner1 + 6, a.radius - 12);

      if (distance > outerCancel) {
        clearSubmenu();
        a.selected = -1;
        a.subSelected = -1;
        a.view.setSelected(-1);
        a.view.setSubSelected(-1);
        return;
      }

      if (distance >= bounds.subInner) {
        a.enteredSubring = true;
        a.focusTier = 'sub';
        if (a.lockedParentIndex >= 0 && a.selected !== a.lockedParentIndex) {
          a.selected = a.lockedParentIndex;
          a.view.setSelected(a.selected);
        }
        const subArc = a.view.subArc;
        const rawSub = distance > bounds.subOuter
          ? -1
          : subArc
            ? arcHitIndex(Math.atan2(y - a.center.y, x - a.center.x) * 180 / Math.PI, subArc, a.submenu.items.length)
            : radialHitTest(x, y, a.center, a.submenu.items.length, bounds.subInner, bounds.subOuter, a.view.subRotation ?? a.subAppearance.rotation);
        const subItem = rawSub >= 0 ? a.submenu.items[rawSub] : null;
        // Empty secondary area clears hit to prevent mis-triggering.
        const nextSub = subItem?.action ? rawSub : -1;
        if (nextSub !== a.subSelected) {
          a.subSelected = nextSub;
          a.view.setSubSelected(nextSub);
        }
        return;
      }

      if (a.enteredSubring && distance > unlockRadius) {
        // Hysteresis band: keep parent sector locked while clearing outer hit.
        if (a.lockedParentIndex >= 0 && a.selected !== a.lockedParentIndex) {
          a.selected = a.lockedParentIndex;
          a.view.setSelected(a.selected);
        }
        if (a.subSelected !== -1) {
          a.subSelected = -1;
          a.view.setSubSelected(-1);
        }
        return;
      }

      // Retreated inward past hysteresis threshold: unlock parent and return to primary ring.
      a.enteredSubring = false;
      a.focusTier = 'main';
      if (a.subSelected !== -1) {
        a.subSelected = -1;
        a.view.setSubSelected(-1);
      }
    }

    // 3. Primary ring hit test.
    if (distance > primaryCancel) {
      clearSubmenu();
      a.selected = -1;
      a.subSelected = -1;
      a.view.setSelected(-1);
      a.view.setSubSelected(-1);
      return;
    }
    const rawPrimary = radialHitTest(x, y, a.center, a.menu.items.length, inner1, primaryCancel, a.appearance.rotation);
    const primaryItem = rawPrimary >= 0 ? a.menu.items[rawPrimary] : null;
    // Empty primary slot clears hit to prevent mis-triggering.
    const i = (primaryItem?.action || primaryItem?.submenu) ? rawPrimary : -1;
    if (i === a.selected && ((primaryItem?.submenu && a.submenu?.id === primaryItem.submenu) || (!primaryItem?.submenu && !a.submenu))) return;
    clearSubmenu();
    a.selected = i;
    a.subSelected = -1;
    if (primaryItem?.submenu) {
      openSubmenu(primaryItem.submenu, i, false);
      submenuTimer = setTimeout(() => {
        if (active === a && a.selected === i && a.submenu?.id === primaryItem.submenu) {
          a.focusTier = 'sub';
          a.enterPoint = lastPoint ? { ...lastPoint } : null;
        }
      }, a.config.submenuDelay);
    } else if (a.submenu) {
      closeSubmenu();
      a.selected = i;
      a.view.setSelected(i);
    } else {
      a.view.setSelected(i);
    }
  }
  function installRadialGestures() {
    detach?.();
    const listeners = [];
    const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push(() => target.removeEventListener(type, fn, options)); };
    const modifier = (e, name) => {
      const required = name === 'altShift' ? ['alt', 'shift'] : name === 'ctrlShift' ? ['ctrl', 'shift'] : name === 'none' ? [] : [name];
      return ['alt', 'ctrl', 'shift', 'meta'].every(key => !!e[`${key}Key`] === (required.includes(key)));
    };
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
        const subIdx = active.subSelected;
        const wasInSubring = active.enteredSubring;
        if (e.cancelable) e.preventDefault();
        if (wasInSubring) {
          if (subIdx >= 0) chooseSub(subIdx);
          else cancelRadial();
        } else if (i < 0 && active.touch && Math.hypot(e.clientX - active.origin.x, e.clientY - active.origin.y) < 10) {
          active.pointerId = null;
          render();
        } else if (i < 0) {
          cancelRadial();
        } else {
          chooseMain(i);
        }
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
        if (e.key === 'Backspace') {
          e.preventDefault();
          if (active.submenu) closeSubmenu();
          return;
        }
        if (e.key.startsWith('Arrow')) {
          e.preventDefault(); clearSubmenu();
          const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
          if (active.focusTier === 'sub' && active.submenu) {
            const count = active.submenu.items.length; if (!count) return;
            active.subSelected = (active.subSelected + step + count) % count;
            active.view.setSubSelected(active.subSelected);
            return;
          }
          const count = active.menu.items.length; if (!count) return;
          active.selected = (active.selected + step + count) % count;
          const item = active.menu.items[active.selected];
          if (item?.submenu) openSubmenu(item.submenu, active.selected, false);
          else if (active.submenu) { closeSubmenu(); active.selected = (active.selected + count) % count; active.view.setSelected(active.selected); }
          else active.view.setSelected(active.selected);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (active.focusTier === 'sub' && active.submenu) {
            if (active.subSelected >= 0) chooseSub(active.subSelected);
          } else {
            chooseMain(active.selected);
          }
        }
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
