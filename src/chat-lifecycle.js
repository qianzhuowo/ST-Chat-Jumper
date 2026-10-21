import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "clearQuickEditState",
  "closeFavoriteQuickMenu",
  "flushPendingFavoriteSnapshot",
  "getCurrentChatId",
  "getHostContext",
  "getHostEventTypes",
  "invalidateChatIndex",
  "refreshFavoritesFromMetadata",
  "renderFavoritesManager",
  "scheduleMessageVisibilityObserverReset",
  "setActiveRange",
  "setFavPanelOpen",
  "setPinMode",
  "sleep",
  "updateFavoritesUI"
];

export function createFeature({ state, dependencies }) {
  function getChatKey() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx) return null;

      const parts = [];

      const groupId = ctx.groupId ?? ctx.group_id ?? ctx.group?.id;
      const charId = ctx.characterId ?? ctx.character_id ?? ctx.character?.id;
      const chatId =
        ctx.chatId ??
        ctx.chat_id ??
        ctx.activeChatId ??
        ctx.active_chat_id ??
        ctx.chatName ??
        ctx.chat_name ??
        ctx.chatFileName ??
        ctx.chat_file_name ??
        ctx.chatFile ??
        ctx.chat_file;

      if (groupId != null) parts.push(`group:${groupId}`);
      if (charId != null) parts.push(`char:${charId}`);
      if (chatId != null) parts.push(`chat:${chatId}`);

      return parts.length ? parts.join('|') : null;
    } catch {
      return null;
    }
  }

  function resetTempFavorites(reason, options) {
    const clearRange = !!options?.clearRange;

    dependencies.setPinMode(false);
    dependencies.setFavPanelOpen(false);
    dependencies.closeFavoriteQuickMenu();
    if (clearRange) dependencies.setActiveRange(null);
    dependencies.clearQuickEditState();

    state.favorites.favoriteSyncSeq += 1;
    try {
      dependencies.refreshFavoritesFromMetadata();
    } catch (error) {
      console.error('[STCJ] favorites-read failed', {
        chatId: dependencies.getCurrentChatId(),
        reason,
        error,
      });
    }

    const root = document.getElementById(constants.ROOT_ID);
    if (root) dependencies.updateFavoritesUI(root);

    if (state.favorites.favoritesModalOpen) {
      dependencies.renderFavoritesManager();
    }
  }

  function attachChatChangeListeners() {
    try {
      const ctx = dependencies.getHostContext();
      const event = dependencies.getHostEventTypes(ctx).CHAT_CHANGED;
      if (!ctx?.eventSource || !event) {
        console.warn('[STCJ] listener-bound', {
          ok: false,
          event: event || null,
          chatId: dependencies.getCurrentChatId(ctx),
          reason: 'CHAT_CHANGED unavailable',
        });
        return null;
      }
      let handledChatId = dependencies.getCurrentChatId(ctx);
      const handler = async (eventChatId) => {
        console.log('[STCJ] chat-event', {
          event,
          eventChatId: eventChatId == null ? null : String(eventChatId),
          contextChatId: dependencies.getCurrentChatId(),
        });
        const oldChatId = handledChatId;
        state.range.rangeOperationSeq += 1;
        state.range.rangeBusy = false;
        dependencies.flushPendingFavoriteSnapshot(oldChatId);

        // CHAT_CHANGED 的参数就是宿主加载后的聊天 ID；让同步监听器先完成，再读取新 metadata。
        await Promise.resolve();
        await dependencies.sleep(0);
        const contextChatId = dependencies.getCurrentChatId();
        const nextChatId = eventChatId == null ? contextChatId : String(eventChatId);
        handledChatId = nextChatId || contextChatId;
        const latestCtx = dependencies.getHostContext();
        state.lifecycle.lastChatKey = getChatKey();
        state.lifecycle.lastChatRef = latestCtx?.chat || null;
        state.lifecycle.lastChatMetadataRef = latestCtx?.chatMetadata || null;
        state.lifecycle.lastChatLen = Array.isArray(latestCtx?.chat) ? latestCtx.chat.length : null;
        dependencies.invalidateChatIndex();
        try { dependencies.scheduleMessageVisibilityObserverReset(); }
        catch (error) { console.warn('[STCJ] visibility-observer', { stage: 'chat-event', error }); }
        // 可见楼层 observer 的任何异常都不得阻断收藏刷新。
        resetTempFavorites('event', { clearRange: true });
        console.log('[STCJ] favorites-read', {
          source: 'chat-event',
          chatId: handledChatId,
          count: state.favorites.favoriteItems.length,
        });
      };
      ctx.eventSource.on?.(event, handler);
      console.log('[STCJ] listener-bound', {
        ok: true,
        event,
        chatId: handledChatId,
      });
      return () => ctx.eventSource.removeListener?.(event, handler);
    } catch (error) {
      console.error('[STCJ] listener-bound', { ok: false, error });
      return null;
    }
  }

  function attachMessageInvalidationListeners() {
    const ctx = dependencies.getHostContext();
    const eventTypes = dependencies.getHostEventTypes(ctx);
    const events = [
      eventTypes.MESSAGE_RECEIVED,
      eventTypes.MESSAGE_EDITED,
      eventTypes.MESSAGE_UPDATED,
      eventTypes.MESSAGE_DELETED,
      eventTypes.MESSAGE_SWIPED,
    ].filter(Boolean);
    const uniqueEvents = [...new Set(events)];
    const handler = () => dependencies.invalidateChatIndex();
    uniqueEvents.forEach((event) => ctx?.eventSource?.on?.(event, handler));
    return () => uniqueEvents.forEach((event) => ctx?.eventSource?.removeListener?.(event, handler));
  }

  function startChatWatch() {
    if (state.lifecycle.chatWatchInterval) return;

    try {
      const ctx = window.SillyTavern?.getContext?.();
      state.lifecycle.lastChatKey = getChatKey();
      state.lifecycle.lastChatRef = ctx?.chat || null;
      state.lifecycle.lastChatMetadataRef = ctx?.chatMetadata || null;
      state.lifecycle.lastChatLen = Array.isArray(ctx?.chat) ? ctx.chat.length : null;
    } catch {
      state.lifecycle.lastChatKey = null;
      state.lifecycle.lastChatRef = null;
      state.lifecycle.lastChatMetadataRef = null;
      state.lifecycle.lastChatLen = null;
    }

    state.lifecycle.chatWatchInterval = setInterval(() => {
      try {
        const ctx = window.SillyTavern?.getContext?.();
        if (!ctx) return;

        const key = getChatKey();
        const ref = ctx.chat || null;
        const metadataRef = ctx.chatMetadata || null;
        const len = Array.isArray(ctx.chat) ? ctx.chat.length : null;
        const identityChanged = !!(key && state.lifecycle.lastChatKey && key !== state.lifecycle.lastChatKey);
        const metadataChanged = !!(metadataRef && state.lifecycle.lastChatMetadataRef && metadataRef !== state.lifecycle.lastChatMetadataRef);
        const chatRefChanged = !!(ref && state.lifecycle.lastChatRef && ref !== state.lifecycle.lastChatRef);

        if (identityChanged || metadataChanged || chatRefChanged) {
          const reason = identityChanged ? 'key' : (metadataChanged ? 'metadata-ref' : 'chat-ref');
          state.lifecycle.lastChatKey = key || state.lifecycle.lastChatKey;
          state.lifecycle.lastChatRef = ref || state.lifecycle.lastChatRef;
          state.lifecycle.lastChatMetadataRef = metadataRef || state.lifecycle.lastChatMetadataRef;
          state.lifecycle.lastChatLen = len;
          dependencies.invalidateChatIndex();
          try { dependencies.scheduleMessageVisibilityObserverReset(); }
          catch (error) { console.warn('[STCJ] visibility-observer', { stage: 'fallback-change', error }); }
          console.log('[STCJ] fallback-change', {
            reason,
            chatId: dependencies.getCurrentChatId(ctx),
          });
          resetTempFavorites(reason, { clearRange: identityChanged || metadataChanged });
          console.log('[STCJ] favorites-read', {
            source: 'fallback-change',
            chatId: dependencies.getCurrentChatId(ctx),
            count: state.favorites.favoriteItems.length,
          });
          return;
        }
        if (!state.lifecycle.lastChatKey && key) state.lifecycle.lastChatKey = key;
        if (!state.lifecycle.lastChatRef && ref) state.lifecycle.lastChatRef = ref;
        if (!state.lifecycle.lastChatMetadataRef && metadataRef) state.lifecycle.lastChatMetadataRef = metadataRef;

        // 极早期切换可能先把 chat 清空，此时也刷新一次。
        if (
          typeof len === 'number' &&
          typeof state.lifecycle.lastChatLen === 'number' &&
          len === 0 &&
          state.lifecycle.lastChatLen > 0 &&
          state.favorites.favoriteItems.length
        ) {
          state.lifecycle.lastChatKey = key || state.lifecycle.lastChatKey;
          state.lifecycle.lastChatRef = ref || state.lifecycle.lastChatRef;
          state.lifecycle.lastChatMetadataRef = metadataRef || state.lifecycle.lastChatMetadataRef;
          state.lifecycle.lastChatLen = len;
          console.log('[STCJ] fallback-change', { reason: 'chat-empty', chatId: dependencies.getCurrentChatId(ctx) });
          resetTempFavorites('chat-empty', { clearRange: true });
          return;
        }

        state.lifecycle.lastChatLen = len;
      } catch {
        /* ignore */
      }
    }, 1000);
  }

  return { getChatKey, resetTempFavorites, attachChatChangeListeners, attachMessageInvalidationListeners, startChatWatch };
}
