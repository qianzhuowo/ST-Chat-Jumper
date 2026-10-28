const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = file => import(pathToFileURL(path.join(__dirname, '..', 'src', file)).href);

test('inline paths migrate to the icon library once and are deduplicated', async () => {
  const { migrateInlinePaths, iconUsage } = await load('icon-store.js');
  const d = 'M4 4h16v16H4z';
  const config = {
    menus: [{ id: 'main', items: [{ label: 'A', iconPath: d }, { label: 'B', iconPath: d }, { label: 'C', iconId: 'tb:x' }] }],
    schemes: [{ menus: [{ id: 'main', items: [{ label: 'S', iconPath: 'bad <script>' }] }] }],
    appearance: {},
  };
  const { icons, moved } = migrateInlinePaths(config, []);
  assert.equal(moved, 2);
  assert.equal(icons.length, 1);
  const id = `user:${icons[0].id}`;
  assert.equal(config.menus[0].items[0].iconId, id);
  assert.equal(config.menus[0].items[1].iconId, id);
  assert.equal('iconPath' in config.menus[0].items[0], false);
  assert.equal(config.menus[0].items[2].iconId, 'tb:x');
  config.appearance.centerIconId = id;
  assert.equal(iconUsage(config, id), 3);
  assert.equal(migrateInlinePaths(config, icons).moved, 0);
});

test('centre icon is kept only when it is a valid icon id', async () => {
  const { normalizeRadialAppearance } = await load('radial-config.js').catch(() => ({}));
  if (!normalizeRadialAppearance) return;
  assert.equal(normalizeRadialAppearance({ centerIconId: 'user:abc' }).centerIconId, 'user:abc');
  assert.equal(normalizeRadialAppearance({ centerIconId: 'javascript:x' }).centerIconId, undefined);
});
