const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ready, createHarness } = require('./module-harness.cjs');
let createApplication, createState;
test.before(async () => {
    await ready;
    ({ createApplication } = await import('../src/application.js'));
    ({ createState } = await import('../src/state.js'));
});

function environment() {
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    globalThis.window = {};
    globalThis.document = { getElementById: () => null };
    return storage;
}
const hostImports = { coreMessageFormatting: text => text, messageEdit() {}, SWIPE_DIRECTION: { LEFT: 'left', RIGHT: 'right' } };

test('the complete native ESM graph links and creates isolated applications', () => {
    environment();
    const first = createApplication(hostImports);
    const second = createApplication(hostImports);
    assert.equal(typeof first.start, 'function');
    assert.equal(Object.isFrozen(first.services), true);
    assert.ok(Object.keys(first.services).length > 250);
    first.state.favorites.favoriteItems.push({ id: 'only-first' });
    first.state.favorites.pendingFavoriteSnapshots.set('chat', {});
    first.state.navigation.visibleMessageIds.add(1);
    assert.equal(second.state.favorites.favoriteItems.length, 0);
    assert.equal(second.state.favorites.pendingFavoriteSnapshots.size, 0);
    assert.equal(second.state.navigation.visibleMessageIds.size, 0);
    assert.notEqual(first.services.ensureFavoritesPreviewMessageListener, second.services.ensureFavoritesPreviewMessageListener);
});

test('feature dependency contracts and state paths match production references', async () => {
    const directory = path.join(__dirname, '..', 'src');
    const state = createState();
    for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.js'))) {
        const source = fs.readFileSync(path.join(directory, filename), 'utf8');
        for (const [, branch, field] of source.matchAll(/\bstate\.(\w+)\.(\w+)/g)) {
            assert.ok(branch in state && field in state[branch], `${filename}: unknown state ${branch}.${field}`);
        }
        if (!source.includes('export function createFeature')) continue;
        const feature = await import(`../src/${filename}`);
        const actual = [...new Set([...source.matchAll(/\bdependencies\.(\w+)/g)].map(match => match[1]))].sort();
        assert.deepEqual([...feature.requiredServices].sort(), actual, filename);
        assert.ok(source.split('\n').length < 850, `${filename}: feature grew beyond its boundary`);
    }
});

test('settings retain local storage format and default merging', () => {
    const storage = environment();
    storage.set('st_chat_jumper_settings_v1', JSON.stringify({ orientation: 'horizontal', scale: 99, x: 12, collapsed: true }));
    const app = createApplication(hostImports);
    assert.equal(app.state.layout.settings.orientation, 'horizontal');
    assert.equal(app.state.layout.settings.scale, 1.5);
    assert.equal(app.state.layout.settings.x, 12);
    app.services.saveSettings();
    const saved = JSON.parse(storage.get('st_chat_jumper_settings_v1'));
    assert.equal(saved.collapsed, true);
    assert.equal(saved.orientation, 'horizontal');
    assert.equal(saved.favPanelCustom, false);
});

test('extension settings preserve stored button order, drop duplicates and merge new buttons', () => {
    environment();
    const host = { extensionSettings: { 'ST-Chat-Jumper': { buttons: [{ id: 'next', enabled: false, order: 0 }, { id: 'next' }, { id: 'removed' }] } } };
    window.SillyTavern = { getContext: () => host };
    const app = createApplication(hostImports);
    const buttons = app.services.getButtonSettings();
    assert.equal(buttons[0].id, 'next');
    assert.equal(buttons[0].enabled, false);
    assert.equal(new Set(buttons.map(button => button.id)).size, buttons.length);
    assert.equal(buttons.some(button => button.id === 'removed'), false);
    assert.equal(buttons.some(button => button.id === 'quickEdit'), true);
});

test('actual range parser enforces boundaries and configured context', () => {
    const context = createHarness({ getRangeContext: () => 3 });
    assert.deepEqual(context.parseRangeInput(' 5 ', 10), { start: 2, end: 8, jumpTo: 5 });
    assert.deepEqual(context.parseRangeInput('0-10', 10), { start: 0, end: 10 });
    for (const input of ['-1', '11', '6-2', '0-11', 'foo']) assert.equal(context.parseRangeInput(input, 10), null);
});

test('destroy during APP_READY wait removes readiness listener and cancels late UI creation', async () => {
    const listeners = new Set();
    const host = { eventTypes: { APP_READY: 'ready' }, eventSource: { on: (_, callback) => listeners.add(callback), removeListener: (_, callback) => listeners.delete(callback) } };
    let builds = 0;
    const context = createHarness({ window: { SillyTavern: { getContext: () => host } }, buildUI: () => builds++ });
    const instance = context.start();
    assert.equal(listeners.size, 1);
    instance.destroy();
    instance.destroy();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(listeners.size, 0);
    assert.equal(context.state.lifecycle.cancelReadyWait, null);
    assert.equal(builds, 0);
});

test('reload destroys the old instance and teardown releases listeners, observers and host styles once', async () => {
    const calls = [];
    const context = createHarness({
        window: {
            SillyTavern: { getContext: () => ({ eventSource: {} }) },
            removeEventListener: type => calls.push(`remove:${type}`),
            __ST_CHAT_JUMPER_INSTANCE__: { destroy: () => calls.push('previous') },
        },
        document: { body: { classList: { remove: () => calls.push('pin-class') } }, getElementById: id => id === 'chat' ? {} : null, querySelectorAll: () => [] },
        buildUI() {}, clearQuickEditState: () => calls.push('editor'), detachPinPickListeners() {},
        closeFavoritesManager() {}, flushAllPendingFavoriteSnapshots: () => calls.push('flush'),
        resetMessageVisibilityObservers: () => calls.push('visibility'), restoreHostStyles: () => calls.push('styles'),
    });
    const instance = context.start();
    await Promise.resolve();
    context.state.lifecycle.detachChatListeners = () => calls.push('chat-events');
    context.state.lifecycle.detachOutsideClose = () => calls.push('outside');
    context.state.lifecycle.settingsMountObserver = { disconnect: () => calls.push('settings-observer') };
    context.installCleanup({ remove: () => calls.push('root') }, () => {}, () => calls.push('message-events'));
    instance.destroy();
    instance.destroy();
    for (const name of ['previous', 'remove:resize', 'editor', 'flush', 'visibility', 'styles', 'chat-events', 'message-events', 'outside', 'settings-observer', 'root']) {
        assert.equal(calls.filter(value => value === name).length, 1, name);
    }
    assert.equal(window.__ST_CHAT_JUMPER_INSTANCE__, null);
    assert.equal(window.stcjCleanup, undefined);
});

test('host style ownership restores preexisting CSS rather than removing host styling', () => {
    const context = createHarness();
    const values = new Map([['overscroll-behavior', 'auto']]);
    const element = { style: { getPropertyValue: name => values.get(name) || '', setProperty: (name, value) => values.set(name, value), removeProperty: name => values.delete(name) } };
    context.writeHostStyle(element, 'overscroll-behavior', 'contain');
    context.writeHostStyle(element, 'color', 'red');
    context.restoreHostStyles();
    assert.equal(values.get('overscroll-behavior'), 'auto');
    assert.equal(values.has('color'), false);
    assert.equal(context.state.host.hostStyleWrites.size, 0);
});
