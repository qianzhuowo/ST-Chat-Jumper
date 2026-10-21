import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "addFavorite",
  "applyFavoritePanelPosition",
  "captureWindowScroll",
  "closeFavoriteQuickMenu",
  "ensureFavoriteResolved",
  "formatFloorLabel",
  "getFavoriteItemById",
  "getFavoritePanelElement",
  "getFavoriteQuickLabel",
  "getHostContext",
  "removeFavoriteById",
  "resolveFavoriteTarget",
  "restoreWindowScrollStable",
  "scrollMessageInChat",
  "showFloorRange",
  "showHostDialog",
  "toastInfo",
  "toastSuccess",
  "toastWarn",
  "updateFavPanelToggleButton",
  "updateFavoriteNoteById",
  "updateFavoritesUI"
];

export function createFeature({ state, dependencies }) {
  async function promptFavoriteNote(initialValue = '') {
    return dependencies.showHostDialog('INPUT', '编辑收藏备注', String(initialValue || ''));
  }

  async function confirmFavoriteDelete(item) {
    const label = dependencies.getFavoriteQuickLabel(item, { mesId: item.messageId });
    const tip = `确认删除收藏：${label} ？`;
    return dependencies.showHostDialog('CONFIRM', tip);
  }

  async function editFavoriteNoteById(favoriteId) {
    const item = dependencies.getFavoriteItemById(favoriteId);
    if (!item) return false;
    const metadata = dependencies.getHostContext()?.chatMetadata;
    const value = await promptFavoriteNote(item.note || '');
    if (value == null || metadata !== dependencies.getHostContext()?.chatMetadata) return false;
    if (!await dependencies.updateFavoriteNoteById(favoriteId, value)) return false;
    dependencies.toastSuccess(value ? '收藏备注已更新。' : '已清空收藏备注。');
    return true;
  }

  async function deleteFavoriteByIdWithConfirm(favoriteId) {
    const item = dependencies.getFavoriteItemById(favoriteId);
    if (!item) return false;
    const metadata = dependencies.getHostContext()?.chatMetadata;
    const confirmed = await confirmFavoriteDelete(item);
    if (!confirmed || metadata !== dependencies.getHostContext()?.chatMetadata) return false;
    const removed = await dependencies.removeFavoriteById(favoriteId);
    if (removed) dependencies.toastInfo('收藏已删除。');
    return removed;
  }

  async function jumpToFavoriteItemFromRecentList(item) {
    if (!item) return false;
    const resolution = dependencies.ensureFavoriteResolved(item, dependencies.resolveFavoriteTarget(item));
    if (!resolution?.message || resolution.status === 'missing') {
      dependencies.toastWarn('未能在当前聊天中定位到该收藏对应的楼层。');
      return false;
    }
    const existingEl = document.querySelector(`#chat .mes[mesid="${resolution.mesId}"]`);
    if (!existingEl) {
      return jumpToFavoriteItem(item, 'start');
    }

    const targetEl = document.querySelector(`#chat .mes[mesid="${resolution.mesId}"]`) || existingEl;
    const winPos = dependencies.captureWindowScroll();
    dependencies.scrollMessageInChat(targetEl, 'start', 'instant');
    dependencies.restoreWindowScrollStable(winPos);
    return true;
  }

  async function jumpToFavoriteItem(item, block = 'start') {
    void block;
    if (!item) return false;
    const resolution = dependencies.ensureFavoriteResolved(item, dependencies.resolveFavoriteTarget(item));
    if (!resolution?.message || resolution.status === 'missing') {
      dependencies.toastWarn('未能在当前聊天中定位到该收藏对应的楼层。');
      return false;
    }
    const jumped = await dependencies.showFloorRange(String(resolution.mesId));
    if (!jumped) return false;
    return true;
  }

  function setFavPanelOpen(open) {
    state.favorites.favPanelOpen = !!open;

    const root = document.getElementById(constants.ROOT_ID);
    if (root) {
      root.classList.toggle('stcj-fav-open', state.favorites.favPanelOpen);
      const panel = dependencies.getFavoritePanelElement(root);
      if (panel) panel.setAttribute('aria-hidden', state.favorites.favPanelOpen ? 'false' : 'true');
      dependencies.updateFavPanelToggleButton(root);
      dependencies.updateFavoritesUI(root);
      if (state.favorites.favPanelOpen) requestAnimationFrame(() => dependencies.applyFavoritePanelPosition(root, { force: true }));
    }

    // 关闭面板时一并退出点选模式
    if (!state.favorites.favPanelOpen) setPinMode(false);
  }

  function setPinMode(on) {
    state.favorites.pinMode = !!on;

    try {
      document.body.classList.toggle(constants.BODY_PIN_MODE_CLASS, state.favorites.pinMode);
    } catch {
      /* ignore */
    }

    const root = document.getElementById(constants.ROOT_ID);
    if (root) {
      const pinBtn = root.querySelector('.stcj-btn.stcj-pin');
      pinBtn?.classList.toggle('stcj-pin-active', state.favorites.pinMode);
      dependencies.updateFavoritesUI(root);
    }

    if (state.favorites.pinMode) attachPinPickListeners();
    else detachPinPickListeners();
  }

  function togglePinMode() {
    // 第一次点：打开面板并进入点选
    if (!state.favorites.favPanelOpen) setFavPanelOpen(true);

    setPinMode(!state.favorites.pinMode);

    if (state.favorites.pinMode) dependencies.toastInfo('点选收藏：请点击要收藏的楼层（按 ESC 退出）');
  }

  function bindRootOutsideClose(root) {
    const onPointerDown = (e) => {
      if (root.contains(e.target)) return;
      if (document.getElementById(constants.FAVORITES_MODAL_ID)?.contains(e.target)) return;
      if (document.getElementById(constants.FAVORITE_QUICK_MENU_OVERLAY_ID)?.contains(e.target)) return;
      dependencies.closeFavoriteQuickMenu();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      try {
        document.removeEventListener('pointerdown', onPointerDown, true);
      } catch {
        /* ignore */
      }
    };
  }

  function onPinPointerDown(e) {
    if (!state.favorites.pinMode) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    state.favorites.pinDown = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  }

  async function onPinPointerUp(e) {
    if (!state.favorites.pinMode) return;

    if (state.favorites.pinDown && state.favorites.pinDown.pointerId !== e.pointerId) return;
    const down = state.favorites.pinDown;
    state.favorites.pinDown = null;
    if (!down) return;

    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const CLICK_THRESHOLD = 8;
    if (Math.hypot(dx, dy) > CLICK_THRESHOLD) return; // 认为是拖拽/滚动

    const root = document.getElementById(constants.ROOT_ID);
    if (root && root.contains(e.target)) return; // 点在插件自身上

    const mesEl = e.target?.closest?.('#chat .mes[mesid]');
    if (!mesEl) return;

    const mesId = parseInt(mesEl.getAttribute('mesid') || '', 10);
    if (Number.isNaN(mesId)) return;

    // 在点选模式下，拦截点击，避免触发酒馆自身的消息交互
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    const saved = dependencies.addFavorite(mesId);
    if (root) dependencies.updateFavoritesUI(root);

    // 在等待保存前结束点选并拦截 click，避免异步 I/O 期间重复收藏。
    // 阻止本次点击（click 事件）继续触发酒馆自身逻辑
    state.favorites.suppressNextChatClick = true;
    setTimeout(() => {
      state.favorites.suppressNextChatClick = false;
    }, 400);

    // 一次点选后自动退出点选模式，但保留收藏面板
    setPinMode(false);
    if (await saved) dependencies.toastSuccess(`已收藏：${dependencies.formatFloorLabel(mesId)}`);
  }

  function onPinClickCapture(e) {
    const mesEl = e.target?.closest?.('#chat .mes[mesid]');
    if (!mesEl) return;

    const root = document.getElementById(constants.ROOT_ID);
    if (root && root.contains(e.target)) return;

    if (!state.favorites.pinMode && !state.favorites.suppressNextChatClick) return;

    state.favorites.suppressNextChatClick = false;

    // 捕获阶段拦截 click，避免触发消息选择/菜单等行为
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }

  function onPinKeyDown(e) {
    if (!state.favorites.pinMode) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setPinMode(false);
    }
  }

  function attachPinPickListeners() {
    if (state.favorites.pinListenersAttached) return;
    state.favorites.pinListenersAttached = true;
    document.addEventListener('pointerdown', onPinPointerDown, true);
    document.addEventListener('pointerup', onPinPointerUp, true);
    document.addEventListener('click', onPinClickCapture, true);
    document.addEventListener('keydown', onPinKeyDown, true);
  }

  function detachPinPickListeners() {
    if (!state.favorites.pinListenersAttached) return;
    state.favorites.pinListenersAttached = false;
    document.removeEventListener('pointerdown', onPinPointerDown, true);
    document.removeEventListener('pointerup', onPinPointerUp, true);
    document.removeEventListener('click', onPinClickCapture, true);
    document.removeEventListener('keydown', onPinKeyDown, true);
  }

  return { promptFavoriteNote, confirmFavoriteDelete, editFavoriteNoteById, deleteFavoriteByIdWithConfirm, jumpToFavoriteItemFromRecentList, jumpToFavoriteItem, setFavPanelOpen, setPinMode, togglePinMode, bindRootOutsideClose, onPinPointerDown, onPinPointerUp, onPinClickCapture, onPinKeyDown, attachPinPickListeners, detachPinPickListeners };
}
