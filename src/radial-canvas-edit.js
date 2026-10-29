// Settings-only Pointer Events. Swaps any two cells, also across tiers; never dispatches actions.
// A cell is { tier: 'main' | 'sub', index, parent } read from data-edit-tier / -index / -parent.
const suppressUntil = new WeakMap();
export function bindCanvasSwap(canvas, onSwap, onCancel = () => {}) {
  let drag = null;
  const listeners = [];
  const on = (target, type, handler, capture = false) => { target.addEventListener(type, handler, capture); listeners.push(() => target.removeEventListener(type, handler, capture)); };
  const cell = target => target?.closest?.('[data-edit-tier][data-edit-index]');
  const cellOf = b => ({ tier: b.dataset.editTier, index: Number(b.dataset.editIndex), parent: b.dataset.editParent == null ? -1 : Number(b.dataset.editParent) });
  const clear = () => { const old = drag; drag = null; canvas.classList.remove('is-dragging'); canvas.querySelectorAll('.is-drop-target').forEach(b => b.classList.remove('is-drop-target')); if (old && canvas.hasPointerCapture?.(old.id)) canvas.releasePointerCapture(old.id); };
  const cancel = () => { if (!drag) return; suppressUntil.set(canvas, Date.now() + 500); clear(); onCancel(); };
  on(canvas, 'pointerdown', e => {
    if (drag || e.isPrimary === false || e.button !== 0) return;
    const b = cell(e.target); if (!b || !canvas.contains(b)) return;
    drag = { id: e.pointerId, from: cellOf(b), x: e.clientX, y: e.clientY, moved: false };
  });
  on(window, 'pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7 && !drag.moved) return;
    if (!drag.moved) canvas.setPointerCapture?.(e.pointerId);
    drag.moved = true; e.preventDefault(); canvas.classList.add('is-dragging');
    canvas.querySelectorAll('.is-drop-target').forEach(b => b.classList.remove('is-drop-target'));
    const target = cell(document.elementFromPoint(e.clientX, e.clientY));
    if (target && canvas.contains(target)) target.classList.add('is-drop-target');
  });
  on(window, 'pointerup', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const state = drag, target = cell(document.elementFromPoint(e.clientX, e.clientY));
    clear();
    if (!state.moved) return;
    e.preventDefault(); suppressUntil.set(canvas, Date.now() + 500);
    if (target && canvas.contains(target)) onSwap(state.from, cellOf(target));
    else onCancel();
  });
  on(canvas, 'click', e => { if (Date.now() < (suppressUntil.get(canvas) || 0)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  on(window, 'pointercancel', e => { if (drag?.id === e.pointerId) cancel(); });
  // Touch transfers implicit capture from the original button to this canvas.
  // The old button's bubbling lost event is not loss of our canvas capture.
  on(canvas, 'lostpointercapture', e => { if (e.target === canvas && drag?.id === e.pointerId) cancel(); });
  on(canvas, 'keydown', e => {
    if (e.key === 'Escape') { if (drag) { e.preventDefault(); e.stopPropagation(); cancel(); } return; }
    const b = cell(e.target); if (!b || !e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const delta = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
    const from = cellOf(b); onSwap(from, { ...from, index: from.index + delta });
  });
  on(window, 'blur', cancel); on(window, 'scroll', cancel, true);
  return () => { clear(); listeners.splice(0).forEach(off => off()); };
}
