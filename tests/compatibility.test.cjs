const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
// Execute the production functions in isolation, without bootstrapping the toolbar DOM.
function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error(`Missing test boundary: ${start}`);
    return source.slice(from, to);
}
function harness(result, { managed = false, tt = true } = {}) {
    const calls = { native: 0, popup: 0, removed: 0, notes: 0, domWrites: 0, jumps: [] };
    const host = {
        chat: [{ mes: 'one' }, { mes: 'two' }], chatMetadata: {},
        POPUP_TYPE: { INPUT: 3, CONFIRM: 2 }, POPUP_RESULT: { AFFIRMATIVE: 1 },
        callGenericPopup: async (...args) => {
            calls.popup++;
            calls.args = args;
            return typeof result === 'function' ? result() : result;
        },
    };
    const context = vm.createContext({
        window: {
            SillyTavern: { getContext: () => host },
            __TAURITAVERN__: tt ? { api: { chatSurface: { isManagedOwnershipRequired: () => managed } } } : undefined,
            prompt: () => { calls.native++; return 'legacy'; },
            confirm: () => { calls.native++; return true; },
        },
        document: { createElement: () => ({ style: {}, textContent: '' }) },
        log() {}, toastError() {}, toastInfo() {}, toastSuccess() {}, toastWarn() {},
        getFavoriteQuickLabel: () => '<img src=x onerror=alert(1)>',
        getFavoriteItemById: () => ({ id: 'same-id', messageId: 1, note: 'note' }),
        updateFavoriteNoteById: () => { calls.notes++; return true; },
        removeFavoriteById: () => { calls.removed++; return true; },
        getCurrentChatId: () => 'chat',
        setActiveRange: (range) => { calls.range = range; },
        getChatScrollElement: () => null,
        getChatContainer: () => ({ replaceChildren: () => { calls.domWrites++; } }),
        parseRangeInput: (input) => input.includes('-') ? { start: 0, end: 1 } : { start: 0, end: 1, jumpTo: Number(input) },
        jumpToMessage: async (id, block) => { calls.jumps.push([id, block]); return true; },
    });
    vm.runInContext([
        section('  function getHostContext()', '  function getCurrentChatId('),
        section('  async function promptFavoriteNote(', '  async function jumpToFavoriteItemFromRecentList('),
        'let rangeOperationSeq = 0;',
        section('  async function showFloorRangeImpl(', '  async function restoreDefaultRangeView('),
    ].join('\n'), context);
    return { context, host, calls };
}

for (const [value, shouldDelete] of [[1, true], [0, false], [null, false], [true, true], [false, false], [1001, false]]) {
    test(`favorite confirmation ${value} deletes only when affirmative`, async () => {
        const { context, calls } = harness(value);
        assert.equal(await context.deleteFavoriteByIdWithConfirm('same-id'), shouldDelete);
        assert.equal(calls.removed, Number(shouldDelete));
        assert.equal(calls.native, 0);
        assert.equal(calls.popup, 1);
        assert.equal(calls.args[0].textContent, '确认删除收藏：<img src=x onerror=alert(1)> ？');
    });
}
for (const value of [null, false, '', 'updated']) {
    test(`note input ${JSON.stringify(value)} preserves cancel/empty semantics`, async () => {
        const { context, calls } = harness(value);
        assert.equal(await context.editFavoriteNoteById('same-id'), typeof value === 'string');
        assert.equal(calls.notes, Number(typeof value === 'string'));
        assert.equal(calls.native, 0);
        assert.equal(calls.args[2], 'note');
    });
}
test('popup failure cancels rather than opening a second/native confirmation', async () => {
    const { context, calls } = harness(() => { throw new Error('popup failed'); });
    assert.equal(await context.deleteFavoriteByIdWithConfirm('same-id'), false);
    assert.equal(calls.native, 0);
    assert.equal(calls.removed, 0);
});
test('switching chats while confirming cannot delete a favorite in the new chat', async () => {
    const h = harness(() => { h.host.chatMetadata = {}; return 1; });
    assert.equal(await h.context.deleteFavoriteByIdWithConfirm('same-id'), false);
    assert.equal(h.calls.removed, 0);
});
test('switching chats while editing cannot change a note in the new chat', async () => {
    const h = harness(() => { h.host.chatMetadata = {}; return 'changed'; });
    assert.equal(await h.context.editFavoriteNoteById('same-id'), false);
    assert.equal(h.calls.notes, 0);
});
test('missing popup API fails closed in tt, but supports old browser hosts', async () => {
    for (const tt of [true, false]) {
        const { context, host, calls } = harness(1, { tt });
        delete host.callGenericPopup;
        assert.equal(await context.deleteFavoriteByIdWithConfirm('same-id'), !tt);
        assert.equal(calls.native, Number(!tt));
    }
});
test('managed single-floor navigation delegates without rewriting the host DOM', async () => {
    const { context, calls } = harness(1, { managed: true });
    assert.equal(await context.showFloorRangeImpl('1'), true);
    assert.deepEqual(calls.jumps, [[1, 'start']]);
    assert.equal(calls.domWrites, 0);
});
test('static hosts retain interval rendering', async () => {
    const { context, host, calls } = harness(1, { managed: false });
    const rendered = [];
    host.addOneMessage = async (message, options) => rendered.push(options.forceId);
    assert.equal(await context.showFloorRangeImpl('0-1'), true);
    assert.equal(calls.domWrites, 1);
    assert.deepEqual(rendered, [0, 1]);
    assert.equal(calls.range.start, 0);
    assert.equal(calls.range.end, 1);
});
test('managed interval requests leave the host DOM unchanged', async () => {
    const { context, calls } = harness(1, { managed: true });
    assert.equal(await context.showFloorRangeImpl('0-1'), false);
    assert.equal(calls.domWrites, 0);
    assert.equal(calls.jumps.length, 0);
});

test('explicit favorite deletion waits for persistence before reporting success', async () => {
    let release;
    const save = new Promise(resolve => { release = resolve; });
    const h = harness(1);
    const messages = [];
    h.context.removeFavoriteById = () => save;
    h.context.toastInfo = text => messages.push(text);
    const operation = h.context.deleteFavoriteByIdWithConfirm('same-id');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(messages.length, 0);
    release(true);
    assert.equal(await operation, true);
    assert.deepEqual(messages, ['收藏已删除。']);
});

test('explicit save bypasses debounce and cancels its pending stale snapshot', async () => {
    let release;
    const writes = [];
    const metadata = { stcjFavorites: [] };
    const host = {
        chatMetadata: metadata,
        saveMetadata: () => { writes.push('immediate'); return new Promise(resolve => { release = resolve; }); },
        saveMetadataDebounced: () => writes.push('debounced'),
    };
    const context = vm.createContext({
        getHostContext: () => host, getCurrentChatId: () => 'chat',
        clearTimeout: () => writes.push('cancel-timer'),
        touchFavoritesUI: () => writes.push('refresh'), log() {}, toastError() {},
    });
    vm.runInContext('let favoritesSaveTimer = 123; const pendingFavoriteSnapshots = new Map([["chat", {}]]);\n'
        + section('  async function saveExplicitFavoriteChange()', '  function touchFavoritesUI()'), context);
    const operation = context.saveExplicitFavoriteChange();
    assert.deepEqual(writes, ['cancel-timer', 'immediate']);
    assert.equal(vm.runInContext('pendingFavoriteSnapshots.size', context), 0);
    release();
    assert.equal(await operation, true);
    assert.deepEqual(writes, ['cancel-timer', 'immediate', 'refresh']);
});

test('failed persistence does not report successful deletion', async () => {
    const h = harness(1);
    const messages = [];
    h.context.removeFavoriteById = async () => false;
    h.context.toastInfo = text => messages.push(text);
    assert.equal(await h.context.deleteFavoriteByIdWithConfirm('same-id'), false);
    assert.equal(messages.length, 0);
});

for (const matched of [true, false]) {
    test(`favorite preview uses ${matched ? 'matched saved swipe' : 'saved summary'} instead of current swipe`, async () => {
        const context = vm.createContext({
            resolveFavoriteMessageSnapshot: () => ({ matched, text: 'saved branch A full text', swipeIndex: 0 }),
            getCurrentMessageSnapshot: () => ({ text: 'currently displayed branch B' }),
            getMessageContentText: () => 'currently displayed branch B',
            normalizeFavoriteSwipeIndex: value => value,
            applyFavoritesRegexPipeline: async text => text,
            applySillyTavernMessageFormatting: text => text,
            buildFavoriteRenderableHtml: text => text,
            decorateFavoriteInlineSemantics: text => text,
            sanitizeFavoriteOutput: text => text,
        });
        vm.runInContext(section('  async function prepareFavoritePreviewPayload(', '  function buildFavoriteReasoningBlock('), context);
        const payload = await context.prepareFavoritePreviewPayload(
            { previewText: 'saved branch A summary', swipeIndex: 0 },
            { status: 'exact', mesId: 70, message: { mes: 'currently displayed branch B', swipe_id: 1 } },
        );
        assert.equal(payload.rawText, matched ? 'saved branch A full text' : 'saved branch A summary');
        assert.equal(payload.swipeIndex, 0);
    });
}

for (const switchChat of [false, true]) {
    test(`save failure is surfaced and ${switchChat ? 'cannot refresh a different chat' : 'refreshes the same chat'}`, async () => {
        let rejectSave;
        const calls = [];
        const host = { chatMetadata: {}, saveMetadata: () => new Promise((_, reject) => { rejectSave = reject; }) };
        const context = vm.createContext({
            getHostContext: () => host, getCurrentChatId: () => 'chat', clearTimeout() {},
            touchFavoritesUI: () => calls.push('refresh'), log() {}, toastError: text => calls.push(text),
        });
        vm.runInContext('let favoritesSaveTimer = null; const pendingFavoriteSnapshots = new Map();\n'
            + section('  async function saveExplicitFavoriteChange()', '  function touchFavoritesUI()'), context);
        const operation = context.saveExplicitFavoriteChange();
        if (switchChat) host.chatMetadata = {};
        rejectSave(new Error('disk error'));
        assert.equal(await operation, false);
        assert.ok(calls[0].includes('尚未保存'));
        assert.equal(calls.includes('refresh'), !switchChat);
    });
}
