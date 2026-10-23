const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ready, createHarness } = require('./module-harness.cjs');

test('quick edit monitor retains shared state and detaches on editor close', async () => {
    await ready;
    const listeners = new Map();
    let textarea = { offsetParent: {} };
    const h = createHarness({
        document: { querySelector: () => textarea },
        getHostContext: () => ({ eventSource: {
            on: (event, fn) => listeners.set(event, fn),
            removeListener: event => listeners.delete(event),
        } }),
        getHostEventTypes: () => ({ MESSAGE_UPDATED: 'updated' }),
    });
    const editState = { mesId: 1 };
    h.state.editing.quickEditState = editState;
    h.attachQuickEditMonitor({});
    assert.equal(typeof editState.detachMonitor, 'function');
    assert.equal(listeners.size, 1);
    textarea = null;
    listeners.get('updated')();
    assert.equal(h.state.editing.quickEditState, null);
    assert.equal(listeners.size, 0);
});

test('quick edit saves, restores scroll and releases busy state', async () => {
    await ready;
    const message = {};
    let restored;
    let commits = 0;
    const h = createHarness({
        document: { querySelector: () => null },
        getCurrentChatId: () => 'chat',
        getMessageElement: () => message,
        commitEditor: element => { assert.equal(element, message); commits++; return true; },
    });
    h.state.editing.quickEditState = { mesId: 1, chatId: 'chat', scrollTop: 123, scrollEl: { scrollTo: value => { restored = value.top; } } };
    assert.equal(await h.quickEditSave(), true);
    assert.equal(commits, 1);
    assert.equal(restored, 123);
    assert.equal(h.state.editing.quickEditState, null);
    assert.equal(h.state.editing.quickEditBusy, false);
});

test('quick edit refuses to commit state from another chat', async () => {
    await ready;
    let commits = 0;
    const h = createHarness({
        document: { querySelector: () => null },
        getCurrentChatId: () => 'new',
        commitEditor: () => { commits++; return true; },
    });
    h.state.editing.quickEditState = { mesId: 1, chatId: 'old' };
    assert.equal(await h.quickEditSave(), false);
    assert.equal(commits, 0);
    assert.equal(h.state.editing.quickEditState, null);
    assert.equal(h.state.editing.quickEditBusy, false);
});
