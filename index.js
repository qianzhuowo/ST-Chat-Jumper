/*
 * ST Chat Jumper
 * - 悬浮可拖拽
 * - 横/竖布局（按钮切换）
 * - 快速跳转：最近3楼、上一楼（头部）、下一楼（头部）
 * - H/L：对齐“当前楼层”的头部/尾部（用于精确定位）
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
  let lastChatLen = null;

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
    if (wrapper) return wrapper;

    // 极少数布局可能把 wrapper 放在 #chat 内部，做一层兜底
    const inner = chat.querySelector?.('.simplebar-content-wrapper');
    if (inner) return inner;

    return chat;
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

      // 覆盖顶部探针的消息：优先；如果出现多个（极少见），取 rect.top 更大的那个（更贴近顶部）
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

    const lastId = getLastMessageId();
    const targetId = clamp(mesId, 0, lastId);

    // 先尝试用 chat-jump 让虚拟滚动加载目标消息（这一步通常会把目标滚到中间）
    await trySlashChatJump(targetId);

    // 再等待 DOM 出现后，用 scrollIntoView 精确对齐到头/尾
    const el = await waitForMessageElement(targetId, 2000);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block });
      flashMessage(el);
      return true;
    }

    // 兜底：滚动到顶部/底部
    if (targetId <= 0) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    }

    if (targetId >= lastId) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      return true;
    }

    toastWarn('未能定位到目标楼层（可能被虚拟滚动隐藏），请稍后重试。');
    return false;
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

      // 布局切换
      case 'toggleOrientation':
        toggleOrientation();
        return;

      // 收藏：打开面板并进入点选
      case 'togglePin':
        togglePinMode();
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

      default:
        return;
    }
  }

  function updateOrientationToggleButton(root) {
    const btn = root.querySelector('.stcj-btn[data-action="toggleOrientation"]');
    if (!btn) return;

    const isHorizontal = settings.orientation === 'horizontal';
    btn.textContent = isHorizontal ? '↕' : '↔';
    btn.title = isHorizontal ? '切换为竖向布局' : '切换为横向布局';
  }

  function updateCollapseToggleButton(root) {
    const btn = root.querySelector('.stcj-btn[data-action="toggleCollapse"]');
    if (!btn) return;

    const collapsed = !!settings.collapsed;
    btn.textContent = collapsed ? '+' : '–';
    btn.title = collapsed ? '展开跳转栏' : '收起跳转栏';
  }

  function updatePrevNextButtons(root) {
    const prev = root.querySelector('.stcj-btn[data-action="prev"]');
    const next = root.querySelector('.stcj-btn[data-action="next"]');
    if (!prev || !next) return;

    const isVertical = settings.orientation === 'vertical';
    prev.textContent = isVertical ? '↑' : '<';
    next.textContent = isVertical ? '↓' : '>';
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
      hint.textContent = pinMode
        ? '点选楼层收藏：点击聊天中的目标楼层（ESC 退出点选）'
        : '点击 📌 进入点选收藏；点击条目可跳转到该楼层顶部';
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
      remove.textContent = '×';

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
    const onDocPointerUp = (e) => {
      try {
        if (!favPanelOpen) return;
        if (pinMode) return;
        if (isDragging) return;
        if (settings.collapsed) return;

        // 点在插件内部则不关闭
        if (root.contains(e.target)) return;

        closeFavPanel();
      } catch {
        /* ignore */
      }
    };

    document.addEventListener('pointerup', onDocPointerUp, true);

    return () => {
      try {
        document.removeEventListener('pointerup', onDocPointerUp, true);
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
      <div class="stcj-btn stcj-mini stcj-collapse" data-action="toggleCollapse" title="收起跳转栏">–</div>
      <div class="stcj-btn" data-action="recent3" title="最近第3楼（跳到头部）">3</div>
      <div class="stcj-btn" data-action="recent2" title="最近第2楼（跳到头部）">2</div>
      <div class="stcj-btn" data-action="recent1" title="最近第1楼（跳到头部）">1</div>
      <div class="stcj-btn stcj-toggle" data-action="toggleOrientation" title="切换横/竖布局">↔</div>
      <div class="stcj-btn" data-action="prev" title="上一楼（跳到头部）">&lt;</div>
      <div class="stcj-btn" data-action="next" title="下一楼（跳到头部）">&gt;</div>
      <div class="stcj-btn" data-action="currentHead" title="当前楼层：对齐到头部">H</div>
      <div class="stcj-btn" data-action="currentTail" title="当前楼层：对齐到尾部">L</div>
      <div class="stcj-btn stcj-pin" data-action="togglePin" title="收藏楼层：点选收藏（仅本页临时）">📌</div>

      <div class="stcj-fav-panel" aria-hidden="true">
        <div class="stcj-fav-header">
          <div class="stcj-fav-title">收藏</div>
          <div class="stcj-fav-close" title="关闭">×</div>
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
    updateFavoritesUI(root);

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
