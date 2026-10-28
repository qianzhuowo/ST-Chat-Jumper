import { normalizeUserIcon, sanitizeIconPath, setUserIcons, getUserIcons } from './icon-library.js';

// Custom icons are stored in their own user file instead of the shared settings.json:
//   ST: data/<user>/user/files/stcj-icon-library.json   TT: <data_root>/default-user/user/files/...
// Both hosts expose the same /api/files/upload + /user/files/ routes, and deleting the
// extension folder never touches user files.
export const ICON_FILE = 'stcj-icon-library.json';
export const ICON_FILE_URL = `/user/files/${ICON_FILE}`;
export const ICON_LIBRARY_LIMIT = 200;
export const requiredServices = [];

const toBase64 = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
export function newIconId(existing) {
  const used = new Set(existing.map(i => i.id));
  let id; do id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); while (used.has(id));
  return id;
}
// Moves legacy inline cell paths into library entries. Pure: returns the new list and the replaced cell count.
export function migrateInlinePaths(config, icons) {
  const list = icons.slice(); let moved = 0;
  const visit = item => {
    const d = sanitizeIconPath(item?.iconPath);
    if (!d) return;
    let icon = list.find(i => i.d === d && i.viewBox === '0 0 24 24' && i.mode === 'fill');
    if (!icon) { icon = { id: newIconId(list), name: `${item.label || '自定义'} 图标`.slice(0, 40), d, viewBox: '0 0 24 24', mode: 'fill' }; list.push(icon); }
    item.iconId = `user:${icon.id}`; delete item.iconPath; moved++;
  };
  for (const menu of config.menus || []) for (const item of menu.items || []) visit(item);
  for (const scheme of config.schemes || []) for (const menu of scheme.menus || []) for (const item of menu.items || []) visit(item);
  return { icons: list, moved };
}
export function iconUsage(config, iconId) {
  let count = 0;
  const each = menus => { for (const m of menus || []) for (const i of m.items || []) if (i.iconId === iconId) count++; };
  each(config.menus); for (const s of config.schemes || []) each(s.menus);
  if (config.appearance?.centerIconId === iconId) count++;
  return count;
}

export function createFeature() {
  let loading = null, loaded = false, lastError = '';
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* listener errors stay local */ } });
  async function loadIconLibrary(force = false) {
    if (loaded && !force) return getUserIcons();
    if (loading && !force) return loading;
    loading = (async () => {
      try {
        const response = await fetch(`${ICON_FILE_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (response.status === 404) setUserIcons([]);
        else if (!response.ok) throw new Error(`读取图标文件失败（HTTP ${response.status}）`);
        else {
          const data = await response.json();
          setUserIcons(Array.isArray(data?.icons) ? data.icons : []);
        }
        loaded = true; lastError = '';
      } catch (error) { lastError = error.message || String(error); }
      finally { loading = null; notify(); }
      return getUserIcons();
    })();
    return loading;
  }
  async function saveIconLibrary(icons) {
    const list = icons.map(normalizeUserIcon).filter(Boolean).slice(0, ICON_LIBRARY_LIMIT);
    const body = JSON.stringify({ version: 1, icons: list }, null, 1);
    const ctx = window.SillyTavern?.getContext?.();
    const headers = { ...(ctx?.getRequestHeaders?.() || {}), 'Content-Type': 'application/json' };
    const response = await fetch('/api/files/upload', { method: 'POST', headers, body: JSON.stringify({ name: ICON_FILE, data: toBase64(body) }) });
    if (!response.ok) throw new Error(`保存图标文件失败（HTTP ${response.status}）`);
    setUserIcons(list); loaded = true; lastError = ''; notify();
    return getUserIcons();
  }
  function onIconLibraryChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function iconLibraryStatus() { return { loaded, error: lastError, count: getUserIcons().length }; }
  return { loadIconLibrary, saveIconLibrary, onIconLibraryChange, iconLibraryStatus };
}
