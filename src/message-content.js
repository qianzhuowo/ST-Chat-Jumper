import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "clamp"
];

export function createFeature({ state, dependencies }) {
  function getRawMessageTextFromContext(mesId) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const chat = ctx?.chat;
      if (!Array.isArray(chat)) return null;
      const msg = chat?.[mesId];
      if (!msg) return null;

      const snapshot = getCurrentMessageSnapshot(msg);
      return snapshot.text || null;
    } catch {
      return null;
    }
  }

  function getMessagePartText(part) {
    if (part == null) return '';
    if (typeof part === 'string') return part;
    if (typeof part === 'object' && 'text' in part) return String(part.text ?? '');
    return String(part);
  }

  function joinMaybeMessageParts(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(getMessagePartText).join('');
    return String(value);
  }

  function getMessageContentText(message) {
    const base = message?.mes ?? message?.message ?? message?.text ?? message?.content;
    return joinMaybeMessageParts(base);
  }

  function getMessageCurrentSwipeIndex(message) {
    if (!Array.isArray(message?.swipes) || !message.swipes.length) return -1;
    const rawSwipeId =
      Number.isInteger(message?.swipe_id) ? message.swipe_id :
        (Number.isInteger(message?.swipeId) ? message.swipeId :
          (Number.isInteger(message?.swipeID) ? message.swipeID : 0));
    return Math.trunc(dependencies.clamp(rawSwipeId, 0, Math.max(0, message.swipes.length - 1)));
  }

  function getMessageSwipeEntries(message) {
    if (!Array.isArray(message?.swipes) || !message.swipes.length) return [];
    return message.swipes.map((swipe, index) => ({
      index,
      text: joinMaybeMessageParts(swipe),
      media: message?.swipe_info?.[index]?.extra?.media ?? null,
      reasoning: message?.swipe_info?.[index]?.extra?.reasoning
        ? String(message.swipe_info[index].extra.reasoning)
        : '',
    }));
  }

  function getMessageSwipeEntry(message, swipeIndex = getMessageCurrentSwipeIndex(message)) {
    if (!Number.isInteger(swipeIndex) || swipeIndex < 0) return null;
    return getMessageSwipeEntries(message).find((entry) => entry.index === swipeIndex) || null;
  }

  function getCurrentMessageSnapshot(message) {
    const swipeEntry = getMessageSwipeEntry(message);
    if (swipeEntry && swipeEntry.text) {
      return {
        text: swipeEntry.text,
        swipeIndex: swipeEntry.index,
        media: swipeEntry.media,
        reasoning: swipeEntry.reasoning,
      };
    }

    return {
      text: getMessageContentText(message),
      swipeIndex: -1,
      media: message?.extra?.media ?? null,
      reasoning: message?.extra?.reasoning ? String(message.extra.reasoning) : '',
    };
  }

  return { getRawMessageTextFromContext, getMessagePartText, joinMaybeMessageParts, getMessageContentText, getMessageCurrentSwipeIndex, getMessageSwipeEntries, getMessageSwipeEntry, getCurrentMessageSnapshot };
}
