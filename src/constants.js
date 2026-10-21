// Stable DOM identifiers, storage keys and default values. No instance state.
export const PLUGIN_NS = 'stcj';

export const ROOT_ID = 'stcj-root';

export const STORAGE_KEY = 'st_chat_jumper_settings_v1';

export const BODY_PIN_MODE_CLASS = 'stcj-pin-mode';

export const DEFAULT_ORIENTATION = 'vertical';

export const DEFAULT_SCALE = 1;

export const MIN_SCALE = 0.5;

export const MAX_SCALE = 1.5;

export const SCALE_STEP = 0.01;

export const DEFAULT_RANGE_STEP = 10;

export const DEFAULT_RANGE_CONTEXT = 20;

export const DEFAULT_RANGE_PAGING_MODE = 'expand';

export const DEFAULT_SETTINGS = {
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

export const FAV_PANEL_MIN_W = 160;

export const FAV_PANEL_MIN_H = 120;

export const FAV_PANEL_MAX_W = 640;

export const FAV_PANEL_MAX_H = 720;

export const EXT_SETTINGS_KEY = 'ST-Chat-Jumper';

export const CONFIGURABLE_BUTTONS = [
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
    { id: 'quickDelete',       label: '快速删除 (🗑️)',      defaultEnabled: true, order: 13 },
    { id: 'pinGroup',          label: '收藏 (📌)',          defaultEnabled: true, order: 14 },
  ];

export const FAVORITES_METADATA_KEY = 'stcjFavorites';

export const FAVORITES_SAVE_DEBOUNCE = 120;

export const FAVORITES_RECENT_LIMIT = 5;

export const FAVORITES_MODAL_ID = 'stcj-favorites-modal';

export const FAVORITES_MODAL_DRAWER_BREAKPOINT = 900;

export const FAVORITES_MODAL_CARD_PREFIX = 'stcj-fav-card';

export const FAVORITE_QUICK_MENU_OVERLAY_ID = 'stcj-fav-quick-menu-overlay';

export const FAVORITES_PREVIEW_MODES = {
    SWIPE_DEFAULT: 'swipe_default',
    SWIPE_HTML: 'swipe_html',
    STAR_MAIN: 'star_main',
  };

export const FAVORITES_PREVIEW_MODE_ORDER = [
    FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT,
    FAVORITES_PREVIEW_MODES.SWIPE_HTML,
    FAVORITES_PREVIEW_MODES.STAR_MAIN,
  ];

export const ICONS = {
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

export const QUICK_EDIT = {
    EDIT_BUTTON_SELECTORS: ['.mes_edit', '.fa-edit', '.fa-pencil'],
    DONE_BUTTON_SELECTOR: '.mes_edit_done',
    TEXT_CONTAINER_SELECTORS: ['.mes_text', '.mes_text_inner', '.mes_text_block'],
    EDIT_TEXTAREA_SELECTOR: '#curEditTextarea',
    SCROLL_INTO_VIEW_OFFSET: 120,
    EDITOR_SCROLL_ALIGNMENT_RATIO: 0.5,
  };

export const BUTTON_DOM_MAP = {
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
    quickDelete:       '.stcj-btn[data-action="quickDelete"]',
    pinGroup:          '.stcj-pin-group',
  };
