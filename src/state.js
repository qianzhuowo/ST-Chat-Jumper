import * as constants from './constants.js';

// One state tree per mounted instance; never share it between reloads.
// Branch names identify the primary owner; lifecycle may reset every branch.
export function createState() {
  return {
    layout: {
      settings: null,
      isDragging: false,
      dragPointerId: null,
      dragStart: { x: 0, y: 0, left: 0, top: 0 },
      suppressButtonActionUntil: 0,
      resizeRaf: null,
      globalHidden: false
    },
    favorites: {
      favoriteItems: [],
      favPanelOpen: false,
      pinMode: false,
      favoriteQuickMenuId: null,
      favoritesSaveTimer: null,
      pendingFavoriteSnapshots: new Map(),
      favoritesModalOpen: false,
      favoritesModalSort: 'floor_asc',
      favoritesModalActiveId: null,
      favoritesPreviewMode: constants.FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT,
      favoritesSidebarCollapsed: false,
      favoritesSidebarDrawerOpen: false,
      favoritesPreviewIframeToken: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      favoritesPreviewMessageListenerAttached: false,
      favoritesRenderSeq: 0,
      favoriteSyncSeq: 0,
      suppressNextChatClick: false,
      pinDown: null,
      pinListenersAttached: false,
      favoritesRegexEnginePromise: null
    },
    editing: {
      quickEditState: null,
      quickEditMirror: null,
      quickEditBusy: false,
      quickDeleteBusy: false
    },
    lifecycle: {
      detachChatListeners: null,
      detachOutsideClose: null,
      chatWatchInterval: null,
      settingsMountObserver: null,
      lastChatKey: null,
      lastChatRef: null,
      lastChatMetadataRef: null,
      lastChatLen: null,
      instanceDestroyed: false,
      instance: null,
      cancelReadyWait: null,
      retryTimer: null
    },
    host: {
      hostFlashSuppressTimer: null,
      hostStyleWrites: new Map(),
      currentChatIndex: null,
      currentChatIndexKey: null
    },
    navigation: {
      messageVisibilityObserver: null,
      messageDomObserver: null,
      visibleMessageIds: new Set()
    },
    range: {
      activeRange: null,
      rangeBusy: false,
      rangeOperationSeq: 0
    }
  };
}
