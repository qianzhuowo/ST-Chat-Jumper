import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "captureWindowScroll",
  "clamp",
  "commitEditor",
  "computeBestMatchForTextarea",
  "executeChatJump",
  "getAnchorMesId",
  "getChatContainer",
  "getChatScrollElement",
  "getCurrentChatId",
  "getHostContext",
  "getHostEventTypes",
  "getLastMessageId",
  "getMessageElement",
  "getRawMessageTextFromContext",
  "getSelectionContextInElement",
  "getSelectionInfo",
  "log",
  "openEditor",
  "restoreWindowScrollStable",
  "scrollMessageInChat",
  "setIcon",
  "setPinMode",
  "sleep",
  "toastError",
  "toastInfo",
  "toastWarn",
  "trySlashChatJump",
  "waitForDom",
  "waitForMessageElement"
];

export function createFeature({ state, dependencies }) {
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
    const editing = isElementVisible(document.querySelector(constants.QUICK_EDIT.EDIT_TEXTAREA_SELECTOR));
    dependencies.setIcon(btn, editing ? 'check' : 'pencil');
    btn.classList.toggle('stcj-editing', editing);
    btn.title = editing ? '保存编辑（完成）' : '快速编辑：选中文字可高亮定位；无选中则编辑当前楼层';
  }

  function getMessageTextContainer(mesEl) {
    if (!mesEl) return null;
    for (const sel of constants.QUICK_EDIT.TEXT_CONTAINER_SELECTORS) {
      const el = mesEl.querySelector(sel);
      if (el) return el;
    }
    return mesEl;
  }

  function ensureQuickEditMirror(textarea) {
    if (state.editing.quickEditMirror && state.editing.quickEditMirror.isConnected) return state.editing.quickEditMirror;

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
    state.editing.quickEditMirror = div;
    return div;
  }

  function scrollTextareaToSelection(textarea, rangeStart, rangeEnd) {
    try {
      const mirror = ensureQuickEditMirror(textarea);
      const style = getComputedStyle(textarea);
      const text = String(textarea.value || '');
      const fallbackStart = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : 0;
      const fallbackEnd = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : fallbackStart;
      const start = dependencies.clamp(Number.isFinite(rangeStart) ? rangeStart : fallbackStart, 0, text.length);
      const end = dependencies.clamp(Number.isFinite(rangeEnd) ? rangeEnd : fallbackEnd, start, text.length);
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
      let target = caretY - textarea.clientHeight * constants.QUICK_EDIT.EDITOR_SCROLL_ALIGNMENT_RATIO;
      const max = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
      target = dependencies.clamp(target + fallbackLineHeight / 2, 0, max);
      textarea.scrollTop = target;
    } catch (e) {
      dependencies.log('scrollTextareaToSelection failed', e);
    }
  }

  function scrollMessageToComfortPosition(mesEl) {
    const scrollEl = dependencies.getChatScrollElement();
    if (!mesEl || !scrollEl) return;
    try {
      const vp = scrollEl.getBoundingClientRect();
      const rect = mesEl.getBoundingClientRect();
      const delta = rect.top - vp.top;
      const nextTop = scrollEl.scrollTop + delta - constants.QUICK_EDIT.SCROLL_INTO_VIEW_OFFSET;
      scrollEl.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' });
    } catch {
      /* ignore */
    }
  }

  function getCurrentEditTextarea() {
    const el = document.querySelector(constants.QUICK_EDIT.EDIT_TEXTAREA_SELECTOR);
    return el && isElementVisible(el) ? el : null;
  }

  function getEditingMessageElement() {
    const textarea = getCurrentEditTextarea();
    return textarea?.closest?.('#chat .mes[mesid]') || null;
  }

  async function waitForEditTextarea(mesEl, timeoutMs) {
    const eventTypes = dependencies.getHostEventTypes();
    return dependencies.waitForDom({ root: mesEl || dependencies.getChatContainer(), timeoutMs, events: [eventTypes.MESSAGE_UPDATED], find: () => {
      const current = getCurrentEditTextarea();
      if (current) return current;
      const inner = mesEl?.querySelector?.('textarea');
      return inner && isElementVisible(inner) ? inner : null;
    } });
  }

  async function openMessageEdit(mesId) { return dependencies.openEditor(mesId); }

  function clickMessageDoneButton(mesEl) { return dependencies.commitEditor(mesEl); }

  function detachQuickEditOutsideListener() {
    try {
      state.editing.quickEditState?.detachOutside?.();
    } catch {
      /* ignore */
    }
    if (state.editing.quickEditState) state.editing.quickEditState.detachOutside = null;
  }

  function clearQuickEditState() {
    detachQuickEditOutsideListener();
    try { state.editing.quickEditState?.detachMonitor?.(); } catch { /* ignore */ }
    state.editing.quickEditState = null;
    const root = document.getElementById(constants.ROOT_ID);
    if (root) updateQuickEditButton(root);
  }

  function attachQuickEditMonitor(mesEl) {
    if (!state.editing.quickEditState) return;
    const editState = state.editing.quickEditState;
    const ctx = dependencies.getHostContext();
    const eventTypes = dependencies.getHostEventTypes(ctx);
    const events = [eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_DELETED, eventTypes.CHAT_CHANGED].filter(Boolean);
    const check = () => { if (state.editing.quickEditState === editState && !getCurrentEditTextarea()) clearQuickEditState(); };
    const observer = window.MutationObserver ? new MutationObserver(check) : null;
    observer?.observe(mesEl || dependencies.getChatContainer(), { childList: true, subtree: true });
    events.forEach((event) => ctx?.eventSource?.on?.(event, check));
    let detached = false;
    editState.detachMonitor = () => {
      if (detached) return;
      detached = true;
      observer?.disconnect();
      events.forEach((event) => ctx?.eventSource?.removeListener?.(event, check));
    };
  }

  function waitForEditorClosed(mesEl, timeoutMs = 2000) {
    if (!getCurrentEditTextarea()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const ctx = dependencies.getHostContext();
      const eventTypes = dependencies.getHostEventTypes(ctx);
      const events = [eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_DELETED, eventTypes.CHAT_CHANGED].filter(Boolean);
      let settled = false;
      const observer = window.MutationObserver ? new MutationObserver(check) : null;
      let timer = null;
      function finish(closed) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer?.disconnect();
        events.forEach((event) => ctx?.eventSource?.removeListener?.(event, check));
        resolve(closed);
      }
      function check() { if (!getCurrentEditTextarea()) finish(true); }
      observer?.observe(mesEl || dependencies.getChatContainer(), { childList: true, subtree: true });
      events.forEach((event) => ctx?.eventSource?.on?.(event, check));
      timer = setTimeout(() => finish(!getCurrentEditTextarea()), timeoutMs);
      check();
    });
  }

  function attachQuickEditOutsideListener() {
    if (!state.editing.quickEditState) return;
    detachQuickEditOutsideListener();

    const onPointerDown = (e) => {
      if (!state.editing.quickEditState) return;

      const root = document.getElementById(constants.ROOT_ID);
      if (root && root.contains(e.target)) return;

      const mesEl = document.querySelector(`#chat .mes[mesid="${state.editing.quickEditState.mesId}"]`);
      if (mesEl && mesEl.contains(e.target)) return;

      // 点击在编辑 textarea 上也不触发保存
      const ta = getCurrentEditTextarea();
      if (ta && ta.contains(e.target)) return;

      // 其他地方：自动保存
      void quickEditSave();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    state.editing.quickEditState.detachOutside = () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }

  async function quickEditOpen() {
    if (state.editing.quickEditBusy) return false;
    state.editing.quickEditBusy = true;
    try {
      if (state.favorites.pinMode) {
        dependencies.toastWarn('当前处于收藏点选模式，已退出点选模式后再编辑。');
        dependencies.setPinMode(false);
      }

      const scrollEl = dependencies.getChatScrollElement();
      const scrollTop = scrollEl ? scrollEl.scrollTop : null;

      const winPos = dependencies.captureWindowScroll();

      // 1) 优先：选中的消息
      const selectionInfo = dependencies.getSelectionInfo();
      const targetMesId = selectionInfo?.mesId ?? dependencies.getAnchorMesId();

      if (targetMesId == null) {
        dependencies.toastWarn('未找到可编辑的楼层。');
        return false;
      }

      // 2) 让虚拟滚动加载目标消息
      await dependencies.trySlashChatJump(targetMesId);
      dependencies.restoreWindowScrollStable(winPos);
      const mesEl = await dependencies.waitForMessageElement(targetMesId, 2000);
      if (!mesEl) {
        dependencies.toastWarn('未能找到目标楼层（可能被虚拟滚动隐藏），请稍后重试。');
        return false;
      }

      // 3) 记录选中上下文（用于 textarea 内高亮定位）
      let selectionCtx = null;
      if (selectionInfo?.mesId === targetMesId) selectionCtx = selectionInfo.selectionCtx;
      if (!selectionCtx) {
        const textContainer = getMessageTextContainer(mesEl);
        selectionCtx = textContainer ? dependencies.getSelectionContextInElement(textContainer, { win: window, doc: document }) : null;
      }

      // 4) 先点击编辑，让酒馆把 textarea 真正挂到当前楼层上
      if (!await openMessageEdit(targetMesId)) {
        dependencies.toastWarn('无法打开该楼层的编辑器。');
        return false;
      }

      const textarea = await waitForEditTextarea(mesEl, 5000);
      if (!textarea) {
        dependencies.toastWarn('编辑器未出现（超时），请稍后重试。');
        return false;
      }

      // 5) textarea 出现后，再把当前编辑楼层精确对齐到楼层头部
      dependencies.scrollMessageInChat(mesEl, 'start', 'auto');
      dependencies.restoreWindowScrollStable(winPos);
      await dependencies.sleep(32);
      dependencies.scrollMessageInChat(mesEl, 'start', 'auto');
      dependencies.restoreWindowScrollStable(winPos);

      // 6) 在编辑器中高亮定位，并把光标附近内容滚到 textarea 可视区中间
      if (selectionCtx?.selectedText?.trim()) {
        const raw = textarea.value;
        const ctxRaw = dependencies.getRawMessageTextFromContext(targetMesId);

        const match = dependencies.computeBestMatchForTextarea(raw, ctxRaw, selectionCtx);

        textarea.focus();

        if (match) {
          textarea.setSelectionRange(match.start, match.end);
          scrollTextareaToSelection(textarea, match.start, match.end);
        } else {
          // 找不到也没关系：至少打开编辑器并聚焦
          scrollTextareaToSelection(textarea);
          dependencies.toastInfo('已打开编辑器，但未能在原文中匹配到你选中的显示文本（可能被正则/HTML 渲染改写）。可尝试重新选择更长的片段/包含前后更多文字。');
        }
      } else {
        textarea.focus();
        scrollTextareaToSelection(textarea);
      }

      state.editing.quickEditState = {
        mesId: targetMesId,
        scrollTop,
        scrollEl,
        selectionCtx,
        detachOutside: null,
        detachMonitor: null,
        chatId: dependencies.getCurrentChatId(),
      };

      attachQuickEditOutsideListener();
      attachQuickEditMonitor(mesEl);

      const root = document.getElementById(constants.ROOT_ID);
      if (root) updateQuickEditButton(root);

      return true;
    } finally {
      state.editing.quickEditBusy = false;
    }
  }

  async function quickEditSave() {
    if (state.editing.quickEditBusy) return false;
    const existingEditor = getCurrentEditTextarea();
    if (!state.editing.quickEditState && !existingEditor) return false;
    state.editing.quickEditBusy = true;
    try {
      const editState = state.editing.quickEditState;
      if (editState?.chatId && editState.chatId !== dependencies.getCurrentChatId()) { clearQuickEditState(); return false; }
      const mesEl = (editState ? dependencies.getMessageElement(editState.mesId) : null) || getEditingMessageElement();
      if (!mesEl) {
        clearQuickEditState();
        return false;
      }

      const scrollEl = editState?.scrollEl || dependencies.getChatScrollElement();
      const restoreTop = editState?.scrollTop;
      const editorClosed = waitForEditorClosed(mesEl, 2000);

      if (!clickMessageDoneButton(mesEl)) {
        clearQuickEditState();
        return false;
      }

      await editorClosed;
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
      state.editing.quickEditBusy = false;
    }
  }

  async function handleQuickEditAction() {
    // 二段式：未在编辑 -> 打开；已在编辑 -> 保存
    if (getCurrentEditTextarea()) {
      return quickEditSave();
    }
    return quickEditOpen();
  }

  function getSelectedMessageIdForDelete() {
    const selection = dependencies.getSelectionInfo();
    if (selection && Number.isInteger(selection.mesId)) {
      return selection.mesId;
    }
    return dependencies.getLastMessageId();
  }

  function getNativeSwipeDeletionIndex(ctx, targetMesId) {
    const message = ctx?.chat?.[targetMesId];
    const selectedSwipe = Number(message?.swipe_id);
    const swipes = Array.isArray(message?.swipes) ? message.swipes : [];
    const confirmationEnabled = !!ctx?.powerUserSettings?.confirm_message_delete;
    const isLatestMessage = targetMesId === ctx.chat.length - 1;
    const validSwipe = Number.isInteger(selectedSwipe) && selectedSwipe >= 0 && selectedSwipe < swipes.length;
    return confirmationEnabled && isLatestMessage && !message?.is_user && swipes.length > 1 && validSwipe
      ? selectedSwipe
      : undefined;
  }

  async function requestNativeMessageDelete() {
    if (state.editing.quickDeleteBusy) return false;
    if (getCurrentEditTextarea()) {
      dependencies.toastWarn('请先完成当前消息编辑，再执行删除。');
      return false;
    }

    const ctx = dependencies.getHostContext();
    const targetMesId = getSelectedMessageIdForDelete();
    if (!Array.isArray(ctx?.chat) || !ctx.chat[targetMesId]) {
      dependencies.toastWarn('未找到可删除的楼层。');
      return false;
    }

    state.editing.quickDeleteBusy = true;
    try {
      let mesEl = dependencies.getMessageElement(targetMesId);
      if (!mesEl) {
        await dependencies.executeChatJump(targetMesId);
        mesEl = await dependencies.waitForMessageElement(targetMesId, 2000);
      }
      if (!mesEl) {
        dependencies.toastWarn('未能加载目标楼层，无法打开删除确认。');
        return false;
      }

      // 复刻 ST 原生 .mes_edit_delete 的 canDeleteSwipe 判定，恢复 Delete Swipe / Delete Message 选项。
      if (typeof ctx.deleteMessage === 'function') {
        const swipeDeletionIndex = getNativeSwipeDeletionIndex(ctx, targetMesId);
        await ctx.deleteMessage(targetMesId, swipeDeletionIndex, true);
        return true;
      }

      // 旧版兼容：先用原生 messageEdit 设置 this_edit_mes_id，再点击原生删除按钮。
      if (!await dependencies.openEditor(targetMesId)) return false;
      const deleteButton = mesEl.querySelector('.mes_edit_delete');
      if (!(deleteButton instanceof HTMLElement)) {
        dependencies.toastWarn('未找到 SillyTavern 原生删除按钮。');
        return false;
      }
      deleteButton.click();
      return true;
    } catch (error) {
      dependencies.log('快速删除失败', error);
      dependencies.toastError('打开原生删除确认失败，请稍后重试。');
      return false;
    } finally {
      state.editing.quickDeleteBusy = false;
    }
  }

  return { isElementVisible, getQuickEditButton, updateQuickEditButton, getMessageTextContainer, ensureQuickEditMirror, scrollTextareaToSelection, scrollMessageToComfortPosition, getCurrentEditTextarea, getEditingMessageElement, waitForEditTextarea, openMessageEdit, clickMessageDoneButton, detachQuickEditOutsideListener, clearQuickEditState, attachQuickEditMonitor, waitForEditorClosed, attachQuickEditOutsideListener, quickEditOpen, quickEditSave, handleQuickEditAction, getSelectedMessageIdForDelete, getNativeSwipeDeletionIndex, requestNativeMessageDelete };
}
