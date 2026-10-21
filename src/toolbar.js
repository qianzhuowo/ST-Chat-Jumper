import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "applyFavoritePanelPosition",
  "applyFavoritePanelSize",
  "attachChatChangeListeners",
  "attachFavoritePanelDrag",
  "attachFavoritePanelResize",
  "attachMessageInvalidationListeners",
  "bindFavoritesPanel",
  "bindRootOutsideClose",
  "clamp",
  "closeFavPanel",
  "closeFavoritesManager",
  "ensureMessageVisibilityObservers",
  "formatRootScalePercent",
  "getCurrentChatId",
  "getRootScalePercent",
  "getRootScaleSliderProgress",
  "handleAction",
  "installCleanup",
  "loadFavoritesPreviewMode",
  "loadGlobalHidden",
  "log",
  "mountSettingsPanel",
  "normalizeRootScale",
  "refreshButtonLayout",
  "refreshFavoritesFromMetadata",
  "saveGlobalHidden",
  "saveSettings",
  "setIcon",
  "shouldSuppressButtonAction",
  "startChatWatch",
  "suppressButtonActions",
  "toastInfo",
  "triggerHapticFeedback",
  "updateFavoritesUI",
  "updateQuickEditButton",
  "updateRangeButtons"
];

export function createFeature({ state, dependencies }) {
  function updateOrientationToggleButton(root) {
    const btn = root.querySelector('.stcj-btn[data-action="toggleOrientation"]');
    if (!btn) return;

    const isHorizontal = state.layout.settings.orientation === 'horizontal';
    dependencies.setIcon(btn, isHorizontal ? 'vertical' : 'horizontal');
    btn.title = isHorizontal ? '切换为竖向布局' : '切换为横向布局';
  }

  function updateCollapseToggleButton(root) {
    const btn = root.querySelector('.stcj-btn[data-action="toggleCollapse"]');
    if (!btn) return;

    const collapsed = !!state.layout.settings.collapsed;
    dependencies.setIcon(btn, collapsed ? 'plus' : 'minus');
    btn.title = collapsed ? '展开跳转栏' : '收起跳转栏';
  }

  function updatePrevNextButtons(root) {
    const prev = root.querySelector('.stcj-btn[data-action="prev"]');
    const next = root.querySelector('.stcj-btn[data-action="next"]');
    if (!prev || !next) return;

    const isVertical = state.layout.settings.orientation === 'vertical';
    dependencies.setIcon(prev, isVertical ? 'chevronUp' : 'chevronLeft');
    dependencies.setIcon(next, isVertical ? 'chevronDown' : 'chevronRight');
  }

  function updateFavPanelToggleButton(root) {
    const btn = root.querySelector('.stcj-btn[data-action="toggleFavPanel"]');
    if (!btn) return;

    dependencies.setIcon(btn, state.favorites.favPanelOpen ? 'chevronDown' : 'chevronRight');
    btn.title = state.favorites.favPanelOpen ? '收起最近收藏' : '展开最近收藏';
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

    const clampedLeft = dependencies.clamp(left, 0, maxLeft);
    const clampedTop = dependencies.clamp(top, 0, maxTop);

    root.style.left = `${clampedLeft}px`;
    root.style.top = `${clampedTop}px`;

    state.layout.settings.x = Math.round(clampedLeft);
    state.layout.settings.y = Math.round(clampedTop);
    // maxLeft/maxTop 为 0（悬浮窗尺寸 >= 视口）时保留原有 rx/ry，避免被错误清零
    if (maxLeft > 0) {
      state.layout.settings.rx = dependencies.clamp(clampedLeft / maxLeft, 0, 1);
    }
    if (maxTop > 0) {
      state.layout.settings.ry = dependencies.clamp(clampedTop / maxTop, 0, 1);
    }
    dependencies.saveSettings();
    dependencies.applyFavoritePanelPosition(root, { force: true });
  }

  function setRootPositionOnly(root, left, top) {
    const { maxLeft, maxTop } = getRootMaxOffsets(root);
    const clampedLeft = dependencies.clamp(left, 0, maxLeft);
    const clampedTop = dependencies.clamp(top, 0, maxTop);

    root.style.left = `${clampedLeft}px`;
    root.style.top = `${clampedTop}px`;
    state.layout.settings.x = Math.round(clampedLeft);
    state.layout.settings.y = Math.round(clampedTop);
    dependencies.applyFavoritePanelPosition(root, { force: true });
  }

  function clampRootIntoViewport(root) {
    const left = parseFloat(root.style.left || '0') || 0;
    const top = parseFloat(root.style.top || '0') || 0;
    persistRootPosition(root, left, top);
  }

  function applyRootPositionFromSettings(root) {
    const { maxLeft, maxTop } = getRootMaxOffsets(root);

    // 优先使用相对位置（rx/ry）：直接设置 DOM 位置，不反算不保存，保持 rx/ry 权威值
    if (typeof state.layout.settings.rx === 'number' && typeof state.layout.settings.ry === 'number') {
      setRootPositionOnly(root, state.layout.settings.rx * maxLeft, state.layout.settings.ry * maxTop);
      return;
    }

    // 兼容旧版本：使用像素位置，并转换为相对位置
    if (typeof state.layout.settings.x === 'number' && typeof state.layout.settings.y === 'number') {
      persistRootPosition(root, state.layout.settings.x, state.layout.settings.y);
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
      if (state.layout.resizeRaf) {
        cancelAnimationFrame(state.layout.resizeRaf);
        state.layout.resizeRaf = null;
      }

      state.layout.resizeRaf = requestAnimationFrame(() => {
        state.layout.resizeRaf = null;

        // 有相对位置时：直接设置 DOM 位置，不触发保存
        if (typeof state.layout.settings.rx === 'number' && typeof state.layout.settings.ry === 'number') {
          const { maxLeft, maxTop } = getRootMaxOffsets(root);
          setRootPositionOnly(root, state.layout.settings.rx * maxLeft, state.layout.settings.ry * maxTop);
          return;
        }

        // 兜底：仅做 clamp（旧版像素坐标，需转换保存）
        clampRootIntoViewport(root);
      });
    } catch {
      // 极少数环境不支持 rAF：直接处理
      if (typeof state.layout.settings.rx === 'number' && typeof state.layout.settings.ry === 'number') {
        const { maxLeft, maxTop } = getRootMaxOffsets(root);
        setRootPositionOnly(root, state.layout.settings.rx * maxLeft, state.layout.settings.ry * maxTop);
        return;
      }
      clampRootIntoViewport(root);
    }
  }

  function syncScaleControls() {
    const slider = document.getElementById('stcj-size-slider');
    if (slider) {
      slider.value = String(dependencies.getRootScalePercent());
      slider.style.setProperty('--stcj-slider-progress', `${dependencies.getRootScaleSliderProgress()}%`);
    }

    const valueEl = document.getElementById('stcj-size-value');
    if (valueEl) valueEl.textContent = dependencies.formatRootScalePercent();
  }

  function applyRootScale(root) {
    if (!root) return;

    const scale = dependencies.normalizeRootScale(state.layout.settings.scale);
    root.style.setProperty('--stcj-scale', String(scale));

    if (root.classList.contains('stcj-global-hidden')) return;

    if (typeof state.layout.settings.rx === 'number' && typeof state.layout.settings.ry === 'number') {
      const { maxLeft, maxTop } = getRootMaxOffsets(root);
      persistRootPosition(root, state.layout.settings.rx * maxLeft, state.layout.settings.ry * maxTop);
      return;
    }

    const left = parseFloat(root.style.left || '0') || 0;
    const top = parseFloat(root.style.top || '0') || 0;
    persistRootPosition(root, left, top);
  }

  function setRootScale(scale) {
    const nextScale = dependencies.normalizeRootScale(scale);
    if (state.layout.settings.scale === nextScale) {
      syncScaleControls();
      return;
    }

    state.layout.settings.scale = nextScale;
    dependencies.saveSettings();
    syncScaleControls();

    const root = document.getElementById(constants.ROOT_ID);
    if (!root) return;

    applyRootScale(root);
  }

  function setOrientation(orientation) {
    state.layout.settings.orientation = orientation;
    dependencies.saveSettings();

    const root = document.getElementById(constants.ROOT_ID);
    if (!root) return;

    root.classList.toggle('stcj-horizontal', orientation === 'horizontal');
    root.classList.toggle('stcj-vertical', orientation === 'vertical');

    updateOrientationToggleButton(root);
    updatePrevNextButtons(root);

    // 切换后尺寸可能变化：按相对位置重新摆放并 clamp
    if (typeof state.layout.settings.rx === 'number' && typeof state.layout.settings.ry === 'number') {
      const { maxLeft, maxTop } = getRootMaxOffsets(root);
      persistRootPosition(root, state.layout.settings.rx * maxLeft, state.layout.settings.ry * maxTop);
      return;
    }

    clampRootIntoViewport(root);
  }

  function toggleOrientation() {
    setOrientation(state.layout.settings.orientation === 'horizontal' ? 'vertical' : 'horizontal');
    dependencies.toastInfo(`Chat Jumper 已切换为${state.layout.settings.orientation === 'horizontal' ? '横向' : '纵向'}布局`);
  }

  function setCollapsed(collapsed) {
    state.layout.settings.collapsed = !!collapsed;
    dependencies.saveSettings();

    const root = document.getElementById(constants.ROOT_ID);
    if (!root) return;

    // 收起/展开时保持按钮栏的“屏幕位置”不跳动
    const left = parseFloat(root.style.left || '0') || 0;
    const top = parseFloat(root.style.top || '0') || 0;

    root.classList.toggle('stcj-collapsed', state.layout.settings.collapsed);
    updateCollapseToggleButton(root);

    // 收起时关闭收藏面板/点选模式
    if (state.layout.settings.collapsed) {
      dependencies.closeFavPanel();
      dependencies.closeFavoritesManager();
    }

    // 用原 left/top 重新落位，仅在越界时做 clamp
    persistRootPosition(root, left, top);
  }

  function toggleCollapse() {
    setCollapsed(!state.layout.settings.collapsed);
  }

  function toggleGlobalHide() {
    state.layout.globalHidden = !state.layout.globalHidden;

    dependencies.saveGlobalHidden(state.layout.globalHidden);

    const root = document.getElementById(constants.ROOT_ID);
    if (root) {
      root.classList.toggle('stcj-global-hidden', state.layout.globalHidden);
      if (!state.layout.globalHidden) applyRootScale(root);
    }

    // 更新设置面板中的按钮文本
    const btn = document.getElementById('stcj-global-hide-btn');
    if (btn) {
      btn.textContent = state.layout.globalHidden ? '显示悬浮条' : '一键隐藏悬浮条';
      btn.title = state.layout.globalHidden
        ? '点击恢复 ST Chat Jumper 悬浮跳转条'
        : '点击一键隐藏 ST Chat Jumper 悬浮跳转条（不影响按钮显隐设置）';
    }

    if (state.layout.globalHidden) {
      dependencies.toastInfo('ST Chat Jumper 悬浮条已隐藏，可在扩展设置中恢复');
    }
  }

  function attachDrag(root) {
    const DRAG_THRESHOLD = 6;
    const LONG_PRESS_MS = 320;
    let longPressTimer = null;
    let captureTarget = null;

    // 禁止长按/右键菜单
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    const resetDragFeedbackState = () => {
      root.classList.remove('stcj-drag-arming', 'stcj-dragging');
    };

    const clearLongPressTimer = () => {
      if (longPressTimer === null) return;
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
      root.classList.remove('stcj-drag-arming');
    };

    root.addEventListener('pointerdown', (e) => {
      // 仅允许主指针拖动
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (state.layout.dragPointerId !== null) return;
      if (e.target instanceof Element && e.target.closest('.stcj-fav-panel')) return;

      state.layout.isDragging = false;
      state.layout.dragPointerId = e.pointerId;
      state.layout.suppressButtonActionUntil = 0;
      state.layout.dragStart.x = e.clientX;
      state.layout.dragStart.y = e.clientY;
      state.layout.dragStart.left = parseFloat(root.style.left || '0') || 0;
      state.layout.dragStart.top = parseFloat(root.style.top || '0') || 0;
      resetDragFeedbackState();
      root.classList.add('stcj-drag-arming');

      captureTarget = e.target instanceof Element ? e.target : root;

      // 立刻捕获指针，避免长按后手指滑出悬浮条时丢失事件
      try {
        captureTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }

      clearLongPressTimer();
      longPressTimer = window.setTimeout(() => {
        if (state.layout.dragPointerId !== e.pointerId) return;
        state.layout.isDragging = true;
        dependencies.suppressButtonActions();
        dependencies.triggerHapticFeedback();
        root.classList.remove('stcj-drag-arming');
        root.classList.add('stcj-dragging');
      }, LONG_PRESS_MS);
    });

    root.addEventListener('pointermove', (e) => {
      if (state.layout.dragPointerId !== e.pointerId) return;

      const dx = e.clientX - state.layout.dragStart.x;
      const dy = e.clientY - state.layout.dragStart.y;

      if (!state.layout.isDragging) {
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          clearLongPressTimer();
        }
        return;
      }

      e.preventDefault();

      const rect = root.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);

      const left = dependencies.clamp(state.layout.dragStart.left + dx, 0, maxLeft);
      const top = dependencies.clamp(state.layout.dragStart.top + dy, 0, maxTop);

      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
    });

    const finish = () => {
      const wasDragging = state.layout.isDragging;
      clearLongPressTimer();
      resetDragFeedbackState();

      try {
        if (wasDragging) {
          const left = parseFloat(root.style.left || '0') || 0;
          const top = parseFloat(root.style.top || '0') || 0;
          persistRootPosition(root, left, top);
        }
      } finally {
        if (wasDragging) dependencies.suppressButtonActions();
        state.layout.isDragging = false;
        state.layout.dragPointerId = null;
        captureTarget = null;
      }
    };

    root.addEventListener('pointerup', (e) => {
      if (state.layout.dragPointerId !== e.pointerId) return;
      try {
        captureTarget?.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      finish();
    });

    root.addEventListener('pointercancel', (e) => {
      if (state.layout.dragPointerId !== e.pointerId) return;
      try {
        captureTarget?.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      finish();
    });
  }

  function bindButtons(root) {
    /** @type {NodeListOf<HTMLElement>} */
    const btns = root.querySelectorAll('.stcj-btn, .stcj-range-chip-main[data-action]');

    btns.forEach((btn) => {
      // 禁止长按/右键菜单
      btn.addEventListener('contextmenu', (e) => e.preventDefault());

      btn.addEventListener('pointerup', async (e) => {
        // 如果刚刚拖拽，则不触发按钮动作
        if (state.layout.isDragging || dependencies.shouldSuppressButtonAction()) return;
        if (btn.classList.contains('stcj-disabled')) return;

        const rect = btn.getBoundingClientRect();
        const isPointerInside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (!isPointerInside) return;

        const action = btn.getAttribute('data-action');
        if (!action) return;

        await dependencies.handleAction(action);

      });
    });
  }

  function buildUI() {
    if (document.getElementById(constants.ROOT_ID)) return;

    const root = document.createElement('div');
    root.id = constants.ROOT_ID;
    root.title = '长按悬浮条即可拖动位置';
    root.className = `stcj-root stcj-${state.layout.settings.orientation}`;

    root.innerHTML = `
      <div class="stcj-btn stcj-mini stcj-collapse" data-action="toggleCollapse"></div>
      <div class="stcj-btn" data-action="recent3" title="最近第3楼（跳到头部）">${constants.ICONS.num(3)}</div>
      <div class="stcj-btn" data-action="recent2" title="最近第2楼（跳到头部）">${constants.ICONS.num(2)}</div>
      <div class="stcj-btn" data-action="recent1" title="最近第1楼（跳到头部）">${constants.ICONS.num(1)}</div>
      <div class="stcj-btn" data-action="quickPage" title="快速翻页(右)：点击最新楼层的右翻页按钮">${constants.ICONS.fastForward}</div>
      <div class="stcj-btn" data-action="quickPageLeft" title="快速翻页(左)：点击最新楼层的左翻页按钮">${constants.ICONS.fastBackward}</div>
      <div class="stcj-btn" data-action="showRange" title="跳转/区间显示（输入楼层号或区间）">${constants.ICONS.range}</div>
      <div class="stcj-range-stack stcj-hidden" aria-hidden="true">
        <div class="stcj-range-chip" aria-live="polite" aria-hidden="true">
          <div class="stcj-btn stcj-mini stcj-range-nav" data-action="rangePrev" title="向前扩展区间">${constants.ICONS.chevronLeft}</div>
          <div class="stcj-range-chip-main" data-action="editRange" title="修改当前区间">
            <span class="stcj-range-chip-label">区间</span>
            <span class="stcj-range-chip-value">-</span>
          </div>
          <div class="stcj-btn stcj-mini stcj-range-nav" data-action="rangeNext" title="向后扩展区间">${constants.ICONS.chevronRight}</div>
        </div>
        <div class="stcj-btn stcj-hidden stcj-range-reset-text" data-action="resetRange" title="恢复默认聊天视图">恢复</div>
      </div>
      <div class="stcj-btn stcj-toggle" data-action="toggleOrientation"></div>
      <div class="stcj-btn" data-action="prev" title="上一楼（跳到头部）"></div>
      <div class="stcj-btn" data-action="next" title="下一楼（跳到头部）"></div>
      <div class="stcj-btn" data-action="currentHead" title="当前楼层：对齐到头部">${constants.ICONS.head}</div>
      <div class="stcj-btn" data-action="currentTail" title="当前楼层：对齐到尾部">${constants.ICONS.tail}</div>
      <div class="stcj-btn" data-action="quickEdit" title="快速编辑：选中文字可高亮定位；无选中则编辑当前楼层">${constants.ICONS.pencil}</div>
      <div class="stcj-btn" data-action="quickDelete" title="快速删除：选中某楼文字则删除该楼；无选中则删除最新楼层">${constants.ICONS.trash}</div>

      <div class="stcj-pin-group">
        <div class="stcj-btn stcj-pin" data-action="togglePin" title="收藏楼层：点选收藏">${constants.ICONS.pin}</div>
        <div class="stcj-btn stcj-favorites-manager" data-action="openFavoritesManager" title="打开收藏管理器">${constants.ICONS.folder}</div>
        <div class="stcj-btn stcj-pin-arrow" data-action="toggleFavPanel"></div>
      </div>

      <div class="stcj-fav-panel" aria-hidden="true">
        <div class="stcj-fav-header">
          <div class="stcj-fav-title">${constants.ICONS.pin} 最近收藏</div>
          <div class="stcj-fav-close" title="关闭">${constants.ICONS.close}</div>
        </div>
        <div class="stcj-fav-hint"></div>
        <div class="stcj-fav-list"></div>
        <div class="stcj-fav-resize" title="拖动调整大小" aria-hidden="true"></div>
      </div>
    `;

    document.body.appendChild(root);

    // 尽早绑定聊天事件和轻量兜底，避免收藏初始化异常阻断后续刷新链路。
    state.lifecycle.detachChatListeners = dependencies.attachChatChangeListeners();
    const detachMessageInvalidation = dependencies.attachMessageInvalidationListeners();
    dependencies.startChatWatch();

    // 初始布局
    root.style.setProperty('--stcj-scale', String(dependencies.normalizeRootScale(state.layout.settings.scale)));
    root.classList.toggle('stcj-horizontal', state.layout.settings.orientation === 'horizontal');
    root.classList.toggle('stcj-vertical', state.layout.settings.orientation === 'vertical');
    root.classList.toggle('stcj-collapsed', !!state.layout.settings.collapsed);
    updateOrientationToggleButton(root);
    updateCollapseToggleButton(root);
    updatePrevNextButtons(root);
    updateFavPanelToggleButton(root);
    try {
      dependencies.refreshFavoritesFromMetadata();
      console.log('[STCJ] favorites-read', {
        source: 'initial',
        chatId: dependencies.getCurrentChatId(),
        count: state.favorites.favoriteItems.length,
      });
    } catch (error) {
      console.error('[STCJ] favorites-read', {
        source: 'initial',
        chatId: dependencies.getCurrentChatId(),
        error,
      });
    }
    dependencies.updateFavoritesUI(root);
    dependencies.updateRangeButtons(root);
    dependencies.updateQuickEditButton(root);

    // 初始位置：临时禁用 CSS 过渡，避免 scale 过渡动画影响尺寸计算
    const prevTransition = root.style.transition;
    root.style.transition = 'none';
    applyRootPositionFromSettings(root);
    // 恢复 CSS 过渡
    root.style.transition = prevTransition;

    // 延迟修正：布局完全稳定后重新定位，消除初始化时瞬时尺寸导致的偏差
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyRootPositionFromSettings(root);
      });
    });

    attachDrag(root);
    bindButtons(root);
    dependencies.bindFavoritesPanel(root);
    dependencies.attachFavoritePanelDrag(root);
    dependencies.attachFavoritePanelResize(root);
    dependencies.applyFavoritePanelSize(root);
    state.lifecycle.detachOutsideClose = dependencies.bindRootOutsideClose(root);

    // 可见楼层观察器单独初始化；聊天监听已在收藏初始化前绑定。
    dependencies.ensureMessageVisibilityObservers();

    // 窗口尺寸变化时，保持相对位置（并保证不跑出屏幕）
    const onResize = () => scheduleRepositionOnResize(root);
    window.addEventListener('resize', onResize);

    // 暴露清理函数
    dependencies.installCleanup(root, onResize, detachMessageInvalidation);

    // 应用按钮可见性与排序
    dependencies.refreshButtonLayout();

    // 恢复全局隐藏状态
    state.layout.globalHidden = dependencies.loadGlobalHidden();
    state.favorites.favoritesPreviewMode = dependencies.loadFavoritesPreviewMode();
    root.classList.toggle('stcj-global-hidden', state.layout.globalHidden);

    // 挂载扩展设置面板
    dependencies.mountSettingsPanel();

    dependencies.log('UI 已注入');
  }

  return { updateOrientationToggleButton, updateCollapseToggleButton, updatePrevNextButtons, updateFavPanelToggleButton, getRootMaxOffsets, persistRootPosition, setRootPositionOnly, clampRootIntoViewport, applyRootPositionFromSettings, scheduleRepositionOnResize, syncScaleControls, applyRootScale, setRootScale, setOrientation, toggleOrientation, setCollapsed, toggleCollapse, toggleGlobalHide, attachDrag, bindButtons, buildUI };
}
