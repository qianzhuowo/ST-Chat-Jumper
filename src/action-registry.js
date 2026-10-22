import { CONFIGURABLE_BUTTONS } from './constants.js';
export const requiredServices = ['handleAction', 'toastInfo'];

// No DOM clicks, eval, or host-private imports. Future action providers register
// a namespaced ID and handler and keep their own host capability checks.
export function createFeature({ dependencies }) {
  const actions = new Map();
  function registerShortcutAction(action) {
    if (!action || !/^[\w-]+$/.test(action.type) || typeof action.id !== 'string' || !action.id || typeof action.execute !== 'function') throw new TypeError('Invalid shortcut action');
    const key = `${action.type}:${action.id}`;
    if (actions.has(key)) throw new Error(`Duplicate shortcut action: ${key}`);
    actions.set(key, { ...action });
    return () => actions.delete(key);
  }
  const builtin = CONFIGURABLE_BUTTONS.filter(b => b.id !== 'pinGroup');
  builtin.push({ id: 'togglePin', label: '点选收藏' }, { id: 'toggleFavPanel', label: '最近收藏' }, { id: 'openFavoritesManager', label: '收藏管理' }, { id: 'rangePrev', label: '区间上一页' }, { id: 'rangeNext', label: '区间下一页' }, { id: 'resetRange', label: '恢复区间' });
  for (const item of builtin) registerShortcutAction({ type: 'plugin', ...item, execute: () => dependencies.handleAction(item.id === 'toggleFavPanel' ? 'openFavoritesManager' : item.id) });
  function listShortcutActions() { return [...actions.values()].map(({ type, id, label }) => ({ type, id, label })); }
  async function executeShortcutAction(ref) {
    const action = actions.get(`${ref?.type}:${ref?.id}`);
    if (!action) { dependencies.toastInfo('此轮盘动作尚未注册或不可用'); return false; }
    try { await action.execute(); return true; }
    catch (error) { console.warn('[STCJ] Shortcut action failed', error); dependencies.toastInfo('轮盘动作执行失败，请检查当前聊天状态'); return false; }
  }
  return { registerShortcutAction, listShortcutActions, executeShortcutAction };
}
