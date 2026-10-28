import { ICONS } from './constants.js';

// Single source of truth for plugin actions shared by the floating toolbar and the
// radial menu. Add a new feature action here once: the shortcut registry, radial
// settings picker and radial icons pick it up automatically. `icon` is a key of the
// trusted constants.ICONS table (or [key, argument] for parameterised icons).
export const ACTION_CATALOG = Object.freeze([
  { id: 'prev', label: '上一楼', icon: 'chevronUp' },
  { id: 'next', label: '下一楼', icon: 'chevronDown' },
  { id: 'recent1', label: '最新楼', icon: ['num', 1] },
  { id: 'recent2', label: '最近第2楼', icon: ['num', 2] },
  { id: 'recent3', label: '最近第3楼', icon: ['num', 3] },
  { id: 'quickEdit', label: '编辑', icon: 'pencil' },
  { id: 'quickDelete', label: '快速删除', icon: 'trash' },
  { id: 'quickPage', label: '快速翻页(右)', icon: 'fastForward' },
  { id: 'quickPageLeft', label: '快速翻页(左)', icon: 'fastBackward' },
  { id: 'showRange', label: '跳转/区间显示', icon: 'range' },
  { id: 'rangePrev', label: '区间上一页', icon: 'chevronLeft' },
  { id: 'rangeNext', label: '区间下一页', icon: 'chevronRight' },
  { id: 'resetRange', label: '恢复区间', icon: 'restore' },
  { id: 'currentHead', label: '对齐到头部', icon: 'head' },
  { id: 'currentTail', label: '对齐到尾部', icon: 'tail' },
  { id: 'toggleCollapse', label: '收起/展开', icon: 'minus' },
  { id: 'toggleOrientation', label: '横/竖布局切换', icon: 'horizontal' },
  { id: 'togglePin', label: '点选收藏', icon: 'pin' },
  { id: 'toggleFavPanel', label: '最近收藏', icon: 'note', run: 'openFavoritesManager' },
  { id: 'openFavoritesManager', label: '收藏管理', icon: 'folder' },
  // Radial-only: calls the same service as the settings「一键隐藏悬浮条」button.
  { id: 'toggleToolbar', label: '隐藏/显示悬浮条', icon: 'eyeOff', service: 'toggleGlobalHide' },
]);

// Action kinds a radial cell can hold. Future kinds (host commands, character
// actions, ...) are added here; the inspector title and type picker read this map.
export const ACTION_TYPES = Object.freeze({
  empty: { label: '空动作' },
  plugin: { label: '插件动作' },
});
export function actionTypeOf(item) {
  if (item?.action) return item.action.type || 'plugin';
  return item?.submenu ? 'submenu' : 'empty';
}
export function actionTypeLabel(item) {
  const type = actionTypeOf(item);
  if (type === 'submenu') return '二级动作组';
  const label = ACTION_TYPES[type]?.label || `${type} 动作`;
  return item?.submenu ? `${label} · 含二级` : label;
}

const byId = new Map(ACTION_CATALOG.map(entry => [entry.id, entry]));
export function findCatalogAction(id) { return byId.get(id) || null; }
// Returns only markup from the trusted ICONS table; never user-provided strings.
export function iconSvg(icon) {
  const [name, arg] = Array.isArray(icon) ? icon : [icon];
  const value = typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : '';
  return typeof value === 'function' ? value(arg) : value || '';
}
export function actionIconSvg(actionRef) {
  if (!actionRef || (actionRef.type && actionRef.type !== 'plugin')) return '';
  const entry = byId.get(typeof actionRef === 'string' ? actionRef : actionRef.id);
  return entry ? iconSvg(entry.icon) : '';
}
