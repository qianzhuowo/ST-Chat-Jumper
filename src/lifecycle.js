import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "buildUI",
  "destroyRadial",
  "destroyRadialSettings",
  "closeSettingsWindow",
  "clearQuickEditState",
  "closeFavoritesManager",
  "detachPinPickListeners",
  "ensureFavoritesModalResizeListener",
  "ensureFavoritesPreviewMessageListener",
  "flushAllPendingFavoriteSnapshots",
  "getHostContext",
  "getHostEventTypes",
  "resetMessageVisibilityObservers",
  "restoreHostStyles"
];

export function createFeature({ state, dependencies }) {
  function isActuallyReady() {
    return !!(window.SillyTavern?.getContext?.()?.eventSource && document.getElementById('chat') && document.body);
  }

  function waitForReadySignal(ctx, event, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (event) ctx?.eventSource?.removeListener?.(event, done);
        if (state.lifecycle.cancelReadyWait === done) state.lifecycle.cancelReadyWait = null;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      state.lifecycle.cancelReadyWait = done;
      if (event) ctx?.eventSource?.on?.(event, done);
    });
  }

  async function waitUntilReady() {
    if (isActuallyReady() || state.lifecycle.instanceDestroyed) return;
    const ctx = dependencies.getHostContext();
    const event = dependencies.getHostEventTypes(ctx).APP_READY;
    if (ctx?.eventSource && event) {
      await waitForReadySignal(ctx, event, 5000);
      if (isActuallyReady() || state.lifecycle.instanceDestroyed) return;
    }
    for (let i = 0; i < 60 && !state.lifecycle.instanceDestroyed && !isActuallyReady(); i++) {
      await waitForReadySignal(null, null, 500);
    }
  }

  async function init() {
    if (state.lifecycle.instanceDestroyed) return;
    // 避免重复注入
    if (document.getElementById(constants.ROOT_ID)) return;

    await waitUntilReady();
    if (state.lifecycle.instanceDestroyed) return;

    // 如果依然没有聊天容器，则延迟再试
    if (!document.getElementById('chat')) {
      state.lifecycle.retryTimer = setTimeout(() => {
        state.lifecycle.retryTimer = null;
        if (!state.lifecycle.instanceDestroyed) void init();
      }, 1000);
      return;
    }

    dependencies.buildUI();
  }

  function installCleanup(root, onResize, detachMessageInvalidation) {
    window[`${constants.PLUGIN_NS}Cleanup`] = () => {
      dependencies.destroyRadial();
      dependencies.destroyRadialSettings();
      dependencies.closeSettingsWindow();
      try {
        window.removeEventListener('resize', onResize);
      } catch {
        /* ignore */
      }

      try {
        state.lifecycle.detachChatListeners?.();
        detachMessageInvalidation?.();
        state.lifecycle.detachChatListeners = null;
      } catch {
        /* ignore */
      }

      try {
        state.lifecycle.detachOutsideClose?.();
        state.lifecycle.detachOutsideClose = null;
      } catch {
        /* ignore */
      }

      try {
        if (state.lifecycle.chatWatchInterval) {
          clearInterval(state.lifecycle.chatWatchInterval);
          state.lifecycle.chatWatchInterval = null;
        }
      } catch {
        /* ignore */
      }

      try {
        dependencies.detachPinPickListeners();
      } catch {
        /* ignore */
      }

      try {
        dependencies.clearQuickEditState();
      } catch {
        /* ignore */
      }

      try {
        if (state.editing.quickEditMirror && state.editing.quickEditMirror.parentNode) {
          state.editing.quickEditMirror.parentNode.removeChild(state.editing.quickEditMirror);
        }
        state.editing.quickEditMirror = null;
      } catch {
        /* ignore */
      }

      try {
        if (state.layout.resizeRaf) {
          cancelAnimationFrame(state.layout.resizeRaf);
          state.layout.resizeRaf = null;
        }
      } catch {
        /* ignore */
      }

      try {
        if (state.favorites.favoritesSaveTimer) {
          clearTimeout(state.favorites.favoritesSaveTimer);
          state.favorites.favoritesSaveTimer = null;
        }
      } catch {
        /* ignore */
      }

      try {
        dependencies.ensureFavoritesPreviewMessageListener.detach?.();
        state.favorites.favoritesPreviewMessageListenerAttached = false;
      } catch {
        /* ignore */
      }

      try {
        dependencies.ensureFavoritesModalResizeListener.detach?.();
        dependencies.ensureFavoritesModalResizeListener.bound = false;
      } catch {
        /* ignore */
      }

      try {
        dependencies.closeFavoritesManager();
        document.getElementById(constants.FAVORITES_MODAL_ID)?.remove();
      } catch {
        /* ignore */
      }

      try {
        state.lifecycle.settingsMountObserver?.disconnect();
        state.lifecycle.settingsMountObserver = null;
        dependencies.flushAllPendingFavoriteSnapshots();
        dependencies.resetMessageVisibilityObservers();
        dependencies.restoreHostStyles();
        document.body.classList.remove(constants.BODY_PIN_MODE_CLASS);
        document.querySelectorAll('[data-stcj-settings], #stcj-settings-panel, .stcj-settings-panel').forEach((el) => el.remove());
        root.remove();
        if (window.__ST_CHAT_JUMPER_INSTANCE__ === state.lifecycle.instance) window.__ST_CHAT_JUMPER_INSTANCE__ = null;
        delete window[constants.PLUGIN_NS + 'Cleanup'];
      } catch {
        /* ignore */
      }
    };
  }

  function start() {
    try { window.__ST_CHAT_JUMPER_INSTANCE__?.destroy?.(); } catch { /* ignore hot reload cleanup */ }
    state.lifecycle.instance = { destroy: () => {
      if (state.lifecycle.instanceDestroyed) return;
      state.lifecycle.instanceDestroyed = true;
      state.lifecycle.cancelReadyWait?.();
      if (state.lifecycle.retryTimer) clearTimeout(state.lifecycle.retryTimer);
      state.lifecycle.retryTimer = null;
      window[constants.PLUGIN_NS + 'Cleanup']?.();
    } };
    window.__ST_CHAT_JUMPER_INSTANCE__ = state.lifecycle.instance;
    void init();
    return state.lifecycle.instance;
  }

  return { isActuallyReady, waitUntilReady, init, installCleanup, start };
}
