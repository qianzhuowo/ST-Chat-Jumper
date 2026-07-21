/*
 * ST Chat Jumper
 * - 长按悬浮条可拖拽
 * - 横/竖布局（按钮切换）
 * - 快速跳转：最近3楼、快速翻页（左/右）、上一楼（头部）、下一楼（头部）
 * - H/L：对齐“当前楼层”的头部/尾部（用于精确定位）
 * - 跳转/区间显示：输入单数字跳转到该楼层（展示前后20层），输入区间显示指定范围
 * - 区间翻页：激活区间后可上一段/下一段快速翻页，无需重新输入
 * - 楼层收藏列表
 * - 定位编辑楼层内容
 * - 快速左/右翻页
 */

import { messageFormatting as coreMessageFormatting } from '../../../../script.js';

(function () {
  'use strict';

  const PLUGIN_NS = 'stcj';
  const ROOT_ID = 'stcj-root';
  const STORAGE_KEY = 'st_chat_jumper_settings_v1';
  const BODY_PIN_MODE_CLASS = 'stcj-pin-mode';

  /** @type {'horizontal'|'vertical'} */
  const DEFAULT_ORIENTATION = 'vertical';
  const DEFAULT_SCALE = 1;
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 1.5;
  const SCALE_STEP = 0.01;

  const DEFAULT_RANGE_STEP = 10;
  const DEFAULT_RANGE_CONTEXT = 20;
  const DEFAULT_RANGE_PAGING_MODE = 'expand';

  /**
   * x/y: 兼容旧版本的像素坐标（仍会写入，方便调试）
   * rx/ry: 相对位置（0~1），用于窗口尺寸变化时保持相对位置
   * collapsed: 是否收起按钮栏（仅保留悬浮条主体+收起按钮）
   * scale: 悬浮条缩放倍数
   * favPanel*: 最近收藏面板的自定义位置（基于视口保存，相对 root 重算）
   * @type {{x: number|null, y: number|null, rx: number|null, ry: number|null, orientation: 'horizontal'|'vertical', collapsed: boolean, scale: number, favPanelX: number|null, favPanelY: number|null, favPanelRx: number|null, favPanelRy: number|null, favPanelCustom: boolean}}
   */
  const DEFAULT_SETTINGS = {
    x: null,
    y: null,
    rx: null,
    ry: null,
    orientation: DEFAULT_ORIENTATION,
    collapsed: false,
    scale: DEFAULT_SCALE,
    favPanelX: null,
    favPanelY: null,
    favPanelRx: null,
    favPanelRy: null,
    favPanelCustom: false,
    favPanelW: null,
    favPanelH: null,
  };

  // 收藏面板自定义尺寸的限制（px）
  const FAV_PANEL_MIN_W = 160;
  const FAV_PANEL_MIN_H = 120;
  const FAV_PANEL_MAX_W = 640;
  const FAV_PANEL_MAX_H = 720;

  // ===== 按钮可见性与排序设置（持久化到 extensionSettings） =====
  const EXT_SETTINGS_KEY = 'ST-Chat-Jumper';

  /**
   * 所有可配置按钮的定义。
   * id: 与 buildUI 中 data-action 或分组 key 对应
   * label: 设置面板中显示的中文名
   * group: 如果为 true，表示这是一个按钮组（包含多个 DOM 元素）
   */
  const CONFIGURABLE_BUTTONS = [
    { id: 'toggleCollapse',    label: '收起/展开',          defaultEnabled: true, order: 0 },
    { id: 'recent3',           label: '最近第3楼',          defaultEnabled: true, order: 1 },
    { id: 'recent2',           label: '最近第2楼',          defaultEnabled: true, order: 2 },
    { id: 'recent1',           label: '最近第1楼',          defaultEnabled: true, order: 3 },
    { id: 'quickPage',         label: '快速翻页(右)',       defaultEnabled: true, order: 4 },
    { id: 'quickPageLeft',     label: '快速翻页(左)',       defaultEnabled: true, order: 5 },
    { id: 'showRange',         label: '跳转/区间显示',      defaultEnabled: true, order: 6 },
    { id: 'toggleOrientation', label: '横/竖布局切换',      defaultEnabled: true, order: 7 },
    { id: 'prev',              label: '上一楼',             defaultEnabled: true, order: 8 },
    { id: 'next',              label: '下一楼',             defaultEnabled: true, order: 9 },
    { id: 'currentHead',       label: '对齐到头部 (H)',     defaultEnabled: true, order: 10 },
    { id: 'currentTail',       label: '对齐到尾部 (L)',     defaultEnabled: true, order: 11 },
    { id: 'quickEdit',         label: '快速编辑 (✏️)',      defaultEnabled: true, order: 12 },
    { id: 'pinGroup',          label: '收藏 (📌)',          defaultEnabled: true, order: 13 },
  ];

  /**
   * 获取按钮可见性 & 排序设置（从 extensionSettings 读取，带默认值合并）
   */
  function getButtonSettings() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return getDefaultButtonSettings();

      if (!ctx.extensionSettings[EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[EXT_SETTINGS_KEY] = { buttons: getDefaultButtonSettings() };
      }

      const stored = ctx.extensionSettings[EXT_SETTINGS_KEY].buttons;
      if (!Array.isArray(stored)) {
        ctx.extensionSettings[EXT_SETTINGS_KEY].buttons = getDefaultButtonSettings();
        return ctx.extensionSettings[EXT_SETTINGS_KEY].buttons;
      }

      // 合并：确保新增按钮有默认值，移除已删除按钮
      const validIds = new Set(CONFIGURABLE_BUTTONS.map(b => b.id));
      const result = [];
      const seenIds = new Set();

      // 保留已有配置（按 stored 的顺序）
      for (const item of stored) {
        if (validIds.has(item.id) && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          result.push({
            id: item.id,
            enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
            order: typeof item.order === 'number' ? item.order : result.length,
          });
        }
      }

      // 补充新增的按钮（append 到末尾）
      for (const def of CONFIGURABLE_BUTTONS) {
        if (!seenIds.has(def.id)) {
          result.push({ id: def.id, enabled: def.defaultEnabled, order: result.length });
        }
      }

      ctx.extensionSettings[EXT_SETTINGS_KEY].buttons = result;
      return result;
    } catch {
      return getDefaultButtonSettings();
    }
  }

  function getDefaultButtonSettings() {
    return CONFIGURABLE_BUTTONS.map(b => ({
      id: b.id,
      enabled: b.defaultEnabled,
      order: b.order,
    }));
  }

  function saveButtonSettings(buttons) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[EXT_SETTINGS_KEY].buttons = buttons;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  /**
   * 获取区间翻页步长（从 extensionSettings 读取，默认 10）
   */
  function getRangeStep() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return DEFAULT_RANGE_STEP;
      const ext = ctx.extensionSettings[EXT_SETTINGS_KEY];
      if (ext && typeof ext.rangeStep === 'number' && Number.isFinite(ext.rangeStep) && ext.rangeStep >= 1) {
        return Math.round(ext.rangeStep);
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_RANGE_STEP;
  }

  /**
   * 保存区间翻页步长到 extensionSettings
   */
  function saveRangeStep(step) {
    try {
      const val = Math.max(1, Math.round(Number(step)));
      if (!Number.isFinite(val)) return;
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[EXT_SETTINGS_KEY].rangeStep = val;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  /**
   * 获取跳转加载上下文层数（从 extensionSettings 读取，默认 20）
   */
  function getRangeContext() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return DEFAULT_RANGE_CONTEXT;
      const ext = ctx.extensionSettings[EXT_SETTINGS_KEY];
      if (ext && typeof ext.rangeContext === 'number' && Number.isFinite(ext.rangeContext) && ext.rangeContext >= 1) {
        return Math.round(ext.rangeContext);
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_RANGE_CONTEXT;
  }

  function saveRangeContext(val) {
    try {
      const v = Math.max(1, Math.round(Number(val)));
      if (!Number.isFinite(v)) return;
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[EXT_SETTINGS_KEY].rangeContext = v;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  /**
   * 获取区间翻页模式：
   * - expand: 扩展模式（默认）
   * - shift: 平移模式
   */
  function getRangePagingMode() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return DEFAULT_RANGE_PAGING_MODE;
      const ext = ctx.extensionSettings[EXT_SETTINGS_KEY];
      return ext?.rangePagingMode === 'shift' ? 'shift' : DEFAULT_RANGE_PAGING_MODE;
    } catch {
      return DEFAULT_RANGE_PAGING_MODE;
    }
  }

  function saveRangePagingMode(mode) {
    try {
      const nextMode = mode === 'shift' ? 'shift' : 'expand';
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[EXT_SETTINGS_KEY].rangePagingMode = nextMode;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  function loadFavoritesPreviewMode() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT;
      const ext = ctx.extensionSettings[EXT_SETTINGS_KEY];
      return normalizeFavoritePreviewMode(ext?.favoritesPreviewMode);
    } catch {
      return FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT;
    }
  }

  function saveFavoritesPreviewMode(mode) {
    try {
      const nextMode = normalizeFavoritePreviewMode(mode);
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[EXT_SETTINGS_KEY].favoritesPreviewMode = nextMode;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }


  function formatRangePagingModeLabel(mode = getRangePagingMode()) {
    return mode === 'shift' ? '平移' : '扩展';
  }

  function isButtonEnabled(buttonId) {
    const buttons = getButtonSettings();
    const cfg = buttons.find(b => b.id === buttonId);
    return cfg ? cfg.enabled : true;
  }


  /** @type {{x: number|null, y: number|null, rx: number|null, ry: number|null, orientation: 'horizontal'|'vertical', collapsed: boolean, scale: number, favPanelX: number|null, favPanelY: number|null, favPanelRx: number|null, favPanelRy: number|null, favPanelCustom: boolean}} */
  let settings = loadSettings();

  let isDragging = false;
  let dragPointerId = null;
  let dragStart = { x: 0, y: 0, left: 0, top: 0 };
  let suppressButtonActionUntil = 0;
  let resizeRaf = null;

  // ===== 收藏（持久化到当前聊天的 chatMetadata.stcjFavorites） =====
  const FAVORITES_METADATA_KEY = 'stcjFavorites';
  const FAVORITES_SAVE_DEBOUNCE = 120;
  const FAVORITES_RECENT_LIMIT = 5;
  const FAVORITES_MODAL_ID = 'stcj-favorites-modal';
  const FAVORITES_MODAL_DRAWER_BREAKPOINT = 900;
  const FAVORITES_MODAL_CARD_PREFIX = 'stcj-fav-card';
  const FAVORITE_QUICK_MENU_OVERLAY_ID = 'stcj-fav-quick-menu-overlay';
  const FAVORITES_PREVIEW_MODES = {
    SWIPE_DEFAULT: 'swipe_default',
    SWIPE_HTML: 'swipe_html',
    STAR_MAIN: 'star_main',
  };
  const FAVORITES_PREVIEW_MODE_ORDER = [
    FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT,
    FAVORITES_PREVIEW_MODES.SWIPE_HTML,
    FAVORITES_PREVIEW_MODES.STAR_MAIN,
  ];

  /** @type {Array<{id:string,messageId:number,note:string,textHash:string,previewText:string,sender:string,sendDate:string,createdAt:number,updatedAt:number}>} */
  let favoriteItems = [];
  let favPanelOpen = false;
  let pinMode = false;
  let globalHidden = false;
  let favoriteQuickMenuId = null;
  let favoritesSaveTimer = null;
  let favoritesModalOpen = false;
  let favoritesModalSort = 'floor_asc';
  let favoritesModalActiveId = null;
  let favoritesPreviewMode = FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT;
  let favoritesSidebarCollapsed = false;
  let favoritesSidebarDrawerOpen = false;
  const favoritesPreviewIframeToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let favoritesPreviewMessageListenerAttached = false;
  let favoritesRenderSeq = 0;
  let favoriteSyncSeq = 0;

  // ===== 快速编辑（铅笔） =====
  /** @type {null|{mesId:number, scrollTop:number|null, scrollEl:HTMLElement|null, selectionCtx:null|{selectedText:string,before:string,after:string,displayText:string,start:number,end:number}, detachOutside: null|(() => void), monitorTimer:number|null}} */
  let quickEditState = null;
  /** @type {null|HTMLElement} */
  let quickEditMirror = null;

  let suppressNextChatClick = false;

  let pinDown = null;
  let pinListenersAttached = false;

  /** @type {null|(() => void)} */
  let detachChatListeners = null;
  /** @type {null|(() => void)} */
  let detachOutsideClose = null;
  let chatWatchInterval = null;
  let lastChatKey = null;
  let lastChatRef = null;
  /** @type {null|{start:number,end:number}} */
  let activeRange = null;

  let lastChatLen = null;

  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    horizontal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 8 3 12 7 16"></polyline><polyline points="17 8 21 12 17 16"></polyline><line x1="21" y1="12" x2="3" y2="12"></line></svg>',
    vertical: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 7 12 3 16 7"></polyline><polyline points="8 17 12 21 16 17"></polyline><line x1="12" y1="21" x2="12" y2="3"></line></svg>',
    chevronUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
    fastBackward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="19 6 13 12 19 18"></polyline><polyline points="11 6 5 12 11 18"></polyline></svg>',
    fastForward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 6 11 12 5 18"></polyline><polyline points="13 6 19 12 13 18"></polyline></svg>',
    head: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7M5 5h14"/></svg>',
    tail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7M5 19h14"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"></path></svg>',
    sidebarExpand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="9" y1="4" x2="9" y2="20"></line><polyline points="13 9 16 12 13 15"></polyline></svg>',
    sidebarCollapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="9" y1="4" x2="9" y2="20"></line><polyline points="15 9 12 12 15 15"></polyline></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>',
    num: (n) => `<svg viewBox="0 0 24 24" fill="none"><text x="50%" y="55%" dominant-baseline="central" text-anchor="middle" font-weight="500" font-size="16" fill="currentColor" font-family="var(--sans-font, sans-serif)">${n}</text></svg>`,
    range: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v6l-4 2v-8L3 4z"></path></svg>',
    restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15A9 9 0 1 1 23 10"></path></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>',
    arrowUpRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"></path><path d="M8 7h9v9"></path></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16l4-3h10a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>',
  };

  /**
   * @param {string} iconName
   * @param {string} [title]
   * @returns {string}
   */
  function getIcon(iconName, title = '') {
    let svg = ICONS[iconName];
    if (typeof svg === 'function') svg = svg(arguments[2] || '');
    if (!svg) return '';
    return svg;
  }

  function setIcon(el, iconName, extra) {
    if (!el) return;
    el.innerHTML = typeof ICONS[iconName] === 'function' ? ICONS[iconName](extra) : ICONS[iconName];
  }

  function log(...args) {
    // eslint-disable-next-line no-console
    console.log('[ST Chat Jumper]', ...args);
  }

  function toastInfo(msg) {
    try {
      if (window.toastr?.info) window.toastr.info(msg);
    } catch {
      /* ignore */
    }
  }

  function toastWarn(msg) {
    try {
      if (window.toastr?.warning) window.toastr.warning(msg);
    } catch {
      /* ignore */
    }
  }

  function toastError(msg) {
    try {
      if (window.toastr?.error) window.toastr.error(msg);
      else toastWarn(msg);
    } catch {
      /* ignore */
    }
  }

  function toastSuccess(msg) {
    try {
      if (window.toastr?.success) window.toastr.success(msg);
      else toastInfo(msg);
    } catch {
      /* ignore */
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};

      const orientation =
        parsed.orientation === 'horizontal' || parsed.orientation === 'vertical' ? parsed.orientation : DEFAULT_ORIENTATION;

      const x = typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : null;
      const y = typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? parsed.y : null;
      const rx = typeof parsed.rx === 'number' && Number.isFinite(parsed.rx) ? clamp(parsed.rx, 0, 1) : null;
      const ry = typeof parsed.ry === 'number' && Number.isFinite(parsed.ry) ? clamp(parsed.ry, 0, 1) : null;
      const collapsed = typeof parsed.collapsed === 'boolean' ? parsed.collapsed : DEFAULT_SETTINGS.collapsed;
      const scale = normalizeRootScale(parsed.scale);
      const favPanelX = typeof parsed.favPanelX === 'number' && Number.isFinite(parsed.favPanelX) ? parsed.favPanelX : null;
      const favPanelY = typeof parsed.favPanelY === 'number' && Number.isFinite(parsed.favPanelY) ? parsed.favPanelY : null;
      const favPanelRx = typeof parsed.favPanelRx === 'number' && Number.isFinite(parsed.favPanelRx) ? clamp(parsed.favPanelRx, 0, 1) : null;
      const favPanelRy = typeof parsed.favPanelRy === 'number' && Number.isFinite(parsed.favPanelRy) ? clamp(parsed.favPanelRy, 0, 1) : null;
      const favPanelCustom = typeof parsed.favPanelCustom === 'boolean' ? parsed.favPanelCustom : DEFAULT_SETTINGS.favPanelCustom;
      const favPanelW = typeof parsed.favPanelW === 'number' && Number.isFinite(parsed.favPanelW)
        ? clamp(parsed.favPanelW, FAV_PANEL_MIN_W, FAV_PANEL_MAX_W) : null;
      const favPanelH = typeof parsed.favPanelH === 'number' && Number.isFinite(parsed.favPanelH)
        ? clamp(parsed.favPanelH, FAV_PANEL_MIN_H, FAV_PANEL_MAX_H) : null;

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        x,
        y,
        rx,
        ry,
        orientation,
        collapsed,
        scale,
        favPanelX,
        favPanelY,
        favPanelRx,
        favPanelRy,
        favPanelCustom,
        favPanelW,
        favPanelH,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function normalizeRootScale(value) {
    const scale = Number(value);
    if (!Number.isFinite(scale)) return DEFAULT_SCALE;
    return clamp(scale, MIN_SCALE, MAX_SCALE);
  }

  function getRootScalePercent(value = settings.scale) {
    return Math.round(normalizeRootScale(value) * 100);
  }

  function formatRootScalePercent(value = settings.scale) {
    return `${getRootScalePercent(value)}%`;
  }

  function getRootScaleSliderProgress(value = settings.scale) {
    const percent = getRootScalePercent(value);
    return clamp(((percent - MIN_SCALE * 100) / ((MAX_SCALE - MIN_SCALE) * 100)) * 100, 0, 100);
  }

  function getNowMs() {
    try {
      return typeof performance?.now === 'function' ? performance.now() : Date.now();
    } catch {
      return Date.now();
    }
  }

  function suppressButtonActions(duration = 150) {
    suppressButtonActionUntil = getNowMs() + duration;
  }

  function shouldSuppressButtonAction() {
    return getNowMs() < suppressButtonActionUntil;
  }

  function triggerHapticFeedback(duration = 12) {
    try {
      if (typeof navigator?.vibrate !== 'function') return;
      navigator.vibrate(duration);
    } catch {
      /* ignore */
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getChatContainer() {
    return document.getElementById('chat');
  }

  function getChatScrollElement() {
    const chat = getChatContainer();
    if (!chat) return null;

    // SillyTavern 通常使用 SimpleBar：真正可滚动的视口是 #chat 的祖先 .simplebar-content-wrapper
    // 之前用 chat.querySelector 会找不到（因为 wrapper 通常在 #chat 外层），导致滚动/定位基准不稳定。
    const wrapper = chat.closest('.simplebar-content-wrapper');
    if (wrapper) {
      // 防止“滚动链”把滚动/定位传递给页面本身（某些浏览器/触控板下会导致整个页面上移露出灰底）
      try {
        wrapper.style.overscrollBehavior = 'contain';
      } catch {
        /* ignore */
      }
      return wrapper;
    }

    // 极少数布局可能把 wrapper 放在 #chat 内部，做一层兜底
    const inner = chat.querySelector?.('.simplebar-content-wrapper');
    if (inner) {
      try {
        inner.style.overscrollBehavior = 'contain';
      } catch {
        /* ignore */
      }
      return inner;
    }

    return chat;
  }

  function captureWindowScroll() {
    try {
      const se = document.scrollingElement || document.documentElement;
      return {
        x: (typeof window.scrollX === 'number' ? window.scrollX : se.scrollLeft) || 0,
        y: (typeof window.scrollY === 'number' ? window.scrollY : se.scrollTop) || 0,
      };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  /**
   * 恢复窗口滚动位置。
   * - 该插件只应该滚动聊天视口（SimpleBar wrapper），不应该让 window 本身滚动。
   * - 但 ST 内置的 chat-jump/某些浏览器的 scrollIntoView 有时会误滚动 window，导致页面“上移”露出灰色不可点区域。
   */
  function restoreWindowScroll(pos) {
    if (!pos) return;
    try {
      const se = document.scrollingElement || document.documentElement;
      const curX = (typeof window.scrollX === 'number' ? window.scrollX : se.scrollLeft) || 0;
      const curY = (typeof window.scrollY === 'number' ? window.scrollY : se.scrollTop) || 0;
      if (curX === pos.x && curY === pos.y) return;

      // 用 auto 立刻纠正，避免与 smooth 动画互相“拉扯”
      window.scrollTo({ left: pos.x, top: pos.y, behavior: 'auto' });
    } catch {
      /* ignore */
    }
  }

  /**
   * 某些情况下（尤其是虚拟滚动/延迟渲染）window 的滚动会在稍后才被修改。
   * 这里做一次“稳定化恢复”，在下一帧和稍后再补一次纠正。
   */
  function restoreWindowScrollStable(pos) {
    restoreWindowScroll(pos);
    try {
      requestAnimationFrame(() => restoreWindowScroll(pos));
    } catch {
      /* ignore */
    }
    try {
      setTimeout(() => restoreWindowScroll(pos), 80);
    } catch {
      /* ignore */
    }
  }

  /**
   * 只滚动聊天滚动容器，不使用 scrollIntoView（它可能会连带滚动 window）。
   * @param {HTMLElement} mesEl
   * @param {'start'|'end'} block
   * @param {'auto'|'smooth'} behavior
   */
  function scrollMessageInChat(mesEl, block, behavior = 'smooth') {
    const scrollEl = getChatScrollElement();
    if (!mesEl || !scrollEl) return false;

    try {
      const vp = scrollEl.getBoundingClientRect();
      const rect = mesEl.getBoundingClientRect();

      let targetTop = scrollEl.scrollTop;
      if (block === 'end') targetTop += rect.bottom - vp.bottom;
      else targetTop += rect.top - vp.top;

      const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      targetTop = clamp(targetTop, 0, max);

      if (typeof scrollEl.scrollTo === 'function') {
        scrollEl.scrollTo({ top: targetTop, behavior });
      } else {
        scrollEl.scrollTop = targetTop;
      }
      return true;
    } catch (e) {
      log('scrollMessageInChat failed', e);
      return false;
    }
  }

  function getLastMessageId() {
    // 方法1：SillyTavern context.chat.length - 1（最可靠，适配虚拟滚动）
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (ctx?.chat && Array.isArray(ctx.chat) && ctx.chat.length > 0) {
        return ctx.chat.length - 1;
      }
    } catch {
      /* ignore */
    }

    // 方法2：通过 last_mes
    const lastMes = document.querySelector('#chat .mes.last_mes[mesid]');
    if (lastMes) {
      const id = parseInt(lastMes.getAttribute('mesid') || '', 10);
      if (!Number.isNaN(id)) return id;
    }

    // 方法3：DOM 兜底
    const nodes = document.querySelectorAll('#chat .mes[mesid]');
    if (nodes.length > 0) {
      const last = nodes[nodes.length - 1];
      const id = parseInt(last.getAttribute('mesid') || '', 10);
      if (!Number.isNaN(id)) return id;
    }

    return 0;
  }

  function getLatestMessageElement() {
    const lastMes = document.querySelector('#chat .mes.last_mes[mesid]');
    if (lastMes) return lastMes;

    const nodes = document.querySelectorAll('#chat .mes[mesid]');
    return nodes.length ? nodes[nodes.length - 1] : null;
  }

  function triggerElementClick(el) {
    if (!el) return false;
    try {
      if (typeof el.click === 'function') {
        el.click();
        return true;
      }
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (e) {
      log('触发点击失败', e);
      return false;
    }
  }

  async function quickFlipLatestMessagePage(direction = 'right') {
    const isLeft = direction === 'left';
    const selectorBase = isLeft ? '.swipe_left' : '.swipe_right';
    const directionText = isLeft ? '左' : '右';
    const pageDirectionText = isLeft ? '上一' : '下一';
    const lastId = getLastMessageId();
    if (!Number.isFinite(lastId) || lastId < 0) {
      toastWarn('未找到最新楼层。');
      return false;
    }

    let mesEl = getLatestMessageElement();
    const mesId = mesEl ? parseInt(mesEl.getAttribute('mesid') || '', 10) : NaN;

    if (!mesEl || Number.isNaN(mesId) || mesId !== lastId) {
      const winPos = captureWindowScroll();
      await trySlashChatJump(lastId);
      restoreWindowScrollStable(winPos);
      mesEl = await waitForMessageElement(lastId, 2000);
    }

    const flipBtn =
      mesEl?.querySelector(`${selectorBase}.fa-solid.interactable[role="button"]`) ||
      mesEl?.querySelector(`${selectorBase}.interactable[role="button"]`) ||
      mesEl?.querySelector(selectorBase);

    if (!flipBtn) {
      toastWarn(`最新楼层没有可用的${directionText}翻页按钮。`);
      return false;
    }

    if (flipBtn.getAttribute('aria-disabled') === 'true' || flipBtn.classList.contains('disabled')) {
      toastInfo(`最新楼层当前没有${pageDirectionText}页可翻。`);
      return false;
    }

    return triggerElementClick(flipBtn);
  }

  /**
   * 取“当前楼层”锚点元素：优先选中聊天视口**顶部**所在的那条消息。
   *
   * 这样连续点击 < / > 会稳定地按 1 楼递进；
   * 同时解决“跳到某一楼后再次点击仍停留在同一楼/下一楼”的问题（之前按窗口中心算最可见，会被下一条抢占）。
   */
  function getAnchorMessageElement() {
    const nodes = document.querySelectorAll('#chat .mes[mesid]');
    if (!nodes.length) return null;

    const scrollEl = getChatScrollElement();
    if (!scrollEl) return nodes[nodes.length - 1];

    const vpRect = scrollEl.getBoundingClientRect();
    const vpTop = Number.isFinite(vpRect.top) ? vpRect.top : 0;
    const vpBottom =
      Number.isFinite(vpRect.bottom) && vpRect.bottom > vpTop
        ? vpRect.bottom
        : window.innerHeight || document.documentElement.clientHeight || 0;

    // 用 1px 探针落在“视口顶部边缘”处：
    // - 如果当前消息跨过顶部边缘（部分可见/已对齐到头部），就会被选为锚点
    // - 否则选第一个出现在顶部边缘下方的可见消息
    const probeY = vpTop + 1;

    /** @type {HTMLElement|null} */
    let cover = null;
    let coverTop = -Infinity;

    /** @type {HTMLElement|null} */
    let below = null;
    let belowTop = Infinity;

    nodes.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= vpTop || rect.top >= vpBottom) return; // 不可见

      // 覆盖顶部探针的消息：优先；如果出现多个，取 rect.top 更大的那个（更贴近顶部）
      if (rect.top <= probeY && rect.bottom >= probeY) {
        if (rect.top > coverTop) {
          coverTop = rect.top;
          cover = el;
        }
        return;
      }

      // 否则取顶部边缘下方的第一条可见消息
      if (rect.top > probeY && rect.top < belowTop) {
        belowTop = rect.top;
        below = el;
      }
    });

    return cover || below || nodes[0];
  }

  function getAnchorMesId() {
    const el =
      getAnchorMessageElement() ||
      document.querySelector('#chat .mes.last_mes[mesid]') ||
      document.querySelector('#chat .mes[mesid]');
    if (!el) return 0;
    const id = parseInt(el.getAttribute('mesid') || '', 10);
    return Number.isNaN(id) ? 0 : id;
  }

  /**
   * 记录当前视口锚点楼层，以及它相对聊天视口顶部的像素偏移。
   * 用于在重建区间 DOM 后，尽量恢复到完全相同的阅读位置（而不只是回到楼层头部）。
   *
   * @returns {null|{mesId:number, offsetTop:number}}
   */
  function captureViewportAnchor() {
    const scrollEl = getChatScrollElement();
    const anchorEl = getAnchorMessageElement();
    if (!scrollEl || !anchorEl) return null;

    try {
      const mesId = parseInt(anchorEl.getAttribute('mesid') || '', 10);
      if (Number.isNaN(mesId)) return null;

      const vp = scrollEl.getBoundingClientRect();
      const rect = anchorEl.getBoundingClientRect();
      return {
        mesId,
        offsetTop: rect.top - vp.top,
      };
    } catch {
      return null;
    }
  }

  /**
   * 按“原像素偏移”恢复锚点楼层在视口中的位置。
   * 这比 scrollMessageInChat(..., 'start') 更适合连续阅读场景。
   *
   * @param {{mesId:number, offsetTop:number}|null} state
   */
  function restoreViewportAnchor(state) {
    const scrollEl = getChatScrollElement();
    if (!state || !scrollEl) return false;

    const el = document.querySelector(`#chat .mes[mesid="${state.mesId}"]`);
    if (!el) return false;

    try {
      const vp = scrollEl.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const currentOffset = rect.top - vp.top;
      const delta = currentOffset - state.offsetTop;
      const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      const targetTop = clamp(scrollEl.scrollTop + delta, 0, max);
      scrollEl.scrollTo?.({ top: targetTop, behavior: 'auto' });
      if (typeof scrollEl.scrollTo !== 'function') scrollEl.scrollTop = targetTop;
      return true;
    } catch {
      return false;
    }
  }

  async function trySlashChatJump(mesId) {
    try {
      const cmd = window.SillyTavern?.SlashCommandParser?.commands?.['chat-jump'];
      if (cmd?.callback) {
        await cmd.callback({}, String(mesId));
        return true;
      }
    } catch (e) {
      log('SlashCommandParser chat-jump 失败', e);
    }
    return false;
  }

  async function waitForMessageElement(mesId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
      if (el) return el;
      // eslint-disable-next-line no-await-in-loop
      await sleep(50);
    }
    return null;
  }

  function flashMessage(el) {
    try {
      el.classList.add('stcj-flash');
      setTimeout(() => el.classList.remove('stcj-flash'), 900);
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {number} mesId
   * @param {'start'|'end'} block
   */
  async function jumpToMessage(mesId, block) {
    const chat = getChatContainer();
    const scrollEl = getChatScrollElement();
    if (!chat || !scrollEl) return false;

    const winPos = captureWindowScroll();

    const lastId = getLastMessageId();
    const targetId = clamp(mesId, 0, lastId);

    // 先尝试用 chat-jump 让虚拟滚动加载目标消息（这一步通常会把目标滚到中间）
    await trySlashChatJump(targetId);

    // 有些情况下 chat-jump/scrollIntoView 会误滚动 window，导致页面上移出现灰底
    restoreWindowScrollStable(winPos);

    // 再等待 DOM 出现后，精确对齐到头/尾（只滚动聊天容器，不滚动 window）
    const el = await waitForMessageElement(targetId, 2000);
    if (el) {
      scrollMessageInChat(el, block, 'smooth');
      restoreWindowScrollStable(winPos);
      flashMessage(el);
      return true;
    }

    // 兜底：滚动到顶部/底部
    if (targetId <= 0) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      restoreWindowScrollStable(winPos);
      return true;
    }

    if (targetId >= lastId) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      restoreWindowScrollStable(winPos);
      return true;
    }

    toastWarn('未能定位到目标楼层（可能被虚拟滚动隐藏），请稍后重试。');
    restoreWindowScrollStable(winPos);
    return false;
  }

  // =====================
  // 快速编辑（铅笔按钮）
  // =====================

  const QUICK_EDIT = {
    EDIT_BUTTON_SELECTORS: ['.mes_edit', '.fa-edit', '.fa-pencil'],
    DONE_BUTTON_SELECTOR: '.mes_edit_done',
    TEXT_CONTAINER_SELECTORS: ['.mes_text', '.mes_text_inner', '.mes_text_block'],
    EDIT_TEXTAREA_SELECTOR: '#curEditTextarea',
    SCROLL_INTO_VIEW_OFFSET: 120,
    EDITOR_SCROLL_ALIGNMENT_RATIO: 0.5,
  };

  function isElementVisible(el) {
    if (!el) return false;
    try {
      return !!(el.offsetParent || el.getClientRects().length);
    } catch {
      return false;
    }
  }

  function getQuickEditButton(root) {
    return root?.querySelector?.('.stcj-btn[data-action="quickEdit"]') || null;
  }

  function updateQuickEditButton(root) {
    const btn = getQuickEditButton(root);
    if (!btn) return;
    const editing = !!quickEditState && isElementVisible(document.querySelector(QUICK_EDIT.EDIT_TEXTAREA_SELECTOR));
    setIcon(btn, editing ? 'check' : 'pencil');
    btn.classList.toggle('stcj-editing', editing);
    btn.title = editing ? '保存编辑（完成）' : '快速编辑：选中文字可高亮定位；无选中则编辑当前楼层';
  }

  function getMessageTextContainer(mesEl) {
    if (!mesEl) return null;
    for (const sel of QUICK_EDIT.TEXT_CONTAINER_SELECTORS) {
      const el = mesEl.querySelector(sel);
      if (el) return el;
    }
    return mesEl;
  }

  function getSelectionContextInElement(containerEl, env) {
    try {
      const win = env?.win || window;
      const doc = env?.doc || document;
      const sel = win.getSelection?.();
      if (!sel || sel.rangeCount <= 0 || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      if (!containerEl.contains(range.commonAncestorContainer)) return null;

      // 用 Range.toString() 来获得与 offset 计算一致的“显示文本”
      const fullRange = doc.createRange();
      fullRange.selectNodeContents(containerEl);
      const displayText = fullRange.toString();

      const preStart = doc.createRange();
      preStart.selectNodeContents(containerEl);
      preStart.setEnd(range.startContainer, range.startOffset);
      const start = preStart.toString().length;

      const preEnd = doc.createRange();
      preEnd.selectNodeContents(containerEl);
      preEnd.setEnd(range.endContainer, range.endOffset);
      const end = preEnd.toString().length;

      const selectedText = range.toString();
      const before = displayText.slice(Math.max(0, start - 60), start);
      const after = displayText.slice(end, end + 60);

      return { selectedText, before, after, displayText, start, end };
    } catch {
      return null;
    }
  }

  /**
   * 取“用户框选的文本”所在的楼层与上下文。
   *
   * 重要：一些渲染插件（例如把 <fantasy_log> 渲染为 UI）会把可选文本放进 iframe，
   * 这时 parent window.getSelection() 取不到选区。这里会额外扫描 #chat 内可访问的 iframe。
   *
   * @returns {null|{mesEl:HTMLElement, mesId:number, selectionCtx:null|{selectedText:string,before:string,after:string,displayText:string,start:number,end:number}}}
   */
  function getSelectionInfo() {
    // 1) 主文档选择
    try {
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        const mesEl = el?.closest?.('#chat .mes[mesid]') || null;
        if (mesEl) {
          const mesId = parseInt(mesEl.getAttribute('mesid') || '', 10);
          if (!Number.isNaN(mesId)) {
            const container = getMessageTextContainer(mesEl) || mesEl;
            const selectionCtx = getSelectionContextInElement(container, { win: window, doc: document });
            return { mesEl, mesId, selectionCtx };
          }
        }
      }
    } catch {
      /* ignore */
    }

    // 2) iframe 内选择（同源/可访问的情况下）
    try {
      const frames = document.querySelectorAll('#chat iframe');
      for (const iframe of frames) {
        try {
          const win = iframe.contentWindow;
          const doc = iframe.contentDocument;
          if (!win || !doc) continue;
          const sel = win.getSelection?.();
          if (!sel || sel.isCollapsed || sel.rangeCount <= 0) continue;

          const mesEl = iframe.closest?.('#chat .mes[mesid]') || null;
          if (!mesEl) continue;

          const mesId = parseInt(mesEl.getAttribute('mesid') || '', 10);
          if (Number.isNaN(mesId)) continue;

          const container = doc.body || doc.documentElement;
          if (!container) continue;
          const selectionCtx = getSelectionContextInElement(container, { win, doc });
          return { mesEl, mesId, selectionCtx };
        } catch {
          // 跨域 iframe / blob 访问失败等：跳过
          continue;
        }
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  /**
   * 直接从 SillyTavern.getContext().chat[mesId] 读取“楼层原文”。
   * - 优先取当前 swipe（若存在）
   * - 兼容 swipe 为 string / 数组(parts) 的格式
   *
   * @param {number} mesId
   * @returns {string|null}
   */
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
    return Math.trunc(clamp(rawSwipeId, 0, Math.max(0, message.swipes.length - 1)));
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

  function normalizeAndMap(text, options) {
    const opts = {
      ignoreMarkdown: true,
      ignoreHtmlTags: false,
      treatBrAsNewline: true,
      ignorePunct: false,
      ...(options || {}),
    };

    /** @type {number[]} normIndex -> originalIndex */
    const map = [];
    let out = '';
    let lastWasSpace = false;

    for (let i = 0; i < text.length; i++) {
      let ch = text[i];
      if (ch === '\r') continue;

      // 处理 HTML 标签：在原文里经常存在（例如 <quest>xxx</quest> 或 <br>），
      // 但在选区（显示文本）里不会包含标签本体，导致无法匹配。
      if (opts.ignoreHtmlTags && ch === '<') {
        const close = text.indexOf('>', i + 1);
        // 避免把普通文本里的 "<" 误当标签：要求 200 字符内闭合
        if (close !== -1 && close - i <= 200) {
          const rawTag = text.slice(i + 1, close).trim();
          const tagName = rawTag.replace(/^[!/\s]+/, '').split(/[\s/>]/)[0]?.toLowerCase?.() || '';

          if (opts.treatBrAsNewline && (tagName === 'br' || tagName === 'p' || tagName === '/p' || tagName === 'div' || tagName === '/div')) {
            // 用一个空白占位，后续会统一折叠空白
            if (!lastWasSpace) {
              out += ' ';
              map.push(i);
              lastWasSpace = true;
            }
          }

          i = close;
          continue;
        }
      }

      // HTML entity（非常粗略的处理，主要覆盖常见场景；更复杂的交给模糊匹配兜底）
      if (opts.ignoreHtmlTags && ch === '&') {
        const semi = text.indexOf(';', i + 1);
        if (semi !== -1 && semi - i <= 20) {
          const ent = text.slice(i + 1, semi);
          let decoded = null;
          if (ent === 'nbsp') decoded = ' ';
          else if (ent === 'lt') decoded = '<';
          else if (ent === 'gt') decoded = '>';
          else if (ent === 'amp') decoded = '&';
          else if (ent === 'quot') decoded = '"';
          else if (ent === 'apos') decoded = "'";
          else if (ent.startsWith('#x')) {
            const code = parseInt(ent.slice(2), 16);
            if (Number.isFinite(code)) decoded = String.fromCharCode(code);
          } else if (ent.startsWith('#')) {
            const code = parseInt(ent.slice(1), 10);
            if (Number.isFinite(code)) decoded = String.fromCharCode(code);
          }

          if (decoded != null) {
            ch = decoded;
            i = semi;
          }
        }
      }

      if (opts.ignoreMarkdown && (ch === '*' || ch === '_' || ch === '~' || ch === '`')) continue;

      // 极端兜底：模糊匹配时忽略标点/符号（包含中英文标点），提升“正则处理/隐藏符号”场景的命中率
      if (opts.ignorePunct) {
        try {
          if (/\p{P}|\p{S}/u.test(ch)) continue;
        } catch {
          // older runtime fallback: 仅忽略常见标点
          if (/[\.,!?:;\-—–()\[\]{}<>"'“”‘’、，。！？：；【】（）《》]/.test(ch)) continue;
        }
      }

      // 统一空白：不同换行/空格都归一为一个空格，且连续空白折叠
      if (/\s/.test(ch)) {
        if (lastWasSpace) continue;
        ch = ' ';
        lastWasSpace = true;
      } else {
        lastWasSpace = false;
      }

      const lower = ch.toLowerCase();
      out += lower;
      // 注意：out 的索引是 UTF-16 code unit；这里 ch 是单个 code unit（我们按 i 遍历）
      map.push(i);
    }

    return { norm: out, map };
  }

  function commonSuffixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let count = 0;
    for (let i = 1; i <= n; i++) {
      if (a[a.length - i] !== b[b.length - i]) break;
      count++;
    }
    return count;
  }

  function commonPrefixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) break;
      count++;
    }
    return count;
  }

  /**
   * 基于“选区 + 前后上下文”的定位：
   * - 解决重复文本（多个相同子串）导致的误选
   * - 兼容部分“显示正则/Markdown”导致的符号差异（可切换更模糊的 ignorePunct）
   */
  function findBestMatchInEditor(rawText, selectionCtx, options) {
    if (!rawText || !selectionCtx?.selectedText) return null;

    const { selectedText, before, after, start, displayText } = selectionCtx;
    const displayLen = (displayText?.length || 0);
    const expectedRatio =
      typeof options?.expectedRatioOverride === 'number' && Number.isFinite(options.expectedRatioOverride)
        ? clamp(options.expectedRatioOverride, 0, 1)
        : (displayLen > 0 ? clamp(start / displayLen, 0, 1) : 0);

    const { norm: rawNorm, map: rawMap } = normalizeAndMap(String(rawText), options);
    const { norm: selNorm } = normalizeAndMap(String(selectedText), options);
    const { norm: beforeNorm } = normalizeAndMap(String(before || ''), options);
    const { norm: afterNorm } = normalizeAndMap(String(after || ''), options);

    if (!selNorm) return null;

    /** @type {number[]} */
    const indices = [];
    for (let idx = rawNorm.indexOf(selNorm); idx !== -1; idx = rawNorm.indexOf(selNorm, idx + 1)) {
      indices.push(idx);
      if (indices.length > 200) break; // 防御：避免极端长文本 + 极短 needle 卡死
    }

    if (!indices.length) return null;

    const expected = Math.round(rawNorm.length * expectedRatio);
    let best = { idx: indices[0], score: -Infinity };

    for (const idx of indices) {
      const left = rawNorm.slice(Math.max(0, idx - beforeNorm.length), idx);
      const right = rawNorm.slice(idx + selNorm.length, idx + selNorm.length + afterNorm.length);

      const scoreBefore = commonSuffixLen(left, beforeNorm);
      const scoreAfter = commonPrefixLen(right, afterNorm);

      // 越接近“选区大致相对位置”越好（用于进一步打破平分）
      const posPenalty = Math.abs(idx - expected) * 0.02;

      const score = scoreBefore + scoreAfter - posPenalty;
      if (score > best.score) best = { idx, score };
    }

    const startNorm = best.idx;
    const endNorm = best.idx + selNorm.length - 1;
    if (startNorm < 0 || endNorm >= rawMap.length) return null;

    const rawStart = rawMap[startNorm];
    const rawEnd = rawMap[endNorm] + 1;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) return null;

    return { start: rawStart, end: rawEnd, score: best.score };
  }

  /**
   * 在某段文本中尝试定位 selectionCtx（严格 -> 忽略 HTML 标签 -> 更模糊）。
   * @param {string} text
   * @param {any} selectionCtx
   * @param {{expectedRatioOverride?: number}|null} extra
   */
  function computeMatchWithFallbacks(text, selectionCtx, extra) {
    if (!text || !selectionCtx?.selectedText) return null;
    const expectedRatioOverride = extra?.expectedRatioOverride;

    // 1) 严格：忽略 Markdown 符号 + 空白归一
    let match = findBestMatchInEditor(text, selectionCtx, {
      ignoreMarkdown: true,
      ignorePunct: false,
      expectedRatioOverride,
    });

    // 2) HTML 兜底：忽略标签（解决 <quest>xxx</quest> / <br> / 自定义标签等导致的差异）
    if (!match) {
      match = findBestMatchInEditor(text, selectionCtx, {
        ignoreMarkdown: true,
        ignoreHtmlTags: true,
        ignorePunct: false,
        expectedRatioOverride,
      });
    }

    // 3) 更模糊兜底：忽略标点/符号
    if (!match) {
      match = findBestMatchInEditor(text, selectionCtx, {
        ignoreMarkdown: true,
        ignoreHtmlTags: true,
        ignorePunct: true,
        expectedRatioOverride,
      });
    }

    return match;
  }

  function pickBetterMatch(a, b) {
    if (!a) return b;
    if (!b) return a;
    const sa = typeof a.score === 'number' ? a.score : -Infinity;
    const sb = typeof b.score === 'number' ? b.score : -Infinity;
    return sb > sa ? b : a;
  }

  /**
   * 将“另一份原文（ctx）里匹配到的位置”尽量映射回 textarea 文本。
   * 说明：当 ctx 原文与 textarea.value 存在轻微差异（实体/换行/插件改写）时，直接用 start/end 可能不准。
   * 这里会用“该片段 + ctx 前后上下文”再次在 textarea 中做一次定位。
   */
  function mapMatchToTextarea(textareaText, otherText, otherMatch) {
    if (!textareaText || !otherText || !otherMatch) return null;
    if (textareaText === otherText) return otherMatch;

    try {
      const needle = otherText.slice(otherMatch.start, otherMatch.end);
      if (!needle) return null;

      // 先尝试直接查找（仅当唯一命中时使用，避免重复子串误判）
      const first = textareaText.indexOf(needle);
      if (first !== -1) {
        const second = textareaText.indexOf(needle, first + needle.length);
        if (second === -1) {
          return { start: first, end: first + needle.length, score: otherMatch.score };
        }
      }

      const before = otherText.slice(Math.max(0, otherMatch.start - 60), otherMatch.start);
      const after = otherText.slice(otherMatch.end, otherMatch.end + 60);
      const pseudo = {
        selectedText: needle,
        before,
        after,
        displayText: otherText,
        start: otherMatch.start,
        end: otherMatch.end,
      };

      const ratio = otherText.length > 0 ? clamp(otherMatch.start / otherText.length, 0, 1) : 0;
      return computeMatchWithFallbacks(textareaText, pseudo, { expectedRatioOverride: ratio });
    } catch {
      return null;
    }
  }

  /**
   * 双通道：
   * - 通道 A：textarea.value（最终要高亮的文本）
   * - 通道 B：SillyTavern.getContext().chat[mesId] 原文（更“原始”，不受 DOM/渲染影响）
   *
   * 策略：
   * 1) 先在 textarea 内匹配；
   * 2) 若 ctx 原文也能匹配，使用其位置比例（expectedRatio）来改进 textarea 的歧义选择；
   * 3) 若 textarea 匹配失败，尝试把 ctx 的命中片段映射回 textarea。
   */
  function computeBestMatchForTextarea(textareaText, ctxText, selectionCtx) {
    if (!textareaText || !selectionCtx?.selectedText) return null;

    const base = computeMatchWithFallbacks(textareaText, selectionCtx, null);
    let best = base;

    if (ctxText) {
      const ctxMatch = computeMatchWithFallbacks(ctxText, selectionCtx, null);
      if (ctxMatch) {
        const ratio = ctxText.length > 0 ? clamp(ctxMatch.start / ctxText.length, 0, 1) : 0;

        // 用 ctx 的“相对位置”帮助 textarea 在重复子串中选对位置
        const adjusted = computeMatchWithFallbacks(textareaText, selectionCtx, { expectedRatioOverride: ratio });
        best = pickBetterMatch(best, adjusted);

        // 用 ctx 命中的前后上下文，反推 textarea 中的位置。
        // 显著改善“选区来自 iframe 渲染 UI（上下文与原文完全不同）”时的定位效果。
        try {
          const needle = ctxText.slice(ctxMatch.start, ctxMatch.end);
          const before = ctxText.slice(Math.max(0, ctxMatch.start - 60), ctxMatch.start);
          const after = ctxText.slice(ctxMatch.end, ctxMatch.end + 60);
          const ctxDrivenCtx = {
            selectedText: needle,
            before,
            after,
            displayText: ctxText,
            start: ctxMatch.start,
            end: ctxMatch.end,
          };
          const ctxDriven = computeMatchWithFallbacks(textareaText, ctxDrivenCtx, { expectedRatioOverride: ratio });
          best = pickBetterMatch(best, ctxDriven);
        } catch {
          /* ignore */
        }

        // 若仍然失败，则尝试把 ctx 命中的片段映射回 textarea
        if (!best) {
          const mapped = mapMatchToTextarea(textareaText, ctxText, ctxMatch);
          if (mapped) best = mapped;
        }
      }
    }

    return best;
  }

  function ensureQuickEditMirror(textarea) {
    if (quickEditMirror && quickEditMirror.isConnected) return quickEditMirror;

    const div = document.createElement('div');
    div.style.cssText = `
      position: absolute;
      visibility: hidden;
      pointer-events: none;
      box-sizing: border-box;
      left: -9999px;
      top: -9999px;
      white-space: pre-wrap;
      word-wrap: break-word;
      word-break: break-word;
      overflow-wrap: break-word;
    `;
    document.body.appendChild(div);
    quickEditMirror = div;
    return div;
  }

  function scrollTextareaToSelection(textarea, rangeStart, rangeEnd) {
    try {
      const mirror = ensureQuickEditMirror(textarea);
      const style = getComputedStyle(textarea);
      const text = String(textarea.value || '');
      const fallbackStart = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : 0;
      const fallbackEnd = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : fallbackStart;
      const start = clamp(Number.isFinite(rangeStart) ? rangeStart : fallbackStart, 0, text.length);
      const end = clamp(Number.isFinite(rangeEnd) ? rangeEnd : fallbackEnd, start, text.length);
      const anchor = end > start ? Math.floor((start + end) / 2) : end;
      const lineHeight = parseFloat(style.lineHeight);
      const fallbackLineHeight = Number.isFinite(lineHeight)
        ? lineHeight
        : (parseFloat(style.fontSize) || 16) * 1.4;

      mirror.style.width = `${textarea.clientWidth}px`;
      mirror.style.padding = `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`;
      mirror.style.font = style.font;
      mirror.style.fontSize = style.fontSize;
      mirror.style.fontFamily = style.fontFamily;
      mirror.style.fontWeight = style.fontWeight;
      mirror.style.lineHeight = style.lineHeight;
      mirror.style.letterSpacing = style.letterSpacing;
      mirror.style.textTransform = style.textTransform;
      mirror.style.textIndent = style.textIndent;
      mirror.style.tabSize = style.tabSize;

      mirror.textContent = '';
      mirror.append(document.createTextNode(text.substring(0, anchor)));

      const marker = document.createElement('span');
      marker.textContent = text[anchor] || '\u200b';
      marker.style.display = 'inline-block';
      marker.style.width = '1px';
      marker.style.height = `${fallbackLineHeight}px`;
      mirror.append(marker);

      const caretY = marker.offsetTop;
      let target = caretY - textarea.clientHeight * QUICK_EDIT.EDITOR_SCROLL_ALIGNMENT_RATIO;
      const max = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
      target = clamp(target + fallbackLineHeight / 2, 0, max);
      textarea.scrollTop = target;
    } catch (e) {
      log('scrollTextareaToSelection failed', e);
    }
  }

  function scrollMessageToComfortPosition(mesEl) {
    const scrollEl = getChatScrollElement();
    if (!mesEl || !scrollEl) return;
    try {
      const vp = scrollEl.getBoundingClientRect();
      const rect = mesEl.getBoundingClientRect();
      const delta = rect.top - vp.top;
      const nextTop = scrollEl.scrollTop + delta - QUICK_EDIT.SCROLL_INTO_VIEW_OFFSET;
      scrollEl.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' });
    } catch {
      /* ignore */
    }
  }

  function getCurrentEditTextarea() {
    const el = document.querySelector(QUICK_EDIT.EDIT_TEXTAREA_SELECTOR);
    return el && isElementVisible(el) ? el : null;
  }

  async function waitForEditTextarea(mesEl, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ta = getCurrentEditTextarea();
      if (ta) return ta;

      // 兼容极少数情况下编辑器不是 curEditTextarea 的版本：尝试在消息内部找可见 textarea
      const inner = mesEl?.querySelector?.('textarea');
      if (inner && isElementVisible(inner)) return inner;

      // eslint-disable-next-line no-await-in-loop
      await sleep(50);
    }
    return null;
  }

  function clickMessageEditButton(mesEl) {
    if (!mesEl) return false;

    // 优先点击 .mes_edit
    const direct = mesEl.querySelector('.mes_edit');
    if (direct) {
      direct.click();
      return true;
    }

    for (const sel of QUICK_EDIT.EDIT_BUTTON_SELECTORS) {
      const node = mesEl.querySelector(sel);
      if (!node) continue;
      const clickable = node.closest?.('.mes_edit, button, .menu_button, div') || node;
      if (clickable && typeof clickable.click === 'function') {
        clickable.click();
        return true;
      }
    }

    return false;
  }

  function clickMessageDoneButton(mesEl) {
    const done = mesEl?.querySelector?.(QUICK_EDIT.DONE_BUTTON_SELECTOR);
    if (done && typeof done.click === 'function') {
      done.click();
      return true;
    }
    return false;
  }

  function detachQuickEditOutsideListener() {
    try {
      quickEditState?.detachOutside?.();
    } catch {
      /* ignore */
    }
    if (quickEditState) quickEditState.detachOutside = null;
  }

  function clearQuickEditState() {
    detachQuickEditOutsideListener();
    try {
      if (quickEditState?.monitorTimer) {
        clearInterval(quickEditState.monitorTimer);
      }
    } catch {
      /* ignore */
    }
    quickEditState = null;
    const root = document.getElementById(ROOT_ID);
    if (root) updateQuickEditButton(root);
  }

  function attachQuickEditOutsideListener() {
    if (!quickEditState) return;
    detachQuickEditOutsideListener();

    const onPointerDown = (e) => {
      if (!quickEditState) return;

      const root = document.getElementById(ROOT_ID);
      if (root && root.contains(e.target)) return;

      const mesEl = document.querySelector(`#chat .mes[mesid="${quickEditState.mesId}"]`);
      if (mesEl && mesEl.contains(e.target)) return;

      // 点击在编辑 textarea 上也不触发保存
      const ta = getCurrentEditTextarea();
      if (ta && ta.contains(e.target)) return;

      // 其他地方：自动保存
      void quickEditSave();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    quickEditState.detachOutside = () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }

  let quickEditBusy = false;

  async function quickEditOpen() {
    if (quickEditBusy) return false;
    quickEditBusy = true;
    try {
      if (pinMode) {
        toastWarn('当前处于收藏点选模式，已退出点选模式后再编辑。');
        setPinMode(false);
      }

      const scrollEl = getChatScrollElement();
      const scrollTop = scrollEl ? scrollEl.scrollTop : null;

      const winPos = captureWindowScroll();

      // 1) 优先：选中的消息
      const selectionInfo = getSelectionInfo();
      const targetMesId = selectionInfo?.mesId ?? getAnchorMesId();

      if (targetMesId == null) {
        toastWarn('未找到可编辑的楼层。');
        return false;
      }

      // 2) 让虚拟滚动加载目标消息
      await trySlashChatJump(targetMesId);
      restoreWindowScrollStable(winPos);
      const mesEl = await waitForMessageElement(targetMesId, 2000);
      if (!mesEl) {
        toastWarn('未能找到目标楼层（可能被虚拟滚动隐藏），请稍后重试。');
        return false;
      }

      // 3) 记录选中上下文（用于 textarea 内高亮定位）
      let selectionCtx = null;
      if (selectionInfo?.mesId === targetMesId) selectionCtx = selectionInfo.selectionCtx;
      if (!selectionCtx) {
        const textContainer = getMessageTextContainer(mesEl);
        selectionCtx = textContainer ? getSelectionContextInElement(textContainer, { win: window, doc: document }) : null;
      }

      // 4) 先点击编辑，让酒馆把 textarea 真正挂到当前楼层上
      if (!clickMessageEditButton(mesEl)) {
        toastWarn('未找到该楼层的编辑按钮（.mes_edit）。');
        return false;
      }

      const textarea = await waitForEditTextarea(mesEl, 5000);
      if (!textarea) {
        toastWarn('编辑器未出现（超时），请稍后重试。');
        return false;
      }

      // 5) textarea 出现后，再把当前编辑楼层精确对齐到楼层头部
      scrollMessageInChat(mesEl, 'start', 'auto');
      restoreWindowScrollStable(winPos);
      await sleep(32);
      scrollMessageInChat(mesEl, 'start', 'auto');
      restoreWindowScrollStable(winPos);

      // 6) 在编辑器中高亮定位，并把光标附近内容滚到 textarea 可视区中间
      if (selectionCtx?.selectedText?.trim()) {
        const raw = textarea.value;
        const ctxRaw = getRawMessageTextFromContext(targetMesId);

        const match = computeBestMatchForTextarea(raw, ctxRaw, selectionCtx);

        textarea.focus();

        if (match) {
          textarea.setSelectionRange(match.start, match.end);
          scrollTextareaToSelection(textarea, match.start, match.end);
        } else {
          // 找不到也没关系：至少打开编辑器并聚焦
          scrollTextareaToSelection(textarea);
          toastInfo('已打开编辑器，但未能在原文中匹配到你选中的显示文本（可能被正则/HTML 渲染改写）。可尝试重新选择更长的片段/包含前后更多文字。');
        }
      } else {
        textarea.focus();
        scrollTextareaToSelection(textarea);
      }

      quickEditState = {
        mesId: targetMesId,
        scrollTop,
        scrollEl,
        selectionCtx,
        detachOutside: null,
        monitorTimer: null,
      };

      attachQuickEditOutsideListener();

      // 监控：如果用户用酒馆自带按钮关闭编辑器，也要同步清状态
      quickEditState.monitorTimer = setInterval(() => {
        if (!quickEditState) return;
        if (!getCurrentEditTextarea()) {
          const st = quickEditState;
          clearQuickEditState();
          // 用户可能点了酒馆自带“完成”按钮：同样归位
          if (st?.scrollEl && typeof st.scrollTop === 'number' && Number.isFinite(st.scrollTop)) {
            try {
              st.scrollEl.scrollTo({ top: st.scrollTop, behavior: 'auto' });
            } catch {
              st.scrollEl.scrollTop = st.scrollTop;
            }
          }
        }
      }, 400);

      const root = document.getElementById(ROOT_ID);
      if (root) updateQuickEditButton(root);

      return true;
    } finally {
      quickEditBusy = false;
    }
  }

  async function quickEditSave() {
    if (quickEditBusy) return false;
    if (!quickEditState) return false;
    quickEditBusy = true;
    try {
      const mesEl = document.querySelector(`#chat .mes[mesid="${quickEditState.mesId}"]`);
      if (!mesEl) {
        clearQuickEditState();
        return false;
      }

      if (!clickMessageDoneButton(mesEl)) {
        // 可能编辑器已被用户关闭
        clearQuickEditState();
        return false;
      }

      const scrollEl = quickEditState.scrollEl;
      const restoreTop = quickEditState.scrollTop;

      // 等待编辑器关闭后再“归位”，避免被酒馆的 DOM 更新打断
      const start = Date.now();
      while (Date.now() - start < 2000) {
        if (!getCurrentEditTextarea()) break;
        // eslint-disable-next-line no-await-in-loop
        await sleep(50);
      }

      clearQuickEditState();

      if (scrollEl && typeof restoreTop === 'number' && Number.isFinite(restoreTop)) {
        try {
          scrollEl.scrollTo({ top: restoreTop, behavior: 'auto' });
        } catch {
          scrollEl.scrollTop = restoreTop;
        }
      }

      return true;
    } finally {
      quickEditBusy = false;
    }
  }

  async function handleQuickEditAction() {
    // 二段式：未在编辑 -> 打开；已在编辑 -> 保存
    if (quickEditState && getCurrentEditTextarea()) {
      return quickEditSave();
    }
    return quickEditOpen();
  }

  function formatRangeText(range) {
    if (!range) return '-';
    return `${range.start}-${range.end}`;
  }

  function updateRangeButtons(root) {
    const rangeBtn = root.querySelector('.stcj-btn[data-action="showRange"]');
    const resetBtn = root.querySelector('.stcj-btn[data-action="resetRange"]');
    const editBtn = root.querySelector('.stcj-range-chip-main[data-action="editRange"]');
    const rangePrevBtn = root.querySelector('.stcj-btn[data-action="rangePrev"]');
    const rangeNextBtn = root.querySelector('.stcj-btn[data-action="rangeNext"]');
    const rangeStack = root.querySelector('.stcj-range-stack');
    const rangeChip = root.querySelector('.stcj-range-chip');
    const rangeLabel = root.querySelector('.stcj-range-chip-label');
    const rangeValue = root.querySelector('.stcj-range-chip-value');
    const isActive = !!activeRange;
    const currentText = formatRangeText(activeRange);

    root.classList.toggle('stcj-range-active', isActive);

    if (rangeChip) {
      rangeChip.classList.toggle('stcj-show', isActive);
      rangeChip.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      rangeChip.classList.toggle('stcj-disabled', !isActive);
    }

    if (rangeStack) {
      rangeStack.classList.toggle('stcj-show', isActive);
      rangeStack.classList.toggle('stcj-hidden', !isActive);
      rangeStack.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    }

    if (rangeValue) rangeValue.textContent = currentText;

    if (rangeBtn) {
      rangeBtn.title = isActive
        ? `跳转/区间显示（当前：${currentText}）`
        : '跳转/区间显示（输入楼层号或区间）';
      rangeBtn.classList.toggle('stcj-hidden', isActive);
    }

    if (resetBtn) {
      resetBtn.classList.toggle('stcj-hidden', !isActive);
      resetBtn.classList.toggle('stcj-disabled', !isActive);
      resetBtn.title = isActive
        ? `恢复默认聊天视图（当前：${currentText}）`
        : '当前已是默认聊天视图';
    }

    if (editBtn) {
      editBtn.classList.toggle('stcj-disabled', !isActive);
      editBtn.title = isActive ? `修改当前区间（${currentText}）` : '需先显示区间后才能修改';
    }

    if (rangeLabel) {
      rangeLabel.title = isActive ? `修改当前区间（${currentText}）` : '需先显示区间后才能修改';
    }

    // 区间导航按钮：根据是否到达边界来设置禁用状态
    if (rangePrevBtn) {
      const atStart = !isActive || (activeRange && activeRange.start <= 0);
      rangePrevBtn.classList.toggle('stcj-disabled', !!atStart);
      rangePrevBtn.title = isActive
        ? (atStart ? '已经是最早的楼层了' : '向前扩展区间')
        : '需先显示区间';
    }

    if (rangeNextBtn) {
      let atEnd = !isActive;
      if (isActive) {
        try {
          const ctx = window.SillyTavern?.getContext?.();
          const maxId = Array.isArray(ctx?.chat) ? ctx.chat.length - 1 : activeRange.end;
          atEnd = activeRange.end >= maxId;
        } catch {
          atEnd = false;
        }
      }
      rangeNextBtn.classList.toggle('stcj-disabled', !!atEnd);
      rangeNextBtn.title = isActive
        ? (atEnd ? '已经是最新的楼层了' : '向后扩展区间')
        : '需先显示区间';
    }
  }

  function setActiveRange(range) {
    activeRange = range;

    const root = document.getElementById(ROOT_ID);
    if (root) updateRangeButtons(root);
  }

  function parseRangeInput(raw, maxId) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim().replace(/\s+/g, '');

    // 支持单数字输入：跳转到该楼层，展示前后 N 层（N = rangeContext 设置值）
    const singleMatch = trimmed.match(/^(\d+)$/);
    if (singleMatch) {
      const target = Number(singleMatch[1]);
      if (!Number.isInteger(target) || target < 0 || target > maxId) return null;
      const ctx = getRangeContext();
      const start = Math.max(0, target - ctx);
      const end = Math.min(maxId, target + ctx);
      return { start, end, jumpTo: target };
    }

    // 区间格式：a-b
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (!rangeMatch) return null;
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 0 || start > end || end > maxId) return null;
    return { start, end };
  }

  async function showRangePrompt(maxId) {
    const ctxN = getRangeContext();
    const totalFloors = maxId + 1;
    let tip = `共 ${totalFloors} 楼（0-${maxId}）`;
    if (activeRange) {
      tip += `，当前显示：${activeRange.start}-${activeRange.end}`;
    }
    tip += `\n输入楼层号跳转（前后各${ctxN}层）或区间如 0-10`;
    const defaultValue = activeRange
      ? `${activeRange.start}-${activeRange.end}`
      : `${Math.max(0, maxId)}`;

    let value = null;

    try {
      if (typeof window.SillyTavern?.callGenericPopup === 'function') {
        value = await window.SillyTavern.callGenericPopup(tip, window.SillyTavern?.POPUP_TYPE?.INPUT);
      }
    } catch {
      value = null;
    }

    if (typeof value !== 'string') {
      value = window.prompt(tip, defaultValue);
    }

    if (typeof value !== 'string') return null;
    return value.trim();
  }

  async function showFloorRange(rawInput = null) {
    const ctx = window.SillyTavern?.getContext?.();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : null;
    const chatEl = getChatContainer();

    if (!chat || !chatEl || chat.length === 0) {
      toastWarn('当前聊天为空，无法按区间显示。');
      return false;
    }

    const maxId = chat.length - 1;
    const input = typeof rawInput === 'string' ? rawInput.trim() : await showRangePrompt(maxId);
    if (!input) {
      if (typeof rawInput !== 'string') {
        toastInfo('已取消。');
      }
      return false;
    }

    const range = parseRangeInput(input, maxId);
    if (!range) {
      toastError(`输入无效（请输入 0-${maxId} 范围内的楼层号或区间如 a-b）。`);
      return false;
    }

    if (typeof ctx.addOneMessage !== 'function') {
      toastError('当前环境不支持 addOneMessage，无法显示区间。');
      return false;
    }

    chatEl.replaceChildren();
    for (let i = range.start; i <= range.end; i++) {
      ctx.addOneMessage(chat[i], { forceId: i });
    }

    setActiveRange(range);

    // 如果是单数字跳转模式，滚动到目标楼层
    if (typeof range.jumpTo === 'number') {
      // 等待 DOM 渲染完成
      await sleep(50);
      const targetEl = await waitForMessageElement(range.jumpTo, 2000);
      if (targetEl) {
        const winPos = captureWindowScroll();
        scrollMessageInChat(targetEl, 'start', 'auto');
        restoreWindowScrollStable(winPos);
        // 二次对齐：确保渲染稳定后精确到顶部
        await sleep(50);
        scrollMessageInChat(targetEl, 'start', 'auto');
        restoreWindowScrollStable(winPos);
        flashMessage(targetEl);
      } else {
        getChatScrollElement()?.scrollTo?.({ top: 0, behavior: 'auto' });
      }
      toastSuccess(`已跳转到第 ${range.jumpTo} 楼（显示区间：${range.start}-${range.end}）`);
    } else {
      getChatScrollElement()?.scrollTo?.({ top: 0, behavior: 'auto' });
      toastSuccess(`已显示楼层区间：${range.start}-${range.end}`);
    }

    return true;
  }

  async function restoreDefaultRangeView() {
    if (!activeRange) {
      toastInfo('当前已是默认聊天视图。');
      return true;
    }
    const previousRange = activeRange ? { ...activeRange } : null;

    // 若当前区间本身已经覆盖整段聊天，则无需 reload，直接退出“区间模式”即可。
    // 这能解决小聊天里（如总共 0-5 楼，跳转 5 仍显示 0-5）点击“恢复”看起来没反应的问题。
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const maxId = Array.isArray(ctx?.chat) && ctx.chat.length > 0 ? ctx.chat.length - 1 : null;
      if (typeof maxId === 'number' && activeRange.start <= 0 && activeRange.end >= maxId) {
        setActiveRange(null);
        toastSuccess('已恢复默认视图');
        return true;
      }
    } catch {
      /* ignore */
    }

    try {
      // 先同步悬浮条 UI，避免聊天内容已恢复但按钮状态还滞后一段时间。
      setActiveRange(null);

      if (typeof window.SillyTavern?.reloadCurrentChat === 'function') {
        await window.SillyTavern.reloadCurrentChat();
      } else if (typeof window.SillyTavern?.getContext === 'function') {
        const ctx = window.SillyTavern?.getContext?.();
        if (typeof ctx?.reloadCurrentChat === 'function') {
          await ctx.reloadCurrentChat();
        } else {
          toastError('当前环境不支持恢复默认聊天视图。');
          return false;
        }
      } else {
        toastError('当前环境不支持恢复默认聊天视图。');
        if (previousRange) setActiveRange(previousRange);
        return false;
      }
      toastSuccess('已恢复默认聊天视图。');
      return true;
    } catch (e) {
      if (previousRange) setActiveRange(previousRange);
      log('恢复默认聊天视图失败', e);
      toastError('恢复默认聊天视图失败，请稍后重试。');
      return false;
    }
  }

  /**
   * 区间翻页：
   * - expand: 增量扩展（next 扩 end，prev 扩 start）
   * - shift: 平移窗口（保持区间长度不变）
   * 步长 = 用户自定义的 rangeStep（默认 10），模式 = 用户设置。
   */
  async function shiftFloorRange(direction) {
    if (!activeRange) {
      toastWarn('当前没有激活的楼层区间。');
      return false;
    }

    const ctx = window.SillyTavern?.getContext?.();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : null;
    const chatEl = getChatContainer();
    if (!chat || !chatEl || chat.length === 0) {
      toastWarn('当前聊天为空。');
      return false;
    }

    const maxId = chat.length - 1;
    const step = Math.max(1, getRangeStep());
    const rangeSize = activeRange.end - activeRange.start + 1;
    const pagingMode = getRangePagingMode();

    let newStart, newEnd;

    if (direction === 'next') {
      if (activeRange.end >= maxId) {
        toastInfo('已经是最新的楼层了。');
        return false;
      }

      if (pagingMode === 'shift') {
        newStart = Math.min(activeRange.start + step, maxId);
        newEnd = Math.min(newStart + rangeSize - 1, maxId);
        newStart = Math.max(0, newEnd - rangeSize + 1);
      } else {
        newStart = activeRange.start;
        newEnd = Math.min(activeRange.end + step, maxId);
      }
    } else {
      if (activeRange.start <= 0) {
        toastInfo('已经是最早的楼层了。');
        return false;
      }

      if (pagingMode === 'shift') {
        newEnd = Math.max(activeRange.end - step, 0);
        newStart = Math.max(newEnd - rangeSize + 1, 0);
        newEnd = Math.min(maxId, newStart + rangeSize - 1);
      } else {
        newStart = Math.max(activeRange.start - step, 0);
        newEnd = activeRange.end;
      }
    }

    if (newStart === activeRange.start && newEnd === activeRange.end) {
      toastInfo('当前区间无需变化。');
      return false;
    }

    if (typeof ctx.addOneMessage !== 'function') {
      toastError('当前环境不支持 addOneMessage，无法切换区间。');
      return false;
    }

    // 记住当前阅读位置：锚点楼层 + 它相对视口顶部的像素偏移
    const anchorState = captureViewportAnchor();
    const winPos = captureWindowScroll();

    chatEl.replaceChildren();
    for (let i = newStart; i <= newEnd; i++) {
      ctx.addOneMessage(chat[i], { forceId: i });
    }

    const range = { start: newStart, end: newEnd };
    setActiveRange(range);

    // 扩展模式下，原阅读位置必然还在新区间内；
    // 平移模式下，如果锚点仍在新区间内，也尽量按像素保位恢复。
    if (anchorState) {
      const anchorStillVisible = anchorState.mesId >= newStart && anchorState.mesId <= newEnd;
      if (anchorStillVisible) {
        await waitForMessageElement(anchorState.mesId, 1000);
        restoreViewportAnchor(anchorState);
        restoreWindowScrollStable(winPos);
        await sleep(32);
        restoreViewportAnchor(anchorState);
        restoreWindowScrollStable(winPos);
      } else {
        // 平移模式且锚点移出新区间：退化为把新区间边界对齐到头部，避免跳到奇怪的位置
        const fallbackId = direction === 'next' ? newStart : newEnd;
        const fallbackEl = await waitForMessageElement(fallbackId, 1000);
        if (fallbackEl) {
          scrollMessageInChat(fallbackEl, 'start', 'auto');
          restoreWindowScrollStable(winPos);
        } else {
          const se = getChatScrollElement();
          if (se) {
            se.scrollTo?.({ top: direction === 'next' ? 0 : se.scrollHeight, behavior: 'auto' });
            restoreWindowScrollStable(winPos);
          }
        }
      }
    }

    toastSuccess(`已切换区间：${newStart}-${newEnd}（${formatRangePagingModeLabel(pagingMode)}模式）`);
    return true;
  }

  async function handleAction(action) {
    const lastId = getLastMessageId();

    switch (action) {
      // 最近 3 楼：统一跳到“头部”
      case 'recent3':
        return jumpToMessage(lastId - 2, 'start');
      case 'recent2':
        return jumpToMessage(lastId - 1, 'start');
      case 'recent1':
        return jumpToMessage(lastId, 'start');
      case 'quickPage':
        return quickFlipLatestMessagePage('right');
      case 'quickPageLeft':
        return quickFlipLatestMessagePage('left');

      // 收起/展开
      case 'toggleCollapse':
        toggleCollapse();
        return;

      // 楼层区间显示 / 恢复默认
      case 'showRange':
        return showFloorRange();
      case 'rangePrev':
        return shiftFloorRange('prev');
      case 'rangeNext':
        return shiftFloorRange('next');
      case 'resetRange':
        return restoreDefaultRangeView();
      case 'editRange':
        return showFloorRange();

      // 布局切换
      case 'toggleOrientation':
        toggleOrientation();
        return;

      // 收藏：打开面板并进入点选
      case 'togglePin':
        togglePinMode();
        return;

      case 'openFavoritesManager':
        openFavoritesManager();
        return;

      // 最近收藏：展开/收起
      case 'toggleFavPanel':
        setFavPanelOpen(!favPanelOpen);
        return;

      // 上一楼/下一楼：跳到“头部”
      case 'prev': {
        const anchor = getAnchorMesId();
        return jumpToMessage(anchor - 1, 'start');
      }
      case 'next': {
        const anchor = getAnchorMesId();
        return jumpToMessage(anchor + 1, 'start');
      }

      // H/L：对齐“当前楼层”的头部/尾部
      case 'currentHead': {
        const anchor = getAnchorMesId();
        return jumpToMessage(anchor, 'start');
      }
      case 'currentTail': {
        const anchor = getAnchorMesId();
        return jumpToMessage(anchor, 'end');
      }

      // ✏️ 快速编辑（选中内容可高亮定位）
      case 'quickEdit':
        return handleQuickEditAction();

      default:
        return;
    }
  }

  function updateOrientationToggleButton(root) {
    const btn = root.querySelector('.stcj-btn[data-action="toggleOrientation"]');
    if (!btn) return;

    const isHorizontal = settings.orientation === 'horizontal';
    setIcon(btn, isHorizontal ? 'vertical' : 'horizontal');
    btn.title = isHorizontal ? '切换为竖向布局' : '切换为横向布局';
  }

  function updateCollapseToggleButton(root) {
    const btn = root.querySelector('.stcj-btn[data-action="toggleCollapse"]');
    if (!btn) return;

    const collapsed = !!settings.collapsed;
    setIcon(btn, collapsed ? 'plus' : 'minus');
    btn.title = collapsed ? '展开跳转栏' : '收起跳转栏';
  }

  function updatePrevNextButtons(root) {
    const prev = root.querySelector('.stcj-btn[data-action="prev"]');
    const next = root.querySelector('.stcj-btn[data-action="next"]');
    if (!prev || !next) return;

    const isVertical = settings.orientation === 'vertical';
    setIcon(prev, isVertical ? 'chevronUp' : 'chevronLeft');
    setIcon(next, isVertical ? 'chevronDown' : 'chevronRight');
  }

  function updateFavPanelToggleButton(root) {
    const btn = root.querySelector('.stcj-btn[data-action="toggleFavPanel"]');
    if (!btn) return;

    setIcon(btn, favPanelOpen ? 'chevronDown' : 'chevronRight');
    btn.title = favPanelOpen ? '收起最近收藏' : '展开最近收藏';
  }

  function formatFloorLabel(mesId) {
    // SillyTavern 的楼层/mesid 从 0 开始
    return `第 ${mesId} 楼`;
  }

  function normalizeFavoriteSwipeIndex(value) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(-1, Math.trunc(num)) : -1;
  }

  function formatFavoriteSwipeLabel(swipeIndex) {
    const idx = normalizeFavoriteSwipeIndex(swipeIndex);
    return idx >= 0 ? `分支 ${idx + 1}` : '';
  }

  function formatFavoriteSwipeBadgeLabel(swipeIndex) {
    const idx = normalizeFavoriteSwipeIndex(swipeIndex);
    return idx >= 0 ? `S${idx + 1}` : '';
  }

  function buildFavoriteSwipeBadgeHtml(swipeIndex) {
    const badge = formatFavoriteSwipeBadgeLabel(swipeIndex);
    if (!badge) return '';
    return `<span class="stcj-swipe-badge" title="${escapeHtml(formatFavoriteSwipeLabel(swipeIndex))}">${escapeHtml(badge)}</span>`;
  }

  function normalizeFavoriteText(value) {
    return String(value ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function computeTextHash(text) {
    const source = String(text ?? '');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatFavoriteTimestamp(value) {
    if (value == null || value === '') return '时间未知';
    try {
      const num = Number(value);
      const date = new Date(Number.isFinite(num) ? num : value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    } catch {
      return String(value);
    }
  }

  function renderFavoriteMarkdownFallback(text) {
    const codeBlocks = [];
    const source = String(text ?? '').replace(/\r\n?/g, '\n');
    let html = escapeHtml(source);

    html = html.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const token = `@@STCJCODEBLOCK${codeBlocks.length}@@`;
      const safeLang = lang ? `<div class="stcj-md-code-lang">${escapeHtml(lang)}</div>` : '';
      codeBlocks.push(`<pre class="stcj-md-code-block">${safeLang}<code>${code}</code></pre>`);
      return token;
    });

    html = html
      .replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>');

    html = html
      .split(/\n{2,}/)
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (/^@@STCJCODEBLOCK\d+@@$/.test(trimmed)) return trimmed;
        if (trimmed.startsWith('<blockquote>')) return trimmed.replace(/\n/g, '<br>');
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');

    codeBlocks.forEach((block, index) => {
      html = html.replace(`@@STCJCODEBLOCK${index}@@`, block);
    });

    return html || '<p class="stcj-empty-copy">无内容</p>';
  }

  function renderFavoriteMarkdown(text) {
    const raw = String(text ?? '');
    try {
      if (typeof window.marked?.parse === 'function') {
        return window.marked.parse(raw, { breaks: true });
      }
    } catch {
      /* ignore */
    }
    return renderFavoriteMarkdownFallback(raw);
  }

  function normalizeFavoritePreviewMode(mode) {
    return FAVORITES_PREVIEW_MODE_ORDER.includes(mode) ? mode : FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT;
  }

  function getFavoritePreviewModeLabel(mode) {
    switch (normalizeFavoritePreviewMode(mode)) {
      case FAVORITES_PREVIEW_MODES.SWIPE_HTML:
        return '轻前端';
      case FAVORITES_PREVIEW_MODES.STAR_MAIN:
        return '全前端';
      default:
        return '文本';
    }
  }

  function buildFavoritePreviewModeSwitchHtml() {
    const mode = normalizeFavoritePreviewMode(favoritesPreviewMode);
    return `
      <div class="stcj-pill-switch stcj-preview-mode-switch is-${mode}">
        <span class="stcj-pill-switch-thumb"></span>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesPreviewMode" data-preview-mode="${FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT}" title="纯文本预览，最快最稳">文本</button>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesPreviewMode" data-preview-mode="${FAVORITES_PREVIEW_MODES.SWIPE_HTML}" title="轻量前端渲染，适合简单页面">轻前端</button>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesPreviewMode" data-preview-mode="${FAVORITES_PREVIEW_MODES.STAR_MAIN}" title="完整前端渲染，效果最丰富">全前端</button>
      </div>
    `;
  }

  function normalizeFavoriteSortMode(mode) {
    return ['floor_asc', 'floor_desc', 'created_desc'].includes(mode) ? mode : 'floor_asc';
  }

  function buildFavoriteSortModeSwitchHtml() {
    const mode = normalizeFavoriteSortMode(favoritesModalSort);
    return `
      <div class="stcj-pill-switch stcj-sort-mode-switch is-${mode}">
        <span class="stcj-pill-switch-thumb"></span>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesSortMode" data-sort-mode="floor_asc">顺序</button>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesSortMode" data-sort-mode="floor_desc">倒序</button>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesSortMode" data-sort-mode="created_desc">收藏顺序</button>
      </div>`;
  }

  function isFavoritesModalMobileLayout() {
    try {
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia(`(max-width: ${FAVORITES_MODAL_DRAWER_BREAKPOINT}px)`).matches;
      }
    } catch {
      /* ignore */
    }
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    return viewportWidth <= FAVORITES_MODAL_DRAWER_BREAKPOINT;
  }

  function updateFavoritesSidebarToggleButton(modal, isMobile = isFavoritesModalMobileLayout()) {
    const button = modal?.querySelector('.stcj-modal-sidebar-toggle');
    if (!button) return;
    const isOpen = isMobile ? favoritesSidebarDrawerOpen : !favoritesSidebarCollapsed;
    const label = isOpen ? '收起' : '展开';
    button.setAttribute('title', isMobile ? `${label}抽屉` : label);
    button.setAttribute('aria-label', isMobile ? `${label}抽屉` : label);
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    button.innerHTML = `${getIcon(isOpen ? 'sidebarCollapse' : 'sidebarExpand')}<span class="stcj-modal-sidebar-toggle-label">${label}</span>`;
  }

  function formatFavoritesModalSubtitle(text, isMobile = isFavoritesModalMobileLayout()) {
    const raw = String(text || '当前聊天');
    if (!isMobile) return raw;
    const chars = Array.from(raw);
    if (chars.length <= 16) return raw;
    return `…${chars.slice(-16).join('')}`;
  }

  function updateFavoritesModalSubtitle(modal, fullText) {
    const subtitleEl = modal?.querySelector('.stcj-modal-subtitle');
    const mobileSubtitleEl = modal?.querySelector('.stcj-modal-sidebar-mobile-subtitle');
    const raw = String(fullText || subtitleEl?.dataset.fullTitle || mobileSubtitleEl?.dataset.fullTitle || '当前聊天');
    if (!subtitleEl) return;
    subtitleEl.dataset.fullTitle = raw;
    subtitleEl.textContent = formatFavoritesModalSubtitle(raw);
    subtitleEl.title = raw;
    if (mobileSubtitleEl) {
      mobileSubtitleEl.dataset.fullTitle = raw;
      mobileSubtitleEl.textContent = formatFavoritesModalSubtitle(raw);
      mobileSubtitleEl.title = raw;
    }
  }

  function syncFavoritesSidebarState(modal) {
    if (!modal) return;
    const isMobile = isFavoritesModalMobileLayout();
    if (!isMobile) favoritesSidebarDrawerOpen = false;
    modal.classList.toggle('stcj-modal-mobile-layout', isMobile);
    modal.classList.toggle('is-sidebar-collapsed', !isMobile && favoritesSidebarCollapsed);
    modal.classList.toggle('is-sidebar-drawer-open', !!(isMobile && favoritesSidebarDrawerOpen));
    updateFavoritesSidebarToggleButton(modal, isMobile);
    updateFavoritesModalSubtitle(modal);
  }

  function toggleFavoritesSidebar(modal) {
    if (isFavoritesModalMobileLayout()) {
      favoritesSidebarDrawerOpen = !favoritesSidebarDrawerOpen;
    } else {
      favoritesSidebarCollapsed = !favoritesSidebarCollapsed;
    }
    syncFavoritesSidebarState(modal);
  }

  function closeFavoritesSidebarDrawer(modal) {
    favoritesSidebarDrawerOpen = false;
    syncFavoritesSidebarState(modal);
  }

  function ensureFavoritesModalResizeListener() {
    if (ensureFavoritesModalResizeListener.bound) return;
    const onResize = () => syncFavoritesSidebarState(document.getElementById(FAVORITES_MODAL_ID));
    window.addEventListener('resize', onResize);
    ensureFavoritesModalResizeListener.detach = () => window.removeEventListener('resize', onResize);
    ensureFavoritesModalResizeListener.bound = true;
  }

  function getFavoritePreviewFrameId(favoriteId) {
    return `stcj-preview-frame-${favoriteId}`;
  }

  function getMessageFormattingFn() {
    if (typeof coreMessageFormatting === 'function') return coreMessageFormatting;

    const formatter =
      window.messageFormatting ||
      globalThis.messageFormatting ||
      window.SillyTavern?.messageFormatting;
    return typeof formatter === 'function' ? formatter : null;
  }

  function applySillyTavernMessageFormatting(text, senderName, isUser, mesId) {
    const raw = String(text ?? '');
    if (!raw) return '';
    const formatter = getMessageFormattingFn();
    if (!formatter) return '';
    try {
      return String(formatter(raw, senderName || null, false, !!isUser, Number.isFinite(mesId) ? mesId : null, {}, false) || '');
    } catch {
      return '';
    }
  }

  function sanitizeHtml(html) {
    try {
      if (window.DOMPurify?.sanitize) {
        return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
      }
    } catch {
      /* ignore */
    }

    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = String(html ?? '');
      const blockedTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'];
      blockedTags.forEach((tag) => tpl.content.querySelectorAll(tag).forEach((node) => node.remove()));
      tpl.content.querySelectorAll('*').forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          const value = String(attr.value || '').trim().toLowerCase();
          if (name.startsWith('on')) el.removeAttribute(attr.name);
          if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
            el.removeAttribute(attr.name);
          }
        }
      });
      return tpl.innerHTML;
    } catch {
      return String(html ?? '');
    }
  }

  function decorateFavoriteInlineSemantics(html) {
    const raw = String(html ?? '');
    if (!raw) return '';

    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = raw;
      const skipTags = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'KBD', 'SAMP']);
      const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const value = String(node?.nodeValue || '');
          if (!value || !/[“”"『』「」*]/.test(value)) return NodeFilter.FILTER_REJECT;
          let parent = node.parentElement;
          while (parent) {
            if (skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
            parent = parent.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes = [];
      let current = walker.nextNode();
      while (current) {
        textNodes.push(current);
        current = walker.nextNode();
      }

      const tokenRe = /("[^"\n]{1,500}"|“[^”\n]{1,500}”|『[^』\n]{1,500}』|「[^」\n]{1,500}」|\*[^*\n]{1,500}\*)/g;
      textNodes.forEach((node) => {
        const text = String(node.nodeValue || '');
        tokenRe.lastIndex = 0;
        if (!tokenRe.test(text)) return;
        tokenRe.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        text.replace(tokenRe, (match, _group, offset) => {
          if (offset > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
          if (match.startsWith('*') && match.endsWith('*')) {
            const em = document.createElement('em');
            em.className = 'stcj-inline-emphasis';
            em.textContent = match.slice(1, -1);
            frag.appendChild(em);
          } else {
            const span = document.createElement('span');
            span.className = 'stcj-inline-quote';
            span.textContent = match;
            frag.appendChild(span);
          }
          lastIndex = offset + match.length;
          return match;
        });
        if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        node.parentNode?.replaceChild(frag, node);
      });
      return tpl.innerHTML;
    } catch {
      return raw;
    }
  }

  async function importFavoritesRegexEngine() {
    try {
      return await eval('import("/scripts/extensions/regex/engine.js")');
    } catch {
      return null;
    }
  }

  let favoritesRegexEnginePromise = null;
  function getFavoritesRegexEngine() {
    if (!favoritesRegexEnginePromise) favoritesRegexEnginePromise = importFavoritesRegexEngine();
    return favoritesRegexEnginePromise;
  }

  async function applyFavoritesRegexPipeline(text, placement) {
    const raw = String(text ?? '');
    if (!raw) return '';

    const api = window.ST_API;
    if (api?.regexScript?.process) {
      try {
        const result = await api.regexScript.process({ text: raw, placement });
        return String(result?.text ?? raw);
      } catch {
        /* ignore */
      }
    }

    const engine = await getFavoritesRegexEngine();
    if (!engine?.getScriptsByType || !engine?.SCRIPT_TYPES || !engine?.runRegexScript) return raw;

    const options = { allowedOnly: true };
    const scripts = [
      ...(engine.getScriptsByType(engine.SCRIPT_TYPES.GLOBAL, options) || []),
      ...(engine.getScriptsByType(engine.SCRIPT_TYPES.SCOPED, options) || []),
      ...(engine.getScriptsByType(engine.SCRIPT_TYPES.PRESET, options) || []),
    ];

    let out = raw;
    for (const script of scripts) {
      try {
        if (!script || script.disabled || script.promptOnly) continue;
        const placements = Array.isArray(script.placement) ? script.placement : (typeof script.placement === 'number' ? [script.placement] : []);
        if (placements.length && !placements.includes(placement)) continue;
        out = engine.runRegexScript(script, out);
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  function buildFavoritePreviewSrcdoc(htmlBody, token, frameKey) {
    const body = String(htmlBody ?? '');
    const heightScript = `(() => {
      const getHeight = () => {
        const body = document.body;
        const doc = document.documentElement;
        if (!body || !doc) return 0;

        const measuredNodes = Array.from(body.children || []).filter((node) => {
          if (!node || typeof node.getBoundingClientRect !== 'function') return false;
          const style = window.getComputedStyle(node);
          if (style.position === 'fixed' || style.position === 'absolute') return false;
          return true;
        });

        let contentBottom = 0;
        for (const node of measuredNodes) {
          const rect = node.getBoundingClientRect();
          if (!rect || !Number.isFinite(rect.bottom)) continue;
          contentBottom = Math.max(contentBottom, rect.bottom);
        }

        const bodyRect = body.getBoundingClientRect();
        const visualHeight = contentBottom > 0 && Number.isFinite(bodyRect.top)
          ? Math.max(0, Math.ceil(contentBottom - bodyRect.top))
          : 0;

        return Math.max(
          visualHeight,
          Math.ceil(body.getBoundingClientRect().height || 0),
          Math.ceil(doc.getBoundingClientRect().height || 0)
        );
      };

      const send = () => {
        const h = getHeight();
        parent.postMessage({ type: 'stcj:favorites-preview-height', token: ${JSON.stringify(token)}, key: ${JSON.stringify(frameKey)}, height: h }, '*');
      };
      const ro = window.ResizeObserver ? new ResizeObserver(() => send()) : null;
      if (ro) ro.observe(document.documentElement);
      if (ro && document.body) ro.observe(document.body);
      const mo = new MutationObserver(() => send());
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      window.addEventListener('load', send);
      setTimeout(send, 0); setTimeout(send, 50); setTimeout(send, 200); setTimeout(send, 500);
    })();`;
    return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>:root{color-scheme:dark;scrollbar-color:rgba(255,255,255,0.20) transparent;scrollbar-width:thin;}html,body{overflow-x:hidden;scrollbar-color:rgba(255,255,255,0.20) transparent;scrollbar-width:thin;}body{margin:0;padding:12px;font-family:var(--main-font,sans-serif);background:#111;color:#d4d4d4;line-height:1.6;}body::-webkit-scrollbar,pre::-webkit-scrollbar{width:8px;height:8px;}body::-webkit-scrollbar-track,pre::-webkit-scrollbar-track{background:transparent;}body::-webkit-scrollbar-thumb,pre::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:999px;border:2px solid transparent;background-clip:padding-box;}body::-webkit-scrollbar-thumb:hover,pre::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.28);border:2px solid transparent;background-clip:padding-box;}img{max-width:100%;height:auto;}em,i,.stcj-inline-emphasis{color:#ffb55e;}u,ins{color:#4fc1ff;text-decoration-color:rgba(79,193,255,0.85);text-decoration-thickness:1.5px;text-underline-offset:2px;}.stcj-inline-quote{color:#58b6ff;}strong,b{color:#dcdcaa;}pre{overflow-x:hidden;overflow-y:auto;padding:8px 10px;background:#1e1e1e;border:1px solid #2d2d30;border-radius:8px;margin:6px 0;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:0.95em;color:#d4d4d4;box-shadow:inset 0 1px 0 rgba(255,255,255,0.02);}code{color:#ce9178;background:rgba(110,118,129,0.18);padding:0 4px;border-radius:4px;border:1px solid rgba(110,118,129,0.18);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;}pre code{color:inherit;background:transparent;padding:0;border:none;border-radius:0;}a{color:#3794ff;text-decoration-color:rgba(55,148,255,0.72);text-underline-offset:2px;}a:hover{color:#4daafc;}table{border-collapse:collapse;}th,td{border:1px solid rgba(255,255,255,0.15);padding:6px 8px;}blockquote{border-left:3px solid #58b6ff;margin:8px 0;padding:10px 0 10px 12px;background:rgba(45,56,74,0.50);color:#b9e3ff;border-radius:0 10px 10px 0;}.stcj-preview-reasoning{margin:0 0 12px;border:1px solid rgba(88,182,255,0.18);background:rgba(37,37,38,0.92);}.stcj-preview-reasoning > summary{cursor:pointer;color:#c8dff5;font-weight:600;}.stcj-preview-reasoning-body{margin-top:8px;color:#d4d4d4;}</style><script>${heightScript}</script></head><body>${body}</body></html>`;
  }

  function ensureFavoritesPreviewMessageListener() {
    if (favoritesPreviewMessageListenerAttached) return;
    const onPreviewMessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== 'stcj:favorites-preview-height') return;
      if (data.token !== favoritesPreviewIframeToken) return;
      const frame = document.getElementById(getFavoritePreviewFrameId(data.key));
      if (!frame) return;
      const height = Math.max(96, Math.round(Number(data.height) || 0));
      frame.style.height = `${height}px`;
    };
    window.addEventListener('message', onPreviewMessage);
    ensureFavoritesPreviewMessageListener.detach = () => {
      try { window.removeEventListener('message', onPreviewMessage); } catch { /* ignore */ }
    };
    favoritesPreviewMessageListenerAttached = true;
  }

  async function prepareFavoritePreviewPayload(item, resolution) {
    const message = resolution.status === 'missing' ? null : resolution.message;
    const mesId = resolution.status === 'missing' ? item.messageId : resolution.mesId;
    const snapshot = resolution.status === 'missing' ? null : resolveFavoriteMessageSnapshot(item, message);
    const senderName = item.sender || message?.name || '未知发送者';
    const isUser = !!message?.is_user;
    const originalText = resolution.status === 'missing'
      ? (item.previewText || '')
      : String(snapshot?.matched ? snapshot.text : (item.previewText || snapshot?.text || ''));
    const originalReasoning = resolution.status === 'missing' || !snapshot?.matched
      ? ''
      : String(snapshot.reasoning || '');
    const rawText = await applyFavoritesRegexPipeline(originalText, 2);
    const reasoningRaw = await applyFavoritesRegexPipeline(originalReasoning, 6);
    const formattedHtml = applySillyTavernMessageFormatting(rawText, senderName, isUser, mesId);
    const reasoningHtml = reasoningRaw ? applySillyTavernMessageFormatting(reasoningRaw, null, false, null) : '';
    const processedPreviewHtml = formattedHtml
      ? decorateFavoriteInlineSemantics(sanitizeHtml(formattedHtml))
      : (rawText ? decorateFavoriteInlineSemantics(renderFavoriteMarkdown(rawText)) : '<div class="stcj-empty-copy">原消息内容不可用。</div>');
    const processedReasoningHtml = reasoningHtml ? decorateFavoriteInlineSemantics(sanitizeHtml(reasoningHtml)) : '';
    return {
      rawText,
      formattedHtml,
      reasoningRaw,
      reasoningHtml,
      processedPreviewHtml,
      processedReasoningHtml,
      senderName,
      isUser,
      swipeIndex: snapshot?.swipeIndex ?? normalizeFavoriteSwipeIndex(item?.swipeIndex),
      swipeMissing: !!snapshot?.swipeMissing,
      mesId,
      deleted: resolution.status === 'missing' || !!snapshot?.swipeMissing,
    };
  }

  function buildFavoriteReasoningBlock(html, className = 'stcj-preview-reasoning') {
    if (!html) return '';
    return `<details class="${className}"><summary>思考了一会</summary><div class="${className}-body">${html}</div></details>`;
  }

  function renderFavoritePreviewMarkupByMode(mode, item, payload) {

    if (mode === FAVORITES_PREVIEW_MODES.SWIPE_HTML) {
      return {
        html: `<iframe class="stcj-preview-iframe" id="${getFavoritePreviewFrameId(item.id)}" data-preview-frame-key="${item.id}" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe>`,
        payload,
      };
    }

    if (mode === FAVORITES_PREVIEW_MODES.STAR_MAIN) {
      const reasoningBlock = payload.processedReasoningHtml
        ? `<details class="fav-reasoning-details"><summary class="fav-reasoning-summary"><span>思考了一会</span><i class="fa-solid fa-chevron-down reasoning-arrow"></i></summary><div class="fav-reasoning-content">${payload.processedReasoningHtml}</div></details>`
        : '';
      const previewBody = payload.processedPreviewHtml;
      return {
        html: `<div class="stcj-star-preview favorite-item ${payload.isUser ? 'role-user' : 'role-ai'}">${reasoningBlock}<div class="fav-preview ${payload.deleted ? 'deleted' : ''}">${previewBody}</div></div>`,
        payload,
      };
    }

    const reasoningBlock = buildFavoriteReasoningBlock(payload.processedReasoningHtml);
    const previewBody = payload.processedPreviewHtml;
    return {
      html: `<div class="stcj-swipe-preview-default">${reasoningBlock}${previewBody || '<div class="stcj-empty-copy">原消息内容不可用。</div>'}</div>`,
      payload,
    };
  }

  function ensureFavoritesDetailShell(mainList) {
    if (!mainList) return null;
    let preview = mainList.querySelector('.stcj-modal-detail-preview');
    if (!preview) {
      mainList.innerHTML = '<div class="stcj-modal-detail-preview prose"></div>';
      preview = mainList.querySelector('.stcj-modal-detail-preview');
    }
    return {
      preview,
    };
  }

  function getFavoritesMainHeadRefs(modal) {
    return {
      title: modal?.querySelector('.stcj-modal-main-title'),
      note: modal?.querySelector('.stcj-modal-main-note'),
      actionButtons: modal?.querySelectorAll('.stcj-modal-main-actions [data-fav-id]'),
    };
  }

  function setFavoritesSidebarActiveState(modal, favoriteId) {
    modal?.querySelectorAll?.('.stcj-modal-sidebar-item[data-fav-id]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-fav-id') === favoriteId);
    });
  }

  function setFavoriteDetailPreviewLoading(modal) {
    const mainList = modal?.querySelector('.stcj-modal-main-list');
    const refs = ensureFavoritesDetailShell(mainList);
    const previewEl = refs?.preview;
    if (!previewEl) return;
    previewEl.classList.add('is-loading');
    previewEl.scrollTop = 0;
    previewEl.innerHTML = `
      <div class="stcj-preview-skeleton" aria-hidden="true">
        <span class="stcj-preview-skeleton-line short"></span>
        <span class="stcj-preview-skeleton-line"></span>
        <span class="stcj-preview-skeleton-line"></span>
        <span class="stcj-preview-skeleton-line medium"></span>
        <span class="stcj-preview-skeleton-block"></span>
      </div>
    `;
  }

  function renderFavoritesSidebarList(modal, detailEntries) {
    const sidebarList = modal?.querySelector('.stcj-modal-sidebar-list');
    if (!sidebarList) return;

    if (!detailEntries.length) {
      sidebarList.innerHTML = '<div class="stcj-modal-empty">当前聊天还没有收藏。</div>';
      return;
    }

    const sidebarEntries = sortFavoriteItems(detailEntries, favoritesModalSort);
    sidebarList.innerHTML = sidebarEntries.map((entry, index) => {
      const snapshot = getFavoriteResolvedSnapshot(entry.item, entry.resolution);
      const floor = entry.resolution.status === 'missing' ? '未定位' : formatFloorLabel(entry.resolution.mesId);
      const swipeIndex = getFavoriteResolvedSwipeIndex(entry.item, entry.resolution);
      const summary = escapeHtml(getFavoriteListSummary(entry.item));
      const currentBranchBadge = buildFavoriteCurrentBranchBadgeHtml(entry.item, entry.resolution, detailEntries);
      const active = entry.item.id === favoritesModalActiveId ? 'is-active' : '';
      const status = getFavoriteStatusLabel(entry.resolution.status, snapshot);
      const statusHtml = status ? `<span class="stcj-modal-sidebar-status" title="${escapeHtml(getFavoriteStatusDescription(entry.resolution.status, snapshot) || status)}">${escapeHtml(status)}</span>` : '';
      return `
        <button class="stcj-modal-sidebar-item ${active}" data-action="focusFavoriteCard" data-fav-id="${entry.item.id}">
          <span class="stcj-modal-sidebar-copy">
            <span class="stcj-modal-sidebar-topline">
              <span class="stcj-modal-order">${index + 1}</span>
              <span class="stcj-modal-sidebar-floor">${escapeHtml(floor)}${buildFavoriteSwipeBadgeHtml(swipeIndex)}${currentBranchBadge}</span>
            </span>
            <span class="stcj-modal-sidebar-summary">${summary || '无备注'}</span>
          </span>
          ${statusHtml}
        </button>
      `;
    }).join('');
  }

  function hydrateFavoritePreviewByMode(mode, container, previewEntries) {
    if (!container) return;
    ensureFavoritesPreviewMessageListener();

    if (mode === FAVORITES_PREVIEW_MODES.SWIPE_HTML) {
      previewEntries.forEach(({ entry, previewResult }) => {
        const frame = document.getElementById(getFavoritePreviewFrameId(entry.item.id));
        if (!frame) return;
        const payload = previewResult.payload;
        const reasoningBlock = buildFavoriteReasoningBlock(payload.processedReasoningHtml);
        const previewBody = payload.processedPreviewHtml || '<div class="stcj-empty-copy">原消息内容不可用。</div>';
        frame.style.height = '160px';
        frame.setAttribute('srcdoc', buildFavoritePreviewSrcdoc(`${reasoningBlock}<div>${previewBody || '<div class="stcj-empty-copy">原消息内容不可用。</div>'}</div>`, favoritesPreviewIframeToken, entry.item.id));
      });
      return;
    }

    if (mode === FAVORITES_PREVIEW_MODES.STAR_MAIN) {
      container.querySelectorAll('.stcj-star-preview').forEach((el) => renderHtmlCodeIframesInElement(el));
    }
  }

  async function buildFavoritePreviewEntries(detailEntries, mode) {
    const result = [];
    for (const entry of detailEntries) {
      // eslint-disable-next-line no-await-in-loop
      const payload = await prepareFavoritePreviewPayload(entry.item, entry.resolution);
      result.push({
        entry,
        previewResult: renderFavoritePreviewMarkupByMode(mode, entry.item, payload),
      });
    }
    return result;
  }

  function renderHtmlCodeIframesInElement(container) {
    if (!container) return;
    container.querySelectorAll('pre').forEach((preEl) => {
      const codeContent = preEl.textContent || '';
      if (!codeContent.includes('<body') || !codeContent.includes('</body>')) return;
      let srcdoc = codeContent;
      const bridgeScript = `<script>(function(){try{['getContext','toastr','jQuery','$','_'].forEach(function(name){if(window.parent&&typeof window.parent[name]!=='undefined'){window[name]=window.parent[name];}});}catch(e){console.error('STCJ preview bridge error',e);}})();<\/script>`;
      const headTagMatch = srcdoc.match(/<head\s*>/i);
      if (headTagMatch) {
        const injectionPoint = headTagMatch.index + headTagMatch[0].length;
        srcdoc = srcdoc.slice(0, injectionPoint) + bridgeScript + srcdoc.slice(injectionPoint);
      } else {
        srcdoc = bridgeScript + srcdoc;
      }
      const iframe = document.createElement('iframe');
      iframe.className = 'stcj-star-inline-iframe';
      iframe.setAttribute('srcdoc', srcdoc);
      iframe.addEventListener('load', () => {
        try {
          const contentWindow = iframe.contentWindow;
          const body = contentWindow?.document?.body;
          const head = contentWindow?.document?.head;
          if (!body || !head) return;
          const style = contentWindow.document.createElement('style');
          style.innerHTML = 'body { margin: 0; overflow: hidden; }';
          head.appendChild(style);
          const updateHeight = () => { iframe.style.height = `${body.scrollHeight}px`; };
          const observer = window.ResizeObserver ? new ResizeObserver(updateHeight) : null;
          observer?.observe(body);
          updateHeight();
        } catch {
          /* ignore */
        }
      });
      preEl.replaceWith(iframe);
    });
  }


  function getCurrentChatMessages() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      return Array.isArray(ctx?.chat) ? ctx.chat : [];
    } catch {
      return [];
    }
  }

  function ensureFavoritesMetadata() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.chatMetadata || typeof ctx.chatMetadata !== 'object') return null;
      if (!Array.isArray(ctx.chatMetadata[FAVORITES_METADATA_KEY])) {
        ctx.chatMetadata[FAVORITES_METADATA_KEY] = [];
      }
      return ctx.chatMetadata;
    } catch {
      return null;
    }
  }

  function isFavoriteTextMatch(item, rawText) {
    const normalizedText = normalizeFavoriteText(rawText);
    if (!normalizedText) return false;
    const textHash = computeTextHash(normalizedText);
    if (item?.textHash && textHash === item.textHash) return true;
    if (item?.previewText) {
      const expected = normalizeFavoriteText(item.previewText).slice(0, 48);
      const actual = normalizedText.slice(0, 48);
      if (expected && actual && expected === actual) return true;
    }
    return false;
  }

  function isFavoriteMetadataMatch(item, message) {
    return !!item
      && !!message
      && item.sendDate
      && message?.send_date != null
      && String(message.send_date) === String(item.sendDate)
      && item.sender
      && String(message?.name || '') === String(item.sender || '');
  }

  function resolveFavoriteMessageSnapshot(item, message) {
    const storedSwipeIndex = normalizeFavoriteSwipeIndex(item?.swipeIndex);
    if (!message) {
      return {
        text: String(item?.previewText || ''),
        swipeIndex: storedSwipeIndex,
        matched: false,
        swipeMissing: false,
        reasoning: '',
        media: null,
      };
    }

    const baseReasoning = message?.extra?.reasoning ? String(message.extra.reasoning) : '';
    const swipeEntries = getMessageSwipeEntries(message);
    const toSnapshot = (entry, matched = true, swipeMissing = false) => ({
      text: String(entry?.text || ''),
      swipeIndex: Number.isInteger(entry?.index) ? entry.index : -1,
      matched,
      swipeMissing,
      reasoning: entry?.reasoning || baseReasoning,
      media: entry?.media ?? message?.extra?.media ?? null,
    });

    if (swipeEntries.length) {
      if (storedSwipeIndex >= 0 && storedSwipeIndex < swipeEntries.length) {
        const storedEntry = swipeEntries[storedSwipeIndex];
        if (isFavoriteTextMatch(item, storedEntry.text)) return toSnapshot(storedEntry, true, false);
      }
      const matchedEntry = swipeEntries.find((entry) => isFavoriteTextMatch(item, entry.text));
      if (matchedEntry) return toSnapshot(matchedEntry, true, false);
    }

    const baseText = getMessageContentText(message);
    if (isFavoriteTextMatch(item, baseText)) {
      return {
        text: baseText,
        swipeIndex: swipeEntries.length ? getMessageCurrentSwipeIndex(message) : -1,
        matched: true,
        swipeMissing: false,
        reasoning: baseReasoning,
        media: message?.extra?.media ?? null,
      };
    }

    const fallbackEntry = swipeEntries.length
      ? (getMessageSwipeEntry(message, storedSwipeIndex >= 0 && storedSwipeIndex < swipeEntries.length ? storedSwipeIndex : getMessageCurrentSwipeIndex(message)) || swipeEntries[0])
      : null;
    return {
      text: String(item?.previewText || fallbackEntry?.text || baseText || ''),
      swipeIndex: storedSwipeIndex >= 0 ? storedSwipeIndex : (fallbackEntry ? fallbackEntry.index : -1),
      matched: false,
      swipeMissing: storedSwipeIndex >= 0,
      reasoning: '',
      media: fallbackEntry?.media ?? message?.extra?.media ?? null,
    };
  }

  function normalizeFavoriteItem(item, index) {
    const now = Date.now() + index;
    const previewText = normalizeFavoriteText(item?.previewText || '');
    const sendDate = item?.sendDate == null ? '' : String(item.sendDate);
    return {
      id: typeof item?.id === 'string' && item.id ? item.id : `stcj-fav-${now}-${index}`,
      messageId: Math.max(0, Math.round(Number(item?.messageId) || 0)),
      swipeIndex: normalizeFavoriteSwipeIndex(item?.swipeIndex),
      note: String(item?.note || ''),
      textHash: String(item?.textHash || ''),
      previewText,
      sender: String(item?.sender || ''),
      sendDate,
      createdAt: Number.isFinite(Number(item?.createdAt)) ? Number(item.createdAt) : now,
      updatedAt: Number.isFinite(Number(item?.updatedAt)) ? Number(item.updatedAt) : now,
    };
  }

  function applyFavoriteItemUpdate(item, mesId, message) {
    if (!item || !message) return item;
    const snapshot = resolveFavoriteMessageSnapshot(item, message);
    const normalizedText = normalizeFavoriteText(snapshot.text || getMessageContentText(message) || '');
    item.messageId = Math.max(0, Math.round(Number(mesId) || 0));
    item.swipeIndex = normalizeFavoriteSwipeIndex(snapshot.swipeIndex);
    if (normalizedText) {
      item.previewText = normalizedText.slice(0, 160);
      item.textHash = computeTextHash(normalizedText);
    }
    item.sender = String(message?.name || item.sender || '');
    item.sendDate = message?.send_date == null ? '' : String(message.send_date);
    item.updatedAt = Date.now();
    return item;
  }

  function syncFavoriteItemsToMetadata() {
    const metadata = ensureFavoritesMetadata();
    if (!metadata) return false;
    metadata[FAVORITES_METADATA_KEY] = favoriteItems.map((item, index) => normalizeFavoriteItem(item, index));
    favoriteItems = metadata[FAVORITES_METADATA_KEY];
    return true;
  }

  function persistFavoritesNow() {
    if (favoritesSaveTimer) {
      clearTimeout(favoritesSaveTimer);
      favoritesSaveTimer = null;
    }
    if (!syncFavoriteItemsToMetadata()) return;
    try {
      const ctx = window.SillyTavern?.getContext?.();
      ctx?.saveMetadataDebounced?.();
    } catch {
      /* ignore */
    }
  }

  function scheduleFavoritesSave() {
    if (favoritesSaveTimer) clearTimeout(favoritesSaveTimer);
    favoritesSaveTimer = setTimeout(() => {
      favoritesSaveTimer = null;
      persistFavoritesNow();
    }, FAVORITES_SAVE_DEBOUNCE);
  }

  function touchFavoritesUI() {
    const root = document.getElementById(ROOT_ID);
    if (root) updateFavoritesUI(root);
    if (favoritesModalOpen) renderFavoritesManager();
  }

  function refreshFavoritesFromMetadata() {
    const metadata = ensureFavoritesMetadata();
    favoriteItems = Array.isArray(metadata?.[FAVORITES_METADATA_KEY])
      ? metadata[FAVORITES_METADATA_KEY].map((item, index) => normalizeFavoriteItem(item, index))
      : [];
    if (metadata) metadata[FAVORITES_METADATA_KEY] = favoriteItems;
    if (favoriteQuickMenuId && !favoriteItems.some((item) => item.id === favoriteQuickMenuId)) {
      favoriteQuickMenuId = null;
    }
    touchFavoritesUI();
  }

  function buildFavoriteItemFromMessage(mesId, message) {
    const snapshot = getCurrentMessageSnapshot(message);
    const normalizedText = normalizeFavoriteText(snapshot.text || getMessageContentText(message) || '');
    const now = Date.now();
    return {
      id: `stcj-fav-${now}-${Math.random().toString(16).slice(2, 8)}`,
      messageId: mesId,
      swipeIndex: normalizeFavoriteSwipeIndex(snapshot.swipeIndex),
      note: '',
      textHash: computeTextHash(normalizedText),
      previewText: normalizedText.slice(0, 160),
      sender: String(message?.name || ''),
      sendDate: message?.send_date == null ? '' : String(message.send_date),
      createdAt: now,
      updatedAt: now,
    };
  }

  function isFavoriteFingerprintMatch(item, message) {
    if (!item || !message) return false;
    return resolveFavoriteMessageSnapshot(item, message).matched;
  }

  function findFavoriteByRange(item, messages, start, end) {
    const safeStart = clamp(start, 0, Math.max(0, messages.length - 1));
    const safeEnd = clamp(end, 0, Math.max(0, messages.length - 1));
    for (let i = safeStart; i <= safeEnd; i++) {
      if (isFavoriteFingerprintMatch(item, messages[i])) {
        return { mesId: i, message: messages[i], status: 'fallback' };
      }
    }
    return null;
  }

  function resolveFavoriteTarget(item, messages = getCurrentChatMessages()) {
    if (!item || !Array.isArray(messages) || !messages.length) {
      return { mesId: item?.messageId ?? -1, message: null, status: 'missing' };
    }

    const exactId = Math.max(0, Math.min(messages.length - 1, Math.round(Number(item.messageId) || 0)));
    const exactMessage = messages[exactId];
    if (exactMessage && (isFavoriteFingerprintMatch(item, exactMessage) || isFavoriteMetadataMatch(item, exactMessage))) {
      return { mesId: exactId, message: exactMessage, status: 'exact' };
    }

    const nearby = findFavoriteByRange(item, messages, exactId - 12, exactId + 12);
    if (nearby) return nearby;

    const full = findFavoriteByRange(item, messages, 0, messages.length - 1);
    if (full) return full;

    return { mesId: exactId, message: exactMessage || null, status: 'missing' };
  }

  function ensureFavoriteResolved(item, resolution) {
    if (!item || !resolution?.message) return resolution;
    if (resolution.status === 'missing') return resolution;
    const snapshot = resolveFavoriteMessageSnapshot(item, resolution.message);
    if (item.messageId === resolution.mesId
      && resolution.status === 'exact'
      && normalizeFavoriteSwipeIndex(item.swipeIndex) === normalizeFavoriteSwipeIndex(snapshot.swipeIndex)) return resolution;
    applyFavoriteItemUpdate(item, resolution.mesId, resolution.message);
    scheduleFavoritesSave();
    return resolution;
  }

  function findFavoriteIndexByIdentity(candidate) {
    return favoriteItems.findIndex((item) => {
      if (String(item.id) === String(candidate.id)) return true;
      if (item.messageId === candidate.messageId && item.textHash && candidate.textHash && item.textHash === candidate.textHash) return true;
      if (item.sender && candidate.sender && item.sender === candidate.sender && item.sendDate && candidate.sendDate && item.sendDate === candidate.sendDate && item.textHash === candidate.textHash) {
        return true;
      }
      return false;
    });
  }

  function getFavoriteItemById(favoriteId) {
    return favoriteItems.find((item) => item.id === favoriteId) || null;
  }

  function getRecentFavoriteItems() {
    const recentItems = [...favoriteItems]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, FAVORITES_RECENT_LIMIT);

    return recentItems
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function getFavoriteQuickLabel(item, resolution) {
    const floorText = formatFloorLabel(resolution?.mesId ?? item.messageId);
    const resolvedSwipeIndex = resolution?.message
      ? resolveFavoriteMessageSnapshot(item, resolution.message).swipeIndex
      : item?.swipeIndex;
    const swipeText = formatFavoriteSwipeLabel(resolvedSwipeIndex);
    const note = String(item?.note || '').trim();
    const prefix = swipeText ? `${floorText} · ${swipeText}` : floorText;
    return note ? `${prefix} · ${note}` : prefix;
  }

  function getFavoriteListSummary(item) {
    const note = String(item?.note || '').trim();
    if (note) return note;
    return item?.previewText ? item.previewText.slice(0, 60) : '无备注';
  }

  function getFavoriteResolvedSnapshot(item, resolution) {
    if (!resolution?.message || resolution.status === 'missing') return null;
    return resolveFavoriteMessageSnapshot(item, resolution.message);
  }

  function getFavoriteResolvedSwipeIndex(item, resolution) {
    return normalizeFavoriteSwipeIndex(getFavoriteResolvedSnapshot(item, resolution)?.swipeIndex ?? item?.swipeIndex);
  }

  function hasMultipleFavoriteSwipesOnSameFloor(item, resolution, detailEntries) {
    if (!item || !resolution || !Array.isArray(detailEntries) || detailEntries.length < 2) return false;
    const targetFloor = resolution.status === 'missing' ? item.messageId : resolution.mesId;
    const swipeSet = new Set();

    detailEntries.forEach((entry) => {
      const entryFloor = entry?.resolution?.status === 'missing'
        ? entry?.item?.messageId
        : entry?.resolution?.mesId;
      if (entryFloor !== targetFloor) return;
      const swipeIndex = getFavoriteResolvedSwipeIndex(entry?.item, entry?.resolution);
      if (swipeIndex >= 0) swipeSet.add(swipeIndex);
    });

    return swipeSet.size > 1;
  }

  function isFavoriteCurrentDisplayedSwipe(item, resolution) {
    if (!resolution?.message || resolution.status === 'missing') return false;
    const favoriteSwipeIndex = getFavoriteResolvedSwipeIndex(item, resolution);
    const currentSwipeIndex = getMessageCurrentSwipeIndex(resolution.message);
    return favoriteSwipeIndex >= 0 && currentSwipeIndex >= 0 && favoriteSwipeIndex === currentSwipeIndex;
  }

  function buildFavoriteCurrentBranchBadgeHtml(item, resolution, detailEntries) {
    if (!hasMultipleFavoriteSwipesOnSameFloor(item, resolution, detailEntries)) return '';
    if (!isFavoriteCurrentDisplayedSwipe(item, resolution)) return '';
    return '<span class="stcj-current-branch-badge" title="当前聊天记录中实际展示的分支">当前分支</span>';
  }

  function getFavoriteStatusLabel(status, snapshot) {
    if (status === 'missing') return '楼层失效';
    if (snapshot?.swipeMissing) return '分支已删';
    return '';
  }

  function getFavoriteStatusDescription(status, snapshot) {
    if (status === 'missing') return '原收藏楼层已不存在或无法定位。';
    if (snapshot?.swipeMissing) {
      const swipeText = formatFavoriteSwipeLabel(snapshot.swipeIndex);
      return swipeText
        ? `原收藏的 ${swipeText} 已被删除或不存在，当前只能回退到该楼层。`
        : '原收藏的分支已被删除或不存在，当前只能回退到该楼层。';
    }
    return '';
  }

  function getFavoriteSortModeLabel(mode) {
    switch (mode) {
      case 'floor_asc': return '楼层 ↑';
      case 'floor_desc': return '楼层 ↓';
      default: return '收藏顺序';
    }
  }

  function sortFavoriteItems(items, mode) {
    const list = [...items];
    const pickItem = (entry) => entry?.item || entry;
    const pickFloor = (entry) => entry?.resolution?.status === 'missing'
      ? Number.MAX_SAFE_INTEGER
      : (entry?.resolution?.mesId ?? pickItem(entry).messageId);
    const pickSwipe = (entry) => {
      const idx = getFavoriteResolvedSwipeIndex(pickItem(entry), entry?.resolution);
      return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
    };
    switch (mode) {
      case 'floor_asc':
        return list.sort((a, b) => pickFloor(a) - pickFloor(b)
          || pickSwipe(a) - pickSwipe(b)
          || pickItem(a).createdAt - pickItem(b).createdAt);
      case 'floor_desc':
        return list.sort((a, b) => pickFloor(b) - pickFloor(a)
          || pickSwipe(b) - pickSwipe(a)
          || pickItem(b).createdAt - pickItem(a).createdAt);
      default:
        return list.sort((a, b) => (pickItem(b).createdAt || 0) - (pickItem(a).createdAt || 0));
    }
  }

  function buildFavoriteDetailEntries() {
    const messages = getCurrentChatMessages();
    return favoriteItems
      .map((item) => {
        const resolution = ensureFavoriteResolved(item, resolveFavoriteTarget(item, messages));
        return {
          item,
          resolution,
          floor: resolution.status === 'missing' ? Number.MAX_SAFE_INTEGER : resolution.mesId,
        };
      })
      .sort((a, b) => a.floor - b.floor
        || getFavoriteResolvedSwipeIndex(a.item, a.resolution) - getFavoriteResolvedSwipeIndex(b.item, b.resolution)
        || a.item.createdAt - b.item.createdAt);
  }

  function addFavorite(mesId) {
    const messages = getCurrentChatMessages();
    const message = messages[mesId];
    if (!message) return false;

    const candidate = buildFavoriteItemFromMessage(mesId, message);
    if (findFavoriteIndexByIdentity(candidate) >= 0) return false;

    favoriteItems.unshift(candidate);
    syncFavoriteItemsToMetadata();
    scheduleFavoritesSave();
    touchFavoritesUI();
    return true;
  }

  function removeFavoriteById(favoriteId) {
    const index = favoriteItems.findIndex((item) => item.id === favoriteId);
    if (index < 0) return false;
    favoriteItems.splice(index, 1);
    if (favoriteQuickMenuId === favoriteId) favoriteQuickMenuId = null;
    syncFavoriteItemsToMetadata();
    scheduleFavoritesSave();
    touchFavoritesUI();
    return true;
  }

  function updateFavoriteNoteById(favoriteId, nextNote) {
    const item = getFavoriteItemById(favoriteId);
    if (!item) return false;
    item.note = String(nextNote || '');
    item.updatedAt = Date.now();
    syncFavoriteItemsToMetadata();
    scheduleFavoritesSave();
    touchFavoritesUI();
    return true;
  }

  async function promptFavoriteNote(initialValue = '') {
    const tip = '编辑收藏备注';
    let value = null;
    try {
      if (typeof window.SillyTavern?.callGenericPopup === 'function') {
        value = await window.SillyTavern.callGenericPopup(tip, window.SillyTavern?.POPUP_TYPE?.INPUT, String(initialValue || ''));
      }
    } catch {
      value = null;
    }
    if (typeof value !== 'string') {
      value = window.prompt(tip, String(initialValue || ''));
    }
    return typeof value === 'string' ? value : null;
  }

  async function confirmFavoriteDelete(item) {
    const label = getFavoriteQuickLabel(item, { mesId: item.messageId });
    const tip = `确认删除收藏：${label} ？`;
    let result = null;
    try {
      if (typeof window.SillyTavern?.callGenericPopup === 'function') {
        result = await window.SillyTavern.callGenericPopup(tip, window.SillyTavern?.POPUP_TYPE?.CONFIRM);
      }
    } catch {
      result = null;
    }
    if (typeof result === 'boolean') return result;
    return window.confirm(tip);
  }

  async function editFavoriteNoteById(favoriteId) {
    const item = getFavoriteItemById(favoriteId);
    if (!item) return false;
    const value = await promptFavoriteNote(item.note || '');
    if (value == null) return false;
    updateFavoriteNoteById(favoriteId, value);
    toastSuccess(value ? '收藏备注已更新。' : '已清空收藏备注。');
    return true;
  }

  async function deleteFavoriteByIdWithConfirm(favoriteId) {
    const item = getFavoriteItemById(favoriteId);
    if (!item) return false;
    const confirmed = await confirmFavoriteDelete(item);
    if (!confirmed) return false;
    const removed = removeFavoriteById(favoriteId);
    if (removed) toastInfo('收藏已删除。');
    return removed;
  }

  async function jumpToFavoriteItemFromRecentList(item) {
    if (!item) return false;
    const resolution = ensureFavoriteResolved(item, resolveFavoriteTarget(item));
    if (!resolution?.message || resolution.status === 'missing') {
      toastWarn('未能在当前聊天中定位到该收藏对应的楼层。');
      return false;
    }
    const existingEl = document.querySelector(`#chat .mes[mesid="${resolution.mesId}"]`);
    if (!existingEl) {
      return jumpToFavoriteItem(item, 'start');
    }

    const targetEl = document.querySelector(`#chat .mes[mesid="${resolution.mesId}"]`) || existingEl;
    const winPos = captureWindowScroll();
    scrollMessageInChat(targetEl, 'start', 'smooth');
    restoreWindowScrollStable(winPos);
    flashMessage(targetEl);
    return true;
  }

  async function jumpToFavoriteItem(item, block = 'start') {
    void block;
    if (!item) return false;
    const resolution = ensureFavoriteResolved(item, resolveFavoriteTarget(item));
    if (!resolution?.message || resolution.status === 'missing') {
      toastWarn('未能在当前聊天中定位到该收藏对应的楼层。');
      return false;
    }
    const jumped = await showFloorRange(String(resolution.mesId));
    if (!jumped) return false;
    return true;
  }

  function removeFavoriteQuickMenuOverlay() {
    document.getElementById(FAVORITE_QUICK_MENU_OVERLAY_ID)?.remove();
  }

  function positionFavoriteQuickMenuOverlay(menu, trigger) {
    if (!menu || !trigger) return;
    const margin = 8;
    const gap = 6;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    const canOpenRight = triggerRect.left + menuRect.width <= viewportWidth - margin;
    const canOpenLeft = triggerRect.right - menuRect.width >= margin;
    const canOpenDown = triggerRect.bottom + gap + menuRect.height <= viewportHeight - margin;
    const canOpenUp = triggerRect.top - gap - menuRect.height >= margin;

    let horizontal = 'left';
    if (!canOpenLeft && canOpenRight) {
      horizontal = 'right';
    } else if (!canOpenLeft && !canOpenRight) {
      const spaceLeft = Math.max(0, triggerRect.right - margin);
      const spaceRight = Math.max(0, viewportWidth - margin - triggerRect.left);
      horizontal = spaceRight > spaceLeft ? 'right' : 'left';
    }

    let vertical = 'down';
    if (!canOpenDown && canOpenUp) {
      vertical = 'up';
    } else if (!canOpenDown && !canOpenUp) {
      const spaceUp = Math.max(0, triggerRect.top - margin);
      const spaceDown = Math.max(0, viewportHeight - margin - triggerRect.bottom);
      vertical = spaceUp > spaceDown ? 'up' : 'down';
    }

    let left = horizontal === 'right'
      ? triggerRect.left
      : (triggerRect.right - menuRect.width);
    let top = vertical === 'up'
      ? (triggerRect.top - menuRect.height - gap)
      : (triggerRect.bottom + gap);

    if (left + menuRect.width > viewportWidth - margin) {
      left = viewportWidth - margin - menuRect.width;
    }
    if (left < margin) left = margin;

    if (top + menuRect.height > viewportHeight - margin) top = viewportHeight - margin - menuRect.height;
    if (top < margin) top = margin;

    menu.dataset.horizontal = horizontal;
    menu.dataset.vertical = vertical;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = 'visible';
  }

  function renderFavoriteQuickMenuOverlay() {
    removeFavoriteQuickMenuOverlay();
    if (!favoriteQuickMenuId) return;

    const trigger = document.querySelector(`#${ROOT_ID} [data-favorite-menu-trigger="${String(favoriteQuickMenuId)}"]`);
    if (!trigger) return;

    const item = getFavoriteItemById(favoriteQuickMenuId);
    if (!item) return;

    const overlay = document.createElement('div');
    overlay.id = FAVORITE_QUICK_MENU_OVERLAY_ID;
    overlay.className = 'stcj-fav-menu stcj-fav-menu-floating';
    overlay.style.visibility = 'hidden';
    overlay.innerHTML = `
      <button type="button" class="stcj-fav-menu-item" data-favorite-menu-action="note" data-favorite-id="${item.id}">${ICONS.note}<span>备注</span></button>
      <button type="button" class="stcj-fav-menu-item danger" data-favorite-menu-action="delete" data-favorite-id="${item.id}">${ICONS.trash}<span>删除</span></button>
    `;

    overlay.addEventListener('pointerup', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menuAction = e.target?.closest?.('[data-favorite-menu-action]');
      if (!menuAction) return;
      const favoriteId = menuAction.getAttribute('data-favorite-id');
      if (!favoriteId) return;
      const action = menuAction.getAttribute('data-favorite-menu-action');
      closeFavoriteQuickMenu();
      if (action === 'note') {
        await editFavoriteNoteById(favoriteId);
      } else if (action === 'delete') {
        await deleteFavoriteByIdWithConfirm(favoriteId);
      }
    });

    document.body.appendChild(overlay);
    positionFavoriteQuickMenuOverlay(overlay, trigger);
  }

  function closeFavoriteQuickMenu() {
    removeFavoriteQuickMenuOverlay();
    if (!favoriteQuickMenuId) return;
    favoriteQuickMenuId = null;
    const root = document.getElementById(ROOT_ID);
    if (root) updateFavoritesUI(root);
  }

  function openFavoriteQuickMenu(favoriteId) {
    favoriteQuickMenuId = favoriteQuickMenuId === favoriteId ? null : favoriteId;
    const root = document.getElementById(ROOT_ID);
    if (root) updateFavoritesUI(root);
    if (favoriteQuickMenuId) renderFavoriteQuickMenuOverlay();
  }

  function getFavoritePanelElement(root = document.getElementById(ROOT_ID)) {
    return root?.querySelector?.('.stcj-fav-panel') || null;
  }

  function getRootViewportScale(root) {
    if (!root) return 1;
    const rect = root.getBoundingClientRect?.();
    const width = root.offsetWidth || 0;
    if (rect?.width && width > 0) {
      return Math.max(0.01, rect.width / width);
    }
    return normalizeRootScale(settings.scale);
  }

  function getFavoritePanelViewportMetrics(panel) {
    const rect = panel?.getBoundingClientRect?.();
    const width = Math.max(0, rect?.width || panel?.offsetWidth || 0);
    const height = Math.max(0, rect?.height || panel?.offsetHeight || 0);
    const margin = 8;
    return {
      width,
      height,
      margin,
      maxLeft: Math.max(0, window.innerWidth - width - margin * 2),
      maxTop: Math.max(0, window.innerHeight - height - margin * 2),
    };
  }

  function getFavoritePanelCssSizeLimits(root) {
    const scale = getRootViewportScale(root);
    const maxWByViewport = Math.max(FAV_PANEL_MIN_W, (window.innerWidth - 16) / scale);
    const maxHByViewport = Math.max(FAV_PANEL_MIN_H, (window.innerHeight - 16) / scale);
    return {
      minW: FAV_PANEL_MIN_W,
      minH: FAV_PANEL_MIN_H,
      maxW: Math.min(FAV_PANEL_MAX_W, maxWByViewport),
      maxH: Math.min(FAV_PANEL_MAX_H, maxHByViewport),
      scale,
    };
  }

  function applyFavoritePanelViewportPosition(root, panel, viewportLeft, viewportTop, persist = false) {
    if (!root || !panel) return;
    const { width, height, margin, maxLeft, maxTop } = getFavoritePanelViewportMetrics(panel);
    if (!width || !height) return;
    const lockedWidth = Math.round(width);

    const clampedLeft = clamp(Number(viewportLeft) || 0, margin, margin + maxLeft);
    const clampedTop = clamp(Number(viewportTop) || 0, margin, margin + maxTop);
    const rootRect = root.getBoundingClientRect();
    const rootScale = getRootViewportScale(root);

    panel.dataset.positionMode = 'custom';
    root.dataset.favPanelDefaultSide = 'custom';
    // 自定义尺寸模式下宽度由用户控制，不回写锁定宽度
    if (panel.dataset.sizeMode !== 'custom') {
      panel.style.width = `${Math.round(lockedWidth / rootScale)}px`;
    }
    panel.style.left = `${Math.round((clampedLeft - rootRect.left) / rootScale)}px`;
    panel.style.top = `${Math.round((clampedTop - rootRect.top) / rootScale)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';

    if (!persist) return;

    settings.favPanelCustom = true;
    settings.favPanelX = Math.round(clampedLeft);
    settings.favPanelY = Math.round(clampedTop);
    settings.favPanelRx = maxLeft > 0 ? clamp((clampedLeft - margin) / maxLeft, 0, 1) : 0;
    settings.favPanelRy = maxTop > 0 ? clamp((clampedTop - margin) / maxTop, 0, 1) : 0;
    saveSettings();
  }

  function applyFavoritePanelDefaultPosition(root, panel) {
    if (!root || !panel) return;
    panel.removeAttribute('data-position-mode');
    // 自定义尺寸模式下保留用户设置的宽高，不清除
    if (panel.dataset.sizeMode !== 'custom') {
      panel.style.width = '';
      panel.style.height = '';
    }
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';

    let side = 'bottom';
    if (settings.orientation === 'vertical') {
      const rootRect = root.getBoundingClientRect();
      const { width } = getFavoritePanelViewportMetrics(panel);
      const gap = 10;
      const leftSpace = Math.max(0, rootRect.left - gap);
      const rightSpace = Math.max(0, window.innerWidth - rootRect.right - gap);
      if (rightSpace >= width && leftSpace < width) side = 'right';
      else if (leftSpace >= width && rightSpace < width) side = 'left';
      else side = rightSpace > leftSpace ? 'right' : 'left';
    }

    root.dataset.favPanelDefaultSide = side;
  }

  function applyFavoritePanelPosition(root, opts = {}) {
    const panel = getFavoritePanelElement(root);
    if (!root || !panel) return;
    if (!favPanelOpen && !opts.force) return;

    // 先恢复自定义尺寸（若有），再计算位置
    applyFavoritePanelSize(root, panel);

    if (settings.favPanelCustom) {
      const { margin, maxLeft, maxTop } = getFavoritePanelViewportMetrics(panel);
      const viewportLeft = typeof settings.favPanelRx === 'number'
        ? margin + settings.favPanelRx * maxLeft
        : (typeof settings.favPanelX === 'number' ? settings.favPanelX : margin);
      const viewportTop = typeof settings.favPanelRy === 'number'
        ? margin + settings.favPanelRy * maxTop
        : (typeof settings.favPanelY === 'number' ? settings.favPanelY : margin);
      applyFavoritePanelViewportPosition(root, panel, viewportLeft, viewportTop, false);
      return;
    }

    applyFavoritePanelDefaultPosition(root, panel);
  }

  function attachFavoritePanelDrag(root) {
    const panel = getFavoritePanelElement(root);
    const header = panel?.querySelector?.('.stcj-fav-header');
    if (!panel || !header) return;

    let dragState = null;
    const DRAG_THRESHOLD = 4;

    const finishDrag = (persist) => {
      if (!dragState) return;
      try { header.releasePointerCapture?.(dragState.pointerId); } catch { /* ignore */ }
      if (persist && dragState.moved) {
        persistFavoritePanelPosition(root, panel, dragState.left + dragState.dx, dragState.top + dragState.dy);
      }
      panel.classList.remove('stcj-fav-panel-dragging');
      dragState = null;
    };

    header.addEventListener('pointerdown', (e) => {
      if (!favPanelOpen) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target?.closest?.('.stcj-fav-close')) return;

      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        left: rect.left,
        top: rect.top,
        dx: 0,
        dy: 0,
        moved: false,
      };
      panel.classList.add('stcj-fav-panel-dragging');
      try { header.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
      e.stopPropagation();
    });

    header.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      dragState.dx = e.clientX - dragState.startX;
      dragState.dy = e.clientY - dragState.startY;
      if (!dragState.moved) {
        if (Math.hypot(dragState.dx, dragState.dy) < DRAG_THRESHOLD) return;
        dragState.moved = true;
      }
      applyFavoritePanelViewportPosition(root, panel, dragState.left + dragState.dx, dragState.top + dragState.dy, false);
      e.preventDefault();
    });

    header.addEventListener('pointerup', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      finishDrag(true);
      e.preventDefault();
    });

    header.addEventListener('pointercancel', () => finishDrag(false));
  }

  function persistFavoritePanelPosition(root, panel, viewportLeft, viewportTop) {
    applyFavoritePanelViewportPosition(root, panel, viewportLeft, viewportTop, true);
  }
  // 将已保存的自定义尺寸应用到面板 DOM（不保存）
  function applyFavoritePanelSize(root, panel = getFavoritePanelElement(root)) {
    if (!panel) return;
    const hasW = typeof settings.favPanelW === 'number' && Number.isFinite(settings.favPanelW);
    const hasH = typeof settings.favPanelH === 'number' && Number.isFinite(settings.favPanelH);

    if (!hasW && !hasH) {
      panel.removeAttribute('data-size-mode');
      panel.style.width = '';
      panel.style.height = '';
      return;
    }

    panel.dataset.sizeMode = 'custom';
    const { maxW, maxH } = getFavoritePanelCssSizeLimits(root);
    if (hasW) {
      panel.style.width = `${clamp(settings.favPanelW, FAV_PANEL_MIN_W, maxW)}px`;
    }
    if (hasH) {
      panel.style.height = `${clamp(settings.favPanelH, FAV_PANEL_MIN_H, maxH)}px`;
    }
  }

  function attachFavoritePanelResize(root) {
    const panel = getFavoritePanelElement(root);
    const handle = panel?.querySelector?.('.stcj-fav-resize');
    if (!panel || !handle) return;

    let resizeState = null;

    const finishResize = (persist) => {
      if (!resizeState) return;
      try { handle.releasePointerCapture?.(resizeState.pointerId); } catch { /* ignore */ }
      panel.classList.remove('stcj-fav-panel-resizing');
      if (persist && resizeState.moved) {
        // 只保存尺寸，不动位置（不重算/不回写 rx/ry）——
        // 右下角缩放时左上角本来就未变，CSS left/top 也未变，无需重定位
        settings.favPanelW = Math.round(parseFloat(panel.style.width) || resizeState.startW);
        settings.favPanelH = Math.round(parseFloat(panel.style.height) || resizeState.startH);
        saveSettings();
      }
      resizeState = null;
    };

    handle.addEventListener('pointerdown', (e) => {
      if (!favPanelOpen) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const rect = panel.getBoundingClientRect();
      const rootScale = getRootViewportScale(root);
      const startW = rect.width / rootScale;
      const startH = rect.height / rootScale;
      resizeState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startW,
        startH,
        startLeft: rect.left,
        startTop: rect.top,
        rootScale,
        moved: false,
      };
      // 进入自定义尺寸模式，锁定当前 CSS 尺寸作为起点
      panel.dataset.sizeMode = 'custom';
      panel.style.width = `${Math.round(startW)}px`;
      panel.style.height = `${Math.round(startH)}px`;
      panel.classList.add('stcj-fav-panel-resizing');
      try { handle.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!resizeState || resizeState.pointerId !== e.pointerId) return;
      const dx = e.clientX - resizeState.startX;
      const dy = e.clientY - resizeState.startY;
      if (!resizeState.moved && Math.hypot(dx, dy) < 3) return;
      resizeState.moved = true;

      const { maxW, maxH } = getFavoritePanelCssSizeLimits(root);
      const scale = resizeState.rootScale || getRootViewportScale(root);
      const w = clamp(resizeState.startW + dx / scale, FAV_PANEL_MIN_W, maxW);
      const h = clamp(resizeState.startH + dy / scale, FAV_PANEL_MIN_H, maxH);
      panel.style.width = `${Math.round(w)}px`;
      panel.style.height = `${Math.round(h)}px`;
      e.preventDefault();
    });

    handle.addEventListener('pointerup', (e) => {
      if (!resizeState || resizeState.pointerId !== e.pointerId) return;
      finishResize(true);
      e.stopPropagation();
      e.preventDefault();
    });

    handle.addEventListener('pointercancel', () => finishResize(false));
  }


  function ensureFavoritesModalRoot() {
    let modal = document.getElementById(FAVORITES_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = FAVORITES_MODAL_ID;
    modal.className = 'stcj-modal-overlay';
    modal.innerHTML = `
      <div class="stcj-modal-shell">
        <div class="stcj-modal-header">
          <div class="stcj-modal-title-wrap">
            <button class="stcj-modal-title-icon stcj-modal-sidebar-toggle" data-action="toggleFavoritesSidebar" title="收起索引" aria-label="收起索引" aria-expanded="true"></button>
            <div>
              <div class="stcj-modal-subtitle">当前聊天 · 左侧索引 / 右侧详情</div>
              <div class="stcj-modal-title">收藏 · 共 0 条</div>
            </div>
          </div>
          <div class="stcj-modal-actions">
            <div class="stcj-modal-preview-switch-wrap">
              <span>预览模式</span>
              <div class="stcj-modal-preview-switch"></div>
            </div>
          </div>
          <button class="stcj-modal-close" data-action="closeFavoritesManager" title="关闭">${ICONS.close}</button>
        </div>
        <div class="stcj-modal-body">
          <button class="stcj-modal-sidebar-backdrop" type="button" data-action="closeFavoritesSidebar" aria-label="关闭索引抽屉"></button>
          <aside class="stcj-modal-sidebar">
            <div class="stcj-modal-sidebar-head">
              <div class="stcj-modal-sidebar-mobile-summary" aria-hidden="true">
                <span class="stcj-modal-sidebar-mobile-title">收藏</span>
                <span class="stcj-modal-sidebar-mobile-subtitle">当前聊天</span>
              </div>
              <div class="stcj-modal-sort-wrap"></div>
            </div>
            <div class="stcj-modal-sidebar-list"></div>
          </aside>
          <main class="stcj-modal-main">
            <div class="stcj-modal-main-head">
              <div class="stcj-modal-main-info">
                <div class="stcj-modal-main-title">详情预览</div>
                <div class="stcj-modal-main-note" hidden></div>
              </div>
              <div class="stcj-modal-card-actions stcj-modal-main-actions">
                <button class="stcj-modal-card-btn" data-action="favoriteJump" data-fav-id="" title="跳转到楼层">${ICONS.arrowUpRight}<span>跳转</span></button>
                <button class="stcj-modal-card-btn" data-action="favoriteEditNote" data-fav-id="" title="编辑备注">${ICONS.note}<span>备注</span></button>
                <button class="stcj-modal-card-btn danger" data-action="favoriteDelete" data-fav-id="" title="删除收藏">${ICONS.trash}<span>删除</span></button>
              </div>
            </div>
            <div class="stcj-modal-main-list"></div>
          </main>
        </div>
      </div>
    `;

    modal.addEventListener('click', async (e) => {
      if (e.target === modal) {
        closeFavoritesManager();
        return;
      }

      const actionEl = e.target?.closest?.('[data-action]');
      const action = actionEl?.getAttribute('data-action');
      if (!action) return;

      if (action === 'closeFavoritesManager') {
        closeFavoritesManager();
        return;
      }
      if (action === 'toggleFavoritesSidebar') {
        toggleFavoritesSidebar(modal);
        return;
      }
      if (action === 'closeFavoritesSidebar') {
        closeFavoritesSidebarDrawer(modal);
        return;
      }
      if (action === 'setFavoritesPreviewMode') {
        favoritesPreviewMode = normalizeFavoritePreviewMode(actionEl.getAttribute('data-preview-mode'));
        saveFavoritesPreviewMode(favoritesPreviewMode);
        setFavoriteDetailPreviewLoading(modal);
        await renderFavoritesManager();
        return;
      }
      if (action === 'setFavoritesSortMode') {
        favoritesModalSort = normalizeFavoriteSortMode(actionEl.getAttribute('data-sort-mode'));
        const sortWrapEl = modal.querySelector('.stcj-modal-sort-wrap');
        if (sortWrapEl) sortWrapEl.innerHTML = buildFavoriteSortModeSwitchHtml();
        const detailEntries = buildFavoriteDetailEntries();
        renderFavoritesSidebarList(modal, detailEntries);
        setFavoritesSidebarActiveState(modal, favoritesModalActiveId);
        syncFavoritesSidebarState(modal);
        return;
      }
      if (action === 'focusFavoriteCard') {
        const favoriteId = actionEl.getAttribute('data-fav-id');
        if (!favoriteId) return;
        favoritesModalActiveId = favoriteId;
        setFavoritesSidebarActiveState(modal, favoriteId);
        setFavoriteDetailPreviewLoading(modal);
        await renderFavoritesManager();
        return;
      }

      const favoriteId = actionEl.getAttribute('data-fav-id');
      if (!favoriteId) return;

      if (action === 'favoriteJump') {
        const item = getFavoriteItemById(favoriteId);
        const jumped = await jumpToFavoriteItem(item, 'start');
        if (jumped) closeFavoritesManager();
        return;
      }

      if (action === 'favoriteEditNote') {
        await editFavoriteNoteById(favoriteId);
        return;
      }

      if (action === 'favoriteDelete') {
        await deleteFavoriteByIdWithConfirm(favoriteId);
      }
    });

    ensureFavoritesModalResizeListener();
    syncFavoritesSidebarState(modal);
    document.body.appendChild(modal);
    return modal;
  }

  function closeFavoritesManager() {
    favoritesModalOpen = false;
    favoritesSidebarDrawerOpen = false;
    const modal = document.getElementById(FAVORITES_MODAL_ID);
    syncFavoritesSidebarState(modal);
    modal?.classList.remove('is-open');
  }

  async function renderFavoritesManager() {
    const modal = ensureFavoritesModalRoot();
    if (!modal) return;
    syncFavoritesSidebarState(modal);
    const renderSeq = ++favoritesRenderSeq;
    favoritesModalSort = normalizeFavoriteSortMode(favoritesModalSort);
    const previewMode = normalizeFavoritePreviewMode(favoritesPreviewMode);

    const detailEntries = buildFavoriteDetailEntries();
    const sidebarList = modal.querySelector('.stcj-modal-sidebar-list');
    const mainList = modal.querySelector('.stcj-modal-main-list');
    const headerTitleEl = modal.querySelector('.stcj-modal-title');
    const sortWrapEl = modal.querySelector('.stcj-modal-sort-wrap');
    const subtitleEl = modal.querySelector('.stcj-modal-subtitle');
    const previewSwitchEl = modal.querySelector('.stcj-modal-preview-switch');
    const mobileSummaryTitleEl = modal.querySelector('.stcj-modal-sidebar-mobile-title');
    const headRefs = getFavoritesMainHeadRefs(modal);

    const modalTitleText = `收藏 · 共 ${favoriteItems.length} 条`;
    if (headerTitleEl) headerTitleEl.textContent = modalTitleText;
    if (mobileSummaryTitleEl) mobileSummaryTitleEl.textContent = modalTitleText;
    if (sortWrapEl) sortWrapEl.innerHTML = buildFavoriteSortModeSwitchHtml();
    if (previewSwitchEl) previewSwitchEl.innerHTML = buildFavoritePreviewModeSwitchHtml();
    if (headRefs.title) headRefs.title.textContent = `详情预览 · ${getFavoritePreviewModeLabel(previewMode)}`;
    if (headRefs.note) { headRefs.note.hidden = true; headRefs.note.textContent = ''; }

    try {
      const ctx = window.SillyTavern?.getContext?.();
      const chatName = ctx?.chatId || ctx?.chatName || ctx?.chat_file_name || '当前聊天';
      updateFavoritesModalSubtitle(modal, chatName);
    } catch {
      updateFavoritesModalSubtitle(modal, '当前聊天');
    }

    if (!detailEntries.length) {
      if (sidebarList) sidebarList.innerHTML = '<div class="stcj-modal-empty">当前聊天还没有收藏。</div>';
      if (mainList) mainList.innerHTML = '<div class="stcj-modal-empty">点击悬浮条 📌 进入点选收藏，或使用聊天中的快速跳转。</div>';
      return;
    }

    if (mainList) mainList.classList.add('is-single-view');
    if (!favoritesModalActiveId || !detailEntries.some((entry) => entry.item.id === favoritesModalActiveId)) {
      favoritesModalActiveId = detailEntries[0].item.id;
    }

    const activeEntry = detailEntries.find((entry) => entry.item.id === favoritesModalActiveId) || detailEntries[0];
    if (activeEntry && headRefs.title) {
      const activeSnapshot = getFavoriteResolvedSnapshot(activeEntry.item, activeEntry.resolution);
      const activeFloor = activeEntry.resolution.status === 'missing' ? '未定位楼层' : formatFloorLabel(activeEntry.resolution.mesId);
      const activeSwipe = formatFavoriteSwipeLabel(activeSnapshot?.swipeIndex ?? activeEntry.item.swipeIndex);
      const activeSendDate = formatFavoriteTimestamp(activeEntry.item.sendDate || activeEntry.resolution.message?.send_date || '');
      const statusLabel = getFavoriteStatusLabel(activeEntry.resolution.status, activeSnapshot);
      headRefs.title.textContent = `${activeFloor}${activeSwipe ? ` · ${activeSwipe}` : ''} · ${activeSendDate}${statusLabel ? ` · ${statusLabel}` : ''}`;
    }

    renderFavoritesSidebarList(modal, detailEntries);

    if (mainList) {
      const previewEntries = await buildFavoritePreviewEntries(activeEntry ? [activeEntry] : [], previewMode);
      if (renderSeq !== favoritesRenderSeq) return;

      if (!previewEntries.length) {
        mainList.innerHTML = '<div class="stcj-modal-empty">当前收藏内容不可用。</div>';
        return;
      }

      const { entry, previewResult } = previewEntries[0];
      const { item, resolution } = entry;
      const refs = ensureFavoritesDetailShell(mainList);
      if (!refs?.preview) return;

      const note = String(item.note || '').trim();
      const previewHtml = previewResult.html || '<div class="stcj-empty-copy">原消息内容不可用。</div>';
      if (headRefs.note) {
        if (note) {
          headRefs.note.hidden = false;
          headRefs.note.textContent = note;
        } else {
          headRefs.note.hidden = true;
          headRefs.note.textContent = '';
        }
      }

      headRefs.actionButtons?.forEach((button) => {
        button.setAttribute('data-fav-id', item.id);
      });

      refs.preview.classList.remove('is-loading');
      refs.preview.innerHTML = previewHtml;
      mainList.scrollTop = 0;
      hydrateFavoritePreviewByMode(previewMode, mainList, previewEntries);
    }
  }

  function openFavoritesManager(targetId = null) {
    favoritesModalOpen = true;
    if (targetId) favoritesModalActiveId = targetId;
    if (isFavoritesModalMobileLayout()) {
      favoritesSidebarDrawerOpen = false;
    }
    const modal = ensureFavoritesModalRoot();
    syncFavoritesSidebarState(modal);
    renderFavoritesManager();
    modal?.classList.add('is-open');
  }

  function closeFavPanel() {
    closeFavoriteQuickMenu();
    setPinMode(false);
    setFavPanelOpen(false);
  }

  function updateFavoritesUI(root) {
    const managerBtn = root.querySelector('.stcj-btn.stcj-favorites-manager');
    if (managerBtn) managerBtn.setAttribute('data-count', String(favoriteItems.length));

    root.classList.toggle('stcj-fav-open', favPanelOpen);
    updateFavPanelToggleButton(root);

    const hint = root.querySelector('.stcj-fav-hint');
    if (hint) {
      if (favoriteItems.length > 0 && !pinMode) {
        hint.style.display = '';
        hint.textContent = `显示最近 ${Math.min(FAVORITES_RECENT_LIMIT, favoriteItems.length)} 条收藏；更多请点击 📂 打开收藏管理器。`;
      } else {
        hint.style.display = '';
        hint.textContent = pinMode
          ? '点选楼层收藏：点击聊天中的目标楼层（ESC 退出点选）'
          : '点击 📌 进入点选收藏；点击 📂 打开收藏管理器。';
      }
    }

    const list = root.querySelector('.stcj-fav-list');
    if (!list) return;
    list.innerHTML = '';

    if (!favoriteItems.length) {
      const empty = document.createElement('div');
      empty.className = 'stcj-fav-empty';
      empty.textContent = '暂无收藏（当前聊天永久保存）';
      list.appendChild(empty);
      return;
    }

    const recentItems = getRecentFavoriteItems();
    recentItems.forEach((favItem) => {
      const resolution = ensureFavoriteResolved(favItem, resolveFavoriteTarget(favItem));
      const snapshot = getFavoriteResolvedSnapshot(favItem, resolution);
      const row = document.createElement('div');
      row.className = 'stcj-fav-item';
      row.setAttribute('data-favorite-id', String(favItem.id));
      row.title = getFavoriteStatusDescription(resolution.status, snapshot)
        || (resolution.status === 'missing'
          ? '未能在当前聊天中定位该收藏楼层'
          : `mesid=${resolution.mesId}`);

      const floor = document.createElement('div');
      floor.className = 'stcj-fav-floor stcj-fav-item-main';
      const floorText = formatFloorLabel(resolution?.mesId ?? favItem.messageId);
      const swipeIndex = getFavoriteResolvedSwipeIndex(favItem, resolution);
      const statusText = getFavoriteStatusLabel(resolution.status, snapshot);
      const note = String(favItem.note || '').trim();
      floor.innerHTML = `
        <span class="stcj-fav-item-topline">
          <span class="stcj-fav-floor-label">${escapeHtml(floorText)}</span>
          ${buildFavoriteSwipeBadgeHtml(swipeIndex)}
          ${statusText ? `<span class="stcj-fav-status" title="${escapeHtml(getFavoriteStatusDescription(resolution.status, snapshot) || statusText)}">${escapeHtml(statusText)}</span>` : ''}
        </span>
        ${note ? `<span class="stcj-fav-note">${escapeHtml(note)}</span>` : ''}
      `;

      const ops = document.createElement('div');
      ops.className = 'stcj-fav-item-ops';

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'stcj-fav-menu-btn';
      menuBtn.setAttribute('data-favorite-menu-trigger', favItem.id);
      menuBtn.title = '更多操作';
      setIcon(menuBtn, 'more');
      ops.appendChild(menuBtn);
      menuBtn.setAttribute('aria-expanded', favoriteQuickMenuId === favItem.id ? 'true' : 'false');

      row.appendChild(floor);
      row.appendChild(ops);
      list.appendChild(row);
    });

    if (favoriteItems.length > FAVORITES_RECENT_LIMIT) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'stcj-fav-more';
      more.setAttribute('data-favorite-open-manager', 'true');
      more.textContent = `查看全部 ${favoriteItems.length} 条收藏`;
      list.appendChild(more);
    }

    renderFavoriteQuickMenuOverlay();
    if (favPanelOpen) requestAnimationFrame(() => applyFavoritePanelPosition(root, { force: true }));
  }

  function bindFavoritesPanel(root) {
    const panel = root.querySelector('.stcj-fav-panel');
    if (!panel) return;

    panel.addEventListener('contextmenu', (e) => e.preventDefault());

    const closeBtn = panel.querySelector('.stcj-fav-close');
    closeBtn?.addEventListener('pointerup', (e) => {
      if (isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      closeFavPanel();
    });

    panel.addEventListener('scroll', () => {
      closeFavoriteQuickMenu();
    }, { passive: true });

    panel.addEventListener('pointerup', async (e) => {
      if (isDragging) return;

      const managerBtn = e.target?.closest?.('[data-favorite-open-manager]');
      if (managerBtn) {
        e.preventDefault();
        e.stopPropagation();
        openFavoritesManager();
        return;
      }

      const menuTrigger = e.target?.closest?.('[data-favorite-menu-trigger]');
      if (menuTrigger) {
        e.preventDefault();
        e.stopPropagation();
        openFavoriteQuickMenu(menuTrigger.getAttribute('data-favorite-menu-trigger'));
        return;
      }

      const favoriteRow = e.target?.closest?.('.stcj-fav-item');
      if (!favoriteRow) return;

      const favoriteId = favoriteRow.getAttribute('data-favorite-id');
      if (!favoriteId) return;

      const favoriteItem = getFavoriteItemById(favoriteId);
      if (!favoriteItem) return;

      e.preventDefault();
      e.stopPropagation();
      await jumpToFavoriteItemFromRecentList(favoriteItem);
    });
  }


  function setFavPanelOpen(open) {
    favPanelOpen = !!open;

    const root = document.getElementById(ROOT_ID);
    if (root) {
      root.classList.toggle('stcj-fav-open', favPanelOpen);
      const panel = getFavoritePanelElement(root);
      if (panel) panel.setAttribute('aria-hidden', favPanelOpen ? 'false' : 'true');
      updateFavPanelToggleButton(root);
      updateFavoritesUI(root);
      if (favPanelOpen) requestAnimationFrame(() => applyFavoritePanelPosition(root, { force: true }));
    }

    // 关闭面板时一并退出点选模式
    if (!favPanelOpen) setPinMode(false);
  }

  function setPinMode(on) {
    pinMode = !!on;

    try {
      document.body.classList.toggle(BODY_PIN_MODE_CLASS, pinMode);
    } catch {
      /* ignore */
    }

    const root = document.getElementById(ROOT_ID);
    if (root) {
      const pinBtn = root.querySelector('.stcj-btn.stcj-pin');
      pinBtn?.classList.toggle('stcj-pin-active', pinMode);
      updateFavoritesUI(root);
    }

    if (pinMode) attachPinPickListeners();
    else detachPinPickListeners();
  }

  function togglePinMode() {
    // 第一次点：打开面板并进入点选
    if (!favPanelOpen) setFavPanelOpen(true);

    setPinMode(!pinMode);

    if (pinMode) toastInfo('点选收藏：请点击要收藏的楼层（按 ESC 退出）');
  }


  function bindRootOutsideClose(root) {
    const onPointerDown = (e) => {
      if (root.contains(e.target)) return;
      if (document.getElementById(FAVORITES_MODAL_ID)?.contains(e.target)) return;
      if (document.getElementById(FAVORITE_QUICK_MENU_OVERLAY_ID)?.contains(e.target)) return;
      closeFavoriteQuickMenu();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      try {
        document.removeEventListener('pointerdown', onPointerDown, true);
      } catch {
        /* ignore */
      }
    };
  }

  function onPinPointerDown(e) {
    if (!pinMode) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pinDown = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  }

  function onPinPointerUp(e) {
    if (!pinMode) return;

    if (pinDown && pinDown.pointerId !== e.pointerId) return;
    const down = pinDown;
    pinDown = null;
    if (!down) return;

    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const CLICK_THRESHOLD = 8;
    if (Math.hypot(dx, dy) > CLICK_THRESHOLD) return; // 认为是拖拽/滚动

    const root = document.getElementById(ROOT_ID);
    if (root && root.contains(e.target)) return; // 点在插件自身上

    const mesEl = e.target?.closest?.('#chat .mes[mesid]');
    if (!mesEl) return;

    const mesId = parseInt(mesEl.getAttribute('mesid') || '', 10);
    if (Number.isNaN(mesId)) return;

    // 在点选模式下，拦截点击，避免触发酒馆自身的消息交互
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    const added = addFavorite(mesId);
    if (root) updateFavoritesUI(root);

    if (added) toastSuccess(`已收藏：${formatFloorLabel(mesId)}`);

    // 阻止本次点击（click 事件）继续触发酒馆自身逻辑
    suppressNextChatClick = true;
    setTimeout(() => {
      suppressNextChatClick = false;
    }, 400);

    // 一次点选后自动退出点选模式，但保留收藏面板
    setPinMode(false);
  }

  function onPinClickCapture(e) {
    const mesEl = e.target?.closest?.('#chat .mes[mesid]');
    if (!mesEl) return;

    const root = document.getElementById(ROOT_ID);
    if (root && root.contains(e.target)) return;

    if (!pinMode && !suppressNextChatClick) return;

    suppressNextChatClick = false;

    // 捕获阶段拦截 click，避免触发消息选择/菜单等行为
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }

  function onPinKeyDown(e) {
    if (!pinMode) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setPinMode(false);
    }
  }

  function attachPinPickListeners() {
    if (pinListenersAttached) return;
    pinListenersAttached = true;
    document.addEventListener('pointerdown', onPinPointerDown, true);
    document.addEventListener('pointerup', onPinPointerUp, true);
    document.addEventListener('click', onPinClickCapture, true);
    document.addEventListener('keydown', onPinKeyDown, true);
  }

  function detachPinPickListeners() {
    if (!pinListenersAttached) return;
    pinListenersAttached = false;
    document.removeEventListener('pointerdown', onPinPointerDown, true);
    document.removeEventListener('pointerup', onPinPointerUp, true);
    document.removeEventListener('click', onPinClickCapture, true);
    document.removeEventListener('keydown', onPinKeyDown, true);
  }

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

    setPinMode(false);
    setFavPanelOpen(false);
    closeFavoriteQuickMenu();
    if (clearRange) setActiveRange(null);
    clearQuickEditState();

    favoriteSyncSeq += 1;
    refreshFavoritesFromMetadata();

    const root = document.getElementById(ROOT_ID);
    if (root) updateFavoritesUI(root);

    if (favoritesModalOpen) {
      renderFavoritesManager();
    }
  }

  function attachChatChangeListeners() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const es = ctx?.eventSource;
      const et = ctx?.event_types;
      if (!es || !et) return null;

      const handler = () => resetTempFavorites('event', { clearRange: true });

      const keys = [
        'CHAT_CHANGED',
        'CHAT_LOADED',
        'CHAT_SELECTED',
        'OPEN_CHAT',
        'SWITCH_CHAT',
        'CHARACTER_CHANGED',
        'CHARACTER_SELECTED',
        'GROUP_CHANGED',
        'GROUP_SELECTED',
      ];

      const events = keys.map((k) => et[k]).filter(Boolean);
      const uniq = [...new Set(events)];
      uniq.forEach((ev) => es.on?.(ev, handler));

      return () => {
        try {
          uniq.forEach((ev) => es.removeListener?.(ev, handler));
        } catch {
          /* ignore */
        }
      };
    } catch {
      return null;
    }
  }

  function startChatWatch() {
    if (chatWatchInterval) return;

    try {
      const ctx = window.SillyTavern?.getContext?.();
      lastChatKey = getChatKey();
      lastChatRef = ctx?.chat || null;
      lastChatLen = Array.isArray(ctx?.chat) ? ctx.chat.length : null;
    } catch {
      lastChatKey = null;
      lastChatRef = null;
      lastChatLen = null;
    }

    chatWatchInterval = setInterval(() => {
      try {
        const ctx = window.SillyTavern?.getContext?.();
        if (!ctx) return;

        const key = getChatKey();
        const ref = ctx.chat || null;
        const len = Array.isArray(ctx.chat) ? ctx.chat.length : null;

        // 1) 有 chatKey 时优先用 key 判断
        if (key && lastChatKey && key !== lastChatKey) {
          lastChatKey = key;
          lastChatRef = ref;
          lastChatLen = len;
          resetTempFavorites('key', { clearRange: true });
          return;
        }
        if (!lastChatKey && key) lastChatKey = key;

        // 2) 尝试用 chat 数组引用变化判断
        if (ref && lastChatRef && ref !== lastChatRef) {
          lastChatKey = key || lastChatKey;
          lastChatRef = ref;
          lastChatLen = len;
          // chat 数组引用变化噪声较大（编辑/刷新时也可能变化），这里只清理收藏，不动区间视图
          resetTempFavorites('ref', { clearRange: false });
          return;
        }
        if (!lastChatRef && ref) lastChatRef = ref;

        // 3) 兜底：切换聊天时常会先清空 chat
        if (
          typeof len === 'number' &&
          typeof lastChatLen === 'number' &&
          len === 0 &&
          lastChatLen > 0 &&
          favoriteItems.length
        ) {
          lastChatKey = key || lastChatKey;
          lastChatRef = ref || lastChatRef;
          lastChatLen = len;
          resetTempFavorites('len', { clearRange: true });
          return;
        }

        lastChatLen = len;
      } catch {
        /* ignore */
      }
    }, 1000);
  }

  function getRootMaxOffsets(root) {
    const rect = root.getBoundingClientRect();
    return {
      maxLeft: Math.max(0, window.innerWidth - rect.width),
      maxTop: Math.max(0, window.innerHeight - rect.height),
    };
  }

  function persistRootPosition(root, left, top) {
    const { maxLeft, maxTop } = getRootMaxOffsets(root);

    const clampedLeft = clamp(left, 0, maxLeft);
    const clampedTop = clamp(top, 0, maxTop);

    root.style.left = `${clampedLeft}px`;
    root.style.top = `${clampedTop}px`;

    settings.x = Math.round(clampedLeft);
    settings.y = Math.round(clampedTop);
    // maxLeft/maxTop 为 0（悬浮窗尺寸 >= 视口）时保留原有 rx/ry，避免被错误清零
    if (maxLeft > 0) {
      settings.rx = clamp(clampedLeft / maxLeft, 0, 1);
    }
    if (maxTop > 0) {
      settings.ry = clamp(clampedTop / maxTop, 0, 1);
    }
    saveSettings();
    applyFavoritePanelPosition(root, { force: true });
  }

  // 仅设置 DOM 位置（不反算 rx/ry、不触发保存），用于「恢复已保存位置」场景
  function setRootPositionOnly(root, left, top) {
    const { maxLeft, maxTop } = getRootMaxOffsets(root);
    const clampedLeft = clamp(left, 0, maxLeft);
    const clampedTop = clamp(top, 0, maxTop);

    root.style.left = `${clampedLeft}px`;
    root.style.top = `${clampedTop}px`;
    settings.x = Math.round(clampedLeft);
    settings.y = Math.round(clampedTop);
    applyFavoritePanelPosition(root, { force: true });
  }

  function clampRootIntoViewport(root) {
    const left = parseFloat(root.style.left || '0') || 0;
    const top = parseFloat(root.style.top || '0') || 0;
    persistRootPosition(root, left, top);
  }

  function applyRootPositionFromSettings(root) {
    const { maxLeft, maxTop } = getRootMaxOffsets(root);

    // 优先使用相对位置（rx/ry）：直接设置 DOM 位置，不反算不保存，保持 rx/ry 权威值
    if (typeof settings.rx === 'number' && typeof settings.ry === 'number') {
      setRootPositionOnly(root, settings.rx * maxLeft, settings.ry * maxTop);
      return;
    }

    // 兼容旧版本：使用像素位置，并转换为相对位置
    if (typeof settings.x === 'number' && typeof settings.y === 'number') {
      persistRootPosition(root, settings.x, settings.y);
      return;
    }

    // 默认：右侧中部
    const padding = 12;
    const left = Math.max(padding, maxLeft - padding);
    const top = Math.max(padding, Math.round(window.innerHeight * 0.35));

    persistRootPosition(root, left, top);
  }

  function scheduleRepositionOnResize(root) {
    try {
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }

      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;

        // 有相对位置时：直接设置 DOM 位置，不触发保存
        if (typeof settings.rx === 'number' && typeof settings.ry === 'number') {
          const { maxLeft, maxTop } = getRootMaxOffsets(root);
          setRootPositionOnly(root, settings.rx * maxLeft, settings.ry * maxTop);
          return;
        }

        // 兜底：仅做 clamp（旧版像素坐标，需转换保存）
        clampRootIntoViewport(root);
      });
    } catch {
      // 极少数环境不支持 rAF：直接处理
      if (typeof settings.rx === 'number' && typeof settings.ry === 'number') {
        const { maxLeft, maxTop } = getRootMaxOffsets(root);
        setRootPositionOnly(root, settings.rx * maxLeft, settings.ry * maxTop);
        return;
      }
      clampRootIntoViewport(root);
    }
  }

  function syncScaleControls() {
    const slider = document.getElementById('stcj-size-slider');
    if (slider) {
      slider.value = String(getRootScalePercent());
      slider.style.setProperty('--stcj-slider-progress', `${getRootScaleSliderProgress()}%`);
    }

    const valueEl = document.getElementById('stcj-size-value');
    if (valueEl) valueEl.textContent = formatRootScalePercent();
  }

  function applyRootScale(root) {
    if (!root) return;

    const scale = normalizeRootScale(settings.scale);
    root.style.setProperty('--stcj-scale', String(scale));

    if (root.classList.contains('stcj-global-hidden')) return;

    if (typeof settings.rx === 'number' && typeof settings.ry === 'number') {
      const { maxLeft, maxTop } = getRootMaxOffsets(root);
      persistRootPosition(root, settings.rx * maxLeft, settings.ry * maxTop);
      return;
    }

    const left = parseFloat(root.style.left || '0') || 0;
    const top = parseFloat(root.style.top || '0') || 0;
    persistRootPosition(root, left, top);
  }

  function setRootScale(scale) {
    const nextScale = normalizeRootScale(scale);
    if (settings.scale === nextScale) {
      syncScaleControls();
      return;
    }

    settings.scale = nextScale;
    saveSettings();
    syncScaleControls();

    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    applyRootScale(root);
  }

  function setOrientation(orientation) {
    settings.orientation = orientation;
    saveSettings();

    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    root.classList.toggle('stcj-horizontal', orientation === 'horizontal');
    root.classList.toggle('stcj-vertical', orientation === 'vertical');

    updateOrientationToggleButton(root);
    updatePrevNextButtons(root);

    // 切换后尺寸可能变化：按相对位置重新摆放并 clamp
    if (typeof settings.rx === 'number' && typeof settings.ry === 'number') {
      const { maxLeft, maxTop } = getRootMaxOffsets(root);
      persistRootPosition(root, settings.rx * maxLeft, settings.ry * maxTop);
      return;
    }

    clampRootIntoViewport(root);
  }

  function toggleOrientation() {
    setOrientation(settings.orientation === 'horizontal' ? 'vertical' : 'horizontal');
    toastInfo(`Chat Jumper 已切换为${settings.orientation === 'horizontal' ? '横向' : '纵向'}布局`);
  }

  function setCollapsed(collapsed) {
    settings.collapsed = !!collapsed;
    saveSettings();

    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    // 收起/展开时保持按钮栏的“屏幕位置”不跳动
    const left = parseFloat(root.style.left || '0') || 0;
    const top = parseFloat(root.style.top || '0') || 0;

    root.classList.toggle('stcj-collapsed', settings.collapsed);
    updateCollapseToggleButton(root);

    // 收起时关闭收藏面板/点选模式
    if (settings.collapsed) {
      closeFavPanel();
      closeFavoritesManager();
    }

    // 用原 left/top 重新落位，仅在越界时做 clamp
    persistRootPosition(root, left, top);
  }

  function toggleCollapse() {
    setCollapsed(!settings.collapsed);
  }

  function loadGlobalHidden() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return false;
      const ext = ctx.extensionSettings[EXT_SETTINGS_KEY];
      if (ext && typeof ext.globalHidden === 'boolean') {
        return ext.globalHidden;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  function saveGlobalHidden(hidden) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[EXT_SETTINGS_KEY].globalHidden = !!hidden;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  function toggleGlobalHide() {
    globalHidden = !globalHidden;

    saveGlobalHidden(globalHidden);

    const root = document.getElementById(ROOT_ID);
    if (root) {
      root.classList.toggle('stcj-global-hidden', globalHidden);
      if (!globalHidden) applyRootScale(root);
    }

    // 更新设置面板中的按钮文本
    const btn = document.getElementById('stcj-global-hide-btn');
    if (btn) {
      btn.textContent = globalHidden ? '显示悬浮条' : '一键隐藏悬浮条';
      btn.title = globalHidden
        ? '点击恢复 ST Chat Jumper 悬浮跳转条'
        : '点击一键隐藏 ST Chat Jumper 悬浮跳转条（不影响按钮显隐设置）';
    }

    if (globalHidden) {
      toastInfo('ST Chat Jumper 悬浮条已隐藏，可在扩展设置中恢复');
    }
  }

  function attachDrag(root) {
    const DRAG_THRESHOLD = 6;
    const LONG_PRESS_MS = 320;
    let longPressTimer = null;
    let captureTarget = null;

    // 禁止长按/右键菜单
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    const resetDragFeedbackState = () => {
      root.classList.remove('stcj-drag-arming', 'stcj-dragging');
    };

    const clearLongPressTimer = () => {
      if (longPressTimer === null) return;
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
      root.classList.remove('stcj-drag-arming');
    };

    root.addEventListener('pointerdown', (e) => {
      // 仅允许主指针拖动
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (dragPointerId !== null) return;
      if (e.target instanceof Element && e.target.closest('.stcj-fav-panel')) return;

      isDragging = false;
      dragPointerId = e.pointerId;
      suppressButtonActionUntil = 0;
      dragStart.x = e.clientX;
      dragStart.y = e.clientY;
      dragStart.left = parseFloat(root.style.left || '0') || 0;
      dragStart.top = parseFloat(root.style.top || '0') || 0;
      resetDragFeedbackState();
      root.classList.add('stcj-drag-arming');

      captureTarget = e.target instanceof Element ? e.target : root;

      // 立刻捕获指针，避免长按后手指滑出悬浮条时丢失事件
      try {
        captureTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }

      clearLongPressTimer();
      longPressTimer = window.setTimeout(() => {
        if (dragPointerId !== e.pointerId) return;
        isDragging = true;
        suppressButtonActions();
        triggerHapticFeedback();
        root.classList.remove('stcj-drag-arming');
        root.classList.add('stcj-dragging');
      }, LONG_PRESS_MS);
    });

    root.addEventListener('pointermove', (e) => {
      if (dragPointerId !== e.pointerId) return;

      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      if (!isDragging) {
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          clearLongPressTimer();
        }
        return;
      }

      e.preventDefault();

      const rect = root.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);

      const left = clamp(dragStart.left + dx, 0, maxLeft);
      const top = clamp(dragStart.top + dy, 0, maxTop);

      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
    });

    const finish = () => {
      const wasDragging = isDragging;
      clearLongPressTimer();
      resetDragFeedbackState();

      try {
        if (wasDragging) {
          const left = parseFloat(root.style.left || '0') || 0;
          const top = parseFloat(root.style.top || '0') || 0;
          persistRootPosition(root, left, top);
        }
      } finally {
        if (wasDragging) suppressButtonActions();
        isDragging = false;
        dragPointerId = null;
        captureTarget = null;
      }
    };

    root.addEventListener('pointerup', (e) => {
      if (dragPointerId !== e.pointerId) return;
      try {
        captureTarget?.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      finish();
    });

    root.addEventListener('pointercancel', (e) => {
      if (dragPointerId !== e.pointerId) return;
      try {
        captureTarget?.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      finish();
    });
  }

  function bindButtons(root) {
    /** @type {NodeListOf<HTMLElement>} */
    const btns = root.querySelectorAll('.stcj-btn, .stcj-range-chip-main[data-action]');

    btns.forEach((btn) => {
      // 禁止长按/右键菜单
      btn.addEventListener('contextmenu', (e) => e.preventDefault());

      btn.addEventListener('pointerup', async (e) => {
        // 如果刚刚拖拽，则不触发按钮动作
        if (isDragging || shouldSuppressButtonAction()) return;
        if (btn.classList.contains('stcj-disabled')) return;

        const rect = btn.getBoundingClientRect();
        const isPointerInside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (!isPointerInside) return;

        const action = btn.getAttribute('data-action');
        if (!action) return;

        await handleAction(action);

      });
    });
  }


  // ===== 设置面板 & 按钮布局管理 =====

  /**
   * 按钮 ID → DOM 选择器 的映射。
   * 用于在 #stcj-root 中定位对应的 DOM 元素。
   */
  const BUTTON_DOM_MAP = {
    toggleCollapse:    '.stcj-btn[data-action="toggleCollapse"]',
    recent3:           '.stcj-btn[data-action="recent3"]',
    recent2:           '.stcj-btn[data-action="recent2"]',
    recent1:           '.stcj-btn[data-action="recent1"]',
    quickPage:         '.stcj-btn[data-action="quickPage"]',
    quickPageLeft:     '.stcj-btn[data-action="quickPageLeft"]',
    showRange:         '.stcj-btn[data-action="showRange"]',
    toggleOrientation: '.stcj-btn[data-action="toggleOrientation"]',
    prev:              '.stcj-btn[data-action="prev"]',
    next:              '.stcj-btn[data-action="next"]',
    currentHead:       '.stcj-btn[data-action="currentHead"]',
    currentTail:       '.stcj-btn[data-action="currentTail"]',
    quickEdit:         '.stcj-btn[data-action="quickEdit"]',
    pinGroup:          '.stcj-pin-group',
  };

  /**
   * 根据当前设置，调整 #stcj-root 内按钮的可见性和顺序。
   * - 不可见的按钮添加 stcj-settings-hidden class
   * - 按 order 重新排列 DOM 子元素
   * - 收藏面板 (.stcj-fav-panel) 始终保持固定位置
   */
  function refreshButtonLayout() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const buttonsCfg = getButtonSettings();
    const cfgMap = new Map(buttonsCfg.map(b => [b.id, b]));

    // showRange 关联的额外元素（resetRange 按钮 + rangeChip 指示器）
    const RANGE_GROUP_EXTRA = [
      '.stcj-range-stack',
    ];

    // 1) 应用可见性
    for (const [btnId, selector] of Object.entries(BUTTON_DOM_MAP)) {
      const el = root.querySelector(selector);
      if (!el) continue;
      const cfg = cfgMap.get(btnId);
      const enabled = cfg ? cfg.enabled : true;
      el.classList.toggle('stcj-settings-hidden', !enabled);

      // showRange 同时控制关联元素
      if (btnId === 'showRange') {
        for (const extraSel of RANGE_GROUP_EXTRA) {
          const extraEl = root.querySelector(extraSel);
          if (extraEl) extraEl.classList.toggle('stcj-settings-hidden', !enabled);
        }
      }
    }

    // 2) 按 order 排序：收集所有可排序的元素
    const favPanel = root.querySelector('.stcj-fav-panel');

    // 获取排序后的按钮 ID 列表
    const sortedCfg = [...buttonsCfg].sort((a, b) => a.order - b.order);

    // 收集需要排序的元素
    const sortableElements = [];
    for (const cfg of sortedCfg) {
      const selector = BUTTON_DOM_MAP[cfg.id];
      if (!selector) continue;
      const el = root.querySelector(selector);
      if (el) sortableElements.push(el);

      // showRange：将关联元素紧跟其后
      if (cfg.id === 'showRange') {
        for (const extraSel of RANGE_GROUP_EXTRA) {
          const extraEl = root.querySelector(extraSel);
          if (extraEl) sortableElements.push(extraEl);
        }
      }
    }

    // 3) 重新插入：排序后的按钮在前，收藏面板始终放在最后
    // 先移除所有可排序元素（不移除 favPanel）
    for (const el of sortableElements) {
      if (el.parentNode === root) root.removeChild(el);
    }

    // 在 favPanel 之前插入排序后的按钮（如果 favPanel 存在）
    const insertBefore = favPanel || null;
    for (const el of sortableElements) {
      root.insertBefore(el, insertBefore);
    }
  }

  /**
   * 获取按钮的标签（显示名称）
   */
  function getButtonLabel(btnId) {
    const def = CONFIGURABLE_BUTTONS.find(b => b.id === btnId);
    return def ? def.label : btnId;
  }

  /**
   * 在 #extensions_settings2 中挂载设置面板
   */
  function mountSettingsPanel() {
    const PANEL_ID = 'stcj-settings-panel';

    // 防重复
    if (document.getElementById(PANEL_ID)) return;

    const container = document.getElementById('extensions_settings2');
    if (!container) {
      log('未找到 #extensions_settings2，设置面板未挂载');
      return;
    }

    const html = `
      <div id="${PANEL_ID}" class="stcj-ext-settings">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>ST Chat Jumper</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <div class="stcj-settings-global-toggle">
              <button id="stcj-global-hide-btn" class="menu_button" title="点击一键隐藏 ST Chat Jumper 悬浮跳转条（不影响按钮显隐设置）">
                一键隐藏悬浮条
              </button>
            </div>
            <div class="stcj-settings-size">
              <div class="stcj-settings-size-header">
                <div class="stcj-settings-size-copy">
                  <span class="stcj-settings-size-title">悬浮条大小</span>
                </div>
                <span id="stcj-size-value">${formatRootScalePercent()}</span>
              </div>
              <input id="stcj-size-slider" class="text_pole" type="range" min="${MIN_SCALE * 100}" max="${MAX_SCALE * 100}" step="${SCALE_STEP * 100}" value="${getRootScalePercent()}" />
              <div class="stcj-settings-size-scale" aria-hidden="true">
                <span>50%</span><span>75%</span><span>100%</span><span>125%</span><span>150%</span>
              </div>
            </div>
            <div class="stcj-settings-range-options">
              <div class="stcj-settings-range-options-title">区间/跳转 设置</div>
              <div class="stcj-settings-range-row-inline">
                <div class="stcj-settings-range-cell">
                  <label class="stcj-settings-range-label" for="stcj-range-context-input">跳转上下文</label>
                  <input id="stcj-range-context-input" class="text_pole stcj-settings-range-input" type="number" min="1" step="1" value="${getRangeContext()}" title="输入楼层号跳转时，前后各加载多少层（默认 ${DEFAULT_RANGE_CONTEXT}）" />
                </div>
                <div class="stcj-settings-range-cell">
                  <label class="stcj-settings-range-label" for="stcj-range-step-input">翻页步长</label>
                  <input id="stcj-range-step-input" class="text_pole stcj-settings-range-input" type="number" min="1" step="1" value="${getRangeStep()}" title="区间激活后点击 ◀/▶ 每次平移的楼层数（默认 ${DEFAULT_RANGE_STEP}）" />
                </div>
                <div class="stcj-settings-range-cell stcj-settings-range-mode-cell">
                  <label class="stcj-settings-range-label" for="stcj-range-mode-toggle">翻页模式</label>
                  <button id="stcj-range-mode-toggle" class="stcj-range-mode-toggle ${getRangePagingMode() === 'shift' ? 'is-shift' : 'is-expand'}" type="button" title="左：扩展模式；右：平移模式" aria-label="区间翻页模式切换" aria-pressed="${getRangePagingMode() === 'shift' ? 'true' : 'false'}">
                    <span class="stcj-range-mode-label stcj-range-mode-label-left">扩展</span>
                    <span class="stcj-range-mode-label stcj-range-mode-label-right">平移</span>
                    <span class="stcj-range-mode-thumb" aria-hidden="true"></span>
                  </button>
                </div>
              </div>
            </div>
            <div class="stcj-settings-hint">
              <small>勾选以显示/隐藏按钮，拖拽 <i class="fa-solid fa-grip-vertical"></i> 调整按钮顺序。</small>
            </div>
            <div id="stcj-settings-button-list" class="stcj-settings-list">
            </div>
          </div>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', html);
    renderSettingsButtonList();

    // 绑定一键隐藏按钮
    const globalHideBtn = document.getElementById('stcj-global-hide-btn');
    if (globalHideBtn) {
      globalHideBtn.addEventListener('click', toggleGlobalHide);
      // 恢复按钮文本（如果之前已经隐藏）
      if (globalHidden) {
        globalHideBtn.textContent = '显示悬浮条';
        globalHideBtn.title = '点击恢复 ST Chat Jumper 悬浮跳转条';
      }
    }

    const sizeSlider = document.getElementById('stcj-size-slider');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', (e) => {
        setRootScale(Number(e.target.value) / 100);
      });
      sizeSlider.addEventListener('change', (e) => {
        setRootScale(Number(e.target.value) / 100);
      });
    }

    syncScaleControls();

    // 绑定区间翻页步长输入框
    const rangeStepInput = document.getElementById('stcj-range-step-input');
    if (rangeStepInput) {
      rangeStepInput.addEventListener('change', (e) => {
        const val = Math.max(1, Math.round(Number(e.target.value) || DEFAULT_RANGE_STEP));
        e.target.value = val;
        saveRangeStep(val);
      });
    }

    // 绑定跳转上下文输入框
    const rangeContextInput = document.getElementById('stcj-range-context-input');
    if (rangeContextInput) {
      rangeContextInput.addEventListener('change', (e) => {
        const val = Math.max(1, Math.round(Number(e.target.value) || DEFAULT_RANGE_CONTEXT));
        e.target.value = val;
        saveRangeContext(val);
      });
    }

    const rangeModeToggle = document.getElementById('stcj-range-mode-toggle');
    if (rangeModeToggle) {
      rangeModeToggle.addEventListener('click', () => {
        const current = getRangePagingMode();
        const next = current === 'shift' ? 'expand' : 'shift';
        saveRangePagingMode(next);
        rangeModeToggle.classList.toggle('is-shift', next === 'shift');
        rangeModeToggle.classList.toggle('is-expand', next !== 'shift');
        rangeModeToggle.setAttribute('aria-pressed', next === 'shift' ? 'true' : 'false');
        rangeModeToggle.title = next === 'shift' ? '当前：平移模式（右）' : '当前：扩展模式（左）';
      });
    }

    log('设置面板已挂载到 #extensions_settings2');
  }

  /**
   * 渲染设置面板中的按钮列表（含复选框 + 拖拽排序）
   */
  function renderSettingsButtonList() {
    const listEl = document.getElementById('stcj-settings-button-list');
    if (!listEl) return;

    const buttonsCfg = getButtonSettings();
    const sorted = [...buttonsCfg].sort((a, b) => a.order - b.order);

    listEl.innerHTML = '';

    for (const cfg of sorted) {
      const label = getButtonLabel(cfg.id);

      const item = document.createElement('div');
      item.className = 'stcj-settings-item';
      item.draggable = true;
      item.dataset.btnId = cfg.id;

      item.innerHTML = `
        <span class="stcj-settings-drag" title="拖拽排序">
          <i class="fa-solid fa-grip-vertical"></i>
        </span>
        <label class="stcj-settings-label">
          <input type="checkbox" class="stcj-settings-check" data-btn-id="${cfg.id}" ${cfg.enabled ? 'checked' : ''} />
          <span>${label}</span>
        </label>
      `;

      listEl.appendChild(item);
    }

    // 绑定复选框事件
    listEl.querySelectorAll('.stcj-settings-check').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const btnId = e.target.dataset.btnId;
        const buttons = getButtonSettings();
        const cfg = buttons.find(b => b.id === btnId);
        if (cfg) {
          cfg.enabled = e.target.checked;
          saveButtonSettings(buttons);
          refreshButtonLayout();
        }
      });
    });

    // 绑定拖拽排序
    initSettingsDragDrop(listEl);
  }

  /**
   * 设置面板的拖拽排序
   */
  function initSettingsDragDrop(listEl) {
    let draggedItem = null;

    listEl.querySelectorAll('.stcj-settings-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        item.classList.add('stcj-settings-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.btnId);
      });

      item.addEventListener('dragend', () => {
        if (draggedItem) draggedItem.classList.remove('stcj-settings-dragging');
        draggedItem = null;
        listEl.querySelectorAll('.stcj-settings-item').forEach(i => {
          i.classList.remove('stcj-settings-dragover');
        });
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (item === draggedItem) return;

        listEl.querySelectorAll('.stcj-settings-item').forEach(i => {
          i.classList.remove('stcj-settings-dragover');
        });
        item.classList.add('stcj-settings-dragover');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('stcj-settings-dragover');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('stcj-settings-dragover');
        if (!draggedItem || item === draggedItem) return;

        // DOM 重排
        const allItems = [...listEl.querySelectorAll('.stcj-settings-item')];
        const draggedIdx = allItems.indexOf(draggedItem);
        const targetIdx = allItems.indexOf(item);

        if (draggedIdx < targetIdx) {
          listEl.insertBefore(draggedItem, item.nextSibling);
        } else {
          listEl.insertBefore(draggedItem, item);
        }

        // 更新 order 并保存
        const buttons = getButtonSettings();
        const items = listEl.querySelectorAll('.stcj-settings-item');
        items.forEach((el, index) => {
          const id = el.dataset.btnId;
          const cfg = buttons.find(b => b.id === id);
          if (cfg) cfg.order = index;
        });

        saveButtonSettings(buttons);
        refreshButtonLayout();
      });
    });
  }

  function buildUI() {
    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.title = '长按悬浮条即可拖动位置';
    root.className = `stcj-root stcj-${settings.orientation}`;

    root.innerHTML = `
      <div class="stcj-btn stcj-mini stcj-collapse" data-action="toggleCollapse"></div>
      <div class="stcj-btn" data-action="recent3" title="最近第3楼（跳到头部）">${ICONS.num(3)}</div>
      <div class="stcj-btn" data-action="recent2" title="最近第2楼（跳到头部）">${ICONS.num(2)}</div>
      <div class="stcj-btn" data-action="recent1" title="最近第1楼（跳到头部）">${ICONS.num(1)}</div>
      <div class="stcj-btn" data-action="quickPage" title="快速翻页(右)：点击最新楼层的右翻页按钮">${ICONS.fastForward}</div>
      <div class="stcj-btn" data-action="quickPageLeft" title="快速翻页(左)：点击最新楼层的左翻页按钮">${ICONS.fastBackward}</div>
      <div class="stcj-btn" data-action="showRange" title="跳转/区间显示（输入楼层号或区间）">${ICONS.range}</div>
      <div class="stcj-range-stack stcj-hidden" aria-hidden="true">
        <div class="stcj-range-chip" aria-live="polite" aria-hidden="true">
          <div class="stcj-btn stcj-mini stcj-range-nav" data-action="rangePrev" title="向前扩展区间">${ICONS.chevronLeft}</div>
          <div class="stcj-range-chip-main" data-action="editRange" title="修改当前区间">
            <span class="stcj-range-chip-label">区间</span>
            <span class="stcj-range-chip-value">-</span>
          </div>
          <div class="stcj-btn stcj-mini stcj-range-nav" data-action="rangeNext" title="向后扩展区间">${ICONS.chevronRight}</div>
        </div>
        <div class="stcj-btn stcj-hidden stcj-range-reset-text" data-action="resetRange" title="恢复默认聊天视图">恢复</div>
      </div>
      <div class="stcj-btn stcj-toggle" data-action="toggleOrientation"></div>
      <div class="stcj-btn" data-action="prev" title="上一楼（跳到头部）"></div>
      <div class="stcj-btn" data-action="next" title="下一楼（跳到头部）"></div>
      <div class="stcj-btn" data-action="currentHead" title="当前楼层：对齐到头部">${ICONS.head}</div>
      <div class="stcj-btn" data-action="currentTail" title="当前楼层：对齐到尾部">${ICONS.tail}</div>
      <div class="stcj-btn" data-action="quickEdit" title="快速编辑：选中文字可高亮定位；无选中则编辑当前楼层">${ICONS.pencil}</div>

      <div class="stcj-pin-group">
        <div class="stcj-btn stcj-pin" data-action="togglePin" title="收藏楼层：点选收藏">${ICONS.pin}</div>
        <div class="stcj-btn stcj-favorites-manager" data-action="openFavoritesManager" title="打开收藏管理器">${ICONS.folder}</div>
        <div class="stcj-btn stcj-pin-arrow" data-action="toggleFavPanel"></div>
      </div>

      <div class="stcj-fav-panel" aria-hidden="true">
        <div class="stcj-fav-header">
          <div class="stcj-fav-title">${ICONS.pin} 最近收藏</div>
          <div class="stcj-fav-close" title="关闭">${ICONS.close}</div>
        </div>
        <div class="stcj-fav-hint"></div>
        <div class="stcj-fav-list"></div>
        <div class="stcj-fav-resize" title="拖动调整大小" aria-hidden="true"></div>
      </div>
    `;

    document.body.appendChild(root);

    // 初始布局
    root.style.setProperty('--stcj-scale', String(normalizeRootScale(settings.scale)));
    root.classList.toggle('stcj-horizontal', settings.orientation === 'horizontal');
    root.classList.toggle('stcj-vertical', settings.orientation === 'vertical');
    root.classList.toggle('stcj-collapsed', !!settings.collapsed);
    updateOrientationToggleButton(root);
    updateCollapseToggleButton(root);
    updatePrevNextButtons(root);
    updateFavPanelToggleButton(root);
    refreshFavoritesFromMetadata();
    updateFavoritesUI(root);
    updateRangeButtons(root);
    updateQuickEditButton(root);

    // 初始位置：临时禁用 CSS 过渡，避免 scale 过渡动画影响尺寸计算
    const prevTransition = root.style.transition;
    root.style.transition = 'none';
    applyRootPositionFromSettings(root);
    // 恢复 CSS 过渡
    root.style.transition = prevTransition;

    // 延迟修正：布局完全稳定后重新定位，消除初始化时瞬时尺寸导致的偏差
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyRootPositionFromSettings(root);
      });
    });

    attachDrag(root);
    bindButtons(root);
    bindFavoritesPanel(root);
    attachFavoritePanelDrag(root);
    attachFavoritePanelResize(root);
    applyFavoritePanelSize(root);
    detachOutsideClose = bindRootOutsideClose(root);

    // 监听聊天切换，切换到对应聊天文件的永久收藏
    detachChatListeners = attachChatChangeListeners();
    startChatWatch();

    // 窗口尺寸变化时，保持相对位置（并保证不跑出屏幕）
    const onResize = () => scheduleRepositionOnResize(root);
    window.addEventListener('resize', onResize);

    // 暴露清理函数
    window[`${PLUGIN_NS}Cleanup`] = () => {
      try {
        window.removeEventListener('resize', onResize);
      } catch {
        /* ignore */
      }

      try {
        detachChatListeners?.();
        detachChatListeners = null;
      } catch {
        /* ignore */
      }

      try {
        detachOutsideClose?.();
        detachOutsideClose = null;
      } catch {
        /* ignore */
      }

      try {
        if (chatWatchInterval) {
          clearInterval(chatWatchInterval);
          chatWatchInterval = null;
        }
      } catch {
        /* ignore */
      }

      try {
        detachPinPickListeners();
      } catch {
        /* ignore */
      }

      try {
        clearQuickEditState();
      } catch {
        /* ignore */
      }

      try {
        if (quickEditMirror && quickEditMirror.parentNode) {
          quickEditMirror.parentNode.removeChild(quickEditMirror);
        }
        quickEditMirror = null;
      } catch {
        /* ignore */
      }

      try {
        if (resizeRaf) {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = null;
        }
      } catch {
        /* ignore */
      }

      try {
        if (favoritesSaveTimer) {
          clearTimeout(favoritesSaveTimer);
          favoritesSaveTimer = null;
        }
      } catch {
        /* ignore */
      }

      try {
        ensureFavoritesPreviewMessageListener.detach?.();
        favoritesPreviewMessageListenerAttached = false;
      } catch {
        /* ignore */
      }

      try {
        ensureFavoritesModalResizeListener.detach?.();
        ensureFavoritesModalResizeListener.bound = false;
      } catch {
        /* ignore */
      }

      try {
        closeFavoritesManager();
        document.getElementById(FAVORITES_MODAL_ID)?.remove();
      } catch {
        /* ignore */
      }

      try {
        root.remove();
      } catch {
        /* ignore */
      }
    };

    // 应用按钮可见性与排序
    refreshButtonLayout();

    // 恢复全局隐藏状态
    globalHidden = loadGlobalHidden();
    favoritesPreviewMode = loadFavoritesPreviewMode();
    root.classList.toggle('stcj-global-hidden', globalHidden);

    // 挂载扩展设置面板
    mountSettingsPanel();

    log('UI 已注入');
  }

  async function waitUntilReady() {
    // 优先监听 APP_READY；否则轮询
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const es = ctx?.eventSource;
      const et = ctx?.event_types;
      if (es && et?.APP_READY) {
        await new Promise((resolve) => {
          const done = () => {
            try {
              es.removeListener?.(et.APP_READY, done);
            } catch {
              /* ignore */
            }
            resolve();
          };
          es.on(et.APP_READY, done);
          setTimeout(done, 5000);
        });
        return;
      }
    } catch {
      /* ignore */
    }

    // 兜底轮询
    for (let i = 0; i < 60; i++) {
      if (window.SillyTavern?.getContext && document.getElementById('chat')) return;
      // eslint-disable-next-line no-await-in-loop
      await sleep(500);
    }
  }

  async function init() {
    // 避免重复注入
    if (document.getElementById(ROOT_ID)) return;

    await waitUntilReady();

    // 如果依然没有聊天容器，则延迟再试
    if (!document.getElementById('chat')) {
      setTimeout(init, 1000);
      return;
    }

    buildUI();
  }

  init();
})();
