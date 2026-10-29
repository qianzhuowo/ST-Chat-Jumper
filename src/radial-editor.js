// Pure v3 editing operations. No host access, migration, or implicit cleanup.
export const PRIMARY_COUNTS = [4, 8, 12];
const copy = value => JSON.parse(JSON.stringify(value));
export function selectedChild(config, index) {
  const parent = config.menus.find(m => m.id === 'main')?.items[index];
  return config.menus.find(m => m.id !== 'main' && m.id === parent?.submenu) || null;
}
export function archivedChildren(config) {
  const used = new Set(config.menus.find(m => m.id === 'main')?.items.map(i => i.submenu));
  return config.menus.filter(m => m.id !== 'main' && !used.has(m.id));
}
function nextId(config) {
  if (config.menus.length >= 17) throw new Error('子动作组已达上限，请先复用归档子动作；未修改配置。');
  let n = 1; while (config.menus.some(m => m.id === `child-${n}`)) n++;
  return `child-${n}`;
}
export const blankCell = () => ({ label: '未设置', showLabel: false });
// Clears a sector's own content. A parent keeps its secondary group; clearing never touches it.
export function clearCell(item) {
  for (const key of Object.keys(item)) if (key !== 'submenu') delete item[key];
  Object.assign(item, blankCell());
}
export function ownChild(config, index) {
  const main = config.menus.find(m => m.id === 'main'), parent = main?.items[index];
  if (!parent) throw new Error('请先选择一级格子');
  let child = selectedChild(config, index);
  if (!child) throw new Error('该格子还没有二级动作');
  if (main.items.filter(i => i.submenu === child.id).length > 1) {
    child = { ...copy(child), id: nextId(config) };
    config.menus.push(child); parent.submenu = child.id;
  }
  return child;
}
export function addChild(config, index, archiveId = null) {
  const parent = config.menus.find(m => m.id === 'main')?.items[index];
  if (!parent) throw new Error('请先选择一级格子');
  let child = selectedChild(config, index);
  if (child) {
    if (child.items.length >= 12) throw new Error('最多 12 个二级动作');
    child = ownChild(config, index);
    child.items.push(blankCell());
    return child;
  }
  const archived = archiveId && archivedChildren(config).find(m => m.id === archiveId);
  if (archiveId && !archived) throw new Error('归档子动作不可用');
  // The parent keeps its own content in place; a new group starts with one blank child sector.
  child = archived || { id: nextId(config), label: '二级动作', appearance: null, items: [blankCell()] };
  if (!archived) config.menus.push(child);
  parent.submenu = child.id;
  return child;
}
// Deletes one child sector. Deleting the last one also unlinks the parent and drops the empty group.
export function removeChild(config, index, subIndex) {
  const child = ownChild(config, index);
  child.items.splice(subIndex, 1);
  if (child.items.length) return child;
  delete config.menus.find(m => m.id === 'main').items[index].submenu;
  config.menus = config.menus.filter(m => m !== child);
  return null;
}
// One sector's content is everything but its secondary binding, which always stays with the position.
function replaceContent(item, next) {
  const binding = item.submenu;
  for (const key of Object.keys(item)) delete item[key];
  Object.assign(item, next);
  if (binding) item.submenu = binding;
}
const contentOf = item => { const { submenu, ...rest } = copy(item); return rest; };
// Swaps two canvas cells. A cell is { tier: 'main' | 'sub', index, parent } (parent: main index owning a sub cell).
// Parents swapped with link on carry their secondary group; every other swap exchanges content only.
export function swapCells(config, from, to, link = true) {
  const main = config.menus.find(m => m.id === 'main');
  const menuOf = cell => cell.tier === 'sub' ? ownChild(config, cell.parent) : main;
  const fromMenu = menuOf(from), toMenu = menuOf(to);
  const a = fromMenu.items[from.index], b = toMenu.items[to.index];
  if (!a || !b || a === b) return false;
  if (fromMenu === toMenu && (from.tier === 'sub' || link)) return swapSlots(fromMenu.items, from.index, to.index);
  const next = contentOf(b); replaceContent(b, contentOf(a)); replaceContent(a, next);
  return true;
}
export function resizePrimary(config, count) {
  if (!PRIMARY_COUNTS.includes(count)) throw new Error('仅支持 4、8、12 方位');
  const main = config.menus.find(m => m.id === 'main');
  main.items = Array.from({ length: count }, (_, i) => main.items[i] || { label: `动作 ${i + 1}` });
  // Removed parents' child groups remain archived for explicit reuse and undo.
}
export function swapSlots(items, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return false;
  [items[from], items[to]] = [items[to], items[from]];
  return true;
}
export function affectedByShrink(config, count) {
  const main = config.menus.find(m => m.id === 'main');
  return main.items.slice(count).map((item, i) => {
    const child = selectedChild(config, count + i);
    return `第 ${count + i + 1} 格「${item.label}」${child ? `（${child.items.length} 个子动作保留在归档）` : item.action ? '（执行动作）' : '（空动作）'}`;
  });
}
