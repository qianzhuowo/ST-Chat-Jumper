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

    // 重要：收起/展开时保持按钮栏的“屏幕位置”不跳动。
    // 之前按 rx/ry 重新计算 left/top，会因为组件尺寸变化导致位置漂移（看起来像跳到中间）。
    const left = parseFloat(root.style.left || '0') || 0;
    const top = parseFloat(root.style.top || '0') || 0;

    root.classList.toggle('stcj-collapsed', settings.collapsed);
    updateCollapseToggleButton(root);

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
    `;

    document.body.appendChild(root);

    // 初始布局
    root.classList.toggle('stcj-horizontal', settings.orientation === 'horizontal');
    root.classList.toggle('stcj-vertical', settings.orientation === 'vertical');
    root.classList.toggle('stcj-collapsed', !!settings.collapsed);
    updateOrientationToggleButton(root);
    updateCollapseToggleButton(root);

    // 初始位置
    applyRootPositionFromSettings(root);

    attachDrag(root);
    bindButtons(root);

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
