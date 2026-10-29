import { PRIMARY_COUNTS, selectedChild, archivedChildren, ownChild, addChild, removeChild, clearCell, swapCells, resizePrimary, swapSlots, affectedByShrink } from './radial-editor.js';
import { bindCanvasSwap } from './radial-canvas-edit.js';
import { resolveWheelAppearance, createSectorIcon } from './radial-view.js';
import { defaultRadialAppearance, normalizeRadialAppearance, normalizeRadialConfig, RADIAL_CONFIG_VERSION, RADIAL_THEMES } from './radial-config.js';
import { ACTION_TYPES, actionTypeOf, actionTypeLabel } from './action-catalog.js';
import { getUserIcons, iconLabel, normalizeUserIcon } from './icon-library.js';
import { iconUsage, migrateInlinePaths, newIconId, stripIconFromLibrary } from './icon-store.js';
import { SCHEME_LIMIT, newSchemeId, readSchemeImport, mergeSchemeLibrary, schemeExport } from './scheme-store.js';
import { openIconPicker } from './icon-picker.js';

export const requiredServices = ['getRadialConfig', 'saveRadialConfig', 'listShortcutActions', 'cancelRadial', 'createRadialView', 'loadFavoritesPreviewMode', 'saveFavoritesPreviewMode', 'loadIconLibrary', 'saveIconLibrary', 'onIconLibraryChange', 'iconLibraryStatus', 'loadSchemeLibrary', 'saveSchemeLibrary', 'getSchemeLibrary', 'onSchemeLibraryChange', 'schemeLibraryStatus'];

const copy = value => JSON.parse(JSON.stringify(value));
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const COMPASS_8 = ['↑ 上 (N)', '↗ 右上 (NE)', '→ 右 (E)', '↘ 右下 (SE)', '↓ 下 (S)', '↙ 左下 (SW)', '← 左 (W)', '↖ 左上 (NW)'];
const COMPASS_4 = ['↑ 上 (N)', '→ 右 (E)', '↓ 下 (S)', '← 左 (W)'];
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
    let menuId = 'main', slotIndex = -1, subMenuId = null, subSlotIndex = -1;
    let pendingCount = null;
    let previewZoom = 100, clipboardSlot = null, centerSelected = false;
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
      slotIndex = Math.max(-1, Math.min(entry.slotIndex ?? -1, mainMenu().items.length - 1));
      subSlotIndex = Math.max(-1, Math.min(entry.subSlotIndex ?? -1, (activeSubmenu()?.items.length || 0) - 1));
      pendingCount = null;
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
    // Live sliders fire many saves per frame; the canvas previews (full view rebuilds) are coalesced
    // to at most one per animation frame. Persistence stays synchronous so callers read normalized values.
    // Leading edge renders at once (discrete edits stay synchronous); further saves within the same
    // frame mark the preview dirty and are rendered once on the trailing edge.
    let previewFrame = 0, previewDirty = false;
    function schedulePreviews() {
      if (previewFrame) { previewDirty = true; return; }
      renderPreviews();
      const raf = window.requestAnimationFrame?.bind(window);
      if (raf) previewFrame = raf(() => { previewFrame = 0; if (previewDirty) { previewDirty = false; schedulePreviews(); } });
    }
    function save(message) {
      dependencies.cancelRadial(); dependencies.saveRadialConfig(config);
      status.textContent = message || '已保存 · 预览不会执行动作'; schedulePreviews();
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
    function activeSubmenu() { return selectedChild(config, slotIndex); }
    function appearance(targetMenu = currentMenu()) { return normalizeRadialAppearance(targetMenu?.appearance || config.appearance); }
    function selectMenu(id, nextSlot = 0) {
      if (id === 'main') { menuId = 'main'; subSlotIndex = -1; }
      else {
        const parent = /^parent:\d+$/.test(id) ? Number(id.slice(7)) : -1;
        const linked = selectedChild(config, parent);
        if (!linked) return;
        slotIndex = parent; menuId = linked.id; subMenuId = linked.id; subSlotIndex = nextSlot;
      }
      renderEditor(); renderAppearance(); renderPreviews();
    }
    // Shared icon row: preview + name + StarPie-style picker window.
    function iconRow(parent, item, followLabel, onPick) {
      const row = element('div', 'stcj-setting-row stcj-icon-row');
      const copyBox = element('span', 'stcj-setting-copy'); copyBox.append(element('span', '', '图标')); row.append(copyBox);
      const control = element('span', 'stcj-setting-control');
      const a = appearance(mainMenu());
      const current = item.iconPath ? '内嵌路径（待迁移）' : item.iconId ? (iconLabel(item.iconId) || item.iconId) : followLabel;
      // One compact entry: the button itself shows the current icon.
      const open = button(control, '', () => openIconPicker({
        host: dialog || container, current: item.iconId || '', appearance: a, followLabel,
        iconUsage: id => iconUsage(config, id, dependencies.getSchemeLibrary()), saveIcons: list => dependencies.saveIconLibrary(list),
        onApply: id => { if (id !== (item.iconId || '') || item.iconPath) onPick(id); },
        onIconDeleted: id => clearIconRefs(id),
      }), 'stcj-mini-btn stcj-icon-pick-btn');
      const preview = element('span', 'stcj-icon-tile-preview is-small'); preview.style.background = a.surface; preview.style.color = a.text; preview.style.borderColor = a.border;
      const icon = item.iconId || item.iconPath ? createSectorIcon({ iconId: item.iconId, iconPath: item.iconPath }) : null; if (icon) preview.append(icon);
      open.append(preview, element('span', '', '选择图标'));
      open.title = `当前：${current}`; open.setAttribute('aria-label', `选择图标，当前：${current}`); open.setAttribute('aria-haspopup', 'dialog');
      row.append(control); parent.append(row); return open;
    }
    function clearIconRefs(id) {
      const library = dependencies.getSchemeLibrary();
      if (stripIconFromLibrary(library, id)) dependencies.saveSchemeLibrary(library).catch(error => { status.textContent = `方案中的图标引用未清理：${error.message || error}`; });
      if (!iconUsage(config, id)) { renderEditor(); renderPreviews(); return; }
      change('删除自定义图标', () => {
        const each = menus => { for (const m of menus || []) for (const i of m.items || []) if (i.iconId === id) delete i.iconId; };
        each(config.menus); for (const s of config.schemes || []) each(s.menus);
        if (config.appearance.centerIconId === id) delete config.appearance.centerIconId;
      });
    }
    function stepSlot(delta) {
      centerSelected = false;
      slotIndex = ((slotIndex < 0 ? 0 : slotIndex) + delta + mainMenu().items.length) % mainMenu().items.length;
      subSlotIndex = -1; menuId = 'main'; renderEditor(); renderAppearance(); renderPreviews();
    }
    function menuPicker(parent, aria = '编辑轮盘') {
      const choices = [['main', '一级动作'], ...mainMenu().items.flatMap((item, i) => item.submenu ? [[`parent:${i}`, `第 ${i + 1} 格的二级动作`]] : [])];
      return field(parent, '外观对象', { choices, value: menuId === 'main' ? 'main' : `parent:${slotIndex}`, aria, onChange: id => selectMenu(id, 0) });
    }
    function change(reason, mutate) {
      const before = { menus: copy(config.menus), appearance: copy(config.appearance), radius: config.radius };
      const previousRedo = redoStack.slice();
      recordSnapshot(reason);
      try { mutate(); }
      catch (error) { Object.assign(config, before); historyStack.pop(); redoStack.splice(0, redoStack.length, ...previousRedo); status.textContent = error.message; return; }
      pendingCount = null; save(); renderEditor(); renderAppearance();
    }
    function mutateSelected(reason, mutate) {
      change(reason, () => {
        const menu = subSlotIndex >= 0 ? ownChild(config, slotIndex) : mainMenu();
        if (subSlotIndex >= 0) { menuId = menu.id; subMenuId = menu.id; }
        mutate(menu.items[subSlotIndex >= 0 ? subSlotIndex : slotIndex], menu);
      });
    }
    // Canvas cells are { tier, index, parent }; any two cells swap, parents per the 一二级链接 preference.
    function swapCanvas(from, to) {
      const menuOf = cell => cell.tier === 'sub' ? selectedChild(config, cell.parent) : mainMenu();
      const target = menuOf(to);
      if (!target || !menuOf(from) || to.index < 0 || to.index >= target.items.length) return;
      if (from.tier === to.tier && from.index === to.index && from.parent === to.parent) return;
      change(from.tier === to.tier ? '画布交换动作' : '跨层交换动作', () => {
        if (!swapCells(config, from, to, config.editorPrefs.linkChildren)) throw new Error('无法交换这两个格子；未修改配置');
        centerSelected = false;
        if (to.tier === 'sub') { slotIndex = to.parent; subSlotIndex = to.index; menuId = subMenuId = selectedChild(config, to.parent).id; }
        else { slotIndex = to.index; subSlotIndex = -1; menuId = 'main'; subMenuId = mainMenu().items[to.index]?.submenu || subMenuId; }
      });
      const focused = previews.find(p => p.canvas.closest('[data-stcj-page="actions"]'));
      focused?.canvas.querySelector(`[data-edit-tier="${to.tier}"][data-edit-index="${to.index}"]${to.tier === 'sub' ? `[data-edit-parent="${to.parent}"]` : ''}`)?.focus();
    }
    function setEditorPref(key, value, message) {
      config.editorPrefs = { ...config.editorPrefs, [key]: value };
      save(message); renderPreviews();
    }
    function preview(parent) {
      const box = card(parent, '实时动作画布', '从北向开始顺时针。点击格子编辑；拖到任意另一格交换，子格也能和父格互换（只换内容，二级关联留在原方位）。Alt + 方向键在同一层交换；Esc 取消拖拽。预览时不会执行动作。');
      box.classList.add('stcj-preview-card');
      const canvasToolbar = element('div', 'stcj-canvas-toolbar');
      const zoomOutBtn = button(canvasToolbar, '−', () => { previewZoom = Math.max(75, previewZoom - 10); renderPreviews(); }, 'stcj-canvas-tool-btn'); zoomOutBtn.setAttribute('aria-label', '缩小预览');
      const zoomResetBtn = button(canvasToolbar, '100%', () => { previewZoom = 100; renderPreviews(); }, 'stcj-canvas-zoom-label'); zoomResetBtn.setAttribute('aria-label', '重置预览缩放');
      const zoomInBtn = button(canvasToolbar, '+', () => { previewZoom = Math.min(130, previewZoom + 10); renderPreviews(); }, 'stcj-canvas-tool-btn'); zoomInBtn.setAttribute('aria-label', '放大预览');
      const modeBar = element('div', 'stcj-canvas-modes');
      const linkBtn = button(modeBar, '', () => setEditorPref('linkChildren', !config.editorPrefs.linkChildren, config.editorPrefs.linkChildren ? '一二级链接已关闭：交换父格时二级留在原方位' : '一二级链接已开启：交换父格时二级一起移动'), 'stcj-canvas-mode-btn');
      linkBtn.title = '开启：交换一级格子时连同二级一起换位\n关闭：只交换一级格子自身内容，二级留在原方位';
      const viewSeg = element('div', 'stcj-canvas-segment'); viewSeg.setAttribute('role', 'radiogroup'); viewSeg.setAttribute('aria-label', '画布显示形式');
      const viewBtns = [['focus', '一级主轮盘', '点击父格才显示它的二级'], ['cascade', '二级级联', '所有父格与二级一起显示']].map(([id, text, tip]) => {
        const b = button(viewSeg, text, () => setEditorPref('canvasView', id, `画布显示：${text}`), 'stcj-canvas-mode-btn'); b.dataset.canvasView = id; b.title = tip; b.setAttribute('role', 'radio'); return b;
      });
      modeBar.append(viewSeg); box.append(modeBar);
      // Zoom controls float in the canvas' top-right corner and survive every re-render.
      const canvas = element('div', 'stcj-preview-canvas stcj-edit-canvas'); canvas.append(canvasToolbar); box.append(canvas);
      const indicator = element('div', 'stcj-canvas-indicator'); box.append(indicator);
      const caption = element('p', 'stcj-preview-caption'); box.append(caption);
      previews.push({ canvas, toolbar: canvasToolbar, caption, indicator, zoomResetBtn, linkBtn, viewBtns, dispose: null });
    }
    function renderPreviews() {
      const main = mainMenu(), sub = activeSubmenu(), mainA = appearance(main);
      for (const p of previews) {
        p.dispose?.(); p.zoomResetBtn.textContent = `${previewZoom}%`;
        const { linkChildren, canvasView } = config.editorPrefs, cascadeView = canvasView === 'cascade';
        if (p.linkBtn) { p.linkBtn.textContent = `🔗 一二级链接：${linkChildren ? '开启' : '关闭'}`; p.linkBtn.setAttribute('aria-pressed', String(linkChildren)); p.linkBtn.classList.toggle('is-active', linkChildren); }
        p.viewBtns?.forEach(b => { const on = b.dataset.canvasView === canvasView; b.classList.toggle('is-active', on); b.setAttribute('aria-checked', String(on)); });
        const available = Math.min(p.canvas.clientWidth || 330, p.canvas.clientHeight || 315) - 24;
        // The wheel is built at its real runtime size and scaled as a whole, so text and icons keep
        // the exact proportions of the live wheel. Fit the two-ring footprint (≈ 3.1R) first, then zoom.
        const radius = config.radius * mainA.scale / 100;
        const fit = Math.max(40, Math.min(available / 3.2, radius));
        const scale = Math.max(32, fit * previewZoom / 100) / radius;
        const view = dependencies.createRadialView({
          menu: main, appearance: resolveWheelAppearance(config, main, radius), radius,
          selected: slotIndex, submenu: !cascadeView && sub?.items.length ? sub : null,
          cascade: cascadeView ? main.items.map((_, i) => selectedChild(config, i)).map((m, i) => m && { parentIndex: i, menu: m, appearance: resolveWheelAppearance(config, m, radius) }).filter(Boolean) : null,
          onCascadeChoose: (parent, i) => { centerSelected = false; slotIndex = parent; subSlotIndex = i; menuId = subMenuId = selectedChild(config, parent).id; pendingCount = null; renderEditor(); renderAppearance(); renderPreviews(); },
          subAppearance: sub ? resolveWheelAppearance(config, sub, radius) : null,
          subSelected: subSlotIndex, parentIndex: slotIndex, activeTier: subSlotIndex >= 0 ? 'sub' : 'main', preview: true,
          onChoose: i => { centerSelected = false; slotIndex = i; subSlotIndex = -1; menuId = 'main'; subMenuId = main.items[i]?.submenu || null; pendingCount = null; renderEditor(); renderAppearance(); renderPreviews(); },
          onSubChoose: i => { centerSelected = false; subSlotIndex = i; menuId = sub.id; subMenuId = sub.id; renderEditor(); renderAppearance(); renderPreviews(); },
          // Clicking the centre selects it so its icon is edited here like any sector.
          onCenter: () => { centerSelected = true; slotIndex = -1; subSlotIndex = -1; menuId = 'main'; pendingCount = null; renderEditor(); renderAppearance(); renderPreviews(); },
        });
        Object.assign(view.element.style, { position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${scale.toFixed(4)})` });
        p.canvas.replaceChildren(view.element, ...(p.toolbar ? [p.toolbar] : []));
        const centerNode = view.element.querySelector('.stcj-radial-center');
        if (centerNode) { centerNode.classList.toggle('is-selected', centerSelected); centerNode.title = '点击编辑中心核图标'; }
        const editGroups = [['main', view.buttons, null], ['sub', view.subButtons, slotIndex], ...(view.cascadeGroups || []).map(g => ['sub', g.buttons, g.parentIndex])];
        for (const [tier, buttons, parent] of editGroups) (buttons || []).forEach((b, i) => {
          b.dataset.editTier = tier; b.dataset.editIndex = String(i); if (parent != null) b.dataset.editParent = String(parent);
          b.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');
          b.title += ' · 拖拽交换 / Alt+方向键';
        });
        p.dispose = bindCanvasSwap(p.canvas, swapCanvas, () => { status.textContent = '已取消拖拽，未修改动作'; });
        p.indicator.textContent = slotIndex < 0 ? '先选一级格子，再添加二级动作' : `第 ${slotIndex + 1} 格${subSlotIndex >= 0 ? ' · 子动作 ' + (subSlotIndex + 1) : ''}`;
        p.caption.textContent = `一级 ${main.items.length} 方位${sub ? ' · 此父格有 ' + sub.items.length + ' 个二级动作' : ''}`;
      }
    }

    const triggerPage = page('triggers', '触发与安全', '保留原生操作，把快捷动作放在手边。鼠标与触屏均需明确开启。');
    const triggerFields = [];
    function trigger(parent, label, key, options = {}) {
      const input = field(parent, label, { type: typeof config[key] === 'boolean' ? 'checkbox' : typeof config[key] === 'number' ? 'number' : 'text', ...options, value: config[key], onChange: v => {
        config[key] = v; save(); config[key] = dependencies.getRadialConfig()[key];
      } });
      triggerFields.push([input, key]); return input;
    }
    const sharedCard = card(triggerPage, '启用与通用', '轮盘与悬浮条独立使用。普通输入控件和弹窗不接管；Esc、失焦、滚动或聊天切换安全取消。');
    trigger(sharedCard, '启用快捷轮盘', 'enabled', { hint: '默认关闭；电脑与手机方案共用此开关。' });
    for (const [label, key, min, max, proOnly] of [['中心取消死区 · px', 'deadZone', 16, 60, false], ['外甩取消距离 · px', 'cancelDistance', 160, 500, false], ['子轮盘悬停 · ms', 'submenuDelay', 200, 1500, true]]) trigger(sharedCard, label, key, { min, max, proOnly });

    // PC and mobile profiles: mouse/keyboard events always use the PC side, touch events the mobile side.
    const deviceBar = element('div', 'stcj-device-tabs'); deviceBar.setAttribute('role', 'tablist'); deviceBar.setAttribute('aria-label', '触发方案');
    triggerPage.append(deviceBar);
    const devicePanels = {};
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
    function showDevice(id) {
      for (const [key, panel] of Object.entries(devicePanels)) panel.hidden = key !== id;
      deviceBar.querySelectorAll('[data-device-tab]').forEach(b => { const on = b.dataset.deviceTab === id; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    }
    for (const [id, text] of [['pc', '🖥 电脑 · 鼠标 / 键盘'], ['mobile', '📱 手机 · 触屏']]) {
      const tab = button(deviceBar, text, () => showDevice(id), 'stcj-device-tab');
      tab.dataset.deviceTab = id; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-label', id === 'pc' ? '电脑触发方案' : '手机触发方案');
      tab.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = id === 'pc' ? 'mobile' : 'pc'; showDevice(next); deviceBar.querySelector(`[data-device-tab="${next}"]`)?.focus(); } });
      const panel = element('div', 'stcj-device-panel'); panel.dataset.devicePanel = id; panel.setAttribute('role', 'tabpanel');
      devicePanels[id] = panel; triggerPage.append(panel);
    }
    devicePanels.pc.append(element('p', 'stcj-device-lead', '电脑：按住修饰键 + 鼠标键拖动越过阈值，滑向扇区松手执行；快捷键随时呼出。两者都不会误选文字，因此也可在消息编辑框中使用。'));
    devicePanels.mobile.append(element('p', 'stcj-device-lead', '手机：在聊天区长按或连击呼出，未激活前的移动让给滚动。编辑框内的长按始终留给系统选字，编辑时用双指轻点呼出。'));

    const keyCard = card(devicePanels.pc, '快捷键', '默认 Alt + Shift + J，在轮盘可用区域或编辑框中按下即在鼠标位置打开。');
    trigger(keyCard, '启用快捷键', 'keyboardEnabled');
    const mods = [['alt', 'Alt'], ['ctrl', 'Ctrl'], ['shift', 'Shift'], ['altShift', 'Alt + Shift'], ['ctrlShift', 'Ctrl + Shift']];
    trigger(keyCard, '快捷键修饰键', 'keyModifier', { choices: mods, hint: '避开浏览器常用单修饰键快捷键；额外修饰键会被精确拒绝。' });
    const keyInput = trigger(keyCard, '快捷键字母 / 数字', 'key', { type: 'text', hint: '建议使用不被浏览器占用的字母。' }); keyInput.maxLength = 1; keyInput.pattern = '[a-zA-Z0-9]';
    const mouseCard = card(devicePanels.pc, '鼠标手势', '普通右键未拖动时不屏蔽原生菜单。');
    trigger(mouseCard, '鼠标拖动呼出', 'mouseEnabled');
    trigger(mouseCard, '触发按键', 'mouseButton', { choices: [['2', '右键'], ['1', '中键'], ['3', '侧键 1'], ['4', '侧键 2']] });
    trigger(mouseCard, '鼠标修饰键', 'modifier', { choices: [...mods, ['none', '无（谨慎使用）']] });
    trigger(mouseCard, '拖动阈值 · px', 'threshold', { min: 8, max: 100, proOnly: true });
    trigger(mouseCard, '鼠标作用区域', 'mouseScope', { choices: [['chat', '仅聊天区域'], ['page', '页面非交互区域']] });
    const pcEditCard = card(devicePanels.pc, '编辑框中', '「快速编辑」等动作常在打开的编辑框里使用；鼠标手势与快捷键不会与选字冲突。');
    trigger(pcEditCard, '在消息编辑框中可呼出', 'pcEditor', { hint: '仅酒馆的消息编辑框；呼出后焦点与光标保留，执行前交还编辑框。' });
    trigger(pcEditCard, '在底部发送框中可呼出', 'pcComposer', { hint: '默认关闭，避免与发送框的右键菜单习惯冲突。', proOnly: true });

    const touchCard = card(devicePanels.mobile, '触屏手势', '长按原地松手后也可点选；浏览器 pointercancel 会取消，不强行锁住页面。');
    trigger(touchCard, '触屏触发', 'touchMode', { choices: [['off', '关闭'], ['longPress', '长按'], ['multiTap', '连击']] });
    for (const [label, key, min, max, proOnly] of [['长按延时 · ms', 'longPress', 300, 1500, true], ['连击次数', 'tapCount', 2, 4, true], ['连击间隔 · ms', 'tapInterval', 150, 700, true]]) trigger(touchCard, label, key, { min, max, proOnly });
    trigger(touchCard, '触屏作用区域', 'touchScope', { choices: [['chat', '仅聊天区域'], ['page', '页面非交互区域']] });
    const touchEditCard = card(devicePanels.mobile, '编辑框中', '无法区分「长按选字」与「长按呼出」，所以编辑框内改用双指轻点。');
    trigger(touchEditCard, '双指轻点呼出', 'touchTwoFinger', { hint: '两指同时轻触后抬起即打开，编辑框内外都可用，输入法不收起；选字只用单指，不冲突。双指拖动或缩放不会触发。' });
    showDevice(coarse ? 'mobile' : 'pc');
    const appearancePage = page('appearance', '外观与形态', '分区圆环、中心核与选中高亮统一预览。一二级轮盘可以同步，也可以拥有独立风格。');
    const appearanceLayout = element('div', 'stcj-config-layout'); appearancePage.append(appearanceLayout);
    const appearanceControls = element('div', 'stcj-config-controls'); appearanceLayout.append(appearanceControls); preview(appearanceLayout);
    function renderAppearance() {
      appearanceControls.replaceChildren(); let menu = currentMenu();
      const appearanceParentIndex = slotIndex;
      let target;
      function beginAppearanceEdit(reason) {
        if (menu.id !== menuId || (menu.id !== 'main' && (slotIndex !== appearanceParentIndex || activeSubmenu()?.id !== menu.id))) {
          status.textContent = '编辑对象已改变，请重新选择格子；未修改配置'; return false;
        }
        if (menu.id !== "main" && mainMenu().items.filter(i => i.submenu === menu.id).length > 1 && config.menus.length >= 17) { status.textContent = "子动作组已满，无法隔离共享外观；未修改配置"; return false; }
        recordSnapshot(reason);
        if (menu.id !== "main") { menu = ownChild(config, slotIndex); menuId = menu.id; subMenuId = menu.id; }
        target = menu.id === "main" ? config.appearance : menu.appearance;
        return true;
      }
      const scope = card(appearanceControls, '轮盘外观作用域'); menuPicker(scope, '外观编辑轮盘');
      field(scope, '设置窗口主题', { choices: [['host', '跟随酒馆'], ['light', '清亮浅色'], ['dark', '柔和深色']], value: config.panelTheme, onChange: v => { config.panelTheme = v; syncPanelThemeUI(); save(); } });
      if (menu.id !== 'main') {
        field(scope, '独立二级外观', { type: 'checkbox', value: !!menu.appearance, hint: '关闭时实时继承主轮盘。', onChange: v => { if (!beginAppearanceEdit('切换独立二级外观')) return; menu.appearance = v ? copy(config.appearance) : null; save(); renderAppearance(); renderEditor(); } });
        button(scope, '同步主轮盘外观', () => { if (!beginAppearanceEdit('同步主轮盘外观')) return; menu.appearance = copy(config.appearance); save(); renderAppearance(); renderEditor(); });
      }
      target = menu.id === 'main' ? config.appearance : menu.appearance;
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
          if (!target) return; if (!beginAppearanceEdit(`切换配色方案：${t.label}`)) return;
          const preset = defaultRadialAppearance(id);
          for (const key of ['theme', 'surface', 'highlight', 'text', 'border', 'accent', 'center']) target[key] = preset[key];
          save(); renderAppearance(); renderEditor();
        });
        studioGrid.append(swatchBtn);
      }
      palette.append(studioGrid);
      function styleField(parent, title, key, options = {}) {
        return field(parent, title, { ...options, disabled, value: a[key], onChange: (v, input) => {
          if (!target || !beginAppearanceEdit('修改轮盘外观')) return; target[key] = v; Object.assign(target, normalizeRadialAppearance(target));
          if (input.type !== 'checkbox') input.value = target[key]; save();
        } });
      }
      // Native colour inputs only take #rrggbb, so alpha is a separate 0–100% slider (#rrggbbaa).
      function colorField(parent, title, key) {
        const value = a[key] || '#000000';
        const alpha = value.length === 9 ? Math.round(parseInt(value.slice(7), 16) / 255 * 100) : 100;
        const row = element('div', 'stcj-setting-row stcj-color-alpha-row stcj-pro-only');
        const copyBox = element('span', 'stcj-setting-copy'); copyBox.append(element('span', '', title)); row.append(copyBox);
        const control = element('span', 'stcj-setting-control');
        const colorInput = element('input'); colorInput.type = 'color'; colorInput.value = value.slice(0, 7); colorInput.disabled = disabled; colorInput.setAttribute('aria-label', title);
        const alphaInput = element('input'); alphaInput.type = 'range'; alphaInput.min = 0; alphaInput.max = 100; alphaInput.step = 1; alphaInput.value = alpha; alphaInput.disabled = disabled; alphaInput.setAttribute('aria-label', `${title}透明度`);
        alphaInput.className = 'stcj-alpha-range';
        const output = element('output', '', `${alpha}%`);
        const commit = () => {
          if (!target || !beginAppearanceEdit('修改轮盘颜色')) return;
          const pct = Number(alphaInput.value); output.textContent = `${pct}%`;
          target[key] = pct >= 100 ? colorInput.value : colorInput.value + Math.round(pct / 100 * 255).toString(16).padStart(2, '0');
          Object.assign(target, normalizeRadialAppearance(target)); save();
        };
        colorInput.addEventListener('input', commit); alphaInput.addEventListener('input', commit);
        control.append(colorInput, alphaInput, output); row.append(control); parent.append(row);
        return colorInput;
      }
      field(palette, '配色方案', { choices: Object.entries(RADIAL_THEMES).map(([id, t]) => [id, t.label]), value: a.theme, disabled, onChange: v => {
        if (!beginAppearanceEdit('切换配色方案')) return; const preset = defaultRadialAppearance(v);
        for (const key of ['theme', 'surface', 'highlight', 'text', 'border', 'accent', 'center']) target[key] = preset[key];
        save(); renderAppearance(); renderEditor();
      } });
      styleField(palette, '轮盘形态', 'shape', { choices: [['ring', '分区圆环'], ['petals', '疏朗花瓣'], ['solid', '连续圆环']] });
      for (const [title, key] of [['扇区底色', 'surface'], ['选中填色', 'highlight'], ['高亮描边', 'accent'], ['扇区边框', 'border'], ['文字颜色', 'text'], ['中心核颜色', 'center']]) colorField(palette, title, key);
      const geometry = card(appearanceControls, '几何与文字');
      field(geometry, '基础半径 · px', { type: 'range', value: config.radius, min: 80, max: 200, live: true, onChange: v => { config.radius = v; config.cancelDistance = Math.max(config.cancelDistance, v + 40); save(); } });
      for (const [title, key, min, max, proOnly] of [['独立尺寸 · %', 'scale', 70, 130, false], ['中心留白 · %', 'innerRatio', 25, 65, true], ['扇区间隙 · °', 'gap', 0, 16, true], ['扇区边缘平滑倒角 · px', 'corner', 0, 16, false], ['起始旋转 · °', 'rotation', -180, 180, true], ['文字大小 · px', 'fontSize', 10, 20, false], ['背景不透明度 · %', 'opacity', 45, 100, true], ['选中光晕 · px', 'glow', 0, 30, true]]) {
        if (menu.id !== 'main' && ['rotation', 'scale', 'innerRatio'].includes(key)) continue;
        styleField(geometry, title, key, { type: 'range', min, max, live: true, proOnly });
      }
      button(geometry, '重置当前外观', () => { if (!beginAppearanceEdit('重置当前外观')) return; if (menu.id === 'main') { config.appearance = defaultRadialAppearance(); menu.appearance = null; } else menu.appearance = defaultRadialAppearance(); save(); renderAppearance(); renderEditor(); });
    }

    const actionPage = page('actions', '扇区与动作', '先在画布选择一级格子，再配置动作或添加属于它的二级动作。');
    const actionLayout = element('div', 'stcj-config-layout stcj-actions-layout'); actionPage.append(actionLayout);
    preview(actionLayout);
    const editor = element('div', 'stcj-config-controls'); actionLayout.append(editor);
    const actions = dependencies.listShortcutActions();
    function renderCenterInspector() {
      const box = card(editor); box.dataset.centerInspector = 'true';
      const head = element('div', 'stcj-inspector-head'); box.append(head);
      head.append(element('h3', '', '中心核'), element('span', 'stcj-direction-badge', '轮盘中心'));
      box.append(element('p', 'stcj-settings-note', '运行时点击中心核取消轮盘（二级展开时返回主轮盘）。设置了图标时显示图标，否则显示备用文字符号。'));
      iconRow(box, { iconId: config.appearance.centerIconId }, '使用文字符号', iconId => change(iconId ? '修改中心核图标' : '中心核改用文字符号', () => { if (iconId) config.appearance.centerIconId = iconId; else delete config.appearance.centerIconId; }));
      const symbolInput = field(box, '备用文字符号', { value: config.appearance.centerSymbol, aria: '中心核备用文字符号', hint: '最多 3 个字符；仅文本，不加载图片或外部字体。', onChange: v => change('修改中心核符号', () => { config.appearance.centerSymbol = [...String(v || '')].slice(0, 3).join('') || '×'; }) });
      symbolInput.maxLength = 6;
      button(box, '取消选择', () => { centerSelected = false; renderEditor(); renderPreviews(); });
    }
    function renderEditor() {
      editor.replaceChildren();
      if (slotIndex >= mainMenu().items.length) slotIndex = -1;
      const sub = activeSubmenu();
      if (!sub || subSlotIndex >= sub.items.length) subSlotIndex = -1;
      const toolbar = element('div', 'stcj-action-toolbar'); editor.append(toolbar);
      button(toolbar, '↶ 撤销', performUndo, 'stcj-mini-btn').disabled = !historyStack.length;
      button(toolbar, '↷ 重做', performRedo, 'stcj-mini-btn').disabled = !redoStack.length;
      const countBox = element('div', 'stcj-fixed-counts'); toolbar.append(countBox);
      countBox.setAttribute('role', 'group'); countBox.setAttribute('aria-label', '一级固定方位');
      for (const count of PRIMARY_COUNTS) {
        const b = button(countBox, `${count} 方位`, () => {
          if (count === mainMenu().items.length) return;
          if (count < mainMenu().items.length) { pendingCount = count; renderEditor(); return; }
          change('调整一级方位数量', () => resizePrimary(config, count));
        });
        b.setAttribute('aria-pressed', String(count === mainMenu().items.length));
      }
      if (!PRIMARY_COUNTS.includes(mainMenu().items.length)) editor.append(element('p', 'stcj-settings-note', `兼容现有 ${mainMenu().items.length} 方位；选择 4 / 8 / 12 后应用，不自动改写。`));
      if (pendingCount !== null) {
        const warning = card(editor, '确认缩减方位', '以下一级动作将从画布移除，关联子动作保留归档；可撤销恢复。'); warning.dataset.resizeWarning = 'true';
        for (const text of affectedByShrink(config, pendingCount)) warning.append(element('p', '', text));
        button(warning, '确认缩减', () => change('缩减一级方位数量', () => { resizePrimary(config, pendingCount); slotIndex = -1; subSlotIndex = -1; menuId = 'main'; }));
        button(warning, '取消缩减', () => { pendingCount = null; renderEditor(); });
      }
      if (centerSelected) { renderCenterInspector(); return; }
      const parent = mainMenu().items[slotIndex];
      if (!parent) { card(editor, '选择一级格子', '点击画布中的一级动作，才能添加或编辑属于它的二级动作。'); return; }
      const isSub = subSlotIndex >= 0, menu = isSub ? sub : mainMenu(), index = isSub ? subSlotIndex : slotIndex, item = menu.items[index];
      const inspector = card(editor); inspector.dataset.slotInspector = 'true';
      const head = element('div', 'stcj-inspector-head'); inspector.append(head);
      const typeName = actionTypeLabel(item);
      head.append(element('h3', '', isSub ? `第 ${slotIndex + 1} 格 · 子动作 ${subSlotIndex + 1} · ${typeName}` : `第 ${slotIndex + 1} 格 · ${typeName}`));
      head.append(element('span', 'stcj-direction-badge', isSub ? '父格外侧' : formatDirectionBadge(slotIndex, mainMenu().items.length)));
      if (isSub) inspector.append(element('p', 'stcj-settings-note', '仅属于当前父格；在父角度外侧等分显示。'));
      if (isSub) button(inspector, '返回父动作', () => { subSlotIndex = -1; menuId = 'main'; renderEditor(); renderAppearance(); renderPreviews(); });
      field(inspector, '动作名称', { value: item.label, aria: '动作名称', onChange: v => mutateSelected('修改动作名称', selected => { selected.label = v || '未设置'; }) });
      field(inspector, '在轮盘上显示名称', { type: 'checkbox', value: !!item.showLabel, aria: '在轮盘上显示名称', onChange: v => mutateSelected(v ? '显示动作名称' : '隐藏动作名称', selected => { selected.showLabel = v; }) });
      field(inspector, '在轮盘上显示图标', { type: 'checkbox', value: item.showIcon !== false, aria: '在轮盘上显示图标', onChange: v => mutateSelected(v ? '显示动作图标' : '隐藏动作图标', selected => { selected.showIcon = v; }) });
      iconRow(inspector, item, '跟随动作（默认）', iconId => mutateSelected(iconId ? '修改动作图标' : '恢复默认图标', selected => { delete selected.iconPath; if (iconId) selected.iconId = iconId; else delete selected.iconId; }));
      {
        const type = item.submenu && !item.action ? 'empty' : actionTypeOf(item);
        const typeChoices = Object.entries(ACTION_TYPES).map(([id, t]) => [id, t.label]);
        if (!typeChoices.some(c => c[0] === type)) typeChoices.push([type, `${type}（未支持，保留）`]);
        field(inspector, '动作类型', { value: type, choices: typeChoices, onChange: v => mutateSelected('修改动作类型', selected => {
          const first = actions.find(a => a.type === v);
          if (v !== 'empty' && !first) throw new Error('该动作类型暂无可用动作；未修改配置');
          delete selected.action;
          if (first) { selected.action = { type: first.type, id: first.id }; if (!selected.label || selected.label === '未设置') selected.label = first.label; selected.showLabel = true; }
          else if (!selected.submenu) selected.showLabel = false;
        }) });
        if (item.action) {
          const choices = actions.filter(a => a.type === item.action.type).map(a => [`${a.type}:${a.id}`, a.label]), selected = `${item.action.type}:${item.action.id}`;
          if (!choices.some(c => c[0] === selected)) choices.push([selected, '未注册动作（保留）']);
          field(inspector, '执行动作', { value: selected, choices, onChange: v => mutateSelected('修改执行动作', selected => {
            const [type, ...id] = v.split(':'); const previous = actions.find(a => a.type === selected.action?.type && a.id === selected.action?.id);
            selected.action = { type, id: id.join(':') };
            const next = actions.find(a => a.type === type && a.id === selected.action.id);
            if (next && (!selected.label || selected.label === '未设置' || selected.label === previous?.label)) selected.label = next.label;
          }) });
        }
        if (item.submenu) inspector.append(element('p', 'stcj-settings-note', item.action ? '此父格点击 / 松开 / Enter 执行自身动作；悬停或外滑展开二级，Shift+Enter 键盘进入二级。' : '该一级格子打开二级动作；也可为它设置自身动作。点击外侧子格编辑其动作。'));
      }
      const tools = element('div', 'stcj-editor-tools'); inspector.append(tools);
      button(tools, '📋 复制动作', () => { clipboardSlot = copy(item); renderEditor(); });
      button(tools, '📥 粘贴动作', () => mutateSelected('粘贴动作', selected => { const next = copy(clipboardSlot); delete next.submenu; const linked = selected.submenu; Object.keys(selected).forEach(k => delete selected[k]); Object.assign(selected, next); if (linked) selected.submenu = linked; })).disabled = !clipboardSlot;
      if (isSub) button(tools, '删除此子动作', () => change('删除子动作', () => { const left = removeChild(config, slotIndex, subSlotIndex); subSlotIndex = -1; menuId = 'main'; if (!left) subMenuId = config.menus.find(m => m.id !== 'main')?.id || null; }));
      else button(tools, '清空当前动作', () => mutateSelected('清空当前动作', clearCell));
      const children = card(editor, '当前格子的二级动作'); children.dataset.inlineSubwheel = 'true';
      if (sub) children.append(element('p', 'stcj-settings-note', `${sub.items.length} 个子动作；点击画布外侧格子编辑。${mainMenu().items.filter(i => i.submenu === sub.id).length > 1 ? '旧配置共享组：编辑时自动复制，仅影响当前父格。' : ''}`));
      const add = button(children, '+ 添加二级动作', () => change('添加二级动作', () => { const child = addChild(config, slotIndex); subSlotIndex = child.items.length - 1; menuId = child.id; subMenuId = child.id; }));
      add.disabled = !!sub && sub.items.length >= 12;
      if (!sub) {
        const archived = archivedChildren(config);
        if (archived.length) {
          const archive = card(children, '保留的未绑定子动作', '旧孤立组或缩减后组保留数据，不作为独立整圈显示。可绑定到当前格。');
          archived.forEach(group => button(archive, `绑定归档：${group.label}（${group.items.length} 项）`, () => change('绑定归档子动作', () => { const child = addChild(config, slotIndex, group.id); subSlotIndex = -1; subMenuId = child.id; menuId = 'main'; })));
        }
      }
    }

    const schemePage = page('schemes', '方案与备份', '动作和外观分开保存、分开应用。方案存放在酒馆用户目录 user/files/stcj-radial-schemes.json，随 ST / TT 数据一起备份。');
    // Two independent kinds of saved schemes, both kept in the scheme library file.
    const schemeKinds = {
      actions: { title: '动作方案', save: '保存当前扇区为动作方案', empty: '还没有动作方案。保存后可随时把全部一二级扇区换成这一套。', fallback: '我的动作',
        describe: s => `${s.menus.length} 个轮盘 · ${s.menus.find(m => m.id === 'main')?.items.length || 0} 个主扇区`,
        snapshot: name => ({ label: name, menus: copy(config.menus) }),
        apply: s => { recordSnapshot(`应用动作方案：${s.label}`); config.menus = copy(s.menus); undo.clear(); menuId = 'main'; subMenuId = config.menus.find(m => m.id !== 'main')?.id || null; slotIndex = 0; subSlotIndex = -1; save(`已应用动作方案「${s.label}」，外观与触发不变`); renderEditor(); } },
      appearances: { title: '外观方案', save: '保存当前外观为外观方案', empty: '还没有外观方案。保存后可随时把配色、形态和尺寸换成这一套。', fallback: '我的外观',
        describe: s => `${RADIAL_THEMES[s.appearance.theme]?.label || s.appearance.theme} · ${s.radius}px`,
        snapshot: name => ({ label: name, appearance: copy(config.appearance), radius: config.radius }),
        apply: s => { recordSnapshot(`应用外观方案：${s.label}`); config.appearance = copy(s.appearance); config.radius = s.radius; config.cancelDistance = Math.max(config.cancelDistance, config.radius + 40); save(`已应用外观方案「${s.label}」，扇区与触发不变`); renderAppearance(); } },
    };
    const schemeLists = {};
    function updateLibrary(mutate, message) {
      const library = dependencies.getSchemeLibrary(); mutate(library);
      return dependencies.saveSchemeLibrary(library).then(() => { if (message) status.textContent = message; }, error => { status.textContent = `方案未保存：${error.message || error}`; });
    }
    for (const [kind, meta] of Object.entries(schemeKinds)) {
      const box = card(schemePage, meta.title, `最多 ${SCHEME_LIMIT} 套。名称可直接在列表里修改。`);
      let name = meta.fallback; const nameInput = field(box, '新方案名称', { value: name, onChange: v => { name = v || meta.fallback; } });
      const list = element('div', 'stcj-scheme-list'); box.append(list);
      const add = button(box, meta.save, () => updateLibrary(lib => { if (lib[kind].length < SCHEME_LIMIT) lib[kind].push({ id: newSchemeId(kind === 'actions' ? 'a' : 'p', lib[kind]), ...meta.snapshot(name) }); }, `已保存${meta.title}「${name}」`));
      schemeLists[kind] = { list, add, nameInput };
    }
    function renderSchemes() {
      const library = dependencies.getSchemeLibrary(), state = dependencies.schemeLibraryStatus();
      for (const [kind, meta] of Object.entries(schemeKinds)) {
        const { list, add } = schemeLists[kind], items = library[kind];
        list.replaceChildren(); add.disabled = !state.loaded || items.length >= SCHEME_LIMIT;
        if (!state.loaded) { list.append(element('p', 'stcj-settings-note', state.error ? `方案文件不可用：${state.error}` : '正在读取方案文件…')); continue; }
        if (!items.length) list.append(element('p', 'stcj-settings-note', meta.empty));
        for (const scheme of items) {
          const row = element('div', 'stcj-scheme-row');
          const title = element('input', 'stcj-scheme-name'); title.value = scheme.label; title.maxLength = 40; title.setAttribute('aria-label', `${meta.title}名称`);
          title.addEventListener('change', () => { const v = title.value.trim().slice(0, 40); if (!v || v === scheme.label) { title.value = scheme.label; return; } updateLibrary(lib => { const s = lib[kind].find(x => x.id === scheme.id); if (s) s.label = v; }, '已重命名'); });
          row.append(title, element('small', '', meta.describe(scheme)));
          button(row, '应用', () => meta.apply(scheme));
          button(row, '导出', () => exportSchemes({ actions: kind === 'actions' ? [scheme] : [], appearances: kind === 'appearances' ? [scheme] : [] }, `stcj-${kind === 'actions' ? 'action' : 'appearance'}-${scheme.label}`));
          button(row, '删除', () => updateLibrary(lib => { lib[kind] = lib[kind].filter(s => s.id !== scheme.id); }, `已删除「${scheme.label}」`));
          list.append(row);
        }
      }
    }

    const transfer = card(schemePage, '导入导出方案', '方案文件可在设备之间共享；导出时附带用到的自定义图标。导入只会追加，同名方案自动改名，不覆盖现有方案。');
    const schemeJson = element('textarea', 'stcj-config-json'); schemeJson.rows = 6; schemeJson.spellcheck = false; schemeJson.setAttribute('aria-label', '方案 JSON'); schemeJson.placeholder = '导出的方案 JSON 会出现在这里；也可以粘贴后点「从文本导入」。';
    const transferTools = element('div', 'stcj-editor-tools');
    const filePicker = element('input'); filePicker.type = 'file'; filePicker.accept = '.json,application/json'; filePicker.hidden = true;
    transfer.append(schemeJson, transferTools, filePicker);
    // Bundle only the custom icons the exported data references, so exports stay self-contained.
    function bundledIcons(raw) { const used = new Set(); visitIconRefs(raw, ref => { if (ref.get()?.startsWith('user:')) used.add(ref.get()); }); return getUserIcons().filter(i => used.has(`user:${i.id}`)); }
    function exportSchemes(library, fileName) {
      const data = schemeExport(library, []); data.icons = bundledIcons(data);
      const text = JSON.stringify(data, null, 2); schemeJson.value = text;
      try {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = element('a'); link.href = url; link.download = `${fileName.replace(/[\\/:*?"<>|]+/g, '_')}.json`; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = '已导出方案文件；JSON 同时显示在文本框中，可直接复制';
      } catch { status.textContent = '已生成方案 JSON，请从文本框复制'; }
    }
    function importSchemes(text) {
      try {
        if (text.length > 2000000) throw new Error('文件超过 200 万字符上限');
        const raw = JSON.parse(text);
        const iconNote = mergeImportedIcons(raw);
        const { library, added, skipped } = mergeSchemeLibrary(dependencies.getSchemeLibrary(), readSchemeImport(raw));
        if (!added) throw new Error(skipped ? `方案已达 ${SCHEME_LIMIT} 套上限` : '文件中没有可导入的方案');
        dependencies.saveSchemeLibrary(library).then(() => { status.textContent = `已导入 ${added} 套方案${skipped ? `，${skipped} 套因数量上限跳过` : ''}${iconNote}`; }, error => { status.textContent = `方案未保存：${error.message || error}`; });
      } catch (error) { status.textContent = `未导入：${error.message}`; }
    }
    button(transferTools, '导出全部方案', () => exportSchemes(dependencies.getSchemeLibrary(), 'stcj-radial-schemes'));
    button(transferTools, '从文件导入', () => filePicker.click());
    button(transferTools, '从文本导入', () => importSchemes(schemeJson.value));
    filePicker.addEventListener('change', async () => { const file = filePicker.files?.[0]; filePicker.value = ''; if (file) importSchemes(await file.text()); });

    const backup = card(schemePage, '当前配置 JSON', '仅包含本插件当前轮盘配置（不含已保存方案），不包含聊天、API 或宿主设置。文本不会作为代码运行。');
    const json = element('textarea', 'stcj-config-json'); json.rows = 8; json.setAttribute('aria-label', '轮盘配置 JSON'); json.spellcheck = false; backup.append(json);
    const backupTools = element('div', 'stcj-editor-tools'); backup.append(backupTools);
    button(backupTools, '生成可复制 JSON', () => {
      const out = normalizeRadialConfig(config); delete out.schemes;
      const bundled = bundledIcons(out); if (bundled.length) out.customIcons = bundled;
      json.value = JSON.stringify(out, null, 2); json.focus(); json.select();
    });
    let includeTriggers = false; field(backup, '导入时包含触发设置', { type: 'checkbox', value: false, hint: '默认保留现有启用状态、快捷键、鼠标和触屏设置。', onChange: v => { includeTriggers = v; } });
    button(backupTools, '导入 JSON', () => {
      try {
        if (json.value.length > 1000000) throw new Error('配置超过100万字符上限');
        const raw = JSON.parse(json.value);
        if (!raw || !Array.isArray(raw.menus) || raw.version !== RADIAL_CONFIG_VERSION) throw new Error('仅支持 v4 轮盘配置；旧版本配置已停用');
        const iconNote = mergeImportedIcons(raw);
        const next = normalizeRadialConfig(raw);
        for (const key of includeTriggers ? Object.keys(next).filter(k => k !== 'schemes') : ['menus', 'appearance', 'radius', 'panelTheme']) config[key] = next[key];
        config.cancelDistance = Math.max(config.cancelDistance, config.radius + 40); undo.clear(); menuId = 'main';
        subMenuId = config.menus.find(m => m.id !== 'main')?.id || null; slotIndex = 0; subSlotIndex = 0;
        triggerFields.forEach(([input, key]) => { if (input.type === 'checkbox') input.checked = config[key]; else input.value = config[key]; });
        syncPanelThemeUI(); save(`配置已校验并导入${iconNote}`); renderEditor(); renderAppearance();
        // Old full backups may still carry combined schemes: they join the scheme library instead.
        if (Array.isArray(raw.schemes) && raw.schemes.length) {
          const { library, added } = mergeSchemeLibrary(dependencies.getSchemeLibrary(), readSchemeImport({ schemes: raw.schemes }));
          if (added) dependencies.saveSchemeLibrary(library).then(() => { status.textContent = `配置已导入；旧备份中的方案已拆分加入方案库（${added} 套）`; }, () => {});
        }
      } catch (error) { status.textContent = `未导入：${error.message}`; }
    });
    // Every icon reference an import/export payload can carry: live menus, legacy combined schemes,
    // action/appearance schemes and the centre icon.
    function visitIconRefs(raw, visit) {
      const item = i => { if (i && typeof i === 'object') visit({ get: () => i.iconId, set: v => { i.iconId = v; } }); };
      const menus = list => { for (const m of Array.isArray(list) ? list : []) (Array.isArray(m?.items) ? m.items : []).forEach(item); };
      const appearanceRef = a => { if (a && typeof a === 'object') visit({ get: () => a.centerIconId, set: v => { a.centerIconId = v; } }); };
      menus(raw.menus); appearanceRef(raw.appearance);
      for (const s of Array.isArray(raw.schemes) ? raw.schemes : []) { menus(s?.menus); appearanceRef(s?.appearance); }
      for (const s of Array.isArray(raw.actions) ? raw.actions : []) menus(s?.menus);
      for (const s of Array.isArray(raw.appearances) ? raw.appearances : []) appearanceRef(s?.appearance);
    }
    // Merges bundled icons (config backups: customIcons, scheme files: icons) into the icon file;
    // id clashes with different shapes are remapped in `raw`. Only the icon file write is asynchronous.
    function mergeImportedIcons(raw) {
      const source = Array.isArray(raw.customIcons) ? raw.customIcons : Array.isArray(raw.icons) ? raw.icons : [];
      const incoming = source.map(normalizeUserIcon).filter(Boolean);
      if (!incoming.length) return '';
      const list = getUserIcons().slice(), remap = new Map(); let added = 0;
      for (const icon of incoming) {
        const same = list.find(i => i.d === icon.d && i.viewBox === icon.viewBox && i.mode === icon.mode);
        if (same) { if (same.id !== icon.id) remap.set(`user:${icon.id}`, `user:${same.id}`); continue; }
        const id = list.some(i => i.id === icon.id) ? newIconId(list) : icon.id;
        if (id !== icon.id) remap.set(`user:${icon.id}`, `user:${id}`);
        list.push({ ...icon, id }); added++;
      }
      visitIconRefs(raw, ref => { if (remap.has(ref.get())) ref.set(remap.get(ref.get())); });
      if (!added) return '';
      dependencies.saveIconLibrary(list).then(() => { status.textContent = `导入完成；已合并 ${added} 个自定义图标`; },
        error => { status.textContent = `已导入；自定义图标未保存（${error.message || error}），对应格子暂用默认图标`; });
      return `；正在保存 ${added} 个自定义图标`;
    }
    const about = page('about', '关于与设计致谢', '独立浏览器实现 · 无构建依赖 · 与 SillyTavern / TauriTavern 共用服务架构。');
    const credits = card(about, '设计参考与许可边界', '设置分区、交互画布和环形扇区设计参考 StarPie；代码、几何渲染、样式和符号由本插件独立编写。');
    credits.append(element('p', '', 'StarPie © 2026 StarPie Contributors，维护者 SoftBlack42。参考版本 LICENSE 实为 “MIT License (with Non-Commercial Restriction)”，不是标准 MIT。本插件未复制或分发其代码、图片、声音、字体或商标图形，不将其许可表述为本插件许可。'));
    for (const [name, href] of [['StarPie 设计来源', 'https://github.com/SoftBlack42/StarPie'], ['本插件源码与许可证', 'https://github.com/qianzhuowo/ST-Chat-Jumper']]) { const link = element('a', '', name); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; credits.append(link, document.createTextNode(' · ')); }
    card(about, '动作扩展', '目前仅内置插件动作。酒馆操作、角色卡及自定义命令保留注册接口，不提供虚假的未实现功能，也不执行配置中的任意脚本。');
    const favorites = card(about, '收藏预览兼容设置');
    field(favorites, '收藏预览方式', { value: dependencies.loadFavoritesPreviewMode(), choices: [['swipe_default', '默认预览'], ['swipe_html', 'HTML 预览'], ['star_main', '主界面预览']], onChange: v => dependencies.saveFavoritesPreviewMode(v) });
    if (!status.parentNode) container.append(status);
    renderEditor(); renderAppearance(); renderSchemes(); renderPreviews();
    const observer = window.ResizeObserver ? new ResizeObserver(() => schedulePreviews()) : null;
    previews.forEach(p => observer?.observe(p.canvas));
    // Custom icons live in user/files/stcj-icon-library.json; load it, then move legacy inline paths there once.
    let mounted = true;
    const offIcons = dependencies.onIconLibraryChange?.(() => { if (mounted) { renderPreviews(); renderEditor(); } });
    // Saved schemes live in user/files/stcj-radial-schemes.json; the first load also migrates legacy combined schemes.
    const offSchemes = dependencies.onSchemeLibraryChange(() => { if (mounted) renderSchemes(); });
    void dependencies.loadSchemeLibrary();
    void (dependencies.loadIconLibrary?.() || Promise.resolve()).then(async () => {
      if (!mounted) return;
      const state = dependencies.iconLibraryStatus?.() || { error: '' };
      if (state.error) { status.textContent = `自定义图标文件不可用：${state.error}；格子暂用默认图标`; return; }
      const draft = { menus: copy(config.menus), schemes: copy(config.schemes) };
      const { icons, moved } = migrateInlinePaths(draft, getUserIcons());
      if (!moved) return;
      try {
        await dependencies.saveIconLibrary(icons);
        if (!mounted) return;
        config.menus = draft.menus; config.schemes = draft.schemes;
        save(`已把 ${moved} 个内嵌图标迁移到独立图标文件`); renderEditor();
      } catch (error) { status.textContent = `内嵌图标暂未迁移：${error.message || error}；原图标照常显示`; }
    });
    detachObserver = () => { mounted = false; if (previewFrame) window.cancelAnimationFrame?.(previewFrame); previewFrame = 0; offIcons?.(); offSchemes(); observer?.disconnect(); previews.forEach(p => p.dispose?.()); };
  }
  return { mountRadialSettings, destroyRadialSettings };
}
