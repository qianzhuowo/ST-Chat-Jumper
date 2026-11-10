const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ready, createHarness } = require('./module-harness.cjs');
test.before(() => ready);

function floorHarness() {
    let offset = 0;
    const frames = [];
    const listeners = { document: new Map(), window: new Map(), host: new Map() };
    const add = map => (type, fn) => map.set(type, fn);
    const remove = map => type => map.delete(type);
    // Three 100px messages; scrolling moves them up under the viewport top probe.
    const nodes = [0, 1, 2].map(id => ({
        getAttribute: () => String(id),
        getBoundingClientRect: () => ({ top: id * 100 - offset, bottom: id * 100 + 100 - offset }),
    }));
    const chat = { querySelector: () => nodes[0], querySelectorAll: () => nodes, contains: () => true };
    const eventSource = { on: add(listeners.host), removeListener: remove(listeners.host) };
    const observers = [];
    class MutationObserver { constructor(fn) { this.fn = fn; observers.push(this); } observe() { this.active = true; } disconnect() { this.active = false; } }
    const window = { innerWidth: 800, innerHeight: 600, MutationObserver, addEventListener: add(listeners.window), removeEventListener: remove(listeners.window) };
    globalThis.requestAnimationFrame = fn => frames.push(fn);
    globalThis.cancelAnimationFrame = () => {};
    const context = createHarness({
        window,
        document: { addEventListener: add(listeners.document), removeEventListener: remove(listeners.document), elementsFromPoint: () => [] },
        getHostContext: () => ({ chat: [{}, {}, {}], eventSource }),
        getHostEventTypes: () => ({ CHAT_CHANGED: 'chat_changed', MESSAGE_DELETED: 'message_deleted' }),
        getChatContainer: () => chat,
        getChatScrollElement: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 300, left: 0, width: 400 }) }),
        clamp: (n, min, max) => Math.max(min, Math.min(n, max)),
    });
    const scrollTo = value => {
        offset = value;
        listeners.document.get('scroll')({ target: chat });
        frames.splice(0).forEach(fn => fn());
    };
    const shiftLayout = value => {
        offset = value;
        observers.forEach(o => o.active && o.fn([]));
        frames.splice(0).forEach(fn => fn());
    };
    return { context, listeners, scrollTo, shiftLayout, observers };
}

test('current floor watch notifies on floor change only and the last unsubscribe detaches every listener', () => {
    const { context, listeners, scrollTo, shiftLayout, observers } = floorHarness();
    const seen = [];
    const stop = context.watchCurrentFloor(floor => seen.push(floor.id));
    assert.deepEqual(seen, [0], 'subscriber receives the current floor immediately');
    scrollTo(40);
    assert.deepEqual(seen, [0], 'scrolling inside the same floor does not notify');
    scrollTo(150);
    assert.deepEqual(seen, [0, 1]);
    shiftLayout(250);
    assert.deepEqual(seen, [0, 1, 2], 'message DOM changes move the floor without any scroll event');
    stop();
    assert.equal(listeners.document.size + listeners.window.size, 0);
    assert.ok(observers.every(o => !o.active), 'DOM observers are disconnected');
});

test('outline bubble group is the conversation turn around a floor, capped near it', async () => {
    const { resolveBubbleGroup } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'outline.js')).href);
    const chat = [{}, { is_user: true }, {}, {}, { is_user: true }, {}, {}, {}, {}, {}, {}];
    assert.deepEqual(resolveBubbleGroup(chat, 0), [0], 'greeting before any user message');
    assert.deepEqual(resolveBubbleGroup(chat, 3), [1, 2, 3], 'reply floor joins its user prompt');
    assert.deepEqual(resolveBubbleGroup(chat, 1), [1, 2, 3], 'user floor joins its replies');
    assert.deepEqual(resolveBubbleGroup(chat, 9), [7, 8, 9, 10], 'long turns keep a window around the floor');
    assert.deepEqual(resolveBubbleGroup(chat, 99), []);
});
