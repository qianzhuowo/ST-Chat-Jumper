import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "log",
  "toastError"
];

export function createFeature({ state, dependencies, hostImports }) {
  function getHostContext() {
    try { return window.SillyTavern?.getContext?.() || null; } catch { return null; }
  }

  async function showHostDialog(type, text, initialValue = '') {
    const ctx = getHostContext();
    try {
      if (typeof ctx?.callGenericPopup === 'function' && ctx?.POPUP_TYPE?.[type] != null) {
        const content = document.createElement('div');
        content.style.whiteSpace = 'pre-wrap';
        content.textContent = text; // 备注等用户文本不能作为弹窗 HTML 解析。
        const result = await ctx.callGenericPopup(content, ctx.POPUP_TYPE[type], initialValue);
        return type === 'INPUT'
          ? (typeof result === 'string' ? result : null)
          : (result === true || result === (ctx.POPUP_RESULT?.AFFIRMATIVE ?? 1));
      }
      if (window.__TAURITAVERN__) throw new Error('宿主未提供可用的弹窗 API');
      // 仅供缺少 Popup API 的旧版浏览器酒馆使用。
      return type === 'INPUT' ? window.prompt(text, initialValue) : window.confirm(text);
    } catch (error) {
      dependencies.log('宿主弹窗失败', error);
      dependencies.toastError('无法打开宿主对话框，操作已取消。');
      return type === 'INPUT' ? null : false;
    }
  }

  function isHostManagedChatView() {
    return window.__TAURITAVERN__?.api?.chatSurface?.isManagedOwnershipRequired?.() === true;
  }

  function getHostEventTypes(ctx = getHostContext()) {
    return { ...(ctx?.event_types || {}), ...(ctx?.eventTypes || {}) };
  }

  function getCurrentChatId(ctx = getHostContext()) {
    try {
      const id = ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? ctx?.chat_id ?? ctx?.activeChatId ?? ctx?.active_chat_id;
      return id == null ? null : String(id);
    } catch { return null; }
  }

  function getChatContainer() { return document.getElementById('chat'); }

  function isScrollableElement(el, requireOverflowContent = true) {
    if (!el) return false;
    try {
      const style = getComputedStyle(el);
      const canScroll = /(auto|scroll|overlay)/.test(style.overflowY);
      return canScroll && (!requireOverflowContent || el.scrollHeight > el.clientHeight + 1);
    } catch { return false; }
  }

  function writeHostStyle(el, property, value) {
    if (!el?.style) return;
    let properties = state.host.hostStyleWrites.get(el);
    if (!properties) state.host.hostStyleWrites.set(el, properties = new Map());
    if (!properties.has(property)) properties.set(property, el.style.getPropertyValue(property));
    el.style.setProperty(property, value);
  }

  function restoreHostStyles() {
    state.host.hostStyleWrites.forEach((properties, el) => properties.forEach((value, property) => value ? el.style.setProperty(property, value) : el.style.removeProperty(property)));
    state.host.hostStyleWrites.clear();
  }

  function getChatScrollElement() {
    const chat = getChatContainer();
    if (!chat) return null;

    // 优先选择当前确实具有滚动范围的 #chat；主题若把滚动移到祖先，则选择具有实际滚动范围的祖先。
    let scrollEl = isScrollableElement(chat, true) ? chat : null;
    if (!scrollEl) {
      for (let node = chat.parentElement; node && node !== document.body; node = node.parentElement) {
        if (isScrollableElement(node, true)) { scrollEl = node; break; }
      }
    }
    // 空聊天/短聊天没有滚动范围时，标准 ST 仍以 #chat 作为后续滚动容器。
    scrollEl ||= isScrollableElement(chat, false) ? chat : null;
    scrollEl ||= chat;
    writeHostStyle(scrollEl, 'overscroll-behavior', 'contain');
    return scrollEl;
  }

  function getMessageElement(mesId) { return getChatContainer()?.querySelector?.(`.mes[mesid="${mesId}"]`) || null; }

  function waitForDom({ root = getChatContainer(), find, timeoutMs = 2000, events = [] }) {
    const found = find?.();
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => {
      let settled = false, observer = null, timer = null;
      const ctx = getHostContext();
      const finish = (value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); observer?.disconnect();
        events.forEach((event) => ctx?.eventSource?.removeListener?.(event, check));
        resolve(value || null);
      };
      const check = () => { const value = find?.(); if (value) finish(value); };
      if (root && window.MutationObserver) { observer = new MutationObserver(check); observer.observe(root, { childList: true, subtree: true }); }
      events.filter(Boolean).forEach((event) => ctx?.eventSource?.on?.(event, check));
      timer = setTimeout(() => finish(find?.()), timeoutMs);
    });
  }

  async function swipeLatest(direction) {
    const ctx = getHostContext();
    if (typeof ctx?.swipe?.to !== 'function') return false;
    // swipe.to 暴露的是 swipe(event, direction, options)；快速按钮没有可准确声明的宿主来源。
    await ctx.swipe.to(null, direction, {});
    return true;
  }

  async function openEditor(mesId) {
    try { await hostImports.messageEdit(mesId); return true; }
    catch (e) { dependencies.log('messageEdit 失败', e); return false; }
  }

  function commitEditor(mesEl) {
    const done = mesEl?.querySelector?.(constants.QUICK_EDIT.DONE_BUTTON_SELECTOR);
    if (done && typeof done.click === 'function') {
      done.click();
      return true;
    }
    return false;
  }

  function suppressHostJumpFlash(duration = 2200) {
    const chat = getChatContainer();
    if (!chat) return;
    chat.classList.add('stcj-suppress-host-flash');
    if (state.host.hostFlashSuppressTimer) clearTimeout(state.host.hostFlashSuppressTimer);
    state.host.hostFlashSuppressTimer = setTimeout(() => {
      chat.classList.remove('stcj-suppress-host-flash');
      chat.querySelectorAll('.mes.flash.animated').forEach((el) => {
        el.classList.remove('flash', 'animated');
        el.style.removeProperty('--animation-duration');
      });
      state.host.hostFlashSuppressTimer = null;
    }, duration);
  }

  async function executeChatJump(mesId) {
    const ctx = getHostContext();
    suppressHostJumpFlash();
    try {
      if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
        await ctx.executeSlashCommandsWithOptions(`/chat-jump ${mesId}`, { handleParserErrors: false });
        return true;
      }
    } catch (e) { dependencies.log('公开 chat-jump 执行失败，尝试兼容回退', e); }
    try {
      const cmd = ctx?.SlashCommandParser?.commands?.['chat-jump'] || window.SillyTavern?.SlashCommandParser?.commands?.['chat-jump'];
      if (cmd?.callback) { await cmd.callback({}, String(mesId)); return true; }
    } catch (e) { dependencies.log('内部 chat-jump callback 失败', e); }
    return false;
  }

  function invalidateChatIndex() { state.host.currentChatIndex = null; state.host.currentChatIndexKey = null; }

  return { getHostContext, showHostDialog, isHostManagedChatView, getHostEventTypes, getCurrentChatId, getChatContainer, isScrollableElement, writeHostStyle, restoreHostStyles, getChatScrollElement, getMessageElement, waitForDom, swipeLatest, openEditor, commitEditor, suppressHostJumpFlash, executeChatJump, invalidateChatIndex };
}
