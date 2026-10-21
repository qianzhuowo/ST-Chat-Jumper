import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "captureViewportAnchor",
  "captureWindowScroll",
  "formatRangePagingModeLabel",
  "getChatContainer",
  "getChatScrollElement",
  "getCurrentChatId",
  "getCurrentEditTextarea",
  "getHostContext",
  "getRangeContext",
  "getRangePagingMode",
  "getRangeStep",
  "isHostManagedChatView",
  "jumpToMessage",
  "log",
  "restoreViewportAnchor",
  "restoreWindowScrollStable",
  "scrollMessageInChat",
  "showHostDialog",
  "sleep",
  "toastError",
  "toastInfo",
  "toastSuccess",
  "toastWarn",
  "waitForMessageElement"
];

export function createFeature({ state, dependencies }) {
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
    const isActive = !!state.range.activeRange;
    const currentText = formatRangeText(state.range.activeRange);

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
      const atStart = !isActive || (state.range.activeRange && state.range.activeRange.start <= 0);
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
          const maxId = Array.isArray(ctx?.chat) ? ctx.chat.length - 1 : state.range.activeRange.end;
          atEnd = state.range.activeRange.end >= maxId;
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
    state.range.activeRange = range;

    const root = document.getElementById(constants.ROOT_ID);
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
      const ctx = dependencies.getRangeContext();
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
    const ctxN = dependencies.getRangeContext();
    const totalFloors = maxId + 1;
    let tip = `共 ${totalFloors} 楼（0-${maxId}）`;
    if (state.range.activeRange) {
      tip += `，当前显示：${state.range.activeRange.start}-${state.range.activeRange.end}`;
    }
    tip += `\n输入楼层号跳转（前后各${ctxN}层）或区间如 0-10`;
    const defaultValue = state.range.activeRange
      ? `${state.range.activeRange.start}-${state.range.activeRange.end}`
      : `${Math.max(0, maxId)}`;

    if (dependencies.isHostManagedChatView()) tip += '\n当前 tt 虚拟滚动模式仅支持单楼跳转；区间显示需关闭宿主虚拟滚动并重载。';
    const value = await dependencies.showHostDialog('INPUT', tip, defaultValue);

    if (typeof value !== 'string') return null;
    return value.trim();
  }

  async function showFloorRangeImpl(rawInput = null) {
    const ctx = window.SillyTavern?.getContext?.();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat.slice() : null;
    const chatId = dependencies.getCurrentChatId(ctx);
    const operationSeq = ++state.range.rangeOperationSeq;
    const chatEl = dependencies.getChatContainer();

    if (!chat || !chatEl || chat.length === 0) {
      dependencies.toastWarn('当前聊天为空，无法按区间显示。');
      return false;
    }

    const maxId = chat.length - 1;
    const input = typeof rawInput === 'string' ? rawInput.trim() : await showRangePrompt(maxId);
    if (!input) {
      if (typeof rawInput !== 'string') {
        dependencies.toastInfo('已取消。');
      }
      return false;
    }

    const range = parseRangeInput(input, maxId);
    if (!range) {
      dependencies.toastError(`输入无效（请输入 0-${maxId} 范围内的楼层号或区间如 a-b）。`);
      return false;
    }

    if (chatId !== dependencies.getCurrentChatId() || operationSeq !== state.range.rangeOperationSeq) return false;
    if (dependencies.isHostManagedChatView()) {
      if (typeof range.jumpTo === 'number') return dependencies.jumpToMessage(range.jumpTo, 'start');
      dependencies.toastWarn('tt 虚拟滚动模式不支持插件重绘区间。请关闭宿主虚拟滚动并重载，或输入单个楼层号跳转。');
      return false;
    }

    if (typeof ctx.addOneMessage !== 'function') {
      dependencies.toastError('当前环境不支持 addOneMessage，无法显示区间。');
      return false;
    }

    if (chatId !== dependencies.getCurrentChatId() || operationSeq !== state.range.rangeOperationSeq) return false;
    chatEl.replaceChildren();
    for (let i = range.start; i <= range.end; i++) {
      await ctx.addOneMessage(chat[i], { forceId: i, scroll: false, showSwipes: false });
    }

    if (chatId !== dependencies.getCurrentChatId() || operationSeq !== state.range.rangeOperationSeq) return false;
    ctx.swipe?.refresh?.();
    setActiveRange(range);

    // 如果是单数字跳转模式，滚动到目标楼层
    if (typeof range.jumpTo === 'number') {
      // 等待 DOM 渲染完成
      await dependencies.sleep(50);
      const targetEl = await dependencies.waitForMessageElement(range.jumpTo, 2000);
      if (targetEl) {
        const winPos = dependencies.captureWindowScroll();
        dependencies.scrollMessageInChat(targetEl, 'start', 'auto');
        dependencies.restoreWindowScrollStable(winPos);
        // 二次对齐：确保渲染稳定后精确到顶部
        await dependencies.sleep(50);
        dependencies.scrollMessageInChat(targetEl, 'start', 'auto');
        dependencies.restoreWindowScrollStable(winPos);
      } else {
        dependencies.getChatScrollElement()?.scrollTo?.({ top: 0, behavior: 'auto' });
      }
      dependencies.toastSuccess(`已跳转到第 ${range.jumpTo} 楼（显示区间：${range.start}-${range.end}）`);
    } else {
      dependencies.getChatScrollElement()?.scrollTo?.({ top: 0, behavior: 'auto' });
      dependencies.toastSuccess(`已显示楼层区间：${range.start}-${range.end}`);
    }

    return true;
  }

  async function restoreDefaultRangeView() {
    if (!state.range.activeRange) {
      dependencies.toastInfo('当前已是默认聊天视图。');
      return true;
    }
    const previousRange = state.range.activeRange ? { ...state.range.activeRange } : null;

    // 若当前区间本身已经覆盖整段聊天，则无需 reload，直接退出“区间模式”即可。
    // 这能解决小聊天里（如总共 0-5 楼，跳转 5 仍显示 0-5）点击“恢复”看起来没反应的问题。
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const maxId = Array.isArray(ctx?.chat) && ctx.chat.length > 0 ? ctx.chat.length - 1 : null;
      if (typeof maxId === 'number' && state.range.activeRange.start <= 0 && state.range.activeRange.end >= maxId) {
        setActiveRange(null);
        dependencies.toastSuccess('已恢复默认视图');
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
          dependencies.toastError('当前环境不支持恢复默认聊天视图。');
          return false;
        }
      } else {
        dependencies.toastError('当前环境不支持恢复默认聊天视图。');
        if (previousRange) setActiveRange(previousRange);
        return false;
      }
      dependencies.toastSuccess('已恢复默认聊天视图。');
      return true;
    } catch (e) {
      if (previousRange) setActiveRange(previousRange);
      dependencies.log('恢复默认聊天视图失败', e);
      dependencies.toastError('恢复默认聊天视图失败，请稍后重试。');
      return false;
    }
  }

  async function shiftFloorRangeImpl(direction) {
    if (dependencies.isHostManagedChatView()) {
      dependencies.toastWarn('tt 虚拟滚动模式不支持区间翻页，请使用楼层跳转。');
      return false;
    }
    if (!state.range.activeRange) {
      dependencies.toastWarn('当前没有激活的楼层区间。');
      return false;
    }

    const ctx = window.SillyTavern?.getContext?.();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat.slice() : null;
    const chatId = dependencies.getCurrentChatId(ctx);
    const operationSeq = ++state.range.rangeOperationSeq;
    const chatEl = dependencies.getChatContainer();
    if (!chat || !chatEl || chat.length === 0) {
      dependencies.toastWarn('当前聊天为空。');
      return false;
    }

    const maxId = chat.length - 1;
    const step = Math.max(1, dependencies.getRangeStep());
    const rangeSize = state.range.activeRange.end - state.range.activeRange.start + 1;
    const pagingMode = dependencies.getRangePagingMode();

    let newStart, newEnd;

    if (direction === 'next') {
      if (state.range.activeRange.end >= maxId) {
        dependencies.toastInfo('已经是最新的楼层了。');
        return false;
      }

      if (pagingMode === 'shift') {
        newStart = Math.min(state.range.activeRange.start + step, maxId);
        newEnd = Math.min(newStart + rangeSize - 1, maxId);
        newStart = Math.max(0, newEnd - rangeSize + 1);
      } else {
        newStart = state.range.activeRange.start;
        newEnd = Math.min(state.range.activeRange.end + step, maxId);
      }
    } else {
      if (state.range.activeRange.start <= 0) {
        dependencies.toastInfo('已经是最早的楼层了。');
        return false;
      }

      if (pagingMode === 'shift') {
        newEnd = Math.max(state.range.activeRange.end - step, 0);
        newStart = Math.max(newEnd - rangeSize + 1, 0);
        newEnd = Math.min(maxId, newStart + rangeSize - 1);
      } else {
        newStart = Math.max(state.range.activeRange.start - step, 0);
        newEnd = state.range.activeRange.end;
      }
    }

    if (newStart === state.range.activeRange.start && newEnd === state.range.activeRange.end) {
      dependencies.toastInfo('当前区间无需变化。');
      return false;
    }

    if (typeof ctx.addOneMessage !== 'function') {
      dependencies.toastError('当前环境不支持 addOneMessage，无法切换区间。');
      return false;
    }

    // 记住当前阅读位置：锚点楼层 + 它相对视口顶部的像素偏移
    const anchorState = dependencies.captureViewportAnchor();
    const winPos = dependencies.captureWindowScroll();

    if (chatId !== dependencies.getCurrentChatId() || operationSeq !== state.range.rangeOperationSeq) return false;
    chatEl.replaceChildren();
    for (let i = newStart; i <= newEnd; i++) {
      await ctx.addOneMessage(chat[i], { forceId: i, scroll: false, showSwipes: false });
    }

    const range = { start: newStart, end: newEnd };
    if (chatId !== dependencies.getCurrentChatId() || operationSeq !== state.range.rangeOperationSeq) return false;
    ctx.swipe?.refresh?.();
    setActiveRange(range);

    // 扩展模式下，原阅读位置必然还在新区间内；
    // 平移模式下，如果锚点仍在新区间内，也尽量按像素保位恢复。
    if (anchorState) {
      const anchorStillVisible = anchorState.mesId >= newStart && anchorState.mesId <= newEnd;
      if (anchorStillVisible) {
        await dependencies.waitForMessageElement(anchorState.mesId, 1000);
        dependencies.restoreViewportAnchor(anchorState);
        dependencies.restoreWindowScrollStable(winPos);
        await dependencies.sleep(32);
        dependencies.restoreViewportAnchor(anchorState);
        dependencies.restoreWindowScrollStable(winPos);
      } else {
        // 平移模式且锚点移出新区间：退化为把新区间边界对齐到头部，避免跳到奇怪的位置
        const fallbackId = direction === 'next' ? newStart : newEnd;
        const fallbackEl = await dependencies.waitForMessageElement(fallbackId, 1000);
        if (fallbackEl) {
          dependencies.scrollMessageInChat(fallbackEl, 'start', 'auto');
          dependencies.restoreWindowScrollStable(winPos);
        } else {
          const se = dependencies.getChatScrollElement();
          if (se) {
            se.scrollTo?.({ top: direction === 'next' ? 0 : se.scrollHeight, behavior: 'auto' });
            dependencies.restoreWindowScrollStable(winPos);
          }
        }
      }
    }

    dependencies.toastSuccess(`已切换区间：${newStart}-${newEnd}（${dependencies.formatRangePagingModeLabel(pagingMode)}模式）`);
    return true;
  }

  async function runRangeTransaction(operation) {
    if (state.range.rangeBusy) { dependencies.toastInfo('区间操作正在进行，请稍候。'); return false; }

    const ctx = dependencies.getHostContext();
    const swipeState = ctx?.swipe?.state?.();
    if (state.editing.quickEditState || dependencies.getCurrentEditTextarea()) {
      dependencies.toastWarn('请先完成当前消息编辑，再进行区间操作。');
      return false;
    }
    if (swipeState && swipeState !== 'none') {
      dependencies.toastWarn('消息正在切换分支，请稍后再进行区间操作。');
      return false;
    }

    state.range.rangeBusy = true;
    try { return await operation(); }
    finally { state.range.rangeBusy = false; }
  }

  function showFloorRange(rawInput = null) { return runRangeTransaction(() => showFloorRangeImpl(rawInput)); }

  function shiftFloorRange(direction) { return runRangeTransaction(() => shiftFloorRangeImpl(direction)); }

  return { formatRangeText, updateRangeButtons, setActiveRange, parseRangeInput, showRangePrompt, showFloorRangeImpl, restoreDefaultRangeView, shiftFloorRangeImpl, runRangeTransaction, showFloorRange, shiftFloorRange };
}
