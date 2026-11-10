import * as constants from './constants.js';

// Floor outline: a side panel listing every floor with a short excerpt. A row jumps to its
// floor; the eye button previews the floor's bubble group in place without scrolling the chat.
export const requiredServices = [
  'applyFavoritesRegexPipeline',
  'applySillyTavernMessageFormatting',
  'buildFavoriteRenderableHtml',
  'getCurrentMessageSnapshot',
  'getHostContext',
  'getHostEventTypes',
  'jumpToMessage',
  'getOutlinePageSize',
  'normalizeFavoriteText',
  'saveOutlinePageSize',
  'saveSettings',
  'updateOutlineToggleButton',
  'watchCurrentFloor',
];

const PANEL_ID = 'stcj-outline';
const PREVIEW_ID = 'stcj-outline-preview';
const EXCERPT_LENGTH = 16;
const PREVIEW_GROUP_LIMIT = 4;
const HOVER_OPEN_MS = 220;
const HOVER_CLOSE_MS = 260;
const REASONING_BLOCK = /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi;

// A bubble group is one conversation turn: the nearest user message at or before the floor
// plus the replies that follow it until the next user message, capped around the floor.
export function resolveBubbleGroup(chat, mesId, limit = PREVIEW_GROUP_LIMIT) {
  if (!Array.isArray(chat) || !chat[mesId]) return [];
  let start = mesId;
  while (start > 0 && !chat[start]?.is_user) start--;
  if (!chat[start]?.is_user) start = mesId;
  let end = mesId;
  while (end + 1 < chat.length && !chat[end + 1]?.is_user) end++;
  if (end - start + 1 > limit) {
    start = Math.min(Math.max(start, mesId - 1), end - limit + 1);
    end = start + limit - 1;
  }
  const ids = [];
  for (let id = start; id <= end; id++) ids.push(id);
  return ids;
}

// Pages are 1-based; a page size of 0 means everything on one page.
export function outlinePageCount(total, size) {
  return size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
}

export function outlinePageOf(index, size) {
  return size > 0 && index >= 0 ? Math.floor(index / size) + 1 : 1;
}

export function createFeature({ state, dependencies }) {
  const panel = () => state.outline.element;
  const previewElement = () => document.getElementById(PREVIEW_ID);
  const chatArray = () => {
    const chat = dependencies.getHostContext()?.chat;
    return Array.isArray(chat) ? chat : [];
  };

  function messageText(message) {
    return String(dependencies.getCurrentMessageSnapshot(message).text || '');
  }

  function excerptOf(message) {
    const text = dependencies.normalizeFavoriteText(messageText(message).replace(REASONING_BLOCK, ' '))
      .replace(/[*_`#>~|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const chars = Array.from(text);
    return chars.length > EXCERPT_LENGTH ? chars.slice(0, EXCERPT_LENGTH).join('') + '…' : text;
  }

  function buildPanel() {
    const root = document.createElement('aside');
    root.id = PANEL_ID;
    root.className = 'stcj-outline';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '楼层大纲');
    root.innerHTML = `
      <header class="stcj-outline-header">
        <div class="stcj-outline-title">${constants.ICONS.outline}<span>楼层大纲</span><small class="stcj-outline-count"></small></div>
        <button type="button" class="stcj-outline-icon-btn" data-outline-action="swap-side">${constants.ICONS.horizontal}</button>
        <button type="button" class="stcj-outline-icon-btn" data-outline-action="locate" title="定位到当前楼层">${constants.ICONS.head}</button>
        <button type="button" class="stcj-outline-icon-btn" data-outline-action="close" title="关闭大纲 (Esc)">${constants.ICONS.close}</button>
      </header>
      <label class="stcj-outline-search">${constants.ICONS.search}<input type="search" placeholder="楼层号或关键字" aria-label="筛选楼层" /></label>
      <div class="stcj-outline-list" role="list"></div>
      <div class="stcj-outline-empty" hidden>没有匹配的楼层</div>
      <footer class="stcj-outline-pager">
        <button type="button" class="stcj-outline-icon-btn" data-outline-action="page-first" title="首页">${constants.ICONS.fastBackward}</button>
        <button type="button" class="stcj-outline-icon-btn" data-outline-action="page-prev" title="上一页">${constants.ICONS.chevronLeft}</button>
        <label class="stcj-outline-page-jump" title="输入页码后回车跳转"><input type="number" min="1" step="1" inputmode="numeric" aria-label="页码" /><span class="stcj-outline-page-total"></span></label>
        <button type="button" class="stcj-outline-icon-btn" data-outline-action="page-next" title="下一页">${constants.ICONS.chevronRight}</button>
        <button type="button" class="stcj-outline-icon-btn" data-outline-action="page-last" title="尾页">${constants.ICONS.fastForward}</button>
        <select class="stcj-outline-page-size" aria-label="每页条数" title="每页条数">
          ${constants.OUTLINE_PAGE_SIZES.map(size => `<option value="${size}">${size ? `${size} 条/页` : '不设限'}</option>`).join('')}
        </select>
      </footer>`;
    root.addEventListener('click', onPanelClick);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('pointerover', onPanelPointerOver);
    root.addEventListener('pointerout', onPanelPointerOut);
    const input = root.querySelector('.stcj-outline-search input');
    input.value = state.outline.filter;
    input.addEventListener('input', () => {
      state.outline.filter = input.value;
      state.outline.matches = computeMatches();
      goToPage(1);
    });
    const pageInput = root.querySelector('.stcj-outline-page-jump input');
    pageInput.addEventListener('change', () => goToPage(Math.round(Number(pageInput.value)) || state.outline.page));
    pageInput.addEventListener('keydown', event => { if (event.key === 'Enter') pageInput.blur(); });
    const sizeSelect = root.querySelector('.stcj-outline-page-size');
    sizeSelect.value = String(dependencies.getOutlinePageSize());
    sizeSelect.addEventListener('change', () => {
      // Keep the first row the user was looking at on the new page.
      const firstId = Number(root.querySelector('.stcj-outline-row')?.dataset.mesid);
      dependencies.saveOutlinePageSize(Number(sizeSelect.value));
      goToPage(pageContaining(firstId) ?? 1);
    });
    root.querySelector('.stcj-outline-list').addEventListener('scroll', () => {
      if (state.outline.preview && !state.outline.preview.pinned) closePreview();
      else positionPreview();
    }, { passive: true });
    // Same host drawer guard as the settings dialog: presses here must not close host panels.
    for (const type of ['mousedown', 'touchstart']) root.addEventListener(type, e => e.stopPropagation(), { passive: true });
    return root;
  }

  function outlineSide() {
    return state.layout.settings?.outlineSide === 'right' ? 'right' : 'left';
  }

  function swapSide() {
    state.layout.settings.outlineSide = outlineSide() === 'left' ? 'right' : 'left';
    dependencies.saveSettings();
    layoutPanel();
  }

  // The visible area. On phones the layout viewport can be wider or taller than the screen
  // (wide content, browser bars), so CSS right/bottom/vw would push the panel off-screen.
  function visibleViewport() {
    const vv = window.visualViewport;
    return vv
      ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height }
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function layoutPanel() {
    const root = panel();
    if (!root) return;
    const side = outlineSide();
    const vp = visibleViewport();
    const margin = 8;
    const width = Math.min(300, vp.width - margin * 2);
    const topBar = document.getElementById('top-settings-holder')?.getBoundingClientRect().bottom || 0;
    const top = Math.max(vp.top, topBar) + margin;
    root.classList.toggle('is-left', side === 'left');
    const swap = root.querySelector('[data-outline-action="swap-side"]');
    swap.title = side === 'left' ? '移到右侧' : '移到左侧';
    Object.assign(root.style, {
      left: `${side === 'left' ? vp.left + margin : vp.left + vp.width - width - margin}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${Math.max(160, vp.top + vp.height - margin - top)}px`,
    });
    positionPreview();
  }

  // Filtering reads every message's text; only the current page's rows are built.
  function computeMatches() {
    const query = state.outline.filter.trim().toLowerCase().replace(/^#/, '');
    const ids = [];
    chatArray().forEach((message, id) => {
      if (!message) return;
      if (!query || String(id) === query
        || messageText(message).toLowerCase().includes(query)
        || String(message.name || '').toLowerCase().includes(query)) ids.push(id);
    });
    return ids;
  }

  function pageContaining(id) {
    const index = Number.isInteger(id) ? state.outline.matches.indexOf(id) : -1;
    return index < 0 ? null : outlinePageOf(index, dependencies.getOutlinePageSize());
  }

  function goToPage(page) {
    closePreview();
    state.outline.page = page;
    renderRows();
    const list = panel()?.querySelector('.stcj-outline-list');
    if (list) list.scrollTop = 0;
  }

  function renderRows() {
    const root = panel();
    if (!root) return;
    const list = root.querySelector('.stcj-outline-list');
    const scrollTop = list.scrollTop;
    const chat = chatArray();
    const size = dependencies.getOutlinePageSize();
    const matches = state.outline.matches;
    const pages = outlinePageCount(matches.length, size);
    const page = Math.min(Math.max(1, state.outline.page || 1), pages);
    state.outline.page = page;
    const ids = size > 0 ? matches.slice((page - 1) * size, page * size) : matches;
    const fragment = document.createDocumentFragment();
    ids.forEach(id => {
      const message = chat[id];
      if (!message) return;
      const row = document.createElement('div');
      row.className = `stcj-outline-row ${message.is_user ? 'is-user' : 'is-char'}${message.is_system ? ' is-hidden-message' : ''}`;
      row.dataset.mesid = String(id);
      row.setAttribute('role', 'listitem');
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'stcj-outline-jump';
      jump.dataset.outlineAction = 'jump';
      jump.title = `跳转到第 ${id} 楼 · ${message.name || ''}`;
      const floor = document.createElement('span');
      floor.className = 'stcj-outline-floor';
      floor.textContent = `#${id}`;
      const who = document.createElement('span');
      who.className = 'stcj-outline-who';
      who.textContent = message.is_user ? '我' : Array.from(String(message.name || 'AI'))[0];
      who.title = String(message.name || '');
      const text = document.createElement('span');
      text.className = 'stcj-outline-text';
      text.textContent = excerptOf(message) || '（无文本）';
      jump.append(floor, who, text);
      const peek = document.createElement('button');
      peek.type = 'button';
      peek.className = 'stcj-outline-peek';
      peek.dataset.outlineAction = 'peek';
      peek.title = '原地预览这一组气泡（不跳转）';
      peek.setAttribute('aria-label', `预览第 ${id} 楼所在的气泡组`);
      peek.innerHTML = constants.ICONS.eye;
      row.append(jump, peek);
      fragment.append(row);
    });
    list.replaceChildren(fragment);
    root.querySelector('.stcj-outline-count').textContent = `共 ${chat.length} 层`;
    root.querySelector('.stcj-outline-empty').hidden = matches.length > 0;
    renderPager(root, page, pages);
    list.scrollTop = scrollTop;
    markCurrent(state.outline.floor, false);
  }

  function renderPager(root, page, pages) {
    const pager = root.querySelector('.stcj-outline-pager');
    pager.querySelector('[data-outline-action="page-first"]').disabled = page <= 1;
    pager.querySelector('[data-outline-action="page-prev"]').disabled = page <= 1;
    pager.querySelector('[data-outline-action="page-next"]').disabled = page >= pages;
    pager.querySelector('[data-outline-action="page-last"]').disabled = page >= pages;
    const input = pager.querySelector('.stcj-outline-page-jump input');
    input.max = String(pages);
    input.value = String(page);
    input.disabled = pages <= 1;
    pager.querySelector('.stcj-outline-page-total').textContent = `/ ${pages}`;
  }

  function rowElement(id) { return panel()?.querySelector(`.stcj-outline-row[data-mesid="${id}"]`) || null; }

  function scrollRowIntoList(row) {
    const list = panel()?.querySelector('.stcj-outline-list');
    if (!row || !list) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - (list.clientHeight - row.offsetHeight) / 2);
    }
  }

  function markCurrent(id, follow = true) {
    const root = panel();
    if (!root) return;
    root.querySelector('.stcj-outline-row.is-current')?.classList.remove('is-current');
    const row = Number.isInteger(id) ? rowElement(id) : null;
    row?.classList.add('is-current');
    if (follow) scrollRowIntoList(row);
  }

  function scheduleRebuild() {
    if (state.outline.rebuildRaf) return;
    state.outline.rebuildRaf = requestAnimationFrame(() => {
      state.outline.rebuildRaf = null;
      closePreview();
      state.outline.matches = computeMatches();
      renderRows();
    });
  }

  // Locate: show the current floor's page, clearing a filter that hides it.
  function locateCurrent() {
    const id = state.outline.floor;
    if (!Number.isInteger(id)) return;
    if (pageContaining(id) === null && state.outline.filter) {
      state.outline.filter = '';
      panel().querySelector('.stcj-outline-search input').value = '';
      state.outline.matches = computeMatches();
    }
    const page = pageContaining(id);
    if (page === null) return;
    if (page !== state.outline.page) goToPage(page);
    markCurrent(id);
  }

  function attachHostEvents() {
    const ctx = dependencies.getHostContext();
    const types = dependencies.getHostEventTypes(ctx);
    const events = [...new Set([
      types.CHAT_CHANGED, types.MESSAGE_RECEIVED, types.MESSAGE_SENT, types.MESSAGE_EDITED,
      types.MESSAGE_UPDATED, types.MESSAGE_DELETED, types.MESSAGE_SWIPED,
    ].filter(Boolean))];
    events.forEach(event => ctx?.eventSource?.on?.(event, scheduleRebuild));
    return () => events.forEach(event => ctx?.eventSource?.removeListener?.(event, scheduleRebuild));
  }

  function isOutlineOpen() { return !!panel(); }

  function openOutline() {
    if (panel()) return;
    const root = buildPanel();
    state.outline.element = root;
    document.body.append(root);
    layoutPanel();
    window.addEventListener('resize', layoutPanel, { passive: true });
    window.visualViewport?.addEventListener('resize', layoutPanel, { passive: true });
    window.visualViewport?.addEventListener('scroll', layoutPanel, { passive: true });
    state.outline.matches = computeMatches();
    state.outline.page = 1;
    state.outline.detachEvents = attachHostEvents();
    // The first notification is synchronous: open on the page holding the current floor.
    let first = true;
    state.outline.detachFloor = dependencies.watchCurrentFloor(floor => {
      state.outline.floor = floor.id;
      if (first) {
        first = false;
        state.outline.page = pageContaining(floor.id) ?? 1;
        renderRows();
      }
      markCurrent(floor.id);
    });
    dependencies.updateOutlineToggleButton(true);
  }

  function closeOutline() {
    if (!panel()) return;
    closePreview();
    window.removeEventListener('resize', layoutPanel);
    window.visualViewport?.removeEventListener('resize', layoutPanel);
    window.visualViewport?.removeEventListener('scroll', layoutPanel);
    state.outline.detachFloor?.();
    state.outline.detachEvents?.();
    state.outline.detachFloor = state.outline.detachEvents = null;
    if (state.outline.rebuildRaf) cancelAnimationFrame(state.outline.rebuildRaf);
    state.outline.rebuildRaf = null;
    panel().remove();
    state.outline.element = null;
    state.outline.floor = null;
    state.outline.matches = [];
    dependencies.updateOutlineToggleButton(false);
  }

  function toggleOutline() { isOutlineOpen() ? closeOutline() : openOutline(); }

  async function jumpTo(id) {
    closePreview();
    await dependencies.jumpToMessage(id, 'start');
  }

  function onPanelClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-outline-action]') : null;
    if (!target) return;
    const action = target.dataset.outlineAction;
    if (action === 'close') return closeOutline();
    if (action === 'locate') return locateCurrent();
    if (action === 'swap-side') return swapSide();
    if (action.startsWith('page-')) {
      const pages = outlinePageCount(state.outline.matches.length, dependencies.getOutlinePageSize());
      const page = { 'page-first': 1, 'page-prev': state.outline.page - 1, 'page-next': state.outline.page + 1, 'page-last': pages }[action];
      if (page) goToPage(Math.min(Math.max(1, page), pages));
      return;
    }
    const id = Number(target.closest('.stcj-outline-row')?.dataset.mesid);
    if (!Number.isInteger(id)) return;
    if (action === 'jump') return void jumpTo(id);
    if (action === 'peek') {
      const current = state.outline.preview;
      if (current?.id === id && current.pinned) closePreview();
      else openPreview(id, true);
    }
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (state.outline.preview) closePreview(); else closeOutline();
  }

  // Mouse hover on the eye button previews; leaving both the row and the preview closes it.
  function onPanelPointerOver(event) {
    if (event.pointerType !== 'mouse') return;
    const peek = event.target instanceof Element ? event.target.closest('.stcj-outline-peek') : null;
    if (peek) {
      const id = Number(peek.closest('.stcj-outline-row')?.dataset.mesid);
      clearPreviewTimer();
      if (state.outline.preview?.pinned || state.outline.preview?.id === id) return;
      state.outline.previewTimer = setTimeout(() => openPreview(id, false), HOVER_OPEN_MS);
      return;
    }
    const row = event.target instanceof Element ? event.target.closest('.stcj-outline-row') : null;
    if (row && Number(row.dataset.mesid) === state.outline.preview?.id) clearPreviewTimer();
  }

  function onPanelPointerOut(event) {
    if (event.pointerType !== 'mouse' || state.outline.preview?.pinned) return;
    const leaving = event.target instanceof Element ? event.target.closest('.stcj-outline-row') : null;
    const entering = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.stcj-outline-row') : null;
    if (leaving && leaving !== entering) scheduleHoverClose();
  }

  function clearPreviewTimer() {
    clearTimeout(state.outline.previewTimer);
    state.outline.previewTimer = null;
  }

  function scheduleHoverClose() {
    clearPreviewTimer();
    state.outline.previewTimer = setTimeout(() => { if (!state.outline.preview?.pinned) closePreview(); }, HOVER_CLOSE_MS);
  }

  function buildPreviewElement() {
    const el = document.createElement('div');
    el.id = PREVIEW_ID;
    el.className = 'stcj-outline-preview';
    el.setAttribute('role', 'dialog');
    el.addEventListener('pointerenter', clearPreviewTimer);
    el.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && !state.outline.preview?.pinned) scheduleHoverClose(); });
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('[data-outline-action], .stcj-outline-bubble') : null;
      if (!target) return;
      if (target.dataset.outlineAction === 'close-preview') return closePreview();
      const id = Number(target.dataset.mesid);
      if (Number.isInteger(id)) void jumpTo(id);
    });
    for (const type of ['mousedown', 'touchstart']) el.addEventListener(type, e => e.stopPropagation(), { passive: true });
    document.body.append(el);
    return el;
  }

  function openPreview(id, pinned) {
    clearPreviewTimer();
    const chat = chatArray();
    const ids = resolveBubbleGroup(chat, id);
    if (!ids.length || !panel()) return;
    const seq = (state.outline.previewSeq = (state.outline.previewSeq || 0) + 1);
    state.outline.preview = { id, pinned, seq };
    panel().querySelectorAll('.stcj-outline-row.is-previewing').forEach(row => row.classList.remove('is-previewing'));
    rowElement(id)?.classList.add('is-previewing');
    const el = previewElement() || buildPreviewElement();
    el.classList.toggle('is-pinned', !!pinned);
    el.setAttribute('aria-label', `第 ${ids[0]}–${ids[ids.length - 1]} 楼气泡预览`);
    const header = document.createElement('div');
    header.className = 'stcj-outline-preview-header';
    const title = document.createElement('span');
    title.textContent = ids.length > 1 ? `#${ids[0]} – #${ids[ids.length - 1]} · 气泡组` : `#${ids[0]}`;
    const hint = document.createElement('small');
    hint.textContent = '点击气泡跳转';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'stcj-outline-icon-btn';
    close.dataset.outlineAction = 'close-preview';
    close.title = '关闭预览';
    close.innerHTML = constants.ICONS.close;
    header.append(title, hint, close);
    const stack = document.createElement('div');
    stack.className = 'stcj-outline-bubbles';
    const bodies = ids.map(mesId => {
      const message = chat[mesId];
      const bubble = document.createElement('div');
      bubble.className = `stcj-outline-bubble ${message.is_user ? 'is-user' : 'is-char'}${mesId === id ? ' is-focus' : ''}`;
      bubble.dataset.mesid = String(mesId);
      bubble.title = `跳转到第 ${mesId} 楼`;
      const meta = document.createElement('div');
      meta.className = 'stcj-outline-bubble-meta';
      const name = document.createElement('b');
      name.textContent = String(message.name || (message.is_user ? 'User' : 'AI'));
      const floor = document.createElement('span');
      floor.textContent = `#${mesId}`;
      meta.append(name, floor);
      const body = document.createElement('div');
      body.className = 'stcj-outline-bubble-body mes_text';
      body.textContent = excerptOf(message);
      bubble.append(meta, body);
      stack.append(bubble);
      return { mesId, message, body };
    });
    el.replaceChildren(header, stack);
    positionPreview();
    // Formatting reuses the favorites pipeline (regex → host messageFormatting → sanitize).
    bodies.forEach(({ mesId, message, body }) => void renderBubbleBody(mesId, message, body, seq));
  }

  async function renderBubbleBody(mesId, message, body, seq) {
    try {
      const raw = messageText(message);
      const text = String(await dependencies.applyFavoritesRegexPipeline(raw, message.is_user ? 1 : 2) || raw);
      if (state.outline.preview?.seq !== seq) return;
      const formatted = dependencies.applySillyTavernMessageFormatting(text, message.name, !!message.is_user, mesId);
      const tpl = document.createElement('template');
      tpl.innerHTML = dependencies.buildFavoriteRenderableHtml(text, formatted);
      // A thumbnail must not restyle the page or run embedded documents.
      tpl.content.querySelectorAll('style, link, iframe, script, object, embed').forEach(node => node.remove());
      body.replaceChildren(tpl.content);
      positionPreview();
    } catch (error) {
      console.warn('[STCJ] outline preview render failed', error);
    }
  }

  function positionPreview() {
    const el = previewElement();
    const preview = state.outline.preview;
    const root = panel();
    if (!el || !preview || !root) return;
    const panelRect = root.getBoundingClientRect();
    const vp = visibleViewport();
    const margin = 8;
    const width = Math.min(380, vp.width - margin * 2);
    const onLeft = root.classList.contains('is-left');
    const left = onLeft ? panelRect.right + margin : panelRect.left - margin - width;
    const fitsBeside = onLeft ? left + width <= vp.left + vp.width - margin : left >= vp.left + margin;
    el.style.width = `${width}px`;
    el.style.maxHeight = `${Math.round(fitsBeside ? Math.min(560, vp.height * 0.7) : vp.height * 0.58)}px`;
    el.classList.toggle('is-sheet', !fitsBeside);
    if (!fitsBeside) {
      // Narrow screens: a bottom sheet over the panel, inside the visible area.
      el.style.left = `${vp.left + Math.max(margin, (vp.width - width) / 2)}px`;
      el.style.top = `${vp.top + vp.height - margin - el.offsetHeight}px`;
      return;
    }
    el.style.left = `${left}px`;
    const rowRect = rowElement(preview.id)?.getBoundingClientRect();
    const top = (rowRect ? rowRect.top : panelRect.top) - 12;
    el.style.top = `${Math.max(vp.top + margin, Math.min(top, vp.top + vp.height - el.offsetHeight - margin))}px`;
  }

  function closePreview() {
    clearPreviewTimer();
    if (!state.outline.preview) return;
    state.outline.preview = null;
    panel()?.querySelectorAll('.stcj-outline-row.is-previewing').forEach(row => row.classList.remove('is-previewing'));
    previewElement()?.remove();
  }

  function destroyOutline() {
    closeOutline();
    clearPreviewTimer();
    previewElement()?.remove();
    state.outline.filter = '';
  }

  return { isOutlineOpen, openOutline, closeOutline, toggleOutline, destroyOutline };
}
