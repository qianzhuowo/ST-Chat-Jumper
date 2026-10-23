import { resolveWheelAppearance } from './radial-view.js';
import { defaultRadialAppearance, normalizeRadialAppearance, normalizeRadialConfig, RADIAL_THEMES } from './radial-config.js';

export const requiredServices = ['getRadialConfig', 'saveRadialConfig', 'listShortcutActions', 'cancelRadial', 'openRadial', 'createRadialView', 'loadFavoritesPreviewMode', 'saveFavoritesPreviewMode'];

const copy = value => JSON.parse(JSON.stringify(value));
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const COMPASS_8 = ['↑ 上 (N)', '↗ 右上 (NE)', '→ 右 (E)', '↘ 右下 (SE)', '↓ 下 (S)', '↙ 左下 (SW)', '← 左 (W)', '↖ 左上 (NW)'];
const COMPASS_4 = ['↑ 上 (N)', '→ 右 (E)', '↓ 下 (S)', '← 左 (W)'];
const ICON_PRESETS = [['', '自动图标'], ['↑', '↑ 上'], ['↓', '↓ 下'], ['✎', '✎ 编辑'], ['◇', '◇ 收藏'], ['▦', '▦ 菜单'], ['#', '# 楼层'], ['↺', '↺ 恢复'], ['·', '· 简洁']];
function formatDirectionBadge(index, count) {
  if (count === 4) return COMPASS_4[index] || `方位 ${index + 1}`;
  if (count === 8) return COMPASS_8[index] || `方位 ${index + 1}`;
  return `${Math.round(((360 / Math.max(1, count)) * index) % 360)}° 方位 ${index + 1}`;
}

export function createFeature({ dependencies }) {
  let detachObserver = null;
  function destroyRadialSettings() { detachObserver?.(); detachObserver = null; }
  function mountRadialSettings(container) {
    destroyRadialSettings();
    const config = dependencies.getRadialConfig();
    const dialog = container.closest('dialog');
    let menuId = 'main', slotIndex = 0, subMenuId = config.menus.find(m => m.id !== 'main')?.id || null, subSlotIndex = 0;
    let previewZoom = 100, coScreenPreview = true, clipboardSlot = null;
    const undo = new Map(), historyStack = [], redoStack = [], previews = [];
    container.classList.add('stcj-radial-settings');
    const status = dialog?.querySelector('#stcj-settings-save-state') || element('p', 'stcj-editor-status', '自动保存 · 预览不会执行动作');
    status.setAttribute('role', 'status');

    function syncPanelThemeUI() {
      if (!dialog) return;
      dialog.dataset.panelTheme = config.panelTheme;
      dialog.querySelectorAll('[data-panel-theme-btn]').forEach(btn => {
        const active = btn.dataset.panelThemeBtn === config.panelTheme;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
    }
    syncPanelThemeUI();
    dialog?.querySelectorAll('[data-panel-theme-btn]').forEach(btn => {
      btn.addEventListener('click', () => { config.panelTheme = btn.dataset.panelThemeBtn; syncPanelThemeUI(); save('已切换控制台窗口主题'); renderAppearance(); });
    });

    function recordSnapshot(reason) {
      historyStack.push({ menus: copy(config.menus), appearance: copy(config.appearance), radius: config.radius, menuId, slotIndex, subMenuId, subSlotIndex, reason });
      if (historyStack.length > 30) historyStack.shift();
      redoStack.length = 0;
    }
    function applyHistoryEntry(entry, message) {
      if (!entry) return;
      config.menus = copy(entry.menus); config.appearance = copy(entry.appearance); config.radius = entry.radius;
      menuId = config.menus.some(m => m.id === entry.menuId) ? entry.menuId : 'main';
      subMenuId = config.menus.some(m => m.id === entry.subMenuId && m.id !== 'main') ? entry.subMenuId : (config.menus.find(m => m.id !== 'main')?.id || null);
      slotIndex = Math.max(0, Math.min(entry.slotIndex || 0, (currentMenu().items.length || 1) - 1));
      subSlotIndex = Math.max(0, Math.min(entry.subSlotIndex || 0, ((activeSubmenu()?.items.length) || 1) - 1));
      save(message); renderEditor(); renderAppearance();
    }
    function performUndo() {
      if (!historyStack.length) return;
      const prev = historyStack.pop();
      redoStack.push({ menus: copy(config.menus), appearance: copy(config.appearance), radius: config.radius, menuId, slotIndex, subMenuId, subSlotIndex, reason: prev.reason });
      applyHistoryEntry(prev, `已撤销：${prev.reason || '上一步修改'}`);
    }
    function performRedo() {
      if (!redoStack.length) return;
      const next = redoStack.pop();
      historyStack.push({ menus: copy(config.menus), appearance: copy(config.appearance), radius: config.radius, menuId, slotIndex, subMenuId, subSlotIndex, reason: next.reason });
      applyHistoryEntry(next, `已重做：${next.reason || '修改'}`);
    }
    function save(message) {
      dependencies.cancelRadial(); dependencies.saveRadialConfig(config);
      status.textContent = message || '已保存 · 预览不会执行动作'; renderPreviews();
    }
    function page(id, title, subtitle) {
      const section = element('section', 'stcj-settings-page'); section.dataset.stcjPage = id; section.hidden = true; section.id = `stcj-page-${id}`;
      section.append(element('h2', '', title), element('p', 'stcj-page-subtitle', subtitle)); container.append(section); return section;
    }
    function card(parent, title, description, proOnly = false) {
      const box = element('section', `stcj-config-card${proOnly ? ' stcj-pro-only' : ''}`);
      if (title) box.append(element('h3', '', title));
      if (description) box.append(element('p', 'stcj-settings-note', description));
      parent.append(box); return box;
    }
    function button(parent, text, handler, className = '') {
      const b = element('button', className, text); b.type = 'button'; b.addEventListener('click', handler); parent.append(b); return b;
    }
    function field(parent, label, { type = 'text', value, choices, min, max, step = 1, hint, onChange, live = false, disabled = false, aria = label, proOnly = false }) {
      const row = element('label', `stcj-setting-row${proOnly ? ' stcj-pro-only' : ''}`);
      const text = element('span', 'stcj-setting-copy'); text.append(element('span', '', label)); if (hint) text.append(element('small', '', hint)); row.append(text);
      const control = element('span', 'stcj-setting-control'); let input;
      if (choices) {
        input = element('select');
        for (const [v, title] of choices) { const option = element('option', '', title); option.value = v; input.append(option); }
        input.value = String(value);
      } else {
        input = element('input'); input.type = type;
        if (type === 'checkbox') input.checked = !!value; else input.value = value ?? '';
      }
      input.disabled = disabled; input.setAttribute('aria-label', aria);
      if (min != null) { input.min = min; input.max = max; input.step = step; }
      if (type === 'text') input.maxLength = 40;
      const output = type === 'range' || type === 'color' ? element('output', '', value) : null;
      input.addEventListener(live ? 'input' : 'change', () => {
        if (!input.checkValidity()) { input.reportValidity(); return; }
        const v = type === 'checkbox' ? input.checked : ['range', 'number'].includes(type) ? Number(input.value) : input.value;
        if (output) output.textContent = v; onChange(v, input);
      });
      control.append(input); if (output) control.append(output); row.append(control); parent.append(row); return input;
    }
    function mainMenu() { return config.menus.find(m => m.id === 'main') || config.menus[0]; }
    function currentMenu() { return config.menus.find(m => m.id === menuId) || mainMenu(); }
    function activeSubmenu() {
      if (menuId !== 'main') return currentMenu();
      const primaryItem = mainMenu().items[slotIndex];
      if (primaryItem?.submenu) {
        const linked = config.menus.find(m => m.id === primaryItem.submenu && m.id !== 'main');
        if (linked) { subMenuId = linked.id; return linked; }
      }
      if (subMenuId) {
        const chosen = config.menus.find(m => m.id === subMenuId && m.id !== 'main');
        if (chosen) return chosen;
      }
      return config.menus.find(m => m.id !== 'main') || null;
    }
    function appearance(targetMenu = currentMenu()) { return normalizeRadialAppearance(targetMenu?.appearance || config.appearance); }
    function selectMenu(id, nextSlot = 0) {
      menuId = config.menus.some(m => m.id === id) ? id : 'main';
      if (menuId !== 'main') { subMenuId = menuId; subSlotIndex = nextSlot; }
      slotIndex = nextSlot; renderEditor(); renderAppearance(); renderPreviews();
    }
    function stepSlot(delta) {
      const menu = currentMenu(); if (!menu.items.length) return;
      slotIndex = ((slotIndex < 0 ? 0 : slotIndex) + delta + menu.items.length) % menu.items.length;
      if (menu.id !== 'main') subSlotIndex = slotIndex;
      renderEditor(); renderPreviews();
    }
    function createNewSubmenu() {
      recordSnapshot('新建二级轮盘');
      let n = 1; while (config.menus.some(m => m.id === `child-${n}`)) n++;
      const id = `child-${n}`;
      config.menus.push({ id, label: `子轮盘 ${n}`, appearance: null, items: [
        { label: '子扇区 1', action: { type: 'plugin', id: 'prev' } },
        { label: '子扇区 2', action: { type: 'plugin', id: 'next' } },
        { label: '子扇区 3', action: { type: 'plugin', id: 'recent1' } },
        { label: '子扇区 4', action: { type: 'plugin', id: 'showRange' } },
      ] });
      subMenuId = id; subSlotIndex = 0; return id;
    }
    function menuPicker(parent, aria = '编辑轮盘') {
      return field(parent, '当前轮盘', { choices: config.menus.map(m => [m.id, `${m.id === 'main' ? '◉' : '↳'} ${m.label}`]), value: menuId, aria, onChange: id => selectMenu(id, 0) });
    }
    function bindDragReorder(btn, idx, items, onDone, getFrom, setFrom) {
      btn.draggable = true;
      btn.addEventListener('dragstart', () => setFrom(idx));
      btn.addEventListener('dragover', e => e.preventDefault());
      btn.addEventListener('drop', e => {
        e.preventDefault(); const from = getFrom();
        if (from == null || from === idx) return;
        recordSnapshot('拖拽调整扇区顺序');
        const [moved] = items.splice(from, 1); items.splice(idx, 0, moved);
        setFrom(null); onDone(idx);
      });
    }
    function preview(parent) {
      const box = card(parent, '实时交互画布', '一二级轮盘同屏联动展示：点击内圈选一级主扇区，点击外圈选二级子扇区。这里只预览，不执行动作。');
      box.classList.add('stcj-preview-card');
      box.append(element('span', 'stcj-preview-badge', 'LIVE'));
      const canvasToolbar = element('div', 'stcj-canvas-toolbar');
      const coScreenBtn = button(canvasToolbar, coScreenPreview ? '🌟 同屏双环' : '🔘 单环聚焦', () => { coScreenPreview = !coScreenPreview; renderPreviews(); }, `stcj-canvas-tool-btn${coScreenPreview ? ' is-active' : ''}`);
      coScreenBtn.setAttribute('aria-label', '切换一二级同屏预览');
      const zoomOutBtn = button(canvasToolbar, '−', () => { previewZoom = Math.max(75, previewZoom - 10); renderPreviews(); }, 'stcj-canvas-tool-btn'); zoomOutBtn.setAttribute('aria-label', '缩小预览');
      const zoomResetBtn = button(canvasToolbar, `${previewZoom}%`, () => { previewZoom = 100; renderPreviews(); }, 'stcj-canvas-zoom-label'); zoomResetBtn.setAttribute('aria-label', '重置预览缩放');
      const zoomInBtn = button(canvasToolbar, '+', () => { previewZoom = Math.min(130, previewZoom + 10); renderPreviews(); }, 'stcj-canvas-tool-btn'); zoomInBtn.setAttribute('aria-label', '放大预览');
      const resetViewBtn = button(canvasToolbar, '🎯', () => { previewZoom = 100; slotIndex = 0; renderEditor(); renderPreviews(); }, 'stcj-canvas-tool-btn'); resetViewBtn.setAttribute('aria-label', '复位预览视图');
      box.append(canvasToolbar);
      const canvas = element('div', 'stcj-preview-canvas'); box.append(canvas);
      const indicator = element('div', 'stcj-canvas-indicator', '🎯 正在编辑: 主轮盘'); box.append(indicator);
      const caption = element('p', 'stcj-preview-caption'); box.append(caption);
      const tools = element('div', 'stcj-editor-tools'); box.append(tools);
      button(tools, '◀ 上一槽', () => stepSlot(-1));
      button(tools, '下一槽 ▶', () => stepSlot(1));
      button(tools, '↶ 主轮盘', () => selectMenu('main'));
      button(tools, '试用真实轮盘', () => { if (!config.enabled) { status.textContent = '请先在「触发与安全」启用轮盘，再试用。'; return; } dialog?.close(); dependencies.openRadial(); });
      previews.push({ canvas, caption, indicator, zoomResetBtn, coScreenBtn });
    }
    function renderPreviews() {
      const main = mainMenu(), menu = currentMenu(), sub = activeSubmenu(), isEditingSub = menu.id !== 'main';
      const showCoScreen = coScreenPreview && !!sub && sub.items.length > 0;
      const mainA = appearance(main), activeItem = menu.items[slotIndex];
      for (const p of previews) {
        p.zoomResetBtn.textContent = `${previewZoom}%`;
        p.coScreenBtn.textContent = coScreenPreview ? '🌟 同屏双环' : '🔘 单环聚焦';
        p.coScreenBtn.classList.toggle('is-active', coScreenPreview);
        if (showCoScreen) {
          const maxInnerR = Math.min(96, Math.max(42, ((p.canvas.clientWidth || 330) - 110) / 2), config.radius * mainA.scale / 100 * 0.78);
          const radius = Math.max(40, Math.min(110, Math.round(maxInnerR * (previewZoom / 100))));
          const parentIdx = main.items.findIndex(item => item.submenu === sub.id);
          const view = dependencies.createRadialView({
            menu: main, appearance: resolveWheelAppearance(config, main, config.radius * mainA.scale / 100), radius,
            selected: isEditingSub ? parentIdx : slotIndex, submenu: sub,
            subAppearance: resolveWheelAppearance(config, sub, config.radius * appearance(sub).scale / 100),
            subSelected: isEditingSub ? slotIndex : subSlotIndex, parentIndex: parentIdx, activeTier: isEditingSub ? 'sub' : 'main', preview: true,
            onChoose: i => {
              if (main.items[i]?.submenu) { subMenuId = main.items[i].submenu; subSlotIndex = 0; }
              menuId = 'main'; slotIndex = i; renderEditor(); renderAppearance(); renderPreviews(); dialog?.querySelector('[data-settings-page=actions]')?.click();
            },
            onSubChoose: i => {
              subMenuId = sub.id; subSlotIndex = i; if (isEditingSub) slotIndex = i;
              renderEditor(); renderAppearance(); renderPreviews(); dialog?.querySelector('[data-settings-page=actions]')?.click();
            },
            onCenter: () => { if (menuId !== 'main') selectMenu('main'); else { slotIndex = -1; renderEditor(); renderPreviews(); } },
            onHover: i => { view.setSelected(i); p.caption.textContent = `内圈 · ${main.label} · ${i + 1} / ${main.items.length} · ${main.items[i]?.label || '空扇区'}${main.items[i]?.submenu ? ' › 展开同屏子轮盘' : ''}`; },
            onSubHover: i => { view.setSubSelected(i); p.caption.textContent = `外圈 · ${sub.label} · ${i + 1} / ${sub.items.length} · ${sub.items[i]?.label || '空扇区'}`; },
          });
          p.canvas.replaceChildren(view.element);
          p.indicator.textContent = activeItem ? `🎯 同屏预览: 内圈[${main.label}] + 外圈[${sub.label}] · 当前 #${slotIndex + 1} ${activeItem.label}` : `🎯 同屏预览: 内圈[${main.label}] + 外圈[${sub.label}]`;
          p.caption.textContent = `内圈：${main.label} (${main.items.length}扇区) · 外圈：${sub.label} (${sub.items.length}扇区 · ${sub.appearance ? '独立外观' : '继承主轮盘'})`;
        } else {
          const a = appearance(menu);
          const baseRadius = Math.min(155, Math.max(45, ((p.canvas.clientWidth || 330) - 18) / 2), config.radius * a.scale / 100);
          const radius = Math.max(42, Math.min(172, Math.round(baseRadius * (previewZoom / 100))));
          const view = dependencies.createRadialView({
            menu, appearance: resolveWheelAppearance(config, menu, config.radius * a.scale / 100), radius, selected: slotIndex, preview: true,
            onChoose: i => { slotIndex = i; renderEditor(); renderPreviews(); dialog?.querySelector('[data-settings-page=actions]')?.click(); editor.querySelector('[data-slot-inspector]')?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); },
            onCenter: () => { if (menuId !== 'main') selectMenu('main'); else { slotIndex = -1; renderEditor(); renderPreviews(); } },
            onHover: i => { view.setSelected(i); p.caption.textContent = `${menu.label} · ${i + 1} / ${menu.items.length} · ${menu.items[i]?.label || '空扇区'}${menu.items[i]?.submenu ? ' › 子轮盘' : ''}`; },
          });
          p.canvas.replaceChildren(view.element);
          p.indicator.textContent = activeItem ? `🎯 正在编辑: ${menu.label} · #${slotIndex + 1} ${activeItem.label}` : `🎯 正在编辑: ${menu.label} · 中心核圆`;
          p.caption.textContent = `${menu.label} · ${menu.items.length} 个扇区 · ${menu.appearance ? '独立外观' : '主轮盘外观'}`;
        }
      }
    }

    const triggerPage = page('triggers', '触发与安全', '保留原生操作，把快捷动作放在手边。鼠标与触屏均需明确开启。');
    const enableCard = card(triggerPage, '启用与快捷键', '轮盘与悬浮条独立使用。输入框、交互控件及弹窗不接管；Esc、失焦、滚动或聊天切换安全取消。');
    const triggerFields = [];
    function trigger(parent, label, key, options = {}) {
      const input = field(parent, label, { type: typeof config[key] === 'boolean' ? 'checkbox' : typeof config[key] === 'number' ? 'number' : 'text', ...options, value: config[key], onChange: v => { config[key] = v; save(); config[key] = dependencies.getRadialConfig()[key]; } });
      triggerFields.push([input, key]); return input;
    }
    trigger(enableCard, '启用快捷轮盘', 'enabled', { hint: '默认关闭，开启后可与悬浮条同时使用。' });
    trigger(enableCard, '启用快捷键', 'keyboardEnabled');
    const mods = [['alt', 'Alt'], ['ctrl', 'Ctrl'], ['shift', 'Shift']];
    trigger(enableCard, '快捷键修饰键', 'keyModifier', { choices: mods });
    const keyInput = trigger(enableCard, '快捷键字母 / 数字', 'key', { type: 'text', hint: '默认 Alt + J，修饰键精确匹配。' }); keyInput.maxLength = 1; keyInput.pattern = '[a-zA-Z0-9]';
    const mouseCard = card(triggerPage, '鼠标手势', '按住修饰键与鼠标键拖动越过阈值，滑向扇区后松手执行；普通右键未拖动时不屏蔽原生菜单。');
    trigger(mouseCard, '鼠标拖动呼出', 'mouseEnabled');
    trigger(mouseCard, '触发按键', 'mouseButton', { choices: [['2', '右键'], ['1', '中键'], ['3', '侧键 1'], ['4', '侧键 2']] });
    trigger(mouseCard, '鼠标修饰键', 'modifier', { choices: [...mods, ['none', '无（谨慎使用）']] });
    trigger(mouseCard, '拖动阈值 · px', 'threshold', { min: 8, max: 100, proOnly: true });
    trigger(mouseCard, '手势作用区域', 'scope', { choices: [['chat', '仅聊天区域'], ['page', '页面非交互区域']] });
    const touchCard = card(triggerPage, '触屏与取消', '未激活前移动让给滚动。长按原地松手后也可点选；浏览器 pointercancel 会取消，不强行锁住页面。');
    trigger(touchCard, '触屏触发', 'touchMode', { choices: [['off', '关闭'], ['longPress', '长按'], ['multiTap', '连击']] });
    for (const [label, key, min, max, proOnly] of [['长按延时 · ms', 'longPress', 300, 1500, true], ['连击次数', 'tapCount', 2, 4, true], ['连击间隔 · ms', 'tapInterval', 150, 700, true], ['中心取消死区 · px', 'deadZone', 16, 60, false], ['外甩取消距离 · px', 'cancelDistance', 160, 500, false], ['子轮盘悬停 · ms', 'submenuDelay', 200, 1500, true]]) trigger(touchCard, label, key, { min, max, proOnly });

    const appearancePage = page('appearance', '外观与形态', '分区圆环、中心核与选中高亮统一预览。一二级轮盘可以同步，也可以拥有独立风格。');
    const appearanceLayout = element('div', 'stcj-config-layout'); appearancePage.append(appearanceLayout);
    const appearanceControls = element('div', 'stcj-config-controls'); appearanceLayout.append(appearanceControls); preview(appearanceLayout);
    function renderAppearance() {
      appearanceControls.replaceChildren(); const menu = currentMenu();
      const scope = card(appearanceControls, '轮盘外观作用域'); menuPicker(scope, '外观编辑轮盘');
      field(scope, '设置窗口主题', { choices: [['host', '跟随酒馆'], ['light', '清亮浅色'], ['dark', '柔和深色']], value: config.panelTheme, onChange: v => { config.panelTheme = v; syncPanelThemeUI(); save(); } });
      if (menu.id !== 'main') {
        field(scope, '独立二级外观', { type: 'checkbox', value: !!menu.appearance, hint: '关闭时实时继承主轮盘。', onChange: v => { recordSnapshot('切换独立二级外观'); menu.appearance = v ? copy(config.appearance) : null; save(); renderAppearance(); renderEditor(); } });
        button(scope, '同步主轮盘外观', () => { recordSnapshot('同步主轮盘外观'); menu.appearance = copy(config.appearance); save(); renderAppearance(); renderEditor(); });
      }
      const target = menu.id === 'main' ? config.appearance : menu.appearance;
      const disabled = !target, a = appearance(menu);
      const palette = card(appearanceControls, '视觉风格与配色工作室', disabled ? '当前继承主轮盘，开启独立外观后可调整。' : '点击主题色卡一键切换视觉风格，或展开微调色彩与几何形态。');
      const studioGrid = element('div', 'stcj-theme-studio');
      for (const [id, t] of Object.entries(RADIAL_THEMES)) {
        const swatchBtn = element('button', `stcj-theme-card${a.theme === id ? ' is-active' : ''}`);
        swatchBtn.type = 'button'; swatchBtn.disabled = disabled; swatchBtn.dataset.themePreset = id;
        const dots = element('span', 'stcj-theme-dots');
        for (const color of [t.surface, t.highlight, t.accent, t.center]) { const dot = element('i', 'stcj-theme-dot'); dot.style.background = color; dots.append(dot); }
        swatchBtn.append(dots, element('strong', '', t.label));
        swatchBtn.addEventListener('click', () => {
          if (!target) return; recordSnapshot(`切换配色方案：${t.label}`);
          const preset = defaultRadialAppearance(id);
          for (const key of ['theme', 'surface', 'highlight', 'text', 'border', 'accent', 'center']) target[key] = preset[key];
          save(); renderAppearance(); renderEditor();
        });
        studioGrid.append(swatchBtn);
      }
      palette.append(studioGrid);
      function styleField(parent, title, key, options = {}) {
        return field(parent, title, { ...options, disabled, value: a[key], onChange: (v, input) => {
          if (!target) return; target[key] = v; Object.assign(target, normalizeRadialAppearance(target));
          if (input.type !== 'checkbox') input.value = target[key]; save();
          if (key === 'showIcons' || key === 'showLabels') { renderAppearance(); renderEditor(); }
        } });
      }
      field(palette, '配色方案', { choices: Object.entries(RADIAL_THEMES).map(([id, t]) => [id, t.label]), value: a.theme, disabled, onChange: v => {
        recordSnapshot('切换配色方案'); const preset = defaultRadialAppearance(v);
        for (const key of ['theme', 'surface', 'highlight', 'text', 'border', 'accent', 'center']) target[key] = preset[key];
        save(); renderAppearance(); renderEditor();
      } });
      styleField(palette, '轮盘形态', 'shape', { choices: [['ring', '分区圆环'], ['petals', '疏朗花瓣'], ['solid', '连续圆环']] });
      for (const [title, key] of [['扇区底色', 'surface'], ['选中填色', 'highlight'], ['高亮描边', 'accent'], ['扇区边框', 'border'], ['文字颜色', 'text'], ['中心核颜色', 'center']]) styleField(palette, title, key, { type: 'color', live: true, proOnly: true });
      const geometry = card(appearanceControls, '几何与文字');
      field(geometry, '基础半径 · px', { type: 'range', value: config.radius, min: 80, max: 200, live: true, onChange: v => { config.radius = v; config.cancelDistance = Math.max(config.cancelDistance, v + 40); save(); } });
      for (const [title, key, min, max, proOnly] of [['独立尺寸 · %', 'scale', 70, 130, false], ['中心留白 · %', 'innerRatio', 25, 65, true], ['扇区间隙 · °', 'gap', 0, 16, true], ['起始旋转 · °', 'rotation', -180, 180, true], ['文字大小 · px', 'fontSize', 10, 20, false], ['背景不透明度 · %', 'opacity', 45, 100, true], ['选中光晕 · px', 'glow', 0, 30, true]]) styleField(geometry, title, key, { type: 'range', min, max, live: true, proOnly });
      styleField(geometry, '显示图标', 'showIcons', { type: 'checkbox' }); styleField(geometry, '显示标签', 'showLabels', { type: 'checkbox' });
      const centerInput = styleField(geometry, '中心核符号', 'centerSymbol', { type: 'text', hint: '仅文本符号，不加载图片或外部字体。', proOnly: true }); centerInput.maxLength = 6;
      button(geometry, '重置当前外观', () => { recordSnapshot('重置当前外观'); if (menu.id === 'main') { config.appearance = defaultRadialAppearance(); menu.appearance = null; } else menu.appearance = defaultRadialAppearance(); save(); renderAppearance(); renderEditor(); });
    }

    const actionPage = page('actions', '扇区与动作', '一二级轮盘同屏不跳转预览与同页自由编辑：在同一页面直接调整主轮盘与各二级轮盘的名称、数量、排序、标签、图标、动作及独立外观。');
    const actionLayout = element('div', 'stcj-config-layout'); actionPage.append(actionLayout);
    const editor = element('div', 'stcj-config-controls'); actionLayout.append(editor); preview(actionLayout);
    const actions = dependencies.listShortcutActions();

    function renderInlineSubwheelEditor(parentCard) {
      const sub = activeSubmenu();
      const subBox = card(parentCard, '二级轮盘同页工作台（同屏外环）', '无需跳转页面，直接在此自由编辑二级子轮盘的名称、扇区数量、排序、标签、图标、动作与独立外观。');
      subBox.classList.add('stcj-inline-subwheel-card'); subBox.dataset.inlineSubwheel = 'true';
      const subMenus = config.menus.filter(m => m.id !== 'main');
      if (!subMenus.length || !sub) {
        button(subBox, '+ 新建首个二级轮盘', () => { createNewSubmenu(); save('已新建二级轮盘'); renderEditor(); renderAppearance(); });
        return;
      }
      if (subSlotIndex >= sub.items.length) subSlotIndex = Math.max(0, sub.items.length - 1);
      const subHeaderPills = element('div', 'stcj-wheel-pills');
      subMenus.forEach(m => {
        const pill = button(subHeaderPills, `↳ ${m.label} (${m.items.length})`, () => { subMenuId = m.id; subSlotIndex = 0; renderEditor(); renderPreviews(); }, m.id === sub.id ? 'stcj-wheel-pill is-active' : 'stcj-wheel-pill');
        pill.dataset.subwheelTab = m.id;
      });
      button(subHeaderPills, '+ 新建子轮盘', () => { createNewSubmenu(); save('已新建二级轮盘'); renderEditor(); renderAppearance(); }, 'stcj-wheel-pill').disabled = config.menus.length >= 17;
      subBox.append(subHeaderPills);
      field(subBox, '二级轮盘名称', { value: sub.label, aria: '二级轮盘名称', onChange: v => { recordSnapshot('修改二级轮盘名称'); sub.label = v || '未命名子轮盘'; save(); renderEditor(); renderAppearance(); } });
      const subCountTools = element('div', 'stcj-editor-tools'); subBox.append(subCountTools);
      for (const n of [4, 8, 12]) {
        button(subCountTools, `子轮盘 ${n} 方位`, () => {
          recordSnapshot(`子轮盘切换为 ${n} 方位`); undo.set(sub.id, copy(sub.items));
          sub.items = Array.from({ length: n }, (_, i) => sub.items[i] || { label: `子扇区 ${i + 1}`, action: { type: actions[0].type, id: actions[0].id } });
          subSlotIndex = 0; save(); renderEditor();
        }, sub.items.length === n ? 'is-active' : '');
      }
      button(subCountTools, '+ 添加子扇区', () => { recordSnapshot('添加二级子扇区'); sub.items.push({ label: `子扇区 ${sub.items.length + 1}`, action: { type: actions[0].type, id: actions[0].id } }); subSlotIndex = sub.items.length - 1; save(); renderEditor(); }).disabled = sub.items.length >= 12;
      button(subCountTools, '撤销子轮盘数量', () => { if (!undo.has(sub.id)) return; sub.items = undo.get(sub.id); undo.delete(sub.id); subSlotIndex = 0; save(); renderEditor(); }).disabled = !undo.has(sub.id);
      const subSlotsGrid = element('div', 'stcj-slot-grid stcj-subslot-grid'); subBox.append(subSlotsGrid);
      let dragSubFrom = null;
      sub.items.forEach((sItem, idx) => {
        const chip = button(subSlotsGrid, `${idx + 1} · ${sItem.icon ? sItem.icon + ' ' : ''}${sItem.label}`, () => { subSlotIndex = idx; if (menuId === sub.id) slotIndex = idx; renderEditor(); renderPreviews(); }, idx === subSlotIndex ? 'stcj-subslot-chip is-active' : 'stcj-subslot-chip');
        chip.dataset.subslotChip = String(idx); chip.title = `拖拽或点击编辑 · ${formatDirectionBadge(idx, sub.items.length)} · ${sItem.label}`;
        bindDragReorder(chip, idx, sub.items, nextIdx => { subSlotIndex = nextIdx; save(); renderEditor(); }, () => dragSubFrom, v => { dragSubFrom = v; });
      });
      const subItem = sub.items[subSlotIndex];
      if (subItem) {
        const subInspector = element('div', 'stcj-subslot-inspector'); subInspector.dataset.subslotInspector = 'true';
        const subHeader = element('div', 'stcj-focus-header'), subMeta = element('div', 'stcj-focus-meta');
        subMeta.append(element('span', 'stcj-slot-badge', `↳ #${subSlotIndex + 1}`), element('strong', 'stcj-slot-direction', `${sub.label} · ${formatDirectionBadge(subSlotIndex, sub.items.length)}`), element('span', 'stcj-slot-tier-tag', '二级子扇区'));
        subHeader.append(subMeta); subInspector.append(subHeader);
        field(subInspector, '二级扇区标签', { value: subItem.label, aria: '二级扇区标签', onChange: v => { recordSnapshot('修改二级扇区标签'); subItem.label = v || '未设置'; save(); renderEditor(); } });
        const subIcons = copy(ICON_PRESETS); if (subItem.icon && !subIcons.some(i => i[0] === subItem.icon)) subIcons.push([subItem.icon, subItem.icon]);
        field(subInspector, '二级扇区图标', { value: subItem.icon || '', choices: subIcons, aria: '二级扇区图标', onChange: v => { recordSnapshot('修改二级扇区图标'); if (v) subItem.icon = v; else delete subItem.icon; save(); renderEditor(); } });
        const subIconInput = field(subInspector, '自定义二级图标文字', { value: subItem.icon || '', aria: '自定义二级图标文字', proOnly: true, onChange: v => { recordSnapshot('自定义二级图标文字'); subItem.icon = [...v].slice(0, 4).join(''); save(); renderEditor(); } }); subIconInput.maxLength = 8;
        field(subInspector, '二级扇区独立文字色', { type: 'checkbox', value: !!subItem.color, aria: '二级扇区独立文字色', proOnly: true, onChange: v => { recordSnapshot('切换二级扇区文字颜色'); if (v) subItem.color = appearance(sub).text; else delete subItem.color; save(); renderEditor(); } });
        if (subItem.color) field(subInspector, '二级扇区文字颜色', { type: 'color', value: subItem.color, aria: '二级扇区文字颜色', live: true, proOnly: true, onChange: v => { subItem.color = v; save(); } });
        field(subInspector, '二级扇区动作类型', { value: subItem.action ? 'action' : 'empty', choices: [['empty', '空扇区 / 取消'], ['action', '插件动作']], aria: '二级扇区动作类型', onChange: v => { recordSnapshot('修改二级扇区动作类型'); delete subItem.action; if (v === 'action') subItem.action = { type: actions[0].type, id: actions[0].id }; save(); renderEditor(); } });
        if (subItem.action) {
          const choices = actions.map(a => [`${a.type}:${a.id}`, a.label]), selected = `${subItem.action.type}:${subItem.action.id}`;
          if (!choices.some(c => c[0] === selected)) choices.push([selected, '未注册扩展动作（保留，不能执行）']);
          field(subInspector, '二级扇区执行动作', { value: selected, choices, aria: '二级扇区执行动作', onChange: v => { recordSnapshot('修改二级扇区执行动作'); const [type, ...id] = v.split(':'); subItem.action = { type, id: id.join(':') }; save(); } });
        }
        const subTools = element('div', 'stcj-editor-tools');
        for (const [text, direction] of [['↑ 子扇区上移', -1], ['↓ 子扇区下移', 1]]) {
          button(subTools, text, () => { recordSnapshot('调整二级扇区顺序'); const next = subSlotIndex + direction; [sub.items[subSlotIndex], sub.items[next]] = [sub.items[next], subItem]; subSlotIndex = next; save(); renderEditor(); }).disabled = subSlotIndex + direction < 0 || subSlotIndex + direction >= sub.items.length;
        }
        button(subTools, '删除当前子扇区', () => { recordSnapshot('删除二级扇区'); sub.items.splice(subSlotIndex, 1); subSlotIndex = Math.max(0, Math.min(subSlotIndex, sub.items.length - 1)); save(); renderEditor(); });
        subInspector.append(subTools); subBox.append(subInspector);
      }
      const subAppBox = element('div', 'stcj-inline-appearance-box'); subAppBox.dataset.inlineSubAppearance = 'true';
      subAppBox.append(element('h4', 'stcj-inline-subtitle', `🎨 ${sub.label} · 独立外观（同页编辑）`));
      field(subAppBox, '启用二级独立外观', { type: 'checkbox', value: !!sub.appearance, aria: '同页独立二级外观', hint: '关闭时继承一级主轮盘外观；开启后可为该二级子轮盘单独定制主题、形态与尺寸。', onChange: v => { recordSnapshot('切换二级独立外观'); sub.appearance = v ? copy(config.appearance) : null; save(); renderEditor(); renderAppearance(); } });
      if (sub.appearance) {
        const subA = appearance(sub);
        field(subAppBox, '二级配色方案', { choices: Object.entries(RADIAL_THEMES).map(([id, t]) => [id, t.label]), value: subA.theme, aria: '同页二级配色方案', onChange: v => { recordSnapshot('切换二级配色方案'); const preset = defaultRadialAppearance(v); for (const key of ['theme', 'surface', 'highlight', 'text', 'border', 'accent', 'center']) sub.appearance[key] = preset[key]; save(); renderEditor(); renderAppearance(); } });
        field(subAppBox, '二级轮盘形态', { choices: [['ring', '分区圆环'], ['petals', '疏朗花瓣'], ['solid', '连续圆环']], value: subA.shape, aria: '同页二级轮盘形态', onChange: v => { sub.appearance.shape = v; Object.assign(sub.appearance, normalizeRadialAppearance(sub.appearance)); save(); renderAppearance(); } });
        for (const [title, key, ariaLabel] of [['二级扇区底色', 'surface', '同页二级扇区底色'], ['二级选中填色', 'highlight', '同页二级选中填色'], ['二级高亮描边', 'accent', '同页二级高亮描边'], ['二级文字颜色', 'text', '同页二级文字颜色']]) {
          field(subAppBox, title, { type: 'color', value: subA[key], aria: ariaLabel, live: true, onChange: v => { sub.appearance[key] = v; Object.assign(sub.appearance, normalizeRadialAppearance(sub.appearance)); save(); renderAppearance(); } });
        }
        for (const [title, key, min, max, ariaLabel] of [['二级独立尺寸 · %', 'scale', 70, 130, '同页二级独立尺寸'], ['二级扇区间隙 · °', 'gap', 0, 16, '同页二级扇区间隙'], ['二级起始旋转 · °', 'rotation', -180, 180, '同页二级起始旋转'], ['二级文字大小 · px', 'fontSize', 10, 20, '同页二级文字大小']]) {
          field(subAppBox, title, { type: 'range', min, max, value: subA[key], aria: ariaLabel, live: true, onChange: v => { sub.appearance[key] = v; Object.assign(sub.appearance, normalizeRadialAppearance(sub.appearance)); save(); renderAppearance(); } });
        }
        const subAppTools = element('div', 'stcj-editor-tools');
        button(subAppTools, '同步主轮盘外观', () => { recordSnapshot('同步主轮盘外观到子轮盘'); sub.appearance = copy(config.appearance); save(); renderEditor(); renderAppearance(); });
        subAppBox.append(subAppTools);
      }
      subBox.append(subAppBox);
    }

    function renderEditor() {
      editor.replaceChildren(); const menu = currentMenu();
      if (slotIndex >= menu.items.length) slotIndex = menu.items.length - 1;
      const breadcrumb = element('div', 'stcj-editor-breadcrumb');
      config.menus.forEach(m => {
        const pill = button(breadcrumb, `${m.id === 'main' ? '◉' : '↳'} ${m.label}`, () => selectMenu(m.id, 0), m.id === menu.id ? 'stcj-crumb is-active' : 'stcj-crumb');
        pill.title = `切换聚焦到 ${m.label}（右侧画布保持一二级同屏展示）`;
      });
      const historyTools = element('div', 'stcj-breadcrumb-tools');
      button(historyTools, '↶ 撤销', performUndo, 'stcj-mini-btn').disabled = !historyStack.length;
      button(historyTools, '↷ 重做', performRedo, 'stcj-mini-btn').disabled = !redoStack.length;
      breadcrumb.append(historyTools); editor.append(breadcrumb);

      const profile = card(editor, '当前配置轮盘'); menuPicker(profile);
      field(profile, '轮盘名称', { value: menu.label, onChange: v => { recordSnapshot('重命名轮盘'); menu.label = v || '未命名轮盘'; save(); renderEditor(); renderAppearance(); } });
      const profileTools = element('div', 'stcj-editor-tools'); profile.append(profileTools);
      button(profileTools, '+ 二级轮盘', () => { const id = createNewSubmenu(); save(); selectMenu(id, 0); }).disabled = config.menus.length >= 17;
      if (menu.id !== 'main') {
        button(profileTools, '◀ 返回主轮盘', () => selectMenu('main'));
        button(profileTools, '删除此子轮盘', () => {
          recordSnapshot('删除子轮盘'); config.menus = config.menus.filter(m => m.id !== menu.id);
          for (const m of config.menus) for (const item of m.items) if (item.submenu === menu.id) delete item.submenu;
          menuId = 'main'; subMenuId = config.menus.find(m => m.id !== 'main')?.id || null; slotIndex = 0; save(); renderEditor(); renderAppearance();
        });
      }

      const count = card(editor, '扇区方向数量与排序', '从上方开始顺时针排列。支持点击或拖拽扇区调整顺序；调整数量保留已有内容。');
      const countTools = element('div', 'stcj-editor-tools'); count.append(countTools);
      for (const n of [4, 8, 12]) {
        button(countTools, `${n} 方位`, () => { recordSnapshot(`切换为 ${n} 方位`); undo.set(menu.id, copy(menu.items)); menu.items = Array.from({ length: n }, (_, i) => menu.items[i] || { label: `扇区 ${i + 1}` }); slotIndex = 0; save(); renderEditor(); }, menu.items.length === n ? 'is-active' : '');
      }
      button(countTools, '撤销数量调整', () => { if (!undo.has(menu.id)) return; menu.items = undo.get(menu.id); undo.delete(menu.id); slotIndex = 0; save(); renderEditor(); }).disabled = !undo.has(menu.id);
      const slots = element('div', 'stcj-slot-grid'); count.append(slots);
      let dragMainFrom = null;
      menu.items.forEach((item, i) => {
        const b = button(slots, `${i + 1} · ${item.label}`, () => { slotIndex = i; if (item.submenu) { subMenuId = item.submenu; subSlotIndex = 0; } renderEditor(); renderPreviews(); }, i === slotIndex ? 'is-active' : '');
        b.title = `拖拽排序或点击编辑 · ${formatDirectionBadge(i, menu.items.length)} · ${item.label}`;
        bindDragReorder(b, i, menu.items, nextIdx => { slotIndex = nextIdx; save(); renderEditor(); }, () => dragMainFrom, v => { dragMainFrom = v; });
      });
      button(count, '+ 添加扇区（最多 12）', () => { recordSnapshot('添加扇区'); menu.items.push({ label: `扇区 ${menu.items.length + 1}` }); slotIndex = menu.items.length - 1; save(); renderEditor(); }).disabled = menu.items.length >= 12;

      const item = menu.items[slotIndex];
      if (!item) {
        card(editor, '选择一个扇区', '点击画布或上方编号按钮，开始配置内容。');
      } else {
        const inspector = card(editor, `扇区 ${slotIndex + 1} · 内容与动作`); inspector.dataset.slotInspector = 'true';
        const focusHeader = element('div', 'stcj-focus-header'), focusMeta = element('div', 'stcj-focus-meta'), focusNav = element('div', 'stcj-focus-nav');
        focusMeta.append(element('span', 'stcj-slot-badge', `#${slotIndex + 1}`), element('strong', 'stcj-slot-direction', formatDirectionBadge(slotIndex, menu.items.length)), element('span', 'stcj-slot-tier-tag', menu.id === 'main' ? '一级主扇区' : '二级子扇区'));
        button(focusNav, '◀ 上一槽', () => stepSlot(-1), 'stcj-mini-btn'); button(focusNav, '下一槽 ▶', () => stepSlot(1), 'stcj-mini-btn');
        focusHeader.append(focusMeta, focusNav); inspector.append(focusHeader);
        field(inspector, '显示标签', { value: item.label, aria: `扇区 ${slotIndex + 1} 标签`, onChange: v => { recordSnapshot('修改扇区标签'); item.label = v || '未设置'; save(); renderEditor(); } });
        const icons = copy(ICON_PRESETS); if (item.icon && !icons.some(i => i[0] === item.icon)) icons.push([item.icon, item.icon]);
        field(inspector, '图标符号', { value: item.icon || '', choices: icons, onChange: v => { recordSnapshot('修改扇区图标'); if (v) item.icon = v; else delete item.icon; save(); } });
        const iconInput = field(inspector, '自定义图标文字', { value: item.icon || '', hint: '最多 4 个字符；不接受图片地址或脚本。', proOnly: true, onChange: v => { recordSnapshot('自定义图标文字'); item.icon = [...v].slice(0, 4).join(''); save(); } }); iconInput.maxLength = 8;
        field(inspector, '独立文字颜色', { type: 'checkbox', value: !!item.color, proOnly: true, onChange: v => { recordSnapshot('切换独立文字颜色'); if (v) item.color = appearance(menu).text; else delete item.color; save(); renderEditor(); } });
        if (item.color) field(inspector, '扇区文字颜色', { type: 'color', value: item.color, live: true, proOnly: true, onChange: v => { item.color = v; save(); } });
        field(inspector, '动作类型', { value: item.submenu ? 'submenu' : item.action ? 'action' : 'empty', choices: [['empty', '空扇区 / 取消'], ['action', '插件动作'], ...(menu.id === 'main' ? [['submenu', '打开二级轮盘']] : [])], onChange: v => {
          recordSnapshot('修改动作类型'); delete item.action; delete item.submenu;
          if (v === 'action') item.action = { type: actions[0].type, id: actions[0].id };
          if (v === 'submenu') {
            const child = config.menus.find(m => m.id !== 'main');
            if (child) { item.submenu = child.id; subMenuId = child.id; }
            else item.submenu = createNewSubmenu();
          }
          save(); renderEditor();
        } });
        if (item.action) {
          const choices = actions.map(a => [`${a.type}:${a.id}`, a.label]), selected = `${item.action.type}:${item.action.id}`;
          if (!choices.some(c => c[0] === selected)) choices.push([selected, '未注册扩展动作（保留，不能执行）']);
          field(inspector, '执行动作', { value: selected, choices, aria: `扇区 ${slotIndex + 1} 动作`, onChange: v => { recordSnapshot('修改执行动作'); const [type, ...id] = v.split(':'); item.action = { type, id: id.join(':') }; save(); } });
        }
        if (item.submenu) {
          field(inspector, '目标二级轮盘', { value: item.submenu, choices: config.menus.filter(m => m.id !== 'main').map(m => [m.id, m.label]), onChange: v => { recordSnapshot('修改目标二级轮盘'); item.submenu = v; subMenuId = v; save(); renderEditor(); } });
          button(inspector, '编辑这个二级轮盘 ›', () => selectMenu(item.submenu));
        }
        const tools = element('div', 'stcj-editor-tools'); inspector.append(tools);
        for (const [text, direction] of [['↑ 上移', -1], ['↓ 下移', 1]]) {
          button(tools, text, () => { recordSnapshot('调整扇区顺序'); const next = slotIndex + direction; [menu.items[slotIndex], menu.items[next]] = [menu.items[next], item]; slotIndex = next; save(); renderEditor(); }).disabled = slotIndex + direction < 0 || slotIndex + direction >= menu.items.length;
        }
        button(tools, '📋 复制扇区', () => { clipboardSlot = copy(item); status.textContent = `已复制「${item.label}」扇区配置`; renderEditor(); });
        button(tools, '📥 粘贴扇区', () => { if (!clipboardSlot) return; recordSnapshot('粘贴扇区配置'); const nextItem = copy(clipboardSlot); if (menu.id !== 'main') delete nextItem.submenu; menu.items[slotIndex] = nextItem; save('已粘贴扇区配置'); renderEditor(); }).disabled = !clipboardSlot;
        button(tools, '删除扇区', () => { recordSnapshot('删除扇区'); menu.items.splice(slotIndex, 1); slotIndex = Math.min(slotIndex, menu.items.length - 1); save(); renderEditor(); });
      }
      renderInlineSubwheelEditor(editor);
    }

    const schemePage = page('schemes', '方案与备份', '保存内容和外观组合。应用方案不改变手势开关；导入默认也保留当前安全触发设置。');
    const schemes = card(schemePage, '自定义方案', '最多 8 套，包含所有一二级轮盘、图标、外观和基础尺寸。');
    let schemeName = '我的轮盘'; field(schemes, '方案名称', { value: schemeName, onChange: v => { schemeName = v || '我的轮盘'; } });
    const schemeList = element('div', 'stcj-scheme-list'); schemes.append(schemeList);
    const addScheme = button(schemes, '保存当前配置为新方案', () => { if (config.schemes.length >= 8) return; let n = 1; while (config.schemes.some(s => s.id === `scheme-${n}`)) n++; config.schemes.push({ id: `scheme-${n}`, label: schemeName, menus: copy(config.menus), appearance: copy(config.appearance), radius: config.radius }); save('已保存命名方案'); renderSchemes(); });
    function renderSchemes() {
      schemeList.replaceChildren(); addScheme.disabled = config.schemes.length >= 8;
      if (!config.schemes.length) schemeList.append(element('p', 'stcj-settings-note', '还没有保存的方案。先调整扇区和外观，再保存到这里。'));
      config.schemes.forEach(scheme => {
        const row = element('div', 'stcj-scheme-row'); row.append(element('strong', '', scheme.label), element('small', '', `${scheme.menus.length} 个轮盘 · ${scheme.radius}px`));
        button(row, '应用', () => { recordSnapshot(`应用方案：${scheme.label}`); config.menus = copy(scheme.menus); undo.clear(); config.appearance = copy(scheme.appearance); config.radius = scheme.radius; config.cancelDistance = Math.max(config.cancelDistance, config.radius + 40); menuId = 'main'; subMenuId = config.menus.find(m => m.id !== 'main')?.id || null; slotIndex = 0; subSlotIndex = 0; save('已应用方案，触发开关保持不变'); renderEditor(); renderAppearance(); });
        button(row, '删除', () => { config.schemes = config.schemes.filter(s => s.id !== scheme.id); save(); renderSchemes(); });
        schemeList.append(row);
      });
    }
    const backup = card(schemePage, '配置 JSON', '仅包含本插件轮盘配置，不包含聊天、API 或宿主设置。文本不会作为代码运行。');
    const json = element('textarea', 'stcj-config-json'); json.rows = 8; json.setAttribute('aria-label', '轮盘配置 JSON'); json.spellcheck = false; backup.append(json);
    const backupTools = element('div', 'stcj-editor-tools'); backup.append(backupTools);
    button(backupTools, '生成可复制 JSON', () => { json.value = JSON.stringify(normalizeRadialConfig(config), null, 2); json.focus(); json.select(); });
    let includeTriggers = false; field(backup, '导入时包含触发设置', { type: 'checkbox', value: false, hint: '默认保留现有启用状态、快捷键、鼠标和触屏设置。', onChange: v => { includeTriggers = v; } });
    button(backupTools, '导入 JSON', () => {
      try {
        if (json.value.length > 1000000) throw new Error('配置超过100万字符上限');
        const raw = JSON.parse(json.value);
        if (!raw || !Array.isArray(raw.menus) || (raw.version && raw.version > 2)) throw new Error('请提供支持的 v1 / v2 轮盘配置');
        const next = normalizeRadialConfig(raw);
        for (const key of includeTriggers ? Object.keys(next) : ['menus', 'appearance', 'radius', 'schemes', 'panelTheme']) config[key] = next[key];
        config.cancelDistance = Math.max(config.cancelDistance, config.radius + 40); undo.clear(); menuId = 'main';
        subMenuId = config.menus.find(m => m.id !== 'main')?.id || null; slotIndex = 0; subSlotIndex = 0;
        triggerFields.forEach(([input, key]) => { if (input.type === 'checkbox') input.checked = config[key]; else input.value = config[key]; });
        syncPanelThemeUI(); save('配置已校验并导入'); renderEditor(); renderAppearance(); renderSchemes();
      } catch (error) { status.textContent = `未导入：${error.message}`; }
    });
    const about = page('about', '关于与设计致谢', '独立浏览器实现 · 无构建依赖 · 与 SillyTavern / TauriTavern 共用服务架构。');
    const credits = card(about, '设计参考与许可边界', '设置分区、交互画布和环形扇区设计参考 StarPie；入口信息卡的呈现参考 st-toolbox（Qianzhuo）。代码、几何渲染、样式和符号由本插件独立编写。');
    credits.append(element('p', '', 'StarPie © 2026 StarPie Contributors，维护者 SoftBlack42。参考版本 LICENSE 实为 “MIT License (with Non-Commercial Restriction)”，不是标准 MIT。本插件未复制或分发其代码、图片、声音、字体或商标图形，不将其许可表述为本插件许可。'));
    credits.append(element('p', '', 'st-toolbox 的参考副本使用 GPLv3；本插件保留原有 GPLv3 LICENSE。图标仅为系统字体呈现的文本符号与原创几何图形，没有新增第三方资源包。'));
    for (const [name, href] of [['StarPie 设计来源', 'https://github.com/SoftBlack42/StarPie'], ['本插件源码与许可证', 'https://github.com/qianzhuowo/ST-Chat-Jumper']]) { const link = element('a', '', name); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; credits.append(link, document.createTextNode(' · ')); }
    card(about, '动作扩展', '目前仅内置插件动作。酒馆操作、角色卡及自定义命令保留注册接口，不提供虚假的未实现功能，也不执行配置中的任意脚本。');
    const favorites = card(about, '收藏预览兼容设置');
    field(favorites, '收藏预览方式', { value: dependencies.loadFavoritesPreviewMode(), choices: [['swipe_default', '默认预览'], ['swipe_html', 'HTML 预览'], ['star_main', '主界面预览']], onChange: v => dependencies.saveFavoritesPreviewMode(v) });
    if (!status.parentNode) container.append(status);
    renderEditor(); renderAppearance(); renderSchemes(); renderPreviews();
    if (window.ResizeObserver) { const observer = new ResizeObserver(renderPreviews); previews.forEach(p => observer.observe(p.canvas)); detachObserver = () => observer.disconnect(); }
  }
  return { mountRadialSettings, destroyRadialSettings };
}
