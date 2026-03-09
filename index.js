/*
 * ST Chat Jumper
 * - 悬浮可拖拽
 * - 横/竖布局（按钮切换）
 * - 快速跳转：最近3楼、上一楼（头部）、下一楼（头部）
 * - H/L：对齐“当前楼层”的头部/尾部（用于精确定位）
 * - 显示楼层区间 / 恢复默认视图
 * - 临时收藏列表
 */

(function () {
  'use strict';

  const PLUGIN_NS = 'stcj';
  const ROOT_ID = 'stcj-root';
  const STORAGE_KEY = 'st_chat_jumper_settings_v1';
  const BODY_PIN_MODE_CLASS = 'stcj-pin-mode';

  /** @type {'horizontal'|'vertical'} */
  const DEFAULT_ORIENTATION = 'vertical';

  /**
   * x/y: 兼容旧版本的像素坐标（仍会写入，方便调试）
   * rx/ry: 相对位置（0~1），用于窗口尺寸变化时保持相对位置
   * collapsed: 是否收起按钮栏（仅保留拖拽手柄+收起按钮）
   * @type {{x: number|null, y: number|null, rx: number|null, ry: number|null, orientation: 'horizontal'|'vertical', collapsed: boolean}}
   */
  const DEFAULT_SETTINGS = {
    x: null,
    y: null,
    rx: null,
    ry: null,
    orientation: DEFAULT_ORIENTATION,
    collapsed: false,
  };

  /** @type {{x: number|null, y: number|null, rx: number|null, ry: number|null, orientation: 'horizontal'|'vertical', collapsed: boolean}} */
  let settings = loadSettings();

  let isDragging = false;
  let dragPointerId = null;
  let dragStart = { x: 0, y: 0, left: 0, top: 0 };
  let resizeRaf = null;

  // ===== 收藏（仅当前页面，不持久化） =====
  /** @type {number[]} */
  let favoriteMesIds = [];
  let favPanelOpen = false;
  let pinMode = false;

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
    head: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7M5 5h14"/></svg>',
    tail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7M5 19h14"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    num: (n) => `<svg viewBox="0 0 24 24" fill="none"><text x="50%" y="55%" dominant-baseline="central" text-anchor="middle" font-weight="500" font-size="16" fill="currentColor" font-family="var(--sans-font, sans-serif)">${n}</text></svg>`,
    range: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v6l-4 2v-8L3 4z"></path></svg>',
    restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15A9 9 0 1 1 23 10"></path></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
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

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        x,
        y,
        rx,
        ry,
        orientation,
        collapsed,
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
    EDITOR_SCROLL_ALIGNMENT_RATIO: 0.3,
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

      const getPartText = (p) => {
        if (p == null) return '';
        if (typeof p === 'string') return p;
        if (typeof p === 'object' && 'text' in p) return String(p.text ?? '');
        return String(p);
      };

      const joinMaybeParts = (val) => {
        if (val == null) return '';
        if (Array.isArray(val)) return val.map(getPartText).join('');
        return String(val);
      };

      // swipes 优先
      if (Array.isArray(msg.swipes) && msg.swipes.length > 0) {
        const rawSwipeId =
          Number.isInteger(msg.swipe_id) ? msg.swipe_id :
            (Number.isInteger(msg.swipeId) ? msg.swipeId :
              (Number.isInteger(msg.swipeID) ? msg.swipeID : 0));
        const idx = Math.trunc(clamp(rawSwipeId, 0, Math.max(0, msg.swipes.length - 1)));
        const swipe = msg.swipes[idx];
        const text = joinMaybeParts(swipe);
        if (text) return text;
      }

      const base = msg.mes ?? msg.message ?? msg.text;
      const out = joinMaybeParts(base);
      return out || null;
    } catch {
      return null;
    }
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

  function scrollTextareaToSelection(textarea) {
    try {
      const mirror = ensureQuickEditMirror(textarea);
      const style = getComputedStyle(textarea);
      mirror.style.width = `${textarea.clientWidth}px`;
      mirror.style.padding = `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`;
      mirror.style.font = style.font;
      mirror.style.fontSize = style.fontSize;
      mirror.style.fontFamily = style.fontFamily;
      mirror.style.fontWeight = style.fontWeight;
      mirror.style.lineHeight = style.lineHeight;

      const pos = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : 0;
      mirror.textContent = textarea.value.substring(0, pos);

      const caretY = mirror.offsetHeight;
      let target = caretY - textarea.clientHeight * QUICK_EDIT.EDITOR_SCROLL_ALIGNMENT_RATIO;
      target = Math.max(0, target);
      const max = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
      target = Math.min(max, target);
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

      // 4) 调整视口位置（避免编辑器跑到屏幕外）
      scrollMessageInChat(mesEl, 'start', 'auto');
      restoreWindowScrollStable(winPos);
      scrollMessageToComfortPosition(mesEl);

      // 5) 打开编辑器
      if (!clickMessageEditButton(mesEl)) {
        toastWarn('未找到该楼层的编辑按钮（.mes_edit）。');
        return false;
      }

      const textarea = await waitForEditTextarea(mesEl, 5000);
      if (!textarea) {
        toastWarn('编辑器未出现（超时），请稍后重试。');
        return false;
      }

      // 6) 在编辑器中高亮定位（改进点：使用“前后上下文”+“模糊匹配”）
      if (selectionCtx?.selectedText?.trim()) {
        const raw = textarea.value;
        const ctxRaw = getRawMessageTextFromContext(targetMesId);

        const match = computeBestMatchForTextarea(raw, ctxRaw, selectionCtx);

        if (match) {
          textarea.focus();
          textarea.setSelectionRange(match.start, match.end);
          scrollTextareaToSelection(textarea);
        } else {
          // 找不到也没关系：至少打开编辑器并聚焦
          textarea.focus();
          textarea.scrollTop = 0;
          toastInfo('已打开编辑器，但未能在原文中匹配到你选中的显示文本（可能被正则/HTML 渲染改写）。可尝试重新选择更长的片段/包含前后更多文字。');
        }
      } else {
        textarea.focus();
        textarea.scrollTop = 0;
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
    const editBtn = root.querySelector('.stcj-btn[data-action="editRange"]');
    const rangeChip = root.querySelector('.stcj-range-chip');
    const rangeValue = root.querySelector('.stcj-range-chip-value');
    const isActive = !!activeRange;
    const currentText = formatRangeText(activeRange);

    root.classList.toggle('stcj-range-active', isActive);

    if (rangeChip) {
      rangeChip.classList.toggle('stcj-show', isActive);
      rangeChip.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    }

    if (rangeValue) rangeValue.textContent = currentText;

    if (rangeBtn) {
      rangeBtn.title = isActive
        ? `显示楼层区间（当前：${currentText}）`
        : '显示楼层区间';
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
  }

  function setActiveRange(range) {
    activeRange = range;

    const root = document.getElementById(ROOT_ID);
    if (root) updateRangeButtons(root);
  }

  function parseRangeInput(raw, maxId) {
    if (typeof raw !== 'string') return null;
    const match = raw.trim().replace(/\s+/g, '').match(/^(\d+)-(\d+)$/);
    if (!match) return null;

    const start = Number(match[1]);
    const end = Number(match[2]);

    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 0 || start > end || end > maxId) return null;

    return { start, end };
  }

  async function showRangePrompt(maxId) {
    const tip = `请输入显示区间（格式: 0-10，范围: 0-${maxId}）`;
    const defaultValue = activeRange
      ? `${activeRange.start}-${activeRange.end}`
      : `0-${Math.min(10, maxId)}`;

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

  async function showFloorRange() {
    const ctx = window.SillyTavern?.getContext?.();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : null;
    const chatEl = getChatContainer();

    if (!chat || !chatEl || chat.length === 0) {
      toastWarn('当前聊天为空，无法按区间显示。');
      return false;
    }

    const maxId = chat.length - 1;
    const input = await showRangePrompt(maxId);
    if (!input) {
      toastError('未填入有效区间。');
      return false;
    }

    const range = parseRangeInput(input, maxId);
    if (!range) {
      toastError(`未填入有效区间（应为 0-${maxId} 内的 a-b）。`);
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

    getChatScrollElement()?.scrollTo?.({ top: 0, behavior: 'auto' });
    setActiveRange(range);
    toastSuccess(`已显示楼层区间：${range.start}-${range.end}`);
    return true;
  }

  async function restoreDefaultRangeView() {
    if (!activeRange) {
      toastInfo('当前已是默认聊天视图。');
      return true;
    }

    try {
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
        return false;
      }

      setActiveRange(null);
      toastSuccess('已恢复默认聊天视图。');
      return true;
    } catch (e) {
      log('恢复默认聊天视图失败', e);
      toastError('恢复默认聊天视图失败，请稍后重试。');
      return false;
    }
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

      // 收起/展开
      case 'toggleCollapse':
        toggleCollapse();
        return;

      // 楼层区间显示 / 恢复默认
      case 'showRange':
        return showFloorRange();
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

      // 收藏列表：展开/收起
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
    btn.title = favPanelOpen ? '收起收藏列表' : '展开收藏列表';
  }

  function formatFloorLabel(mesId) {
    // SillyTavern 的楼层/mesid 从 0 开始
    return `第 ${mesId} 楼`;
  }

  function setFavPanelOpen(open) {
    favPanelOpen = !!open;

    const root = document.getElementById(ROOT_ID);
    if (root) {
      root.classList.toggle('stcj-fav-open', favPanelOpen);
      updateFavPanelToggleButton(root);
      updateFavoritesUI(root);
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

  function closeFavPanel() {
    setPinMode(false);
    setFavPanelOpen(false);
  }

  function hasFavorite(mesId) {
    return favoriteMesIds.includes(mesId);
  }

  function addFavorite(mesId) {
    if (hasFavorite(mesId)) return false;
    favoriteMesIds.push(mesId);
    favoriteMesIds.sort((a, b) => a - b);
    return true;
  }

  function removeFavorite(mesId) {
    const idx = favoriteMesIds.indexOf(mesId);
    if (idx < 0) return false;
    favoriteMesIds.splice(idx, 1);
    return true;
  }

  function toggleFavorite(mesId) {
    if (hasFavorite(mesId)) {
      removeFavorite(mesId);
      return false;
    }

    addFavorite(mesId);
    return true;
  }

  function updateFavoritesUI(root) {
    const pinBtn = root.querySelector('.stcj-btn.stcj-pin');
    if (pinBtn) pinBtn.setAttribute('data-count', String(favoriteMesIds.length));

    root.classList.toggle('stcj-fav-open', favPanelOpen);

    const hint = root.querySelector('.stcj-fav-hint');
    if (hint) {
      if (favoriteMesIds.length > 0 && !pinMode) {
        // 已有收藏楼层且非点选模式时，隐藏说明文字
        hint.style.display = 'none';
      } else {
        hint.style.display = '';
        hint.textContent = pinMode
          ? '点选楼层收藏：点击聊天中的目标楼层（ESC 退出点选）'
          : '点击 📌 进入点选收藏；点击条目可跳转到该楼层顶部';
      }
    }

    const list = root.querySelector('.stcj-fav-list');
    if (!list) return;
    list.innerHTML = '';

    if (!favoriteMesIds.length) {
      const empty = document.createElement('div');
      empty.className = 'stcj-fav-empty';
      empty.textContent = '暂无收藏（仅本页临时有效）';
      list.appendChild(empty);
      return;
    }

    favoriteMesIds.forEach((mesId) => {
      const item = document.createElement('div');
      item.className = 'stcj-fav-item';
      item.setAttribute('data-mesid', String(mesId));
      item.title = `mesid=${mesId}`;

      const floor = document.createElement('div');
      floor.className = 'stcj-fav-floor';
      floor.textContent = formatFloorLabel(mesId);

      const remove = document.createElement('div');
      remove.className = 'stcj-fav-remove';
      remove.title = '移除';
      setIcon(remove, 'close');

      item.appendChild(floor);
      item.appendChild(remove);
      list.appendChild(item);
    });
  }

  function bindFavoritesPanel(root) {
    const panel = root.querySelector('.stcj-fav-panel');
    if (!panel) return;

    // 禁止长按/右键菜单
    panel.addEventListener('contextmenu', (e) => e.preventDefault());

    const closeBtn = panel.querySelector('.stcj-fav-close');
    closeBtn?.addEventListener('pointerup', (e) => {
      if (isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      closeFavPanel();
    });

    panel.addEventListener('pointerup', async (e) => {
      if (isDragging) return;

      const removeBtn = e.target?.closest?.('.stcj-fav-remove');
      if (removeBtn) {
        const item = removeBtn.closest('.stcj-fav-item');
        const mesId = parseInt(item?.getAttribute('data-mesid') || '', 10);
        if (!Number.isNaN(mesId)) {
          removeFavorite(mesId);
          updateFavoritesUI(root);
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const item = e.target?.closest?.('.stcj-fav-item');
      if (!item) return;

      const mesId = parseInt(item.getAttribute('data-mesid') || '', 10);
      if (Number.isNaN(mesId)) return;

      e.preventDefault();
      e.stopPropagation();

      await jumpToMessage(mesId, 'start');
    });
  }

  function bindRootOutsideClose(root) {
    // 取消“点击外部自动关闭收藏列表”的行为（用户反馈不方便）。
    // 保留函数结构，避免旧逻辑调用时报错；返回空清理函数。
    return () => {
      /* noop */
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

    const added = toggleFavorite(mesId);
    if (root) updateFavoritesUI(root);

    if (added) toastSuccess(`已收藏：${formatFloorLabel(mesId)}`);
    else toastInfo(`已取消收藏：${formatFloorLabel(mesId)}`);

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

  function resetTempFavorites(reason) {
    const hadAny = favoriteMesIds.length > 0;

    favoriteMesIds = [];
    setPinMode(false);
    setFavPanelOpen(false);
    setActiveRange(null);
    clearQuickEditState();

    const root = document.getElementById(ROOT_ID);
    if (root) updateFavoritesUI(root);

    if (hadAny) toastInfo(`聊天已切换：临时收藏已清空${reason ? `（${reason}）` : ''}`);
  }

  function attachChatChangeListeners() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const es = ctx?.eventSource;
      const et = ctx?.event_types;
      if (!es || !et) return null;

      const handler = () => resetTempFavorites('event');

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
          resetTempFavorites('key');
          return;
        }
        if (!lastChatKey && key) lastChatKey = key;

        // 2) 尝试用 chat 数组引用变化判断
        if (ref && lastChatRef && ref !== lastChatRef) {
          lastChatKey = key || lastChatKey;
          lastChatRef = ref;
          lastChatLen = len;
          resetTempFavorites('ref');
          return;
        }
        if (!lastChatRef && ref) lastChatRef = ref;

        // 3) 兜底：切换聊天时常会先清空 chat
        if (
          typeof len === 'number' &&
          typeof lastChatLen === 'number' &&
          len === 0 &&
          lastChatLen > 0 &&
          favoriteMesIds.length
        ) {
          lastChatKey = key || lastChatKey;
          lastChatRef = ref || lastChatRef;
          lastChatLen = len;
          resetTempFavorites('len');
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
    settings.rx = maxLeft > 0 ? clamp(clampedLeft / maxLeft, 0, 1) : 0;
    settings.ry = maxTop > 0 ? clamp(clampedTop / maxTop, 0, 1) : 0;
    saveSettings();
  }

  function clampRootIntoViewport(root) {
    const left = parseFloat(root.style.left || '0') || 0;
    const top = parseFloat(root.style.top || '0') || 0;
    persistRootPosition(root, left, top);
  }

  function applyRootPositionFromSettings(root) {
    const { maxLeft, maxTop } = getRootMaxOffsets(root);

    // 优先使用相对位置（rx/ry）
    if (typeof settings.rx === 'number' && typeof settings.ry === 'number') {
      persistRootPosition(root, settings.rx * maxLeft, settings.ry * maxTop);
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

        // 有相对位置时：按相对位置重新计算，保证窗口变化后仍保持相对位置
        if (typeof settings.rx === 'number' && typeof settings.ry === 'number') {
          const { maxLeft, maxTop } = getRootMaxOffsets(root);
          persistRootPosition(root, settings.rx * maxLeft, settings.ry * maxTop);
          return;
        }

        // 兜底：仅做 clamp
        clampRootIntoViewport(root);
      });
    } catch {
      // 极少数环境不支持 rAF：直接处理
      if (typeof settings.rx === 'number' && typeof settings.ry === 'number') {
        const { maxLeft, maxTop } = getRootMaxOffsets(root);
        persistRootPosition(root, settings.rx * maxLeft, settings.ry * maxTop);
        return;
      }
      clampRootIntoViewport(root);
    }
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
    if (settings.collapsed) closeFavPanel();

    // 用原 left/top 重新落位，仅在越界时做 clamp
    persistRootPosition(root, left, top);
  }

  function toggleCollapse() {
    setCollapsed(!settings.collapsed);
  }

  function attachDrag(root) {
    const handle = root.querySelector('.stcj-handle');
    if (!handle) return;

    const DRAG_THRESHOLD = 6;

    // 禁止长按/右键菜单
    handle.addEventListener('contextmenu', (e) => e.preventDefault());

    handle.addEventListener('pointerdown', (e) => {
      // 仅允许主指针拖动
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      isDragging = false;
      dragPointerId = e.pointerId;
      dragStart.x = e.clientX;
      dragStart.y = e.clientY;
      dragStart.left = parseFloat(root.style.left || '0') || 0;
      dragStart.top = parseFloat(root.style.top || '0') || 0;

      // 立刻捕获指针，避免手指滑出手柄后丢失事件
      try {
        handle.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    });

    handle.addEventListener('pointermove', (e) => {
      if (dragPointerId !== e.pointerId) return;

      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      if (!isDragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        isDragging = true;
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
      try {
        if (isDragging) {
          const left = parseFloat(root.style.left || '0') || 0;
          const top = parseFloat(root.style.top || '0') || 0;
          persistRootPosition(root, left, top);
        }
      } finally {
        isDragging = false;
        dragPointerId = null;
      }
    };

    handle.addEventListener('pointerup', (e) => {
      if (dragPointerId !== e.pointerId) return;
      try {
        handle.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      finish();
    });

    handle.addEventListener('pointercancel', (e) => {
      if (dragPointerId !== e.pointerId) return;
      try {
        handle.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      finish();
    });
  }

  function bindButtons(root) {
    /** @type {NodeListOf<HTMLElement>} */
    const btns = root.querySelectorAll('.stcj-btn');

    btns.forEach((btn) => {
      // 禁止长按/右键菜单
      btn.addEventListener('contextmenu', (e) => e.preventDefault());

      btn.addEventListener('pointerup', async () => {
        // 如果刚刚拖拽，则不触发按钮动作
        if (isDragging) return;
        if (btn.classList.contains('stcj-disabled')) return;

        const action = btn.getAttribute('data-action');
        if (!action) return;

        await handleAction(action);
      });
    });
  }

  function buildUI() {
    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = `stcj-root stcj-${settings.orientation}`;

    root.innerHTML = `
      <div class="stcj-handle" title="拖拽移动"></div>
      <div class="stcj-btn stcj-mini stcj-collapse" data-action="toggleCollapse"></div>
      <div class="stcj-btn" data-action="recent3" title="最近第3楼（跳到头部）">${ICONS.num(3)}</div>
      <div class="stcj-btn" data-action="recent2" title="最近第2楼（跳到头部）">${ICONS.num(2)}</div>
      <div class="stcj-btn" data-action="recent1" title="最近第1楼（跳到头部）">${ICONS.num(1)}</div>
      <div class="stcj-btn" data-action="showRange" title="显示楼层区间">${ICONS.range}</div>
      <div class="stcj-btn stcj-hidden" data-action="resetRange" title="恢复默认聊天视图">${ICONS.restore}</div>
      <div class="stcj-range-chip" aria-live="polite" aria-hidden="true">
        <span class="stcj-range-chip-label">区间</span>
        <span class="stcj-range-chip-value">-</span>
        <div class="stcj-btn stcj-mini stcj-range-edit" data-action="editRange" title="修改当前区间">改</div>
      </div>
      <div class="stcj-btn stcj-toggle" data-action="toggleOrientation"></div>
      <div class="stcj-btn" data-action="prev" title="上一楼（跳到头部）"></div>
      <div class="stcj-btn" data-action="next" title="下一楼（跳到头部）"></div>
      <div class="stcj-btn" data-action="currentHead" title="当前楼层：对齐到头部">${ICONS.head}</div>
      <div class="stcj-btn" data-action="currentTail" title="当前楼层：对齐到尾部">${ICONS.tail}</div>
      <div class="stcj-btn" data-action="quickEdit" title="快速编辑：选中文字可高亮定位；无选中则编辑当前楼层">${ICONS.pencil}</div>

      <div class="stcj-pin-group">
        <div class="stcj-btn stcj-pin" data-action="togglePin" title="收藏楼层：点选收藏">${ICONS.pin}</div>
        <div class="stcj-btn stcj-pin-arrow" data-action="toggleFavPanel"></div>
      </div>

      <div class="stcj-fav-panel" aria-hidden="true">
        <div class="stcj-fav-header">
          <div class="stcj-fav-title">${ICONS.pin} 收藏</div>
          <div class="stcj-fav-close" title="关闭">${ICONS.close}</div>
        </div>
        <div class="stcj-fav-hint"></div>
        <div class="stcj-fav-list"></div>
      </div>
    `;

    document.body.appendChild(root);

    // 初始布局
    root.classList.toggle('stcj-horizontal', settings.orientation === 'horizontal');
    root.classList.toggle('stcj-vertical', settings.orientation === 'vertical');
    root.classList.toggle('stcj-collapsed', !!settings.collapsed);
    updateOrientationToggleButton(root);
    updateCollapseToggleButton(root);
    updatePrevNextButtons(root);
    updateFavPanelToggleButton(root);
    updateFavoritesUI(root);
    updateRangeButtons(root);
    updateQuickEditButton(root);

    // 初始位置
    applyRootPositionFromSettings(root);

    attachDrag(root);
    bindButtons(root);
    bindFavoritesPanel(root);
    detachOutsideClose = bindRootOutsideClose(root);

    // 监听聊天切换，确保“临时收藏”不跨聊天文件
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
        root.remove();
      } catch {
        /* ignore */
      }
    };

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
