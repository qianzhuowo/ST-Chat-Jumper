import { ICONS } from './constants.js';

// Trusted vector icon library for radial cells. Path data uses the same single-path,
// 24×24 filled format as StarPie's SvgData so users can also paste their own path.
// Library ids: `lib:<name>` (filled paths below) and `tb:<ICONS key>` (the floating
// toolbar's own icons). Nothing here accepts markup from configuration.
export const ICON_PATHS = Object.freeze({
  star: ['星标', 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z'],
  heart: ['爱心', 'M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z'],
  bookmark: ['书签', 'M17,3H7A2,2 0 0,0 5,5V21L12,18L19,21V5C19,3.89 18.1,3 17,3Z'],
  folder: ['文件夹', 'M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z'],
  search: ['搜索', 'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z'],
  tune: ['调节', 'M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z'],
  refresh: ['刷新', 'M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z'],
  bolt: ['闪电', 'M11,15H6L13,1V9H18L11,23V15Z'],
  chat: ['对话', 'M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2Z'],
  copy: ['复制', 'M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z'],
  clipboard: ['剪贴板', 'M19,3H14.82C14.4,1.84 13.3,1 12,1C10.7,1 9.6,1.84 9.18,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M12,3A1,1 0 0,1 13,4A1,1 0 0,1 12,5A1,1 0 0,1 11,4A1,1 0 0,1 12,3Z'],
  undo: ['撤销', 'M12.5,8C9.85,8 7.45,8.97 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z'],
  redo: ['重做', 'M18.4,10.6C16.55,8.97 14.15,8 11.5,8C6.85,8 2.92,11.03 1.53,15.22L3.9,16C4.95,12.81 7.96,10.5 11.5,10.5C13.46,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z'],
  play: ['播放', 'M8,5.14V19.14L19,12.14L8,5.14Z'],
  pause: ['暂停', 'M14,19H18V5H14M6,19H10V5H6V19Z'],
  upload: ['上传', 'M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z'],
  download: ['下载', 'M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z'],
  eye: ['眼睛', 'M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z'],
  lock: ['锁', 'M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z'],
  trash: ['垃圾桶', 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z'],
  plus: ['加号', 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z'],
  minus: ['减号', 'M19,13H5V11H19V13Z'],
  check: ['对勾', 'M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z'],
  close: ['叉号', 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z'],
  home: ['主页', 'M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z'],
  tag: ['标签', 'M5.5,7A1.5,1.5 0 0,1 4,5.5A1.5,1.5 0 0,1 5.5,4A1.5,1.5 0 0,1 7,5.5A1.5,1.5 0 0,1 5.5,7M21.41,11.58L12.41,2.58C12.05,2.22 11.55,2 11,2H4C2.89,2 2,2.89 2,4V11C2,11.55 2.22,12.05 2.59,12.41L11.58,21.41C11.95,21.77 12.45,22 13,22C13.55,22 14.05,21.77 14.41,21.41L21.41,14.41C21.78,14.05 22,13.55 22,13C22,12.44 21.77,11.94 21.41,11.58Z'],
  flag: ['旗帜', 'M14.4,6L14,4H5V21H7V14H12.6L13,16H20V6H14.4Z'],
  clock: ['时钟', 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M16.2,16.2L11,13V7H12.5V12.2L17,14.9L16.2,16.2Z'],
  bulb: ['灯泡', 'M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z'],
  wand: ['魔杖', 'M7.5,5.6L5,7L6.4,4.5L5,2L7.5,3.4L10,2L8.6,4.5L10,7L7.5,5.6M19.5,15.4L22,14L20.6,16.5L22,19L19.5,17.6L17,19L18.4,16.5L17,14L19.5,15.4M22,2L20.6,4.5L22,7L19.5,5.6L17,7L18.4,4.5L17,2L19.5,3.4L22,2M13.34,12.78L15.78,10.34L13.66,8.22L11.22,10.66L13.34,12.78M14.37,7.29L16.71,9.63C17.1,10 17.1,10.65 16.71,11.04L5.04,22.71C4.65,23.1 4,23.1 3.63,22.71L1.29,20.37C0.9,20 0.9,19.35 1.29,18.96L12.96,7.29C13.35,6.9 14,6.9 14.37,7.29Z'],
  grid: ['网格', 'M3,3H11V11H3Z M13,3H21V11H13Z M3,13H11V21H3Z M13,13H21V21H13Z'],
  save: ['保存', 'M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z'],
  send: ['发送', 'M2,21L23,12L2,3V10L17,12L2,14V21Z'],
  user: ['用户', 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z'],
  image: ['图片', 'M8.5,13.5L11,16.5L14.5,12L19,18H5M21,19V5C21,3.89 20.1,3 19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19Z'],
  music: ['音乐', 'M12,3V13.55C11.41,13.21 10.73,13 10,13A4,4 0 0,0 6,17A4,4 0 0,0 10,21A4,4 0 0,0 14,17V7H18V3H12Z'],
});
// Toolbar icons offered in the picker (parameterised `num` is excluded).
const TOOLBAR_ICON_LABELS = Object.freeze({
  chevronUp: '上箭头', chevronDown: '下箭头', chevronLeft: '左箭头', chevronRight: '右箭头', fastBackward: '快退', fastForward: '快进',
  head: '头部', tail: '尾部', pin: '定位', folder: '收藏夹', pencil: '铅笔', trash: '删除', range: '区间', restore: '恢复',
  note: '便签', minus: '收起', horizontal: '横向', vertical: '纵向', eyeOff: '隐藏', more: '更多', check: '完成', warning: '警告', arrowUpRight: '外链',
});

export const ICON_PATH_MAX = 4000;
// Only SVG path commands, numbers, separators and exponents; no quotes, brackets or `url(`.
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;
export function sanitizeIconPath(value) {
  if (typeof value !== 'string') return '';
  const d = value.trim().replace(/\s+/g, ' ');
  return d && d.length <= ICON_PATH_MAX && PATH_RE.test(d) && /^[Mm]/.test(d) ? d : '';
}
export function listIconChoices() {
  const lib = Object.entries(ICON_PATHS).map(([id, [label]]) => ({ id: `lib:${id}`, label, group: '通用' }));
  const tb = Object.entries(TOOLBAR_ICON_LABELS).filter(([id]) => typeof ICONS[id] === 'string').map(([id, label]) => ({ id: `tb:${id}`, label, group: '插件' }));
  return [...tb, ...lib];
}
export function isIconId(id) {
  if (typeof id !== 'string') return false;
  const [kind, name] = id.split(':');
  if (kind === 'lib') return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
  if (kind === 'tb') return Object.prototype.hasOwnProperty.call(TOOLBAR_ICON_LABELS, name) && typeof ICONS[name] === 'string';
  return false;
}
// Resolves a cell icon to either trusted toolbar markup or a validated path string.
export function resolveIconSource(item) {
  const path = sanitizeIconPath(item?.iconPath);
  if (path) return { path };
  if (isIconId(item?.iconId)) {
    const [kind, name] = item.iconId.split(':');
    return kind === 'lib' ? { path: ICON_PATHS[name][1] } : { markup: ICONS[name] };
  }
  return null;
}
