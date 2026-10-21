import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "clamp",
  "executeChatJump",
  "getChatContainer",
  "getChatScrollElement",
  "getCurrentChatId",
  "getHostContext",
  "getHostEventTypes",
  "getMessageElement",
  "log",
  "swipeLatest",
  "toastInfo",
  "toastWarn",
  "waitForDom"
];

export function createFeature({ state, dependencies, hostImports }) {
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

  function scrollMessageInChat(mesEl, block, behavior = 'instant') {
    const scrollEl = dependencies.getChatScrollElement();
    if (!mesEl || !scrollEl) return false;

    try {
      const vp = scrollEl.getBoundingClientRect();
      const rect = mesEl.getBoundingClientRect();

      let targetTop = scrollEl.scrollTop;
      if (block === 'end') targetTop += rect.bottom - vp.bottom;
      else targetTop += rect.top - vp.top;

      const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      targetTop = dependencies.clamp(targetTop, 0, max);

      if (typeof scrollEl.scrollTo === 'function') {
        // auto 会继承宿主 CSS 的 scroll-behavior，不能保证没有动画。
        scrollEl.scrollTo({ top: targetTop, behavior: behavior === 'auto' ? 'instant' : behavior });
      } else {
        scrollEl.scrollTop = targetTop;
      }
      return true;
    } catch (e) {
      dependencies.log('scrollMessageInChat failed', e);
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
      dependencies.log('触发点击失败', e);
      return false;
    }
  }

  async function quickFlipLatestMessagePage(direction = 'right') {
    const isLeft = direction === 'left';
    const directionText = isLeft ? '左' : '右';
    const pageDirectionText = isLeft ? '上一' : '下一';
    const lastId = getLastMessageId();
    const ctx = dependencies.getHostContext();
    if (!Number.isFinite(lastId) || lastId < 0) { dependencies.toastWarn('未找到最新楼层。'); return false; }
    if (typeof ctx?.swipe?.to !== 'function') { dependencies.toastWarn(`当前环境不支持${directionText}翻页。`); return false; }
    const identity = dependencies.getCurrentChatId(ctx);
    try {
      await dependencies.swipeLatest(isLeft ? hostImports.SWIPE_DIRECTION.LEFT : hostImports.SWIPE_DIRECTION.RIGHT);
      if (identity !== dependencies.getCurrentChatId()) return false;
      return true;
    } catch (e) {
      dependencies.log('swipe.to 失败', e);
      dependencies.toastInfo(`最新楼层当前没有${pageDirectionText}页可翻。`);
      return false;
    }
  }

  function getAnchorMessageElement() {
    const chat = dependencies.getChatContainer();
    const nodes = Array.from(chat?.querySelectorAll?.('.mes[mesid]') || []);
    if (!nodes.length) return null;

    const scrollEl = dependencies.getChatScrollElement();
    if (!scrollEl) return nodes[nodes.length - 1];
    const vpRect = scrollEl.getBoundingClientRect();
    const vpTop = Number.isFinite(vpRect.top) ? vpRect.top : 0;
    const vpBottom = Number.isFinite(vpRect.bottom) && vpRect.bottom > vpTop
      ? vpRect.bottom
      : window.innerHeight || document.documentElement.clientHeight || 0;
    const probeY = dependencies.clamp(vpTop + 2, 0, Math.max(0, (window.innerHeight || vpBottom) - 1));
    const probeX = dependencies.clamp(vpRect.left + Math.min(Math.max(vpRect.width / 2, 8), Math.max(8, vpRect.width - 8)), 0, Math.max(0, window.innerWidth - 1));

    // 先从真实命中栈寻找覆盖聊天视口顶部的消息，避免 IntersectionObserver root/缓存滞后选错楼层。
    try {
      const hit = document.elementsFromPoint(probeX, probeY)
        .map((el) => el.closest?.('#chat .mes[mesid]'))
        .find((el) => el && chat.contains(el));
      if (hit) return hit;
    } catch {
      /* geometry fallback below */
    }

    let covering = null;
    let coveringTop = -Infinity;
    let firstBelow = null;
    let firstBelowTop = Infinity;
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= vpTop || rect.top >= vpBottom) continue;
      if (rect.top <= probeY && rect.bottom >= probeY && rect.top > coveringTop) {
        covering = el;
        coveringTop = rect.top;
      } else if (rect.top > probeY && rect.top < firstBelowTop) {
        firstBelow = el;
        firstBelowTop = rect.top;
      }
    }
    if (covering || firstBelow) return covering || firstBelow;

    // 缓存只作为末级回退，不再决定正常的当前楼层。
    for (const id of state.navigation.visibleMessageIds) {
      const el = dependencies.getMessageElement(id);
      if (el?.isConnected) return el;
    }
    return nodes[0];
  }

  function resetMessageVisibilityObservers() {
    try { state.navigation.messageVisibilityObserver?.disconnect(); } catch { /* ignore */ }
    state.navigation.messageVisibilityObserver = null;
    try { state.navigation.messageDomObserver?.disconnect(); } catch { /* ignore */ }
    state.navigation.messageDomObserver = null;
    state.navigation.visibleMessageIds.clear();
  }

  function scheduleMessageVisibilityObserverReset() {
    try {
      resetMessageVisibilityObservers();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { ensureMessageVisibilityObservers(); }
          catch (error) { console.warn('[STCJ] visibility-observer', { stage: 'ensure', error }); }
        });
      });
    } catch (error) {
      console.warn('[STCJ] visibility-observer', { stage: 'schedule', error });
    }
  }

  function ensureMessageVisibilityObservers() {
    const chat = dependencies.getChatContainer();
    if (!chat || state.navigation.messageDomObserver || typeof window.IntersectionObserver !== 'function') return;
    state.navigation.messageVisibilityObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
      const id = parseInt(entry.target.getAttribute('mesid') || '', 10);
      if (!Number.isNaN(id)) entry.isIntersecting ? state.navigation.visibleMessageIds.add(id) : state.navigation.visibleMessageIds.delete(id);
    }), { root: dependencies.getChatScrollElement(), threshold: 0.01 });
    const observe = (root) => {
      if (!state.navigation.messageVisibilityObserver) return;
      if (root.matches?.('.mes[mesid]')) state.navigation.messageVisibilityObserver.observe(root);
      root.querySelectorAll?.('.mes[mesid]').forEach((el) => state.navigation.messageVisibilityObserver?.observe(el));
    };
    observe(chat);
    if (typeof window.MutationObserver === 'function') {
      state.navigation.messageDomObserver = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => node.nodeType === 1 && observe(node))));
      state.navigation.messageDomObserver.observe(chat, { childList: true, subtree: true });
    }
  }

  function alignCurrentMessage(block) {
    const element = getAnchorMessageElement();
    if (!element) return false;
    return scrollMessageInChat(element, block, 'auto');
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

  function captureViewportAnchor() {
    const scrollEl = dependencies.getChatScrollElement();
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

  function restoreViewportAnchor(state) {
    const scrollEl = dependencies.getChatScrollElement();
    if (!state || !scrollEl) return false;

    const el = document.querySelector(`#chat .mes[mesid="${state.mesId}"]`);
    if (!el) return false;

    try {
      const vp = scrollEl.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const currentOffset = rect.top - vp.top;
      const delta = currentOffset - state.offsetTop;
      const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      const targetTop = dependencies.clamp(scrollEl.scrollTop + delta, 0, max);
      scrollEl.scrollTo?.({ top: targetTop, behavior: 'auto' });
      if (typeof scrollEl.scrollTo !== 'function') scrollEl.scrollTop = targetTop;
      return true;
    } catch {
      return false;
    }
  }

  async function trySlashChatJump(mesId) { return dependencies.executeChatJump(mesId); }

  async function waitForMessageElement(mesId, timeoutMs) {
    const eventTypes = dependencies.getHostEventTypes();
    return dependencies.waitForDom({ root: dependencies.getChatContainer(), find: () => dependencies.getMessageElement(mesId), timeoutMs,
      events: [eventTypes.MORE_MESSAGES_LOADED, eventTypes.MESSAGE_RECEIVED, eventTypes.MESSAGE_UPDATED] });
  }

  async function jumpToMessage(mesId, block) {
    const chat = dependencies.getChatContainer();
    const scrollEl = dependencies.getChatScrollElement();
    if (!chat || !scrollEl) return false;

    const winPos = captureWindowScroll();

    const lastId = getLastMessageId();
    const targetId = dependencies.clamp(mesId, 0, lastId);

    // 已渲染的消息直接精确滚动；否则才借助 /chat-jump 加载历史消息。
    let el = dependencies.getMessageElement(targetId);
    if (!el) {
      await trySlashChatJump(targetId);
      restoreWindowScrollStable(winPos);
      el = await waitForMessageElement(targetId, 2000);
    }

    if (el) {
      scrollMessageInChat(el, block, 'auto');
      restoreWindowScrollStable(winPos);
      return true;
    }

    // 兜底：滚动到顶部/底部
    if (targetId <= 0) {
      scrollEl.scrollTo({ top: 0, behavior: 'instant' });
      restoreWindowScrollStable(winPos);
      return true;
    }

    if (targetId >= lastId) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'instant' });
      restoreWindowScrollStable(winPos);
      return true;
    }

    dependencies.toastWarn('未能定位到目标楼层（可能被虚拟滚动隐藏），请稍后重试。');
    restoreWindowScrollStable(winPos);
    return false;
  }

  return { captureWindowScroll, restoreWindowScroll, restoreWindowScrollStable, scrollMessageInChat, getLastMessageId, getLatestMessageElement, triggerElementClick, quickFlipLatestMessagePage, getAnchorMessageElement, resetMessageVisibilityObservers, scheduleMessageVisibilityObserverReset, ensureMessageVisibilityObservers, alignCurrentMessage, getAnchorMesId, captureViewportAnchor, restoreViewportAnchor, trySlashChatJump, waitForMessageElement, jumpToMessage };
}
