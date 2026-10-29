import { EXT_SETTINGS_KEY } from './constants.js';
import { isIconId, sanitizeIconPath } from './icon-library.js';

export const requiredServices = [];
export const RADIAL_CONFIG_VERSION = 4;
// Only this dedicated namespace is migrated; toolbar/favorites/host data stay intact.
export function migrateRadialSettings(extensionSettings) {
  const settings = extensionSettings?.[EXT_SETTINGS_KEY];
  if (!settings || settings.radial?.version === RADIAL_CONFIG_VERSION) return false;
  settings.radial = defaultRadialConfig();
  return true;
}
const number = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;
// #rrggbb or #rrggbbaa (alpha channel for per-colour transparency).
export const COLOR_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
export const RADIAL_THEMES = {
  graphite: { label: '石墨深色', surface: '#252d3b', highlight: '#345b86', text: '#eef4ff', border: '#546174', accent: '#80b8ff', center: '#18202d' },
  porcelain: { label: '瓷白', surface: '#f6f8fb', highlight: '#d9e8ff', text: '#25354c', border: '#c9d2dd', accent: '#356ee5', center: '#e7edf4' },
  glacier: { label: '冰川蓝', surface: '#e3f4fa', highlight: '#afdbea', text: '#244756', border: '#a0c3d0', accent: '#197d9e', center: '#cce8f1' },
  forest: { label: '苔绿', surface: '#e7eee4', highlight: '#bbd8b6', text: '#314b3a', border: '#a7b9a4', accent: '#427955', center: '#d3e2cd' },
};
export function defaultRadialAppearance(theme = 'graphite') {
  const id = typeof theme === 'string' && Object.prototype.hasOwnProperty.call(RADIAL_THEMES, theme) ? theme : 'graphite';
  const palette = RADIAL_THEMES[id];
  return { ...palette, theme: id, shape: 'ring', gap: 3, innerRatio: 46, rotation: 0, fontSize: 12, scale: 100, opacity: 96, glow: 14, corner: 6, centerSymbol: '×' };
}
export function normalizeRadialAppearance(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const result = defaultRadialAppearance(r.theme);
  for (const key of ['surface', 'highlight', 'text', 'border', 'accent', 'center']) if (typeof r[key] === 'string' && COLOR_RE.test(r[key])) result[key] = r[key].toLowerCase();
  result.shape = ['ring', 'petals', 'solid'].includes(r.shape) ? r.shape : result.shape;
  for (const [key, min, max] of [['gap', 0, 16], ['innerRatio', 25, 65], ['rotation', -180, 180], ['fontSize', 10, 20], ['scale', 70, 130], ['opacity', 45, 100], ['glow', 0, 30], ['corner', 0, 16]]) result[key] = number(r[key], result[key], min, max);
  if (typeof r.centerSymbol === 'string') result.centerSymbol = [...r.centerSymbol].slice(0, 3).join('') || '×';
  // Centre icon is edited from the actions page together with the sector icons.
  if (isIconId(r.centerIconId)) result.centerIconId = r.centerIconId;
  return result;
}
const slot = (id, label) => ({ label, showLabel: true, showIcon: true, action: { type: 'plugin', id } });
const empty = () => ({ label: '未设置', showLabel: false, showIcon: true });
export function defaultRadialConfig() {
  return {
    version: RADIAL_CONFIG_VERSION, panelTheme: 'host', appearance: defaultRadialAppearance(), schemes: [], enabled: false, mouseEnabled: false, mouseButton: 2, modifier: 'alt',
    keyboardEnabled: true, key: 'j', keyModifier: 'altShift', touchMode: 'off',
    // PC (mouse/keyboard) and mobile (touch) trigger profiles; each input event uses its own side.
    mouseScope: 'chat', touchScope: 'chat', pcEditor: true, pcComposer: false, touchTwoFinger: true,
    threshold: 24, longPress: 550, tapCount: 2, tapInterval: 320, radius: 120,
    deadZone: 28, cancelDistance: 240, submenuDelay: 400,
    menus: [{ id: 'main', label: '主轮盘', items: [slot('prev', '上一楼'), empty(), slot('recent1', '最新楼'), empty(), slot('next', '下一楼'), empty(), slot('quickEdit', '编辑'), empty()] }],
  };
}
export function normalizeRadialConfig(raw) {
  const d = defaultRadialConfig();
  const r = raw && typeof raw === 'object' ? raw : {};
  const result = { ...d, appearance: normalizeRadialAppearance(r.appearance) };
  for (const key of ['enabled', 'mouseEnabled', 'keyboardEnabled', 'pcEditor', 'pcComposer', 'touchTwoFinger']) result[key] = bool(r[key], d[key]);
  for (const [key, values] of Object.entries({ panelTheme: ['host', 'light', 'dark'], modifier: ['alt', 'ctrl', 'shift', 'none'], keyModifier: ['alt', 'ctrl', 'shift', 'altShift', 'ctrlShift'], touchMode: ['off', 'longPress', 'multiTap'] })) {
    result[key] = values.includes(r[key]) ? r[key] : d[key];
  }
  // Former shared `scope` seeds both sides once (no version bump: a version change resets the whole wheel).
  for (const key of ['mouseScope', 'touchScope']) result[key] = ['chat', 'page'].includes(r[key]) ? r[key] : ['chat', 'page'].includes(r.scope) ? r.scope : d[key];
  result.mouseButton = [1, 2, 3, 4].includes(r.mouseButton) ? r.mouseButton : d.mouseButton;
  result.key = typeof r.key === 'string' && /^[a-z0-9]$/i.test(r.key) ? r.key.toLowerCase() : d.key;
  for (const [key, min, max] of [['threshold', 8, 100], ['longPress', 300, 1500], ['tapCount', 2, 4], ['tapInterval', 150, 700], ['radius', 80, 200], ['deadZone', 16, 60], ['cancelDistance', 160, 500], ['submenuDelay', 200, 1500]]) result[key] = number(r[key], d[key], min, max);
  result.cancelDistance = Math.max(result.radius + 40, result.cancelDistance);
  const menus = Array.isArray(r.menus) ? r.menus.slice(0, 17) : d.menus;
  const ids = new Set();
  // Former global icon switch becomes the per-cell default once.
  const legacyIconsOff = r.appearance?.showIcons === false;
  result.menus = menus.filter(m => m && typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id) && !ids.has(m.id) && ids.add(m.id)).map(m => ({
    id: m.id, label: String(m.label || m.id).slice(0, 40), appearance: m.appearance ? normalizeRadialAppearance(m.appearance) : null,
    items: (Array.isArray(m.items) ? m.items : []).slice(0, 12).map(item => {
      const i = item && typeof item === 'object' ? item : {};
      const s = { label: String(i.label || '未设置').slice(0, 40) };
      if (typeof i.color === 'string' && COLOR_RE.test(i.color)) s.color = i.color;
      if (typeof i.submenu === 'string') s.submenu = i.submenu.slice(0, 40);
      // A parent cell may hold its own action in addition to its child group.
      if (i.action && typeof i.action.type === 'string' && typeof i.action.id === 'string') s.action = { type: i.action.type.slice(0, 40), id: i.action.id.slice(0, 100) };
      // Per-cell label visibility; when absent, cells with an action show their name.
      s.showLabel = typeof i.showLabel === 'boolean' ? i.showLabel : !!(s.action || s.submenu);
      s.showIcon = typeof i.showIcon === 'boolean' ? i.showIcon : !legacyIconsOff;
      if (isIconId(i.iconId)) s.iconId = i.iconId;
      const iconPath = sanitizeIconPath(i.iconPath); if (iconPath) s.iconPath = iconPath;
      return s;
    }),
  }));
  if (!result.menus.some(m => m.id === 'main')) result.menus.unshift(d.menus[0]);
  result.menus = result.menus.slice(0, 17);
  const main = result.menus.find(m => m.id === 'main');
  if (main.appearance) { result.appearance = main.appearance; main.appearance = null; }
  // A child group without any sector is not a secondary ring: drop it together with every reference,
  // so a parent never keeps the "has secondary" marker after its last child was deleted.
  const emptyChildren = new Set(result.menus.filter(m => m.id !== 'main' && !m.items.length).map(m => m.id));
  if (emptyChildren.size) {
    result.menus = result.menus.filter(m => !emptyChildren.has(m.id));
    for (const m of result.menus) for (const i of m.items) if (emptyChildren.has(i.submenu)) delete i.submenu;
  }
  // Exactly two levels: child menus cannot recurse or invoke other menus.
  for (const m of result.menus) for (const i of m.items) if (i.submenu && (m.id !== 'main' || i.submenu === 'main' || !result.menus.some(child => child.id === i.submenu))) delete i.submenu;
  const schemes = Array.isArray(r.schemes) ? r.schemes.slice(0, 8) : [];
  const schemeIds = new Set();
  result.schemes = schemes.filter(s => s && typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) && !schemeIds.has(s.id) && schemeIds.add(s.id)).map(s => {
    const normalized = normalizeRadialConfig({ menus: s.menus, appearance: s.appearance, radius: s.radius, schemes: [] });
    return { id: s.id, label: String(s.label || '自定义方案').slice(0, 40), menus: normalized.menus, appearance: normalized.appearance, radius: normalized.radius };
  });
  return result;
}
export function createFeature() {
  let fallback = defaultRadialConfig();
  function getRadialConfig() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (migrateRadialSettings(ctx?.extensionSettings)) ctx.saveSettingsDebounced?.();
      return normalizeRadialConfig(ctx?.extensionSettings?.[EXT_SETTINGS_KEY]?.radial ?? fallback);
    }
    catch { return normalizeRadialConfig(fallback); }
  }
  function saveRadialConfig(config) {
    fallback = normalizeRadialConfig(config);
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (ctx?.extensionSettings) {
        ctx.extensionSettings[EXT_SETTINGS_KEY] ??= {};
        ctx.extensionSettings[EXT_SETTINGS_KEY].radial = fallback;
        ctx.saveSettingsDebounced?.();
      }
    } catch { /* Session fallback when host storage is unavailable. */ }
    return getRadialConfig();
  }
  return { getRadialConfig, saveRadialConfig };
}
