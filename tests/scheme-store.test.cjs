const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = file => import(pathToFileURL(path.join(__dirname, '..', 'src', file)).href);

const menus = [{ id: 'main', label: '主', items: [{ label: 'A', action: { type: 'plugin', id: 'prev' }, iconId: 'user:x1' }] }];

test('legacy combined schemes split into one action and one appearance scheme each', async () => {
  const { splitLegacySchemes } = await load('scheme-store.js');
  const lib = splitLegacySchemes([{ id: 's1', label: '旧方案', menus, appearance: { theme: 'forest', centerIconId: 'user:x2' }, radius: 900 }]);
  assert.equal(lib.actions.length, 1); assert.equal(lib.appearances.length, 1);
  assert.equal(lib.actions[0].label, '旧方案'); assert.equal(lib.appearances[0].label, '旧方案');
  assert.equal(lib.actions[0].menus[0].items[0].label, 'A');
  assert.equal(lib.appearances[0].appearance.theme, 'forest'); assert.equal(lib.appearances[0].radius, 200, 'radius clamped');
  assert.equal('appearance' in lib.actions[0], false); assert.equal('menus' in lib.appearances[0], false);
});

test('library normalization drops invalid entries, dedupes ids and enforces the limit', async () => {
  const { normalizeSchemeLibrary, SCHEME_LIMIT } = await load('scheme-store.js');
  const many = Array.from({ length: SCHEME_LIMIT + 5 }, (_, i) => ({ id: 'same', label: `n${i}`, menus }));
  const lib = normalizeSchemeLibrary({ actions: [null, { label: 'bad' }, ...many], appearances: [{ label: 'x' }, { id: 'p1', appearance: { shape: 'petals' }, radius: 10 }] });
  assert.equal(lib.actions.length, SCHEME_LIMIT);
  assert.equal(new Set(lib.actions.map(s => s.id)).size, SCHEME_LIMIT);
  assert.equal(lib.appearances.length, 1); assert.equal(lib.appearances[0].radius, 80); assert.equal(lib.appearances[0].appearance.shape, 'petals');
});

test('import appends with renamed duplicates, regenerated ids and never overwrites', async () => {
  const { mergeSchemeLibrary, readSchemeImport, schemeExport, normalizeSchemeLibrary } = await load('scheme-store.js');
  const base = normalizeSchemeLibrary({ actions: [{ id: 'a1', label: '日常', menus }] });
  const file = JSON.parse(JSON.stringify(schemeExport(base, [])));
  const { library, added } = mergeSchemeLibrary(base, readSchemeImport(file));
  assert.equal(added, 1); assert.deepEqual(library.actions.map(s => s.label), ['日常', '日常 (2)']);
  assert.equal(library.actions[0].id, 'a1'); assert.notEqual(library.actions[1].id, 'a1');
  // A full-config backup with legacy schemes is accepted too.
  assert.equal(readSchemeImport({ version: 4, menus, schemes: [{ id: 'z', label: 'L', menus, appearance: {} }] }).actions.length, 1);
  assert.throws(() => readSchemeImport({ foo: 1 }), /没有/);
});

test('scheme store migrates settings schemes to the file only after the write succeeds', async () => {
  const { createFeature, SCHEME_FILE } = await load('scheme-store.js');
  let config = { schemes: [{ id: 's1', label: '旧', menus, appearance: {}, radius: 120 }] }, saved = null, fail = true;
  const writes = [];
  globalThis.window = { SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({}) }) } };
  globalThis.fetch = async (url, init) => {
    if (init?.method !== 'POST') return { status: 404, ok: false };
    if (fail) return { ok: false, status: 500 };
    writes.push(JSON.parse(init.body)); return { ok: true, status: 200 };
  };
  const store = createFeature({ dependencies: { getRadialConfig: () => config, saveRadialConfig: c => { saved = c; config = c; } } });
  await store.loadSchemeLibrary();
  assert.equal(saved, null, 'failed write keeps the legacy schemes'); assert.match(store.schemeLibraryStatus().error, /500/);
  fail = false; await store.loadSchemeLibrary(true);
  assert.equal(writes.length, 1); assert.equal(writes[0].name, SCHEME_FILE);
  const body = JSON.parse(Buffer.from(writes[0].data, 'base64').toString('utf8'));
  assert.equal(body.actions.length, 1); assert.equal(body.appearances.length, 1);
  assert.deepEqual(saved.schemes, []);
  assert.equal(store.getSchemeLibrary().actions[0].label, '旧');
  delete globalThis.fetch; delete globalThis.window;
});

test('icon usage counts saved schemes and deleting an icon strips library references', async () => {
  const { iconUsage, stripIconFromLibrary } = await load('icon-store.js');
  const lib = { actions: [{ menus: JSON.parse(JSON.stringify(menus)) }], appearances: [{ appearance: { centerIconId: 'user:x1' } }] };
  assert.equal(iconUsage({ menus: [], appearance: {} }, 'user:x1', lib), 2);
  assert.equal(stripIconFromLibrary(lib, 'user:x1'), true);
  assert.equal(iconUsage({ menus: [], appearance: {} }, 'user:x1', lib), 0);
});
