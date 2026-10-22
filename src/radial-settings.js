import { resolveWheelAppearance } from './radial-view.js';
import { defaultRadialAppearance, normalizeRadialAppearance, normalizeRadialConfig, RADIAL_THEMES } from './radial-config.js';

export const requiredServices = ['getRadialConfig', 'saveRadialConfig', 'listShortcutActions', 'cancelRadial', 'openRadial', 'createRadialView', 'loadFavoritesPreviewMode', 'saveFavoritesPreviewMode'];

const copy = value => JSON.parse(JSON.stringify(value));
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
export function createFeature({ dependencies }) {
  let detachObserver = null;
  function destroyRadialSettings() { detachObserver?.(); detachObserver = null; }
  function mountRadialSettings(container) {
    destroyRadialSettings();
    const config = dependencies.getRadialConfig();
    const dialog = container.closest('dialog'); if (dialog) dialog.dataset.panelTheme = config.panelTheme;
    let menuId = 'main', slotIndex = 0;
    const undo = new Map(), previews = [];
    container.classList.add('stcj-radial-settings');
    const status = container.closest('dialog')?.querySelector('#stcj-settings-save-state') || element('p', 'stcj-editor-status', '自动保存 · 预览不会执行动作'); status.setAttribute('role', 'status');
    function save(message) { dependencies.cancelRadial(); dependencies.saveRadialConfig(config); status.textContent = message || '已保存 · 预览不会执行动作'; renderPreviews(); }
    function page(id, title, subtitle) {
      const section = element('section', 'stcj-settings-page'); section.dataset.stcjPage = id; section.hidden = true; section.id = `stcj-page-${id}`;
      section.append(element('h2', '', title), element('p', 'stcj-page-subtitle', subtitle)); container.append(section); return section;
    }
    function card(parent, title, description) {
      const box = element('section', 'stcj-config-card'); if (title) box.append(element('h3', '', title)); if (description) box.append(element('p', 'stcj-settings-note', description)); parent.append(box); return box;
    }
    function button(parent, text, handler, className = '') {
      const b = element('button', className, text); b.type = 'button'; b.addEventListener('click', handler); parent.append(b); return b;
    }
    function field(parent, label, { type = 'text', value, choices, min, max, step = 1, hint, onChange, live = false, disabled = false, aria = label }) {
      const row = element('label', 'stcj-setting-row'); const text = element('span', 'stcj-setting-copy'); text.append(element('span', '', label)); if (hint) text.append(element('small', '', hint)); row.append(text);
      const control = element('span', 'stcj-setting-control'); let input;
      if (choices) { input = element('select'); for (const [v, title] of choices) { const option = element('option', '', title); option.value = v; input.append(option); } input.value = String(value); }
      else { input = element('input'); input.type = type; if (type === 'checkbox') input.checked = !!value; else input.value = value ?? ''; }
      input.disabled = disabled; input.setAttribute('aria-label', aria);
      if (min != null) { input.min = min; input.max = max; input.step = step; }
      if (type === 'text') input.maxLength = 40;
      const output = type === 'range' || type === 'color' ? element('output', '', value) : null;
      input.addEventListener(live ? 'input' : 'change', () => {
        if (!input.checkValidity()) { input.reportValidity(); return; }
        const v = type === 'checkbox' ? input.checked : ['range', 'number'].includes(type) ? Number(input.value) : input.value;
        if (output) output.textContent = v; onChange(v, input);
      }); control.append(input); if (output) control.append(output); row.append(control); parent.append(row); return input;
    }
    function currentMenu() { return config.menus.find(m => m.id === menuId) || config.menus[0]; }
    function appearance() { return normalizeRadialAppearance(currentMenu().appearance || config.appearance); }
    function selectMenu(id) { menuId = config.menus.some(m => m.id === id) ? id : 'main'; slotIndex = 0; renderEditor(); renderAppearance(); renderPreviews(); }
    function menuPicker(parent, aria = '编辑轮盘') {
      return field(parent, '当前轮盘', { choices: config.menus.map(m => [m.id, `${m.id === 'main' ? '◉' : '↳'} ${m.label}`]), value: menuId, aria, onChange: selectMenu });
    }
    function preview(parent) {
      const box = card(parent, '实时交互画布', '悬停查看选中效果，点击扇区定位编辑。这里只预览，不执行动作。'); box.classList.add('stcj-preview-card');
      const badge = element('span', 'stcj-preview-badge', 'LIVE'); box.append(badge);
      const canvas = element('div', 'stcj-preview-canvas'); box.append(canvas);
      const caption = element('p', 'stcj-preview-caption'); box.append(caption);
      const tools = element('div', 'stcj-editor-tools'); box.append(tools);
      button(tools, '↶ 主轮盘', () => selectMenu('main'));
      button(tools, '试用真实轮盘', () => { if (!config.enabled) { status.textContent = '请先在「触发与安全」启用轮盘，再试用。'; return; } container.closest('dialog')?.close(); dependencies.openRadial(); });
      previews.push({ canvas, caption });
    }
    function renderPreviews() {
      const menu = currentMenu(), a = appearance();
      for (const p of previews) {
        const radius = Math.min(155, Math.max(45, ((p.canvas.clientWidth || 330) - 18) / 2), config.radius * a.scale / 100);
        const view = dependencies.createRadialView({ menu, appearance: resolveWheelAppearance(config, menu, config.radius * a.scale / 100), radius, selected: slotIndex, preview: true,
          onChoose: i => { slotIndex = i; renderEditor(); renderPreviews(); dialog?.querySelector('[data-settings-page=actions]')?.click(); editor.querySelector('[data-slot-inspector]')?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); },
          onCenter: () => { if (menuId !== 'main') selectMenu('main'); else { slotIndex = -1; renderEditor(); renderPreviews(); } },
          onHover: i => { view.setSelected(i); p.caption.textContent = `${menu.label} · ${i + 1} / ${menu.items.length} · ${menu.items[i]?.label || '空扇区'}${menu.items[i]?.submenu ? ' › 子轮盘' : ''}`; } });
        p.canvas.replaceChildren(view.element); p.caption.textContent = `${menu.label} · ${menu.items.length} 个扇区 · ${menu.appearance ? '独立外观' : '主轮盘外观'}`;
      }
    }

    const triggerPage = page('triggers', '触发与安全', '保留原生操作，把快捷动作放在手边。鼠标与触屏均需明确开启。');
    const enableCard = card(triggerPage, '启用与快捷键', '轮盘与悬浮条独立使用。输入框、交互控件及弹窗不接管；Esc、失焦、滚动或聊天切换安全取消。');
    const triggerFields = [];
    function trigger(parent, label, key, options = {}) {
      const input = field(parent, label, { type: typeof config[key] === 'boolean' ? 'checkbox' : typeof config[key] === 'number' ? 'number' : 'text', ...options, value: config[key], onChange: v => { config[key] = v; save(); config[key] = dependencies.getRadialConfig()[key]; } }); triggerFields.push([input, key]); return input;
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
    trigger(mouseCard, '拖动阈值 · px', 'threshold', { min: 8, max: 100 });
    trigger(mouseCard, '手势作用区域', 'scope', { choices: [['chat', '仅聊天区域'], ['page', '页面非交互区域']] });
    const touchCard = card(triggerPage, '触屏与取消', '未激活前移动让给滚动。长按原地松手后也可点选；浏览器 pointercancel 会取消，不强行锁住页面。');
    trigger(touchCard, '触屏触发', 'touchMode', { choices: [['off', '关闭'], ['longPress', '长按'], ['multiTap', '连击']] });
    for (const [label, key, min, max] of [['长按延时 · ms', 'longPress', 300, 1500], ['连击次数', 'tapCount', 2, 4], ['连击间隔 · ms', 'tapInterval', 150, 700], ['中心取消死区 · px', 'deadZone', 16, 60], ['外甩取消距离 · px', 'cancelDistance', 160, 500], ['子轮盘悬停 · ms', 'submenuDelay', 200, 1500]]) trigger(touchCard, label, key, { min, max });

    const appearancePage = page('appearance', '外观与形态', '分区圆环、中心核与选中高亮统一预览。一二级轮盘可以同步，也可以拥有独立风格。');
    const appearanceLayout = element('div', 'stcj-config-layout'); appearancePage.append(appearanceLayout);
    const appearanceControls = element('div', 'stcj-config-controls'); appearanceLayout.append(appearanceControls); preview(appearanceLayout);
    function renderAppearance() {
      appearanceControls.replaceChildren(); const menu = currentMenu();
      const scope = card(appearanceControls, '轮盘外观作用域'); menuPicker(scope, '外观编辑轮盘');
      field(scope, '设置窗口主题', { choices: [['host', '跟随酒馆'], ['light', '清亮浅色'], ['dark', '柔和深色']], value: config.panelTheme, onChange: v => { config.panelTheme = v; if (dialog) dialog.dataset.panelTheme = v; save(); } });
      if (menu.id !== 'main') {
        field(scope, '独立二级外观', { type: 'checkbox', value: !!menu.appearance, hint: '关闭时实时继承主轮盘。', onChange: v => { menu.appearance = v ? copy(config.appearance) : null; save(); renderAppearance(); } });
        button(scope, '同步主轮盘外观', () => { menu.appearance = copy(config.appearance); save(); renderAppearance(); });
      }
      const target = menu.id === 'main' ? config.appearance : menu.appearance;
      const disabled = !target, a = appearance();
      const palette = card(appearanceControls, '视觉风格与配色', disabled ? '当前继承主轮盘，开启独立外观后可调整。' : '预设是起点，颜色、文字与扇区形态均可进一步定制。');
      function styleField(parent, title, key, options = {}) { return field(parent, title, { ...options, disabled, value: a[key], onChange: (v, input) => { if (!target) return; target[key] = v; Object.assign(target, normalizeRadialAppearance(target)); if (input.type !== 'checkbox') input.value = target[key]; save(); if (key === 'showIcons' || key === 'showLabels') renderAppearance(); } }); }
      field(palette, '配色方案', { choices: Object.entries(RADIAL_THEMES).map(([id, t]) => [id, t.label]), value: a.theme, disabled, onChange: v => { const preset = defaultRadialAppearance(v); for (const key of ['theme', 'surface', 'highlight', 'text', 'border', 'accent', 'center']) target[key] = preset[key]; save(); renderAppearance(); } });
      styleField(palette, '轮盘形态', 'shape', { choices: [['ring', '分区圆环'], ['petals', '疏朗花瓣'], ['solid', '连续圆环']] });
      for (const [title, key] of [['扇区底色', 'surface'], ['选中填色', 'highlight'], ['高亮描边', 'accent'], ['扇区边框', 'border'], ['文字颜色', 'text'], ['中心核颜色', 'center']]) styleField(palette, title, key, { type: 'color', live: true });
      const geometry = card(appearanceControls, '几何与文字');
      field(geometry, '基础半径 · px', { type: 'range', value: config.radius, min: 80, max: 200, live: true, onChange: v => { config.radius = v; config.cancelDistance = Math.max(config.cancelDistance, v + 40); save(); } });
      for (const [title, key, min, max] of [['独立尺寸 · %', 'scale', 70, 130], ['中心留白 · %', 'innerRatio', 25, 65], ['扇区间隙 · °', 'gap', 0, 16], ['起始旋转 · °', 'rotation', -180, 180], ['文字大小 · px', 'fontSize', 10, 20], ['背景不透明度 · %', 'opacity', 45, 100], ['选中光晕 · px', 'glow', 0, 30]]) styleField(geometry, title, key, { type: 'range', min, max, live: true });
      styleField(geometry, '显示图标', 'showIcons', { type: 'checkbox' }); styleField(geometry, '显示标签', 'showLabels', { type: 'checkbox' });
      const centerInput = styleField(geometry, '中心核符号', 'centerSymbol', { type: 'text', hint: '仅文本符号，不加载图片或外部字体。' }); centerInput.maxLength = 6;
      button(geometry, '重置当前外观', () => { if (menu.id === 'main') { config.appearance = defaultRadialAppearance(); menu.appearance = null; } else menu.appearance = defaultRadialAppearance(); save(); renderAppearance(); });
    }

    const actionPage = page('actions', '扇区与动作', '先点选画布上的方向，再编辑其标签、图标和动作。子轮盘是独立内容，不是重复的一组按钮。');
    const actionLayout = element('div', 'stcj-config-layout'); actionPage.append(actionLayout);
    const editor = element('div', 'stcj-config-controls'); actionLayout.append(editor); preview(actionLayout);
    const actions = dependencies.listShortcutActions();
    function renderEditor() {
      editor.replaceChildren(); const menu = currentMenu();
      if (slotIndex >= menu.items.length) slotIndex = menu.items.length - 1;
      const profile = card(editor, '当前配置轮盘'); menuPicker(profile);
      field(profile, '轮盘名称', { value: menu.label, onChange: v => { menu.label = v || '未命名轮盘'; save(); renderEditor(); renderAppearance(); } });
      const profileTools = element('div', 'stcj-editor-tools'); profile.append(profileTools);
      const addMenu = button(profileTools, '+ 二级轮盘', () => { let n = 1; while (config.menus.some(m => m.id === `child-${n}`)) n++; const id = `child-${n}`; config.menus.push({ id, label: `子轮盘 ${n}`, appearance: null, items: [] }); save(); selectMenu(id); }); addMenu.disabled = config.menus.length >= 17;
      if (menu.id !== 'main') button(profileTools, '删除此子轮盘', () => { config.menus = config.menus.filter(m => m.id !== menu.id); for (const m of config.menus) for (const item of m.items) if (item.submenu === menu.id) delete item.submenu; menuId = 'main'; slotIndex = 0; save(); renderEditor(); renderAppearance(); });
      const count = card(editor, '扇区方向数量', '从上方开始顺时针排列。调整数量保留已有内容；缩减后可立即撤销。');
      const countTools = element('div', 'stcj-editor-tools'); count.append(countTools);
      for (const n of [4, 8, 12]) button(countTools, `${n} 方位`, () => { undo.set(menu.id, copy(menu.items)); menu.items = Array.from({ length: n }, (_, i) => menu.items[i] || { label: `扇区 ${i + 1}` }); slotIndex = 0; save(); renderEditor(); });
      button(countTools, '撤销数量调整', () => { if (!undo.has(menu.id)) return; menu.items = undo.get(menu.id); undo.delete(menu.id); slotIndex = 0; save(); renderEditor(); }).disabled = !undo.has(menu.id);
      const slots = element('div', 'stcj-slot-grid'); count.append(slots);
      menu.items.forEach((item, i) => { const b = button(slots, `${i + 1} · ${item.label}`, () => { slotIndex = i; renderEditor(); renderPreviews(); }, i === slotIndex ? 'is-active' : ''); b.title = item.label; });
      button(count, '+ 添加扇区（最多 12）', () => { menu.items.push({ label: `扇区 ${menu.items.length + 1}` }); slotIndex = menu.items.length - 1; save(); renderEditor(); }).disabled = menu.items.length >= 12;
      const item = menu.items[slotIndex];
      if (!item) { card(editor, '选择一个扇区', '点击画布或上方编号按钮，开始配置内容。'); return; }
      const inspector = card(editor, `扇区 ${slotIndex + 1} · 内容与动作`); inspector.dataset.slotInspector = 'true';
      field(inspector, '显示标签', { value: item.label, aria: `扇区 ${slotIndex + 1} 标签`, onChange: v => { item.label = v || '未设置'; save(); renderEditor(); } });
      const icons = [['', '自动图标'], ['↑', '↑ 上'], ['↓', '↓ 下'], ['✎', '✎ 编辑'], ['◇', '◇ 收藏'], ['▦', '▦ 菜单'], ['#', '# 楼层'], ['↺', '↺ 恢复'], ['·', '· 简洁']];
      if (item.icon && !icons.some(i => i[0] === item.icon)) icons.push([item.icon, item.icon]);
      field(inspector, '图标符号', { value: item.icon || '', choices: icons, onChange: v => { if (v) item.icon = v; else delete item.icon; save(); } });
      const iconInput = field(inspector, '自定义图标文字', { value: item.icon || '', hint: '最多 4 个字符；不接受图片地址或脚本。', onChange: v => { item.icon = [...v].slice(0, 4).join(''); save(); } }); iconInput.maxLength = 8;
      field(inspector, '独立文字颜色', { type: 'checkbox', value: !!item.color, onChange: v => { if (v) item.color = appearance().text; else delete item.color; save(); renderEditor(); } });
      if (item.color) field(inspector, '扇区文字颜色', { type: 'color', value: item.color, live: true, onChange: v => { item.color = v; save(); } });
      field(inspector, '动作类型', { value: item.submenu ? 'submenu' : item.action ? 'action' : 'empty', choices: [['empty', '空扇区 / 取消'], ['action', '插件动作'], ...(menu.id === 'main' ? [['submenu', '打开二级轮盘']] : [])], onChange: v => { delete item.action; delete item.submenu; if (v === 'action') item.action = { type: actions[0].type, id: actions[0].id }; if (v === 'submenu') { const child = config.menus.find(m => m.id !== 'main'); if (child) item.submenu = child.id; else { const id = 'child-1'; config.menus.push({ id, label: '子轮盘 1', appearance: null, items: [] }); item.submenu = id; } } save(); renderEditor(); } });
      if (item.action) {
        const choices = actions.map(a => [`${a.type}:${a.id}`, a.label]); const selected = `${item.action.type}:${item.action.id}`;
        if (!choices.some(c => c[0] === selected)) choices.push([selected, '未注册扩展动作（保留，不能执行）']);
        field(inspector, '执行动作', { value: selected, choices, aria: `扇区 ${slotIndex + 1} 动作`, onChange: v => { const [type, ...id] = v.split(':'); item.action = { type, id: id.join(':') }; save(); } });
      }
      if (item.submenu) {
        field(inspector, '目标二级轮盘', { value: item.submenu, choices: config.menus.filter(m => m.id !== 'main').map(m => [m.id, m.label]), onChange: v => { item.submenu = v; save(); } });
        button(inspector, '编辑这个二级轮盘 ›', () => selectMenu(item.submenu));
      }
      const tools = element('div', 'stcj-editor-tools'); inspector.append(tools);
      for (const [text, direction] of [['↑ 上移', -1], ['↓ 下移', 1]]) button(tools, text, () => { const next = slotIndex + direction; [menu.items[slotIndex], menu.items[next]] = [menu.items[next], item]; slotIndex = next; save(); renderEditor(); }).disabled = slotIndex + direction < 0 || slotIndex + direction >= menu.items.length;
      button(tools, '删除扇区', () => { menu.items.splice(slotIndex, 1); slotIndex = Math.min(slotIndex, menu.items.length - 1); save(); renderEditor(); });
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
        button(row, '应用', () => { config.menus = copy(scheme.menus); undo.clear(); config.appearance = copy(scheme.appearance); config.radius = scheme.radius; config.cancelDistance = Math.max(config.cancelDistance, config.radius + 40); menuId = 'main'; slotIndex = 0; save('已应用方案，触发开关保持不变'); renderEditor(); renderAppearance(); });
        button(row, '删除', () => { config.schemes = config.schemes.filter(s => s.id !== scheme.id); save(); renderSchemes(); }); schemeList.append(row);
      });
    }
    const backup = card(schemePage, '配置 JSON', '仅包含本插件轮盘配置，不包含聊天、API 或宿主设置。文本不会作为代码运行。');
    const json = element('textarea', 'stcj-config-json'); json.rows = 8; json.setAttribute('aria-label', '轮盘配置 JSON'); json.spellcheck = false; backup.append(json);
    const backupTools = element('div', 'stcj-editor-tools'); backup.append(backupTools);
    button(backupTools, '生成可复制 JSON', () => { json.value = JSON.stringify(normalizeRadialConfig(config), null, 2); json.focus(); json.select(); });
    let includeTriggers = false; field(backup, '导入时包含触发设置', { type: 'checkbox', value: false, hint: '默认保留现有启用状态、快捷键、鼠标和触屏设置。', onChange: v => { includeTriggers = v; } });
    button(backupTools, '导入 JSON', () => {
      try {
        if (json.value.length > 1000000) throw new Error('配置超过100万字符上限'); const raw = JSON.parse(json.value); if (!raw || !Array.isArray(raw.menus) || (raw.version && raw.version > 2)) throw new Error('请提供支持的 v1 / v2 轮盘配置');
        const next = normalizeRadialConfig(raw);
        for (const key of includeTriggers ? Object.keys(next) : ['menus', 'appearance', 'radius', 'schemes', 'panelTheme']) config[key] = next[key];
        config.cancelDistance = Math.max(config.cancelDistance, config.radius + 40); undo.clear(); menuId = 'main'; slotIndex = 0;
        triggerFields.forEach(([input, key]) => { if (input.type === 'checkbox') input.checked = config[key]; else input.value = config[key]; });
        if (dialog) dialog.dataset.panelTheme = config.panelTheme; save('配置已校验并导入'); renderEditor(); renderAppearance(); renderSchemes();
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
    if (!status.parentNode) container.append(status); renderEditor(); renderAppearance(); renderSchemes(); renderPreviews();
    if (window.ResizeObserver) { const observer = new ResizeObserver(renderPreviews); previews.forEach(p => observer.observe(p.canvas)); detachObserver = () => observer.disconnect(); }
  }
  return { mountRadialSettings, destroyRadialSettings };
}
