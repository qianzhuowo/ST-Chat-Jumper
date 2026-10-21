const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const nativeClearTimeout = globalThis.clearTimeout;
let features, createState;
const ready = (async () => {
    const directory = path.join(__dirname, '..', 'src');
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.js') && !['application.js', 'state.js', 'constants.js'].includes(name));
    features = await Promise.all(files.map(name => import(pathToFileURL(path.join(directory, name)).href)));
    ({ createState } = await import('../src/state.js'));
})();

// Import and execute the actual production factories. Mocks cross feature boundaries,
// never extract/rewrite source or replace a feature's internal implementation.
function createHarness(overrides = {}) {
    const dependencies = Object.create(null);
    const state = createState();
    const window = overrides.window || { SillyTavern: { getContext: () => ({ chat: Array.from({ length: 51 }, () => ({})) }) } };
    const document = {
        getElementById: () => null,
        createElement: () => ({ style: {}, textContent: '' }),
        ...overrides.document,
    };
    Object.assign(globalThis, { window, document, clearTimeout: overrides.clearTimeout || nativeClearTimeout });
    for (const feature of features) Object.assign(dependencies, feature.createFeature({
        state, dependencies, hostImports: { coreMessageFormatting: text => text, messageEdit() {}, SWIPE_DIRECTION: { LEFT: 'left', RIGHT: 'right' } },
    }));
    Object.assign(dependencies, overrides, { window, document, state });
    return dependencies;
}
module.exports = { ready, createHarness };
