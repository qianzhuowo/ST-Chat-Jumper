import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "buildFavoriteCurrentBranchBadgeHtml",
  "buildFavoriteDetailEntries",
  "buildFavoritePreviewModeSwitchHtml",
  "buildFavoritePreviewSrcdoc",
  "buildFavoriteReasoningBlock",
  "buildFavoriteSortModeSwitchHtml",
  "buildFavoriteSwipeBadgeHtml",
  "deleteFavoriteByIdWithConfirm",
  "editFavoriteNoteById",
  "ensureFavoriteResolved",
  "ensureFavoritesPreviewMessageListener",
  "escapeHtml",
  "formatFavoriteSwipeLabel",
  "formatFavoriteTimestamp",
  "formatFloorLabel",
  "getFavoriteItemById",
  "getFavoriteListSummary",
  "getFavoritePreviewFrameId",
  "getFavoritePreviewModeLabel",
  "getFavoriteResolvedSnapshot",
  "getFavoriteResolvedSwipeIndex",
  "getFavoriteStatusDescription",
  "getFavoriteStatusLabel",
  "getHostContext",
  "getIcon",
  "jumpToFavoriteItem",
  "log",
  "normalizeFavoritePreviewMode",
  "normalizeFavoriteSortMode",
  "prepareFavoritePreviewPayload",
  "renderFavoritePreviewMarkupByMode",
  "renderHtmlCodeIframesInElement",
  "resolveFavoriteTarget",
  "saveFavoritesPreviewMode",
  "sortFavoriteItems"
];

export function createFeature({ state, dependencies }) {
  function isFavoritesModalMobileLayout() {
    try {
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia(`(max-width: ${constants.FAVORITES_MODAL_DRAWER_BREAKPOINT}px)`).matches;
      }
    } catch {
      /* ignore */
    }
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    return viewportWidth <= constants.FAVORITES_MODAL_DRAWER_BREAKPOINT;
  }

  function updateFavoritesSidebarToggleButton(modal, isMobile = isFavoritesModalMobileLayout()) {
    const button = modal?.querySelector('.stcj-modal-sidebar-toggle');
    if (!button) return;
    const isOpen = isMobile ? state.favorites.favoritesSidebarDrawerOpen : !state.favorites.favoritesSidebarCollapsed;
    const label = isOpen ? '收起' : '展开';
    button.setAttribute('title', isMobile ? `${label}抽屉` : label);
    button.setAttribute('aria-label', isMobile ? `${label}抽屉` : label);
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    button.innerHTML = `${dependencies.getIcon(isOpen ? 'sidebarCollapse' : 'sidebarExpand')}<span class="stcj-modal-sidebar-toggle-label">${label}</span>`;
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
    if (!isMobile) state.favorites.favoritesSidebarDrawerOpen = false;
    modal.classList.toggle('stcj-modal-mobile-layout', isMobile);
    modal.classList.toggle('is-sidebar-collapsed', !isMobile && state.favorites.favoritesSidebarCollapsed);
    modal.classList.toggle('is-sidebar-drawer-open', !!(isMobile && state.favorites.favoritesSidebarDrawerOpen));
    updateFavoritesSidebarToggleButton(modal, isMobile);
    updateFavoritesModalSubtitle(modal);
  }

  function toggleFavoritesSidebar(modal) {
    if (isFavoritesModalMobileLayout()) {
      state.favorites.favoritesSidebarDrawerOpen = !state.favorites.favoritesSidebarDrawerOpen;
    } else {
      state.favorites.favoritesSidebarCollapsed = !state.favorites.favoritesSidebarCollapsed;
    }
    syncFavoritesSidebarState(modal);
  }

  function closeFavoritesSidebarDrawer(modal) {
    state.favorites.favoritesSidebarDrawerOpen = false;
    syncFavoritesSidebarState(modal);
  }

  function ensureFavoritesModalResizeListener() {
    if (ensureFavoritesModalResizeListener.bound) return;
    const onResize = () => syncFavoritesSidebarState(document.getElementById(constants.FAVORITES_MODAL_ID));
    window.addEventListener('resize', onResize);
    ensureFavoritesModalResizeListener.detach = () => window.removeEventListener('resize', onResize);
    ensureFavoritesModalResizeListener.bound = true;
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

    const sidebarEntries = dependencies.sortFavoriteItems(detailEntries, state.favorites.favoritesModalSort);
    sidebarList.innerHTML = sidebarEntries.map((entry, index) => {
      const snapshot = dependencies.getFavoriteResolvedSnapshot(entry.item, entry.resolution);
      const floor = entry.resolution.status === 'missing' ? '未定位' : dependencies.formatFloorLabel(entry.resolution.mesId);
      const swipeIndex = dependencies.getFavoriteResolvedSwipeIndex(entry.item, entry.resolution);
      const summary = dependencies.escapeHtml(dependencies.getFavoriteListSummary(entry.item, entry.resolution));
      const currentBranchBadge = dependencies.buildFavoriteCurrentBranchBadgeHtml(entry.item, entry.resolution, detailEntries);
      const active = entry.item.id === state.favorites.favoritesModalActiveId ? 'is-active' : '';
      const status = dependencies.getFavoriteStatusLabel(entry.resolution.status, snapshot);
      const statusHtml = status ? `<span class="stcj-modal-sidebar-status" title="${dependencies.escapeHtml(dependencies.getFavoriteStatusDescription(entry.resolution.status, snapshot) || status)}">${dependencies.escapeHtml(status)}</span>` : '';
      return `
        <button class="stcj-modal-sidebar-item ${active}" data-action="focusFavoriteCard" data-fav-id="${entry.item.id}">
          <span class="stcj-modal-sidebar-copy">
            <span class="stcj-modal-sidebar-topline">
              <span class="stcj-modal-order">${index + 1}</span>
              <span class="stcj-modal-sidebar-floor">${dependencies.escapeHtml(floor)}${dependencies.buildFavoriteSwipeBadgeHtml(swipeIndex)}${currentBranchBadge}</span>
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
    dependencies.ensureFavoritesPreviewMessageListener();

    if (mode === constants.FAVORITES_PREVIEW_MODES.SWIPE_HTML) {
      previewEntries.forEach(({ entry, previewResult }) => {
        const frame = document.getElementById(dependencies.getFavoritePreviewFrameId(entry.item.id));
        if (!frame) return;
        const payload = previewResult.payload;
        const reasoningBlock = dependencies.buildFavoriteReasoningBlock(payload.processedReasoningHtml);
        const previewBody = payload.processedPreviewHtml || '<div class="stcj-empty-copy">原消息内容不可用。</div>';
        frame.style.height = '160px';
        frame.setAttribute('srcdoc', dependencies.buildFavoritePreviewSrcdoc(`${reasoningBlock}<div>${previewBody || '<div class="stcj-empty-copy">原消息内容不可用。</div>'}</div>`, state.favorites.favoritesPreviewIframeToken, entry.item.id));
      });
      return;
    }

    if (mode === constants.FAVORITES_PREVIEW_MODES.STAR_MAIN) {
      container.querySelectorAll('.stcj-star-preview').forEach((el) => dependencies.renderHtmlCodeIframesInElement(el));
    }
  }

  async function buildFavoritePreviewEntries(detailEntries, mode) {
    const result = [];
    for (const entry of detailEntries) {
      // eslint-disable-next-line no-await-in-loop
      const payload = await dependencies.prepareFavoritePreviewPayload(entry.item, entry.resolution);
      result.push({
        entry,
        previewResult: dependencies.renderFavoritePreviewMarkupByMode(mode, entry.item, payload),
      });
    }
    return result;
  }

  function ensureFavoritesModalRoot() {
    let modal = document.getElementById(constants.FAVORITES_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = constants.FAVORITES_MODAL_ID;
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
          <button class="stcj-modal-close" data-action="closeFavoritesManager" title="关闭">${constants.ICONS.close}</button>
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
                <button class="stcj-modal-card-btn" data-action="favoriteJump" data-fav-id="" title="跳转到楼层">${constants.ICONS.arrowUpRight}<span>跳转</span></button>
                <button class="stcj-modal-card-btn" data-action="favoriteEditNote" data-fav-id="" title="编辑备注">${constants.ICONS.note}<span>备注</span></button>
                <button class="stcj-modal-card-btn danger" data-action="favoriteDelete" data-fav-id="" title="删除收藏">${constants.ICONS.trash}<span>删除</span></button>
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
        state.favorites.favoritesPreviewMode = dependencies.normalizeFavoritePreviewMode(actionEl.getAttribute('data-preview-mode'));
        dependencies.saveFavoritesPreviewMode(state.favorites.favoritesPreviewMode);
        setFavoriteDetailPreviewLoading(modal);
        await renderFavoritesManager();
        return;
      }
      if (action === 'setFavoritesSortMode') {
        state.favorites.favoritesModalSort = dependencies.normalizeFavoriteSortMode(actionEl.getAttribute('data-sort-mode'));
        const sortWrapEl = modal.querySelector('.stcj-modal-sort-wrap');
        if (sortWrapEl) sortWrapEl.innerHTML = dependencies.buildFavoriteSortModeSwitchHtml();
        const detailEntries = dependencies.buildFavoriteDetailEntries();
        renderFavoritesSidebarList(modal, detailEntries);
        setFavoritesSidebarActiveState(modal, state.favorites.favoritesModalActiveId);
        syncFavoritesSidebarState(modal);
        return;
      }
      if (action === 'focusFavoriteCard') {
        const favoriteId = actionEl.getAttribute('data-fav-id');
        if (!favoriteId) return;
        state.favorites.favoritesModalActiveId = favoriteId;
        setFavoritesSidebarActiveState(modal, favoriteId);
        setFavoriteDetailPreviewLoading(modal);
        await renderFavoritesManager();
        return;
      }

      const favoriteId = actionEl.getAttribute('data-fav-id');
      if (!favoriteId) return;

      if (action === 'favoriteJump') {
        const item = dependencies.getFavoriteItemById(favoriteId);
        const jumped = await dependencies.jumpToFavoriteItem(item, 'start');
        if (jumped) closeFavoritesManager();
        return;
      }

      if (action === 'favoriteEditNote') {
        await dependencies.editFavoriteNoteById(favoriteId);
        return;
      }

      if (action === 'favoriteDelete') {
        await dependencies.deleteFavoriteByIdWithConfirm(favoriteId);
      }
    });

    ensureFavoritesModalResizeListener();
    syncFavoritesSidebarState(modal);
    document.body.appendChild(modal);
    return modal;
  }

  function closeFavoritesManager() {
    state.favorites.favoritesModalOpen = false;
    state.favorites.favoritesSidebarDrawerOpen = false;
    const modal = document.getElementById(constants.FAVORITES_MODAL_ID);
    syncFavoritesSidebarState(modal);
    modal?.classList.remove('is-open');
  }

  async function renderFavoritesManager() {
    const modal = ensureFavoritesModalRoot();
    if (!modal) return;
    syncFavoritesSidebarState(modal);
    const renderSeq = ++state.favorites.favoritesRenderSeq;
    state.favorites.favoritesModalSort = dependencies.normalizeFavoriteSortMode(state.favorites.favoritesModalSort);
    const previewMode = dependencies.normalizeFavoritePreviewMode(state.favorites.favoritesPreviewMode);

    const detailEntries = dependencies.buildFavoriteDetailEntries();
    const sidebarList = modal.querySelector('.stcj-modal-sidebar-list');
    const mainList = modal.querySelector('.stcj-modal-main-list');
    const headerTitleEl = modal.querySelector('.stcj-modal-title');
    const sortWrapEl = modal.querySelector('.stcj-modal-sort-wrap');
    const subtitleEl = modal.querySelector('.stcj-modal-subtitle');
    const previewSwitchEl = modal.querySelector('.stcj-modal-preview-switch');
    const mobileSummaryTitleEl = modal.querySelector('.stcj-modal-sidebar-mobile-title');
    const headRefs = getFavoritesMainHeadRefs(modal);

    const modalTitleText = `收藏 · 共 ${state.favorites.favoriteItems.length} 条`;
    if (headerTitleEl) headerTitleEl.textContent = modalTitleText;
    if (mobileSummaryTitleEl) mobileSummaryTitleEl.textContent = modalTitleText;
    if (sortWrapEl) sortWrapEl.innerHTML = dependencies.buildFavoriteSortModeSwitchHtml();
    if (previewSwitchEl) previewSwitchEl.innerHTML = dependencies.buildFavoritePreviewModeSwitchHtml();
    if (headRefs.title) headRefs.title.textContent = `详情预览 · ${dependencies.getFavoritePreviewModeLabel(previewMode)}`;
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
    if (!state.favorites.favoritesModalActiveId || !detailEntries.some((entry) => entry.item.id === state.favorites.favoritesModalActiveId)) {
      state.favorites.favoritesModalActiveId = detailEntries[0].item.id;
    }

    const activeEntry = detailEntries.find((entry) => entry.item.id === state.favorites.favoritesModalActiveId) || detailEntries[0];
    const previewMessage = activeEntry?.resolution?.message;
    if (window.__TAURITAVERN__ && previewMessage?.tt_swipe_cold) {
      const metadata = dependencies.getHostContext()?.chatMetadata;
      const isCurrentRender = () => renderSeq === state.favorites.favoritesRenderSeq
        && state.favorites.favoritesModalOpen && dependencies.getHostContext()?.chatMetadata === metadata;
      try {
        // tt 的 transport 暴露宿主原生水合逻辑：仅补齐当前预览楼层的空槽，
        // 保留实时分支内容、swipe_id 与冷源寿命。原版 ST 不加载此模块。
        const { hydrateMessageSwipes } = await import('../../../../chat-payload-transport.js');
        if (!isCurrentRender()) return;
        await hydrateMessageSwipes(previewMessage);
        if (!isCurrentRender()) return;
        activeEntry.resolution = dependencies.ensureFavoriteResolved(activeEntry.item, dependencies.resolveFavoriteTarget(activeEntry.item));
      } catch (error) {
        if (!isCurrentRender()) return;
        dependencies.log('收藏历史分支加载失败', error);
        if (mainList) mainList.textContent = '历史分支尚未加载，无法显示完整预览。请重新打开收藏重试。';
        return;
      }
    }
    if (activeEntry && headRefs.title) {
      const activeSnapshot = dependencies.getFavoriteResolvedSnapshot(activeEntry.item, activeEntry.resolution);
      const activeFloor = activeEntry.resolution.status === 'missing' ? '未定位楼层' : dependencies.formatFloorLabel(activeEntry.resolution.mesId);
      const activeSwipe = dependencies.formatFavoriteSwipeLabel(activeSnapshot?.swipeIndex ?? activeEntry.item.swipeIndex);
      const activeSendDate = dependencies.formatFavoriteTimestamp(activeEntry.item.sendDate || activeEntry.resolution.message?.send_date || '');
      const statusLabel = dependencies.getFavoriteStatusLabel(activeEntry.resolution.status, activeSnapshot);
      headRefs.title.textContent = `${activeFloor}${activeSwipe ? ` · ${activeSwipe}` : ''} · ${activeSendDate}${statusLabel ? ` · ${statusLabel}` : ''}`;
    }

    renderFavoritesSidebarList(modal, detailEntries);

    if (mainList) {
      const previewEntries = await buildFavoritePreviewEntries(activeEntry ? [activeEntry] : [], previewMode);
      if (renderSeq !== state.favorites.favoritesRenderSeq) return;

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
    state.favorites.favoritesModalOpen = true;
    if (targetId) state.favorites.favoritesModalActiveId = targetId;
    if (isFavoritesModalMobileLayout()) {
      state.favorites.favoritesSidebarDrawerOpen = false;
    }
    const modal = ensureFavoritesModalRoot();
    syncFavoritesSidebarState(modal);
    renderFavoritesManager();
    modal?.classList.add('is-open');
  }

  return { isFavoritesModalMobileLayout, updateFavoritesSidebarToggleButton, formatFavoritesModalSubtitle, updateFavoritesModalSubtitle, syncFavoritesSidebarState, toggleFavoritesSidebar, closeFavoritesSidebarDrawer, ensureFavoritesModalResizeListener, ensureFavoritesDetailShell, getFavoritesMainHeadRefs, setFavoritesSidebarActiveState, setFavoriteDetailPreviewLoading, renderFavoritesSidebarList, hydrateFavoritePreviewByMode, buildFavoritePreviewEntries, ensureFavoritesModalRoot, closeFavoritesManager, renderFavoritesManager, openFavoritesManager };
}
