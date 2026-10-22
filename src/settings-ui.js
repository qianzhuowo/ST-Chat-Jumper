import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "formatRootScalePercent",
  "mountRadialSettings",
  "cancelRadial",
  "getButtonSettings",
  "getChatContainer",
  "getRangeContext",
  "getRangePagingMode",
  "getRangeStep",
  "getRootScalePercent",
  "log",
  "saveButtonSettings",
  "saveRangeContext",
  "saveRangePagingMode",
  "saveRangeStep",
  "setRootScale",
  "syncScaleControls",
  "toggleGlobalHide"
];

export function createFeature({ state, dependencies }) {
  function refreshButtonLayout() {
    const root = document.getElementById(constants.ROOT_ID);
    if (!root) return;

    const buttonsCfg = dependencies.getButtonSettings();
    const cfgMap = new Map(buttonsCfg.map(b => [b.id, b]));

    // showRange 关联的额外元素（resetRange 按钮 + rangeChip 指示器）
    const RANGE_GROUP_EXTRA = [
      '.stcj-range-stack',
    ];

    // 1) 应用可见性
    for (const [btnId, selector] of Object.entries(constants.BUTTON_DOM_MAP)) {
      const el = root.querySelector(selector);
      if (!el) continue;
      const cfg = cfgMap.get(btnId);
      const enabled = cfg ? cfg.enabled : true;
      el.classList.toggle('stcj-settings-hidden', !enabled);

      // showRange 同时控制关联元素
      if (btnId === 'showRange') {
        for (const extraSel of RANGE_GROUP_EXTRA) {
          const extraEl = root.querySelector(extraSel);
          if (extraEl) extraEl.classList.toggle('stcj-settings-hidden', !enabled);
        }
      }
    }

    // 2) 按 order 排序：收集所有可排序的元素
    const favPanel = root.querySelector('.stcj-fav-panel');

    // 获取排序后的按钮 ID 列表
    const sortedCfg = [...buttonsCfg].sort((a, b) => a.order - b.order);

    // 收集需要排序的元素
    const sortableElements = [];
    for (const cfg of sortedCfg) {
      const selector = constants.BUTTON_DOM_MAP[cfg.id];
      if (!selector) continue;
      const el = root.querySelector(selector);
      if (el) sortableElements.push(el);

      // showRange：将关联元素紧跟其后
      if (cfg.id === 'showRange') {
        for (const extraSel of RANGE_GROUP_EXTRA) {
          const extraEl = root.querySelector(extraSel);
          if (extraEl) sortableElements.push(extraEl);
        }
      }
    }

    // 3) 重新插入：排序后的按钮在前，收藏面板始终放在最后
    // 先移除所有可排序元素（不移除 favPanel）
    for (const el of sortableElements) {
      if (el.parentNode === root) root.removeChild(el);
    }

    // 在 favPanel 之前插入排序后的按钮（如果 favPanel 存在）
    const insertBefore = favPanel || null;
    for (const el of sortableElements) {
      root.insertBefore(el, insertBefore);
    }
  }

  function getButtonLabel(btnId) {
    const def = constants.CONFIGURABLE_BUTTONS.find(b => b.id === btnId);
    return def ? def.label : btnId;
  }

  function mountSettingsPanel() {
    const PANEL_ID = 'stcj-settings-panel';

    // 防重复
    if (document.getElementById(PANEL_ID)) return;

    const container = document.getElementById('extensions_settings2');
    if (!container) {
      if (!state.lifecycle.settingsMountObserver && window.MutationObserver) {
        state.lifecycle.settingsMountObserver = new MutationObserver(() => {
          if (!document.getElementById('extensions_settings2')) return;
          if (state.host.hostFlashSuppressTimer) {
          clearTimeout(state.host.hostFlashSuppressTimer);
          state.host.hostFlashSuppressTimer = null;
        }
        dependencies.getChatContainer()?.classList.remove('stcj-suppress-host-flash');
        state.lifecycle.settingsMountObserver?.disconnect();
          state.lifecycle.settingsMountObserver = null;
          mountSettingsPanel();
        });
        state.lifecycle.settingsMountObserver.observe(document.body, { childList: true, subtree: true });
      }
      dependencies.log('未找到 #extensions_settings2，等待设置容器出现');
      return;
    }
    state.lifecycle.settingsMountObserver?.disconnect();
    state.lifecycle.settingsMountObserver = null;

    const entry = document.createElement('button');
    entry.id = PANEL_ID; entry.type = 'button'; entry.className = 'stcj-settings-launcher stcj-ext-settings';
    entry.innerHTML = '<span class="stcj-launcher-mark" aria-hidden="true">◉</span><span class="stcj-launcher-copy"><strong>ST Chat Jumper</strong><small>手势轮盘 · 悬浮导航 · 收藏</small></span><span class="stcj-launcher-arrow" aria-hidden="true">›</span>';
    entry.setAttribute('aria-label', 'ST Chat Jumper，打开设置');
    entry.setAttribute('aria-haspopup', 'dialog');
    entry.addEventListener('click', openSettingsWindow);
    container.append(entry);

    const html = `
      <dialog id="stcj-settings-window" data-stcj-settings class="stcj-settings-window" aria-labelledby="stcj-settings-title">
        <div class="stcj-settings-window-header"><div class="stcj-settings-brand"><span aria-hidden="true">◉</span><div><h2 id="stcj-settings-title">Chat Jumper</h2><small>快捷轮盘控制台</small></div></div><button type="button" id="stcj-settings-close" aria-label="关闭设置">×</button></div>
        <div class="stcj-settings-workspace"><nav class="stcj-settings-nav" role="tablist" aria-label="设置分区">
          <button type="button" role="tab" data-settings-page="triggers"><span>◎</span>触发与安全</button>
          <button type="button" role="tab" data-settings-page="appearance"><span>◌</span>外观与形态</button>
          <button type="button" role="tab" data-settings-page="actions"><span>▤</span>扇区与动作</button>
          <button type="button" role="tab" data-settings-page="toolbar"><span>↕</span>悬浮条与导航</button>
          <button type="button" role="tab" data-settings-page="schemes"><span>▦</span>方案与备份</button>
          <button type="button" role="tab" data-settings-page="about"><span>ⓘ</span>关于与致谢</button>
        </nav><div class="stcj-settings-window-body"><section class="stcj-settings-page" data-stcj-page="toolbar" id="stcj-page-toolbar" hidden><h2>悬浮条与导航</h2><p class="stcj-page-subtitle">悬浮条与轮盘独立启用，已有按钮顺序及显隐设置完整保留。</p>
            <div class="stcj-settings-global-toggle">
              <button id="stcj-global-hide-btn" class="menu_button" title="点击一键隐藏 ST Chat Jumper 悬浮跳转条（不影响按钮显隐设置）">
                一键隐藏悬浮条
              </button>
            </div>
            <div class="stcj-settings-size">
              <div class="stcj-settings-size-header">
                <div class="stcj-settings-size-copy">
                  <span class="stcj-settings-size-title">悬浮条大小</span>
                </div>
                <span id="stcj-size-value">${dependencies.formatRootScalePercent()}</span>
              </div>
              <input id="stcj-size-slider" class="text_pole" type="range" min="${constants.MIN_SCALE * 100}" max="${constants.MAX_SCALE * 100}" step="${constants.SCALE_STEP * 100}" value="${dependencies.getRootScalePercent()}" />
              <div class="stcj-settings-size-scale" aria-hidden="true">
                <span>50%</span><span>75%</span><span>100%</span><span>125%</span><span>150%</span>
              </div>
            </div>
            <div class="stcj-settings-range-options">
              <div class="stcj-settings-range-options-title">区间/跳转 设置</div>
              <div class="stcj-settings-range-row-inline">
                <div class="stcj-settings-range-cell">
                  <label class="stcj-settings-range-label" for="stcj-range-context-input">跳转上下文</label>
                  <input id="stcj-range-context-input" class="text_pole stcj-settings-range-input" type="number" min="1" step="1" value="${dependencies.getRangeContext()}" title="输入楼层号跳转时，前后各加载多少层（默认 ${constants.DEFAULT_RANGE_CONTEXT}）" />
                </div>
                <div class="stcj-settings-range-cell">
                  <label class="stcj-settings-range-label" for="stcj-range-step-input">翻页步长</label>
                  <input id="stcj-range-step-input" class="text_pole stcj-settings-range-input" type="number" min="1" step="1" value="${dependencies.getRangeStep()}" title="区间激活后点击 ◀/▶ 每次平移的楼层数（默认 ${constants.DEFAULT_RANGE_STEP}）" />
                </div>
                <div class="stcj-settings-range-cell stcj-settings-range-mode-cell">
                  <label class="stcj-settings-range-label" for="stcj-range-mode-toggle">翻页模式</label>
                  <button id="stcj-range-mode-toggle" class="stcj-range-mode-toggle ${dependencies.getRangePagingMode() === 'shift' ? 'is-shift' : 'is-expand'}" type="button" title="左：扩展模式；右：平移模式" aria-label="区间翻页模式切换" aria-pressed="${dependencies.getRangePagingMode() === 'shift' ? 'true' : 'false'}">
                    <span class="stcj-range-mode-label stcj-range-mode-label-left">扩展</span>
                    <span class="stcj-range-mode-label stcj-range-mode-label-right">平移</span>
                    <span class="stcj-range-mode-thumb" aria-hidden="true"></span>
                  </button>
                </div>
              </div>
            </div>
            <div class="stcj-settings-hint">
              <small>勾选以显示/隐藏按钮，拖拽 <i class="fa-solid fa-grip-vertical"></i> 或点击 ↑ / ↓ 调整按钮顺序。</small>
            </div>
            <div id="stcj-settings-button-list" class="stcj-settings-list">
            </div>
          </section><div id="stcj-radial-settings-mount"></div>
        </div></div><footer class="stcj-settings-footer"><p id="stcj-settings-save-state" role="status">自动保存 · 配置 v2</p><span>ST / TT</span></footer>
      </dialog>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const dialog = document.getElementById('stcj-settings-window');
    document.getElementById('stcj-settings-close').addEventListener('click', closeSettingsWindow);
    dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeSettingsWindow(); } });
    dialog.addEventListener('close', () => document.getElementById(PANEL_ID)?.focus({ preventScroll: true }));
    dependencies.mountRadialSettings(document.getElementById('stcj-radial-settings-mount'));
    const tabs = [...dialog.querySelectorAll('[data-settings-page]')];
    function showPage(id) {
      tabs.forEach(tab => { const selected = tab.dataset.settingsPage === id; tab.classList.toggle('is-active', selected); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
      dialog.querySelectorAll('[data-stcj-page]').forEach(page => { page.hidden = page.dataset.stcjPage !== id; page.setAttribute('role', 'tabpanel'); });
      dialog.querySelector('.stcj-settings-window-body').scrollTop = 0;
    }
    tabs.forEach((tab, index) => { tab.id = 'stcj-tab-' + tab.dataset.settingsPage; tab.setAttribute('aria-controls', 'stcj-page-' + tab.dataset.settingsPage); tab.addEventListener('click', () => showPage(tab.dataset.settingsPage)); tab.addEventListener('keydown', event => {
      let next = index;
      if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (index + 1) % tabs.length;
      else if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = tabs.length - 1; else return;
      event.preventDefault(); showPage(tabs[next].dataset.settingsPage); tabs[next].focus();
    }); });
    dialog.querySelectorAll('[data-stcj-page]').forEach(page => page.setAttribute('aria-labelledby', 'stcj-tab-' + page.dataset.stcjPage));
    showPage('triggers');
    renderSettingsButtonList();

    // 绑定一键隐藏按钮
    const globalHideBtn = document.getElementById('stcj-global-hide-btn');
    if (globalHideBtn) {
      globalHideBtn.addEventListener('click', dependencies.toggleGlobalHide);
      // 恢复按钮文本（如果之前已经隐藏）
      if (state.layout.globalHidden) {
        globalHideBtn.textContent = '显示悬浮条';
        globalHideBtn.title = '点击恢复 ST Chat Jumper 悬浮跳转条';
      }
    }

    const sizeSlider = document.getElementById('stcj-size-slider');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', (e) => {
        dependencies.setRootScale(Number(e.target.value) / 100);
      });
      sizeSlider.addEventListener('change', (e) => {
        dependencies.setRootScale(Number(e.target.value) / 100);
      });
    }

    dependencies.syncScaleControls();

    // 绑定区间翻页步长输入框
    const rangeStepInput = document.getElementById('stcj-range-step-input');
    if (rangeStepInput) {
      rangeStepInput.addEventListener('change', (e) => {
        const val = Math.max(1, Math.round(Number(e.target.value) || constants.DEFAULT_RANGE_STEP));
        e.target.value = val;
        dependencies.saveRangeStep(val);
      });
    }

    // 绑定跳转上下文输入框
    const rangeContextInput = document.getElementById('stcj-range-context-input');
    if (rangeContextInput) {
      rangeContextInput.addEventListener('change', (e) => {
        const val = Math.max(1, Math.round(Number(e.target.value) || constants.DEFAULT_RANGE_CONTEXT));
        e.target.value = val;
        dependencies.saveRangeContext(val);
      });
    }

    const rangeModeToggle = document.getElementById('stcj-range-mode-toggle');
    if (rangeModeToggle) {
      rangeModeToggle.addEventListener('click', () => {
        const current = dependencies.getRangePagingMode();
        const next = current === 'shift' ? 'expand' : 'shift';
        dependencies.saveRangePagingMode(next);
        rangeModeToggle.classList.toggle('is-shift', next === 'shift');
        rangeModeToggle.classList.toggle('is-expand', next !== 'shift');
        rangeModeToggle.setAttribute('aria-pressed', next === 'shift' ? 'true' : 'false');
        rangeModeToggle.title = next === 'shift' ? '当前：平移模式（右）' : '当前：扩展模式（左）';
      });
    }

    dependencies.log('设置面板已挂载到 #extensions_settings2');
  }

  function openSettingsWindow() {
    dependencies.cancelRadial();
    const dialog = document.getElementById('stcj-settings-window');
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeSettingsWindow() { document.getElementById('stcj-settings-window')?.close(); }

  function renderSettingsButtonList() {
    const listEl = document.getElementById('stcj-settings-button-list');
    if (!listEl) return;

    const buttonsCfg = dependencies.getButtonSettings();
    const sorted = [...buttonsCfg].sort((a, b) => a.order - b.order);

    listEl.innerHTML = '';

    for (const cfg of sorted) {
      const label = getButtonLabel(cfg.id);

      const item = document.createElement('div');
      item.className = 'stcj-settings-item';
      item.draggable = true;
      item.dataset.btnId = cfg.id;

      item.innerHTML = `
        <span class="stcj-settings-drag" title="拖拽排序">
          <i class="fa-solid fa-grip-vertical"></i>
        </span>
        <label class="stcj-settings-label">
          <input type="checkbox" class="stcj-settings-check" data-btn-id="${cfg.id}" ${cfg.enabled ? 'checked' : ''} />
          <span>${label}</span>
        </label>
        <button type="button" class="stcj-settings-move-up" aria-label="上移${label}">↑</button>
        <button type="button" class="stcj-settings-move-down" aria-label="下移${label}">↓</button>
      `;

      const move = direction => {
        const index = sorted.findIndex(b => b.id === cfg.id), target = index + direction;
        if (target < 0 || target >= sorted.length) return;
        [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
        sorted.forEach((button, order) => { button.order = order; });
        dependencies.saveButtonSettings(sorted); refreshButtonLayout(); renderSettingsButtonList();
      };
      item.querySelector('.stcj-settings-move-up').addEventListener('click', () => move(-1));
      item.querySelector('.stcj-settings-move-down').addEventListener('click', () => move(1));
      listEl.appendChild(item);
    }

    // 绑定复选框事件
    listEl.querySelectorAll('.stcj-settings-check').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const btnId = e.target.dataset.btnId;
        const buttons = dependencies.getButtonSettings();
        const cfg = buttons.find(b => b.id === btnId);
        if (cfg) {
          cfg.enabled = e.target.checked;
          dependencies.saveButtonSettings(buttons);
          refreshButtonLayout();
        }
      });
    });

    // 绑定拖拽排序
    initSettingsDragDrop(listEl);
  }

  function initSettingsDragDrop(listEl) {
    let draggedItem = null;

    listEl.querySelectorAll('.stcj-settings-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        item.classList.add('stcj-settings-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.btnId);
      });

      item.addEventListener('dragend', () => {
        if (draggedItem) draggedItem.classList.remove('stcj-settings-dragging');
        draggedItem = null;
        listEl.querySelectorAll('.stcj-settings-item').forEach(i => {
          i.classList.remove('stcj-settings-dragover');
        });
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (item === draggedItem) return;

        listEl.querySelectorAll('.stcj-settings-item').forEach(i => {
          i.classList.remove('stcj-settings-dragover');
        });
        item.classList.add('stcj-settings-dragover');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('stcj-settings-dragover');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('stcj-settings-dragover');
        if (!draggedItem || item === draggedItem) return;

        // DOM 重排
        const allItems = [...listEl.querySelectorAll('.stcj-settings-item')];
        const draggedIdx = allItems.indexOf(draggedItem);
        const targetIdx = allItems.indexOf(item);

        if (draggedIdx < targetIdx) {
          listEl.insertBefore(draggedItem, item.nextSibling);
        } else {
          listEl.insertBefore(draggedItem, item);
        }

        // 更新 order 并保存
        const buttons = dependencies.getButtonSettings();
        const items = listEl.querySelectorAll('.stcj-settings-item');
        items.forEach((el, index) => {
          const id = el.dataset.btnId;
          const cfg = buttons.find(b => b.id === id);
          if (cfg) cfg.order = index;
        });

        dependencies.saveButtonSettings(buttons);
        refreshButtonLayout();
      });
    });
  }

  return { openSettingsWindow, closeSettingsWindow, refreshButtonLayout, getButtonLabel, mountSettingsPanel, renderSettingsButtonList, initSettingsDragDrop };
}
