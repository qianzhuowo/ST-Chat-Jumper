const test = require('node:test'), assert = require('node:assert/strict');
const { sameProtectedState } = require('./radial-state-guard.cjs');
function fixture() { return { context: { chatIdUnavailable: true, characterIdUnavailable: true, groupIdUnavailable: true }, settings: { keep: 1 }, metadata: {}, localStorage: {}, chat: [{ is_system: false, is_user: false, extra: { type: 'assistant_message', swipeable: false }, mes: 'welcome', send_date: 'old', swipe_info: [{ send_date: 'old', extra: { keep: 1 } }] }, { is_system: true, is_user: false, extra: { type: 'welcome_prompt', swipeable: false }, mes: 'panel', send_date: 'old' }] }; }
test('welcome timestamp exception requires synthetic message markers and no actual chat', () => {
  const a = fixture(), b = fixture(); b.chat[0].send_date = 'new'; b.chat[0].swipe_info[0].send_date = 'new'; b.chat[1].send_date = 'new';
  assert.equal(sameProtectedState(a, b), true);
  for (const key of ['chatIdUnavailable', 'characterIdUnavailable', 'groupIdUnavailable']) { const c = structuredClone(b); c.context[key] = false; assert.equal(sameProtectedState(a, c), false); }
  const c = structuredClone(b); c.chat[0].extra.type = 'real'; assert.equal(sameProtectedState(a, c), false);
});
test('welcome exception never ignores content, swipe payload, metadata or settings', () => {
  const a = fixture();
  for (const mutate of [b => b.chat[0].mes = 'changed', b => b.chat[0].swipe_info[0].extra.keep++, b => b.metadata.favorites = [], b => b.settings.keep++, b => b.localStorage.toolbar = 'changed', b => b.chat.push({ send_date: 'new' })]) { const b = fixture(); mutate(b); assert.equal(sameProtectedState(a, b), false); }
});
test('real chat timestamps are protected even when both snapshots identify real chat', () => {
  const a = fixture(); a.context.chatIdUnavailable = false; const b = structuredClone(a); b.chat[0].send_date = 'new'; assert.equal(sameProtectedState(a, b), false);
});

test('config comparison ignores object key order only and reports changed values and array positions', () => {
 const {sameConfig,diffPaths}=require('./radial-state-guard.cjs');
 const a={version:3,items:[{label:'A',id:1},{id:2,label:'B'}]};
 const reordered={items:[{id:1,label:'A'},{label:'B',id:2}],version:3};
 assert.equal(sameConfig(a,reordered),true);assert.deepEqual(diffPaths(a,reordered),[]);
 const changed=structuredClone(a);changed.items[0].label='changed';assert.equal(sameConfig(a,changed),false);assert.deepEqual(diffPaths(a,changed),['/items/0/label']);
 const swapped=structuredClone(a);swapped.items.reverse();assert.equal(sameConfig(a,swapped),false);assert.ok(diffPaths(a,swapped).includes('/items/0/id'));
});
