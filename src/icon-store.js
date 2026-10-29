import { normalizeUserIcon, sanitizeIconPath, setUserIcons, getUserIcons } from './icon-library.js';
import { USER_FILE_URL, readUserJson, writeUserJson } from './user-file.js';

// Custom icons live in their own user file (see user-file.js), not in the shared settings.json.
export const ICON_FILE = 'stcj-icon-library.json';
export const ICON_FILE_URL = USER_FILE_URL(ICON_FILE);
export const ICON_LIBRARY_LIMIT = 200;
export const requiredServices = [];

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
// Counts references in the live config and, when given, the saved scheme library.
export function iconUsage(config, iconId, library = null) {
  let count = 0;
  const each = menus => { for (const m of menus || []) for (const i of m.items || []) if (i.iconId === iconId) count++; };
  each(config.menus); for (const s of config.schemes || []) each(s.menus);
  if (config.appearance?.centerIconId === iconId) count++;
  for (const s of library?.actions || []) each(s.menus);
  for (const s of library?.appearances || []) if (s.appearance?.centerIconId === iconId) count++;
  return count;
}
// Removes one icon reference everywhere in a scheme library (in place); returns whether anything changed.
export function stripIconFromLibrary(library, iconId) {
  let changed = false;
  for (const s of library.actions) for (const m of s.menus) for (const i of m.items) if (i.iconId === iconId) { delete i.iconId; changed = true; }
  for (const s of library.appearances) if (s.appearance.centerIconId === iconId) { delete s.appearance.centerIconId; changed = true; }
  return changed;
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
        const data = await readUserJson(ICON_FILE, '图标文件');
        setUserIcons(Array.isArray(data?.icons) ? data.icons : []);
        loaded = true; lastError = '';
      } catch (error) { lastError = error.message || String(error); }
      finally { loading = null; notify(); }
      return getUserIcons();
    })();
    return loading;
  }
  async function saveIconLibrary(icons) {
    const list = icons.map(normalizeUserIcon).filter(Boolean).slice(0, ICON_LIBRARY_LIMIT);
    await writeUserJson(ICON_FILE, { version: 1, icons: list }, '图标文件');
    setUserIcons(list); loaded = true; lastError = ''; notify();
    return getUserIcons();
  }
  function onIconLibraryChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function iconLibraryStatus() { return { loaded, error: lastError, count: getUserIcons().length }; }
  return { loadIconLibrary, saveIconLibrary, onIconLibraryChange, iconLibraryStatus };
}
