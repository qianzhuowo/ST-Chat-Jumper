import { ACTION_CATALOG } from './action-catalog.js';
export const requiredServices = ['handleAction', 'toastInfo', 'toggleGlobalHide'];

// No DOM clicks, eval, or host-private imports. Future action providers register
// a namespaced ID and handler and keep their own host capability checks.
// Built-in plugin actions come from action-catalog.js, so a new catalog entry is
// automatically available to the radial settings picker.
export function createFeature({ dependencies }) {
  const actions = new Map();
  function registerShortcutAction(action) {
    if (!action || !/^[\w-]+$/.test(action.type) || typeof action.id !== 'string' || !action.id || typeof action.execute !== 'function') throw new TypeError('Invalid shortcut action');
    const key = `${action.type}:${action.id}`;
    if (actions.has(key)) throw new Error(`Duplicate shortcut action: ${key}`);
    actions.set(key, { ...action });
    return () => actions.delete(key);
  }
  for (const item of ACTION_CATALOG) registerShortcutAction({ type: 'plugin', id: item.id, label: item.label, icon: item.icon, execute: () => item.service === 'toggleGlobalHide' ? dependencies.toggleGlobalHide() : dependencies.handleAction(item.run || item.id) });
  function listShortcutActions() { return [...actions.values()].map(({ type, id, label, icon }) => ({ type, id, label, icon })); }
  async function executeShortcutAction(ref) {
    const action = actions.get(`${ref?.type}:${ref?.id}`);
    if (!action) { dependencies.toastInfo('此轮盘动作尚未注册或不可用'); return false; }
    try { await action.execute(); return true; }
    catch (error) { console.warn('[STCJ] Shortcut action failed', error); dependencies.toastInfo('轮盘动作执行失败，请检查当前聊天状态'); return false; }
  }
  return { registerShortcutAction, listShortcutActions, executeShortcutAction };
}
