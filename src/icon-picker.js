import { listIconChoices, getUserIcons, iconLabel, svgTextToIcon } from './icon-library.js';
import { newIconId, ICON_LIBRARY_LIMIT } from './icon-store.js';
import { createSectorIcon } from './radial-view.js';

// StarPie-style "选择扇区动作矢量图标" window: search, import, clear, grouped preview grid,
// selected name and confirm/cancel. It lives inside the settings <dialog> so it shares
// the top layer and theme variables; it never executes or stores markup from files.
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const btn = (parent, text, handler, className = 'stcj-mini-btn') => { const b = el('button', className, text); b.type = 'button'; b.addEventListener('click', handler); parent.append(b); return b; };

export function openIconPicker({ host, current = '', appearance = {}, title = '选择扇区动作矢量图标', followLabel = '跟随动作（默认）', iconUsage = () => 0, saveIcons, onApply, onIconDeleted }) {
  const root = host || document.body;
  const previousFocus = document.activeElement;
  let selected = current || '', query = '', confirmDelete = false;
  // A nested modal <dialog> sits in the browser top layer: centred on the viewport and never clipped by the settings window.
  const backdrop = el('dialog', 'stcj-icon-picker-backdrop');
  const dialog = el('div', 'stcj-icon-picker');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'stcj-icon-picker-title');
  backdrop.append(dialog);
  const head = el('div', 'stcj-icon-picker-head');
  const heading = el('h3', '', title); heading.id = 'stcj-icon-picker-title';
  head.append(heading, el('p', 'stcj-settings-note', '矢量图形，任意尺寸清晰显示。可导入本地 SVG 或粘贴路径，自定义图标单独保存在酒馆用户文件中。'));
  const tools = el('div', 'stcj-icon-picker-tools');
  const search = el('input', 'stcj-icon-picker-search'); search.type = 'search'; search.placeholder = '输入图标名称快速过滤…'; search.setAttribute('aria-label', '搜索图标');
  const file = el('input'); file.type = 'file'; file.accept = '.svg,image/svg+xml'; file.multiple = true; file.hidden = true;
  tools.append(search, file);
  btn(tools, '➕ 导入 SVG 文件…', () => file.click());
  const pasteToggle = btn(tools, '粘贴路径…', () => { paste.hidden = !paste.hidden; pasteToggle.setAttribute('aria-expanded', String(!paste.hidden)); if (!paste.hidden) pasteText.focus(); });
  pasteToggle.setAttribute('aria-expanded', 'false');
  btn(tools, followLabel, () => select(''));
  const paste = el('div', 'stcj-icon-picker-paste'); paste.hidden = true;
  const pasteText = el('textarea'); pasteText.rows = 3; pasteText.spellcheck = false; pasteText.placeholder = '粘贴 24×24 的 path d 数据，或完整 <svg>…</svg> 文本'; pasteText.setAttribute('aria-label', '粘贴路径或 SVG');
  const pasteName = el('input'); pasteName.type = 'text'; pasteName.maxLength = 40; pasteName.placeholder = '图标名称'; pasteName.setAttribute('aria-label', '新图标名称');
  paste.append(pasteText, pasteName);
  btn(paste, '添加到我的图标', () => addDrafts([{ text: pasteText.value, name: pasteName.value.trim() || '自定义图标' }]).then(ok => { if (ok) { pasteText.value = ''; pasteName.value = ''; } }));
  const message = el('p', 'stcj-icon-picker-msg'); message.setAttribute('role', 'status');
  const grid = el('div', 'stcj-icon-picker-grid');
  const footer = el('div', 'stcj-icon-picker-footer');
  dialog.append(head, tools, paste, message, grid, footer);

  const swatch = node => { node.style.background = appearance.surface || ''; node.style.color = appearance.text || ''; node.style.borderColor = appearance.border || ''; };
  function tile(choice) {
    const b = el('button', `stcj-icon-tile${choice.id === selected ? ' is-selected' : ''}`);
    b.type = 'button'; b.dataset.iconId = choice.id; b.title = choice.label; b.setAttribute('aria-pressed', String(choice.id === selected));
    const preview = el('span', 'stcj-icon-tile-preview'); swatch(preview);
    const icon = createSectorIcon({ iconId: choice.id }); if (icon) preview.append(icon);
    b.append(preview, el('span', 'stcj-icon-tile-name', choice.label));
    b.addEventListener('click', () => select(choice.id));
    b.addEventListener('dblclick', () => { select(choice.id); apply(); });
    return b;
  }
  // Selection only toggles state classes, so the grid never re-flows or scrolls.
  function select(id) {
    selected = id; confirmDelete = false;
    grid.querySelectorAll('.stcj-icon-tile').forEach(t => { const on = t.dataset.iconId === id; t.classList.toggle('is-selected', on); t.setAttribute('aria-pressed', String(on)); });
    renderFooter();
  }
  function renderGrid() {
    const scroll = grid.scrollTop;
    grid.replaceChildren();
    const q = query.trim().toLowerCase();
    const choices = listIconChoices().filter(c => !q || c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    const groups = new Map(); for (const c of choices) { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); }
    if (!groups.has('我的图标') && !q) groups.set('我的图标', []);
    for (const name of ['我的图标', '插件', '通用']) {
      const list = groups.get(name); if (!list) continue;
      const section = el('section', 'stcj-icon-group'); section.append(el('h4', '', `${name}${name === '我的图标' ? `（${getUserIcons().length}/${ICON_LIBRARY_LIMIT}）` : ''}`));
      const wrap = el('div', 'stcj-icon-group-grid');
      if (!list.length) wrap.append(el('p', 'stcj-settings-note', name === '我的图标' ? '还没有自定义图标。导入 SVG 文件或粘贴路径即可添加。' : '没有匹配的图标。'));
      list.forEach(c => wrap.append(tile(c)));
      section.append(wrap); grid.append(section);
    }
    if (!choices.length && q) grid.append(el('p', 'stcj-settings-note', `没有名称包含「${query}」的图标。`));
    grid.scrollTop = scroll;
  }
  function renderFooter() {
    footer.replaceChildren();
    const info = el('div', 'stcj-icon-picker-selected');
    const preview = el('span', 'stcj-icon-tile-preview is-small'); swatch(preview);
    const icon = selected ? createSectorIcon({ iconId: selected }) : null; if (icon) preview.append(icon);
    info.append(preview, el('span', '', '已选图标：'), el('strong', '', selected ? (iconLabel(selected) || selected) : followLabel));
    footer.append(info);
    const userIcon = selected.startsWith('user:') ? getUserIcons().find(i => `user:${i.id}` === selected) : null;
    // The manage slot always occupies space (hidden when unused) so the footer height never changes.
    const manage = el('div', 'stcj-icon-picker-manage'); footer.append(manage);
    if (!userIcon) manage.classList.add('is-empty');
    if (userIcon) {
      const name = el('input'); name.type = 'text'; name.maxLength = 40; name.value = userIcon.name; name.setAttribute('aria-label', '自定义图标名称');
      manage.append(name);
      btn(manage, '保存名称', () => persist(getUserIcons().map(i => i.id === userIcon.id ? { ...i, name: name.value.trim() || i.name } : i), '已重命名'));
      const uses = iconUsage(selected);
      btn(manage, confirmDelete ? `确认删除${uses ? `（${uses} 处改回默认）` : ''}` : '删除', async () => {
        if (!confirmDelete) { confirmDelete = true; renderFooter(); return; }
        const id = selected;
        if (await persist(getUserIcons().filter(i => i.id !== userIcon.id), '已删除自定义图标')) { onIconDeleted?.(id); selected = ''; confirmDelete = false; renderGrid(); renderFooter(); }
      }, `stcj-mini-btn${confirmDelete ? ' is-danger' : ''}`);
    }
    const actions = el('div', 'stcj-icon-picker-actions');
    btn(actions, '确定应用', apply, 'stcj-mini-btn is-primary');
    btn(actions, '取消', close);
    footer.append(actions);
  }
  async function persist(list, okText) {
    if (!saveIcons) { message.textContent = '图标文件服务不可用；未修改'; return false; }
    message.textContent = '正在保存图标文件…';
    try { await saveIcons(list); message.textContent = okText; return true; }
    catch (error) { message.textContent = `${error.message || error}；未修改`; return false; }
  }
  async function addDrafts(drafts) {
    const list = getUserIcons().slice(), added = [], notes = [];
    for (const { text, name } of drafts) {
      try {
        const { icon, warnings } = svgTextToIcon(text, new DOMParser(), name);
        if (list.length >= ICON_LIBRARY_LIMIT) throw new Error(`最多 ${ICON_LIBRARY_LIMIT} 个自定义图标`);
        const entry = { ...icon, id: newIconId(list) }; list.push(entry); added.push(entry);
        notes.push(...warnings.map(w => `${name}：${w}`));
      } catch (error) { notes.push(`${name}：${error.message || error}`); }
    }
    if (!added.length) { message.textContent = notes.join('；') || '没有可导入的图标'; return false; }
    if (!await persist(list, `已导入 ${added.length} 个图标${notes.length ? '；' + notes.join('；') : ''}`)) return false;
    selected = `user:${added.at(-1).id}`; confirmDelete = false; renderGrid(); renderFooter();
    return true;
  }
  file.addEventListener('change', async () => {
    const files = [...file.files].slice(0, 20); file.value = '';
    const drafts = await Promise.all(files.map(async f => ({ text: f.size > 300000 ? '' : await f.text(), name: f.name.replace(/\.svg$/i, '').slice(0, 40) || '自定义图标' })));
    await addDrafts(drafts);
  });
  search.addEventListener('input', () => { query = search.value; renderGrid(); });
  function apply() { onApply?.(selected); close(); }
  // Esc closes only this picker (its own cancel event), never the settings dialog.
  backdrop.addEventListener('cancel', e => { e.preventDefault(); close(); });
  function close() {
    if (!backdrop.isConnected) return;
    if (backdrop.open) backdrop.close();
    backdrop.remove();
    previousFocus?.focus?.({ preventScroll: true });
  }
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { // Keep focus inside the picker.
      const items = [...dialog.querySelectorAll('button,input,textarea')].filter(n => !n.disabled && n.offsetParent !== null);
      if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    }
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  grid.style.setProperty('--tile-accent', appearance.accent || '');
  renderGrid(); renderFooter(); root.append(backdrop);
  if (typeof backdrop.showModal === 'function') backdrop.showModal(); else backdrop.setAttribute('open', '');
  search.focus();
  return { close, element: backdrop };
}
