const { isDeepStrictEqual } = require('node:util');
function isSyntheticWelcome(state) {
  const c = state.context;
  return c?.chatIdUnavailable === true && c.characterIdUnavailable === true && c.groupIdUnavailable === true
    && Array.isArray(state.chat) && state.chat.length === 2
    && state.chat[0].extra?.type === 'assistant_message' && state.chat[0].extra?.swipeable === false
    && state.chat[0].is_system === false && state.chat[0].is_user === false
    && state.chat[1].extra?.type === 'welcome_prompt' && state.chat[1].extra?.swipeable === false
    && state.chat[1].is_system === true && state.chat[1].is_user === false;
}
function comparable(state, welcome) {
  const copy = structuredClone(state);
  if (welcome) for (const message of copy.chat) {
    delete message.send_date;
    if (Array.isArray(message.swipe_info)) for (const swipe of message.swipe_info) delete swipe.send_date;
  }
  return copy;
}
function sameProtectedState(before, after) {
  const welcome = isSyntheticWelcome(before) && isSyntheticWelcome(after);
  return isDeepStrictEqual(comparable(before, welcome), comparable(after, welcome));
}
module.exports = { isSyntheticWelcome, sameProtectedState };
