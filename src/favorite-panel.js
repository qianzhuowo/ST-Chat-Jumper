import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "buildFavoriteSwipeBadgeHtml",
  "clamp",
  "deleteFavoriteByIdWithConfirm",
  "editFavoriteNoteById",
  "ensureFavoriteResolved",
  "escapeHtml",
  "formatFloorLabel",
  "getFavoriteItemById",
  "getFavoriteResolvedSnapshot",
  "getFavoriteResolvedSwipeIndex",
  "getFavoriteStatusDescription",
  "getFavoriteStatusLabel",
  "getRecentFavoriteItems",
  "jumpToFavoriteItemFromRecentList",
  "normalizeRootScale",
  "openFavoritesManager",
  "resolveFavoriteTarget",
  "saveSettings",
  "setFavPanelOpen",
  "setIcon",
  "setPinMode",
  "updateFavPanelToggleButton"
];

export function createFeature({ state, dependencies }) {
  function removeFavoriteQuickMenuOverlay() {
    document.getElementById(constants.FAVORITE_QUICK_MENU_OVERLAY_ID)?.remove();
  }

  function positionFavoriteQuickMenuOverlay(menu, trigger) {
    if (!menu || !trigger) return;
    const margin = 8;
    const gap = 6;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    const canOpenRight = triggerRect.left + menuRect.width <= viewportWidth - margin;
    const canOpenLeft = triggerRect.right - menuRect.width >= margin;
    const canOpenDown = triggerRect.bottom + gap + menuRect.height <= viewportHeight - margin;
    const canOpenUp = triggerRect.top - gap - menuRect.height >= margin;

    let horizontal = 'left';
    if (!canOpenLeft && canOpenRight) {
      horizontal = 'right';
    } else if (!canOpenLeft && !canOpenRight) {
      const spaceLeft = Math.max(0, triggerRect.right - margin);
      const spaceRight = Math.max(0, viewportWidth - margin - triggerRect.left);
      horizontal = spaceRight > spaceLeft ? 'right' : 'left';
    }

    let vertical = 'down';
    if (!canOpenDown && canOpenUp) {
      vertical = 'up';
    } else if (!canOpenDown && !canOpenUp) {
      const spaceUp = Math.max(0, triggerRect.top - margin);
      const spaceDown = Math.max(0, viewportHeight - margin - triggerRect.bottom);
      vertical = spaceUp > spaceDown ? 'up' : 'down';
    }

    let left = horizontal === 'right'
      ? triggerRect.left
      : (triggerRect.right - menuRect.width);
    let top = vertical === 'up'
      ? (triggerRect.top - menuRect.height - gap)
      : (triggerRect.bottom + gap);

    if (left + menuRect.width > viewportWidth - margin) {
      left = viewportWidth - margin - menuRect.width;
    }
    if (left < margin) left = margin;

    if (top + menuRect.height > viewportHeight - margin) top = viewportHeight - margin - menuRect.height;
    if (top < margin) top = margin;

    menu.dataset.horizontal = horizontal;
    menu.dataset.vertical = vertical;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = 'visible';
  }

  function renderFavoriteQuickMenuOverlay() {
    removeFavoriteQuickMenuOverlay();
    if (!state.favorites.favoriteQuickMenuId) return;

    const trigger = document.querySelector(`#${constants.ROOT_ID} [data-favorite-menu-trigger="${String(state.favorites.favoriteQuickMenuId)}"]`);
    if (!trigger) return;

    const item = dependencies.getFavoriteItemById(state.favorites.favoriteQuickMenuId);
    if (!item) return;

    const overlay = document.createElement('div');
    overlay.id = constants.FAVORITE_QUICK_MENU_OVERLAY_ID;
    overlay.className = 'stcj-fav-menu stcj-fav-menu-floating';
    overlay.style.visibility = 'hidden';
    overlay.innerHTML = `
      <button type="button" class="stcj-fav-menu-item" data-favorite-menu-action="note" data-favorite-id="${item.id}">${constants.ICONS.note}<span>备注</span></button>
      <button type="button" class="stcj-fav-menu-item danger" data-favorite-menu-action="delete" data-favorite-id="${item.id}">${constants.ICONS.trash}<span>删除</span></button>
    `;

    overlay.addEventListener('pointerup', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menuAction = e.target?.closest?.('[data-favorite-menu-action]');
      if (!menuAction) return;
      const favoriteId = menuAction.getAttribute('data-favorite-id');
      if (!favoriteId) return;
      const action = menuAction.getAttribute('data-favorite-menu-action');
      closeFavoriteQuickMenu();
      if (action === 'note') {
        await dependencies.editFavoriteNoteById(favoriteId);
      } else if (action === 'delete') {
        await dependencies.deleteFavoriteByIdWithConfirm(favoriteId);
      }
    });

    document.body.appendChild(overlay);
    positionFavoriteQuickMenuOverlay(overlay, trigger);
  }

  function closeFavoriteQuickMenu() {
    removeFavoriteQuickMenuOverlay();
    if (!state.favorites.favoriteQuickMenuId) return;
    state.favorites.favoriteQuickMenuId = null;
    const root = document.getElementById(constants.ROOT_ID);
    if (root) updateFavoritesUI(root);
  }

  function openFavoriteQuickMenu(favoriteId) {
    state.favorites.favoriteQuickMenuId = state.favorites.favoriteQuickMenuId === favoriteId ? null : favoriteId;
    const root = document.getElementById(constants.ROOT_ID);
    if (root) updateFavoritesUI(root);
    if (state.favorites.favoriteQuickMenuId) renderFavoriteQuickMenuOverlay();
  }

  function getFavoritePanelElement(root = document.getElementById(constants.ROOT_ID)) {
    return root?.querySelector?.('.stcj-fav-panel') || null;
  }

  function getRootViewportScale(root) {
    if (!root) return 1;
    const rect = root.getBoundingClientRect?.();
    const width = root.offsetWidth || 0;
    if (rect?.width && width > 0) {
      return Math.max(0.01, rect.width / width);
    }
    return dependencies.normalizeRootScale(state.layout.settings.scale);
  }

  function getFavoritePanelViewportMetrics(panel) {
    const rect = panel?.getBoundingClientRect?.();
    const width = Math.max(0, rect?.width || panel?.offsetWidth || 0);
    const height = Math.max(0, rect?.height || panel?.offsetHeight || 0);
    const margin = 8;
    return {
      width,
      height,
      margin,
      maxLeft: Math.max(0, window.innerWidth - width - margin * 2),
      maxTop: Math.max(0, window.innerHeight - height - margin * 2),
    };
  }

  function getFavoritePanelCssSizeLimits(root) {
    const scale = getRootViewportScale(root);
    const maxWByViewport = Math.max(constants.FAV_PANEL_MIN_W, (window.innerWidth - 16) / scale);
    const maxHByViewport = Math.max(constants.FAV_PANEL_MIN_H, (window.innerHeight - 16) / scale);
    return {
      minW: constants.FAV_PANEL_MIN_W,
      minH: constants.FAV_PANEL_MIN_H,
      maxW: Math.min(constants.FAV_PANEL_MAX_W, maxWByViewport),
      maxH: Math.min(constants.FAV_PANEL_MAX_H, maxHByViewport),
      scale,
    };
  }

  function applyFavoritePanelViewportPosition(root, panel, viewportLeft, viewportTop, persist = false) {
    if (!root || !panel) return;
    const { width, height, margin, maxLeft, maxTop } = getFavoritePanelViewportMetrics(panel);
    if (!width || !height) return;
    const lockedWidth = Math.round(width);

    const clampedLeft = dependencies.clamp(Number(viewportLeft) || 0, margin, margin + maxLeft);
    const clampedTop = dependencies.clamp(Number(viewportTop) || 0, margin, margin + maxTop);
    const rootRect = root.getBoundingClientRect();
    const rootScale = getRootViewportScale(root);

    panel.dataset.positionMode = 'custom';
    root.dataset.favPanelDefaultSide = 'custom';
    // 自定义尺寸模式下宽度由用户控制，不回写锁定宽度
    if (panel.dataset.sizeMode !== 'custom') {
      panel.style.width = `${Math.round(lockedWidth / rootScale)}px`;
    }
    panel.style.left = `${Math.round((clampedLeft - rootRect.left) / rootScale)}px`;
    panel.style.top = `${Math.round((clampedTop - rootRect.top) / rootScale)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';

    if (!persist) return;

    state.layout.settings.favPanelCustom = true;
    state.layout.settings.favPanelX = Math.round(clampedLeft);
    state.layout.settings.favPanelY = Math.round(clampedTop);
    state.layout.settings.favPanelRx = maxLeft > 0 ? dependencies.clamp((clampedLeft - margin) / maxLeft, 0, 1) : 0;
    state.layout.settings.favPanelRy = maxTop > 0 ? dependencies.clamp((clampedTop - margin) / maxTop, 0, 1) : 0;
    dependencies.saveSettings();
  }

  function applyFavoritePanelDefaultPosition(root, panel) {
    if (!root || !panel) return;
    panel.removeAttribute('data-position-mode');
    // 自定义尺寸模式下保留用户设置的宽高，不清除
    if (panel.dataset.sizeMode !== 'custom') {
      panel.style.width = '';
      panel.style.height = '';
    }
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';

    let side = 'bottom';
    if (state.layout.settings.orientation === 'vertical') {
      const rootRect = root.getBoundingClientRect();
      const { width } = getFavoritePanelViewportMetrics(panel);
      const gap = 10;
      const leftSpace = Math.max(0, rootRect.left - gap);
      const rightSpace = Math.max(0, window.innerWidth - rootRect.right - gap);
      if (rightSpace >= width && leftSpace < width) side = 'right';
      else if (leftSpace >= width && rightSpace < width) side = 'left';
      else side = rightSpace > leftSpace ? 'right' : 'left';
    }

    root.dataset.favPanelDefaultSide = side;
  }

  function applyFavoritePanelPosition(root, opts = {}) {
    const panel = getFavoritePanelElement(root);
    if (!root || !panel) return;
    if (!state.favorites.favPanelOpen && !opts.force) return;

    // 先恢复自定义尺寸（若有），再计算位置
    applyFavoritePanelSize(root, panel);

    if (state.layout.settings.favPanelCustom) {
      const { margin, maxLeft, maxTop } = getFavoritePanelViewportMetrics(panel);
      const viewportLeft = typeof state.layout.settings.favPanelRx === 'number'
        ? margin + state.layout.settings.favPanelRx * maxLeft
        : (typeof state.layout.settings.favPanelX === 'number' ? state.layout.settings.favPanelX : margin);
      const viewportTop = typeof state.layout.settings.favPanelRy === 'number'
        ? margin + state.layout.settings.favPanelRy * maxTop
        : (typeof state.layout.settings.favPanelY === 'number' ? state.layout.settings.favPanelY : margin);
      applyFavoritePanelViewportPosition(root, panel, viewportLeft, viewportTop, false);
      return;
    }

    applyFavoritePanelDefaultPosition(root, panel);
  }

  function attachFavoritePanelDrag(root) {
    const panel = getFavoritePanelElement(root);
    const header = panel?.querySelector?.('.stcj-fav-header');
    if (!panel || !header) return;

    let dragState = null;
    const DRAG_THRESHOLD = 4;

    const finishDrag = (persist) => {
      if (!dragState) return;
      try { header.releasePointerCapture?.(dragState.pointerId); } catch { /* ignore */ }
      if (persist && dragState.moved) {
        persistFavoritePanelPosition(root, panel, dragState.left + dragState.dx, dragState.top + dragState.dy);
      }
      panel.classList.remove('stcj-fav-panel-dragging');
      dragState = null;
    };

    header.addEventListener('pointerdown', (e) => {
      if (!state.favorites.favPanelOpen) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target?.closest?.('.stcj-fav-close')) return;

      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        left: rect.left,
        top: rect.top,
        dx: 0,
        dy: 0,
        moved: false,
      };
      panel.classList.add('stcj-fav-panel-dragging');
      try { header.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
      e.stopPropagation();
    });

    header.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      dragState.dx = e.clientX - dragState.startX;
      dragState.dy = e.clientY - dragState.startY;
      if (!dragState.moved) {
        if (Math.hypot(dragState.dx, dragState.dy) < DRAG_THRESHOLD) return;
        dragState.moved = true;
      }
      applyFavoritePanelViewportPosition(root, panel, dragState.left + dragState.dx, dragState.top + dragState.dy, false);
      e.preventDefault();
    });

    header.addEventListener('pointerup', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      finishDrag(true);
      e.preventDefault();
    });

    header.addEventListener('pointercancel', () => finishDrag(false));
  }

  function persistFavoritePanelPosition(root, panel, viewportLeft, viewportTop) {
    applyFavoritePanelViewportPosition(root, panel, viewportLeft, viewportTop, true);
  }

  function applyFavoritePanelSize(root, panel = getFavoritePanelElement(root)) {
    if (!panel) return;
    const hasW = typeof state.layout.settings.favPanelW === 'number' && Number.isFinite(state.layout.settings.favPanelW);
    const hasH = typeof state.layout.settings.favPanelH === 'number' && Number.isFinite(state.layout.settings.favPanelH);

    if (!hasW && !hasH) {
      panel.removeAttribute('data-size-mode');
      panel.style.width = '';
      panel.style.height = '';
      return;
    }

    panel.dataset.sizeMode = 'custom';
    const { maxW, maxH } = getFavoritePanelCssSizeLimits(root);
    if (hasW) {
      panel.style.width = `${dependencies.clamp(state.layout.settings.favPanelW, constants.FAV_PANEL_MIN_W, maxW)}px`;
    }
    if (hasH) {
      panel.style.height = `${dependencies.clamp(state.layout.settings.favPanelH, constants.FAV_PANEL_MIN_H, maxH)}px`;
    }
  }

  function attachFavoritePanelResize(root) {
    const panel = getFavoritePanelElement(root);
    const handle = panel?.querySelector?.('.stcj-fav-resize');
    if (!panel || !handle) return;

    let resizeState = null;

    const finishResize = (persist) => {
      if (!resizeState) return;
      try { handle.releasePointerCapture?.(resizeState.pointerId); } catch { /* ignore */ }
      panel.classList.remove('stcj-fav-panel-resizing');
      if (persist && resizeState.moved) {
        // 只保存尺寸，不动位置（不重算/不回写 rx/ry）——
        // 右下角缩放时左上角本来就未变，CSS left/top 也未变，无需重定位
        state.layout.settings.favPanelW = Math.round(parseFloat(panel.style.width) || resizeState.startW);
        state.layout.settings.favPanelH = Math.round(parseFloat(panel.style.height) || resizeState.startH);
        dependencies.saveSettings();
      }
      resizeState = null;
    };

    handle.addEventListener('pointerdown', (e) => {
      if (!state.favorites.favPanelOpen) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const rect = panel.getBoundingClientRect();
      const rootScale = getRootViewportScale(root);
      const startW = rect.width / rootScale;
      const startH = rect.height / rootScale;
      resizeState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startW,
        startH,
        startLeft: rect.left,
        startTop: rect.top,
        rootScale,
        moved: false,
      };
      // 进入自定义尺寸模式，锁定当前 CSS 尺寸作为起点
      panel.dataset.sizeMode = 'custom';
      panel.style.width = `${Math.round(startW)}px`;
      panel.style.height = `${Math.round(startH)}px`;
      panel.classList.add('stcj-fav-panel-resizing');
      try { handle.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!resizeState || resizeState.pointerId !== e.pointerId) return;
      const dx = e.clientX - resizeState.startX;
      const dy = e.clientY - resizeState.startY;
      if (!resizeState.moved && Math.hypot(dx, dy) < 3) return;
      resizeState.moved = true;

      const { maxW, maxH } = getFavoritePanelCssSizeLimits(root);
      const scale = resizeState.rootScale || getRootViewportScale(root);
      const w = dependencies.clamp(resizeState.startW + dx / scale, constants.FAV_PANEL_MIN_W, maxW);
      const h = dependencies.clamp(resizeState.startH + dy / scale, constants.FAV_PANEL_MIN_H, maxH);
      panel.style.width = `${Math.round(w)}px`;
      panel.style.height = `${Math.round(h)}px`;
      e.preventDefault();
    });

    handle.addEventListener('pointerup', (e) => {
      if (!resizeState || resizeState.pointerId !== e.pointerId) return;
      finishResize(true);
      e.stopPropagation();
      e.preventDefault();
    });

    handle.addEventListener('pointercancel', () => finishResize(false));
  }

  function closeFavPanel() {
    closeFavoriteQuickMenu();
    dependencies.setPinMode(false);
    dependencies.setFavPanelOpen(false);
  }

  function updateFavoritesUI(root) {
    const managerBtn = root.querySelector('.stcj-btn.stcj-favorites-manager');
    if (managerBtn) managerBtn.setAttribute('data-count', String(state.favorites.favoriteItems.length));

    root.classList.toggle('stcj-fav-open', state.favorites.favPanelOpen);
    dependencies.updateFavPanelToggleButton(root);

    const hint = root.querySelector('.stcj-fav-hint');
    if (hint) {
      if (state.favorites.favoriteItems.length > 0 && !state.favorites.pinMode) {
        hint.style.display = '';
        hint.textContent = `显示最近 ${Math.min(constants.FAVORITES_RECENT_LIMIT, state.favorites.favoriteItems.length)} 条收藏；更多请点击 📂 打开收藏管理器。`;
      } else {
        hint.style.display = '';
        hint.textContent = state.favorites.pinMode
          ? '点选楼层收藏：点击聊天中的目标楼层（ESC 退出点选）'
          : '点击 📌 进入点选收藏；点击 📂 打开收藏管理器。';
      }
    }

    const list = root.querySelector('.stcj-fav-list');
    if (!list) return;
    list.innerHTML = '';

    if (!state.favorites.favoriteItems.length) {
      const empty = document.createElement('div');
      empty.className = 'stcj-fav-empty';
      empty.textContent = '暂无收藏（当前聊天永久保存）';
      list.appendChild(empty);
      return;
    }

    const recentItems = dependencies.getRecentFavoriteItems();
    recentItems.forEach((favItem) => {
      const resolution = dependencies.ensureFavoriteResolved(favItem, dependencies.resolveFavoriteTarget(favItem));
      const snapshot = dependencies.getFavoriteResolvedSnapshot(favItem, resolution);
      const row = document.createElement('div');
      row.className = 'stcj-fav-item';
      row.setAttribute('data-favorite-id', String(favItem.id));
      row.title = dependencies.getFavoriteStatusDescription(resolution.status, snapshot)
        || (resolution.status === 'missing'
          ? '未能在当前聊天中定位该收藏楼层'
          : `mesid=${resolution.mesId}`);

      const floor = document.createElement('div');
      floor.className = 'stcj-fav-floor stcj-fav-item-main';
      const floorText = dependencies.formatFloorLabel(resolution?.mesId ?? favItem.messageId);
      const swipeIndex = dependencies.getFavoriteResolvedSwipeIndex(favItem, resolution);
      const statusText = dependencies.getFavoriteStatusLabel(resolution.status, snapshot);
      const note = String(favItem.note || '').trim();
      floor.innerHTML = `
        <span class="stcj-fav-item-topline">
          <span class="stcj-fav-floor-label">${dependencies.escapeHtml(floorText)}</span>
          ${dependencies.buildFavoriteSwipeBadgeHtml(swipeIndex)}
          ${statusText ? `<span class="stcj-fav-status" title="${dependencies.escapeHtml(dependencies.getFavoriteStatusDescription(resolution.status, snapshot) || statusText)}">${dependencies.escapeHtml(statusText)}</span>` : ''}
        </span>
        ${note ? `<span class="stcj-fav-note">${dependencies.escapeHtml(note)}</span>` : ''}
      `;

      const ops = document.createElement('div');
      ops.className = 'stcj-fav-item-ops';

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'stcj-fav-menu-btn';
      menuBtn.setAttribute('data-favorite-menu-trigger', favItem.id);
      menuBtn.title = '更多操作';
      dependencies.setIcon(menuBtn, 'more');
      ops.appendChild(menuBtn);
      menuBtn.setAttribute('aria-expanded', state.favorites.favoriteQuickMenuId === favItem.id ? 'true' : 'false');

      row.appendChild(floor);
      row.appendChild(ops);
      list.appendChild(row);
    });

    if (state.favorites.favoriteItems.length > constants.FAVORITES_RECENT_LIMIT) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'stcj-fav-more';
      more.setAttribute('data-favorite-open-manager', 'true');
      more.textContent = `查看全部 ${state.favorites.favoriteItems.length} 条收藏`;
      list.appendChild(more);
    }

    renderFavoriteQuickMenuOverlay();
    if (state.favorites.favPanelOpen) requestAnimationFrame(() => applyFavoritePanelPosition(root, { force: true }));
  }

  function bindFavoritesPanel(root) {
    const panel = root.querySelector('.stcj-fav-panel');
    if (!panel) return;

    panel.addEventListener('contextmenu', (e) => e.preventDefault());

    const closeBtn = panel.querySelector('.stcj-fav-close');
    closeBtn?.addEventListener('pointerup', (e) => {
      if (state.layout.isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      closeFavPanel();
    });

    panel.addEventListener('scroll', () => {
      closeFavoriteQuickMenu();
    }, { passive: true });

    panel.addEventListener('pointerup', async (e) => {
      if (state.layout.isDragging) return;

      const managerBtn = e.target?.closest?.('[data-favorite-open-manager]');
      if (managerBtn) {
        e.preventDefault();
        e.stopPropagation();
        dependencies.openFavoritesManager();
        return;
      }

      const menuTrigger = e.target?.closest?.('[data-favorite-menu-trigger]');
      if (menuTrigger) {
        e.preventDefault();
        e.stopPropagation();
        openFavoriteQuickMenu(menuTrigger.getAttribute('data-favorite-menu-trigger'));
        return;
      }

      const favoriteRow = e.target?.closest?.('.stcj-fav-item');
      if (!favoriteRow) return;

      const favoriteId = favoriteRow.getAttribute('data-favorite-id');
      if (!favoriteId) return;

      const favoriteItem = dependencies.getFavoriteItemById(favoriteId);
      if (!favoriteItem) return;

      e.preventDefault();
      e.stopPropagation();
      await dependencies.jumpToFavoriteItemFromRecentList(favoriteItem);
    });
  }

  return { removeFavoriteQuickMenuOverlay, positionFavoriteQuickMenuOverlay, renderFavoriteQuickMenuOverlay, closeFavoriteQuickMenu, openFavoriteQuickMenu, getFavoritePanelElement, getRootViewportScale, getFavoritePanelViewportMetrics, getFavoritePanelCssSizeLimits, applyFavoritePanelViewportPosition, applyFavoritePanelDefaultPosition, applyFavoritePanelPosition, attachFavoritePanelDrag, persistFavoritePanelPosition, applyFavoritePanelSize, attachFavoritePanelResize, closeFavPanel, updateFavoritesUI, bindFavoritesPanel };
}
