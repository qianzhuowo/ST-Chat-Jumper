import { normalizeRadialConfig } from './radial-config.js';
import { readUserJson, writeUserJson } from './user-file.js';

// Saved wheel schemes live in their own user file (see user-file.js), split into two kinds
// that are saved and applied independently:
//   actions     — every primary/secondary wheel with its sectors, actions and icon references;
//   appearances — palette, shape, centre core and base radius.
export const SCHEME_FILE = 'stcj-radial-schemes.json';
export const SCHEME_LIMIT = 30;
export const SCHEME_FORMAT = 'stcj-radial-schemes';
export const requiredServices = ['getRadialConfig', 'saveRadialConfig'];

const ID_RE = /^[\w-]{1,40}$/;
const label = (value, fallback) => String(value || fallback).trim().slice(0, 40) || fallback;
export function newSchemeId(prefix, existing) {
  const used = new Set(existing.map(s => s.id));
  let id; do id = prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); while (used.has(id));
  return id;
}
export function normalizeActionScheme(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.menus)) return null;
  return { id: ID_RE.test(raw.id) ? raw.id : '', label: label(raw.label, '动作方案'), menus: normalizeRadialConfig({ menus: raw.menus }).menus };
}
export function normalizeAppearanceScheme(raw) {
  if (!raw || typeof raw !== 'object' || !raw.appearance || typeof raw.appearance !== 'object') return null;
  const normalized = normalizeRadialConfig({ appearance: raw.appearance, radius: raw.radius });
  return { id: ID_RE.test(raw.id) ? raw.id : '', label: label(raw.label, '外观方案'), appearance: normalized.appearance, radius: normalized.radius };
}
function normalizeList(list, normalize, prefix) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const scheme = normalize(raw);
    if (!scheme) continue;
    if (!scheme.id || out.some(s => s.id === scheme.id)) scheme.id = newSchemeId(prefix, out);
    out.push(scheme);
    if (out.length >= SCHEME_LIMIT) break;
  }
  return out;
}
export function normalizeSchemeLibrary(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { actions: normalizeList(r.actions, normalizeActionScheme, 'a'), appearances: normalizeList(r.appearances, normalizeAppearanceScheme, 'p') };
}
// Former combined schemes (settings.json radial.schemes) become one action and one appearance scheme each.
export function splitLegacySchemes(schemes) {
  const actions = [], appearances = [];
  for (const s of Array.isArray(schemes) ? schemes : []) {
    if (!s || typeof s !== 'object') continue;
    if (Array.isArray(s.menus)) actions.push({ label: s.label, menus: s.menus });
    if (s.appearance) appearances.push({ label: s.label, appearance: s.appearance, radius: s.radius });
  }
  return normalizeSchemeLibrary({ actions, appearances });
}
// Adds incoming schemes after the existing ones. Never overwrites: duplicate names get a numeric suffix,
// ids are always regenerated. Returns how many were added and skipped for the limit.
export function mergeSchemeLibrary(base, incoming) {
  const result = normalizeSchemeLibrary(base); const add = normalizeSchemeLibrary(incoming);
  let added = 0, skipped = 0;
  for (const [kind, prefix] of [['actions', 'a'], ['appearances', 'p']]) {
    for (const scheme of add[kind]) {
      if (result[kind].length >= SCHEME_LIMIT) { skipped++; continue; }
      let name = scheme.label, n = 2;
      while (result[kind].some(s => s.label === name)) name = `${scheme.label.slice(0, 34)} (${n++})`;
      result[kind].push({ ...scheme, id: newSchemeId(prefix, result[kind]), label: name });
      added++;
    }
  }
  return { library: result, added, skipped };
}
/** Accepts a scheme export file, a full-config backup with legacy `schemes`, or a bare library. */
export function readSchemeImport(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的方案文件');
  if (raw.format === SCHEME_FORMAT || Array.isArray(raw.actions) || Array.isArray(raw.appearances)) return normalizeSchemeLibrary(raw);
  if (Array.isArray(raw.schemes)) return splitLegacySchemes(raw.schemes);
  throw new Error('文件中没有动作方案或外观方案');
}
export function schemeExport(library, icons = []) {
  return { format: SCHEME_FORMAT, version: 1, actions: library.actions, appearances: library.appearances, icons };
}

export function createFeature({ dependencies }) {
  let library = { actions: [], appearances: [] }, loading = null, loaded = false, lastError = '';
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* listener errors stay local */ } });
  async function persist(next) {
    const normalized = normalizeSchemeLibrary(next);
    await writeUserJson(SCHEME_FILE, { version: 1, ...normalized }, '方案文件');
    library = normalized; loaded = true; lastError = ''; notify();
    return getSchemeLibrary();
  }
  // Loads the file, then moves legacy combined schemes out of settings.json. They are only removed
  // from settings after the file write succeeded, so a failed write never loses data.
  async function loadSchemeLibrary(force = false) {
    if (loaded && !force) return getSchemeLibrary();
    if (loading && !force) return loading;
    loading = (async () => {
      try {
        library = normalizeSchemeLibrary(await readUserJson(SCHEME_FILE, '方案文件'));
        loaded = true; lastError = '';
        const config = dependencies.getRadialConfig();
        if (config.schemes.length) {
          await persist(mergeSchemeLibrary(library, splitLegacySchemes(config.schemes)).library);
          dependencies.saveRadialConfig({ ...dependencies.getRadialConfig(), schemes: [] });
        }
      } catch (error) { lastError = error.message || String(error); }
      finally { loading = null; notify(); }
      return getSchemeLibrary();
    })();
    return loading;
  }
  function getSchemeLibrary() { return JSON.parse(JSON.stringify(library)); }
  function saveSchemeLibrary(next) { return persist(next); }
  function onSchemeLibraryChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function schemeLibraryStatus() { return { loaded, error: lastError, actions: library.actions.length, appearances: library.appearances.length }; }
  return { loadSchemeLibrary, saveSchemeLibrary, getSchemeLibrary, onSchemeLibraryChange, schemeLibraryStatus };
}
