const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ready, createHarness } = require('./module-harness.cjs');
test.before(() => ready);

function harness() {
    const calls = { scroll: [], ranges: [], loads: [] };
    const target = { getBoundingClientRect: () => ({ top: 800, bottom: 1100 }) };
    const scroll = {
        scrollTop: 100, scrollHeight: 3000, clientHeight: 500,
        getBoundingClientRect: () => ({ top: 50, bottom: 550 }),
        scrollTo: options => calls.scroll.push(options),
    };
    const context = createHarness({
        document: { querySelector: () => target },
        getChatContainer: () => ({}), getChatScrollElement: () => scroll,
        getMessageElement: () => target, getLastMessageId: () => 50,
        clamp: (n, min, max) => Math.max(min, Math.min(n, max)),
        captureWindowScroll: () => ({}), restoreWindowScrollStable() {},
        resolveFavoriteTarget: () => ({ mesId: 20, message: {}, status: 'exact' }),
        ensureFavoriteResolved: (_, resolution) => resolution,
        showFloorRange: async range => { calls.ranges.push(range); return true; },
        executeChatJump: async id => { calls.loads.push(id); },
        waitForDom: async () => target,
        log() {}, toastWarn() {},
    });

    return { context, calls, target, scroll };
}
for (const behavior of [undefined, 'auto', 'instant']) {
    test(`message alignment uses explicit instant scrolling for ${behavior ?? 'default'}`, () => {
        const { context, calls, target } = harness();
        assert.equal(context.scrollMessageInChat(target, 'start', behavior), true);
        assert.equal(calls.scroll[0].behavior, 'instant');
        assert.equal(calls.scroll[0].top, 850);
    });
}
test('recent mounted favorite jumps instantly without loading or rebuilding messages', async () => {
    const { context, calls } = harness();
    assert.equal(await context.jumpToFavoriteItemFromRecentList({ id: 'favorite' }), true);
    assert.equal(calls.scroll[0].behavior, 'instant');
    assert.equal(calls.ranges.length, 0);
    assert.equal(calls.loads.length, 0);
});
test('recent unmounted favorite retains the manager loading path', async () => {
    const { context, calls } = harness();
    context.document.querySelector = () => null;
    assert.equal(await context.jumpToFavoriteItemFromRecentList({ id: 'favorite' }), true);
    assert.deepEqual(calls.ranges, ['20']);
});
test('unmounted message is loaded by the host then aligned instantly', async () => {
    const { context, calls } = harness();
    context.getMessageElement = () => null;
    assert.equal(await context.jumpToMessage(20, 'start'), true);
    assert.deepEqual(calls.loads, [20]);
    assert.equal(calls.scroll[0].behavior, 'instant');
});
for (const id of [0, 50]) {
    test(`boundary fallback ${id} does not animate`, async () => {
        const { context, calls } = harness();
        context.getMessageElement = () => null;
        context.waitForDom = async () => null;
        assert.equal(await context.jumpToMessage(id, 'start'), true);
        assert.equal(calls.scroll[0].behavior, 'instant');
        assert.equal(calls.scroll[0].top, id === 0 ? 0 : 3000);
    });
}
