import { normalizeRadialAppearance } from './radial-config.js';

export const requiredServices = [];
// Original browser renderer. Geometry is standard polar math, not a port of an upstream renderer.
export function sectorGeometry(index, count, radius, innerRadius, gap = 3, rotation = 0) {
  if (!Number.isFinite(count) || count < 1) return { path: '', polygon: '', angle: 0 };
  const step = 360 / count, space = Math.min(gap, step * .45);
  const start = -90 + rotation + (index - .5) * step + space / 2;
  const end = start + Math.min(359.95, step - space);
  const point = (angle, r) => { const a = angle * Math.PI / 180; return [radius + Math.cos(a) * r, radius + Math.sin(a) * r]; };
  const [a, b, c, d] = [point(start, radius - 2), point(end, radius - 2), point(end, innerRadius), point(start, innerRadius)];
  const large = end - start > 180 ? 1 : 0;
  const path = `M ${a.join(' ')} A ${radius - 2} ${radius - 2} 0 ${large} 1 ${b.join(' ')} L ${c.join(' ')} A ${innerRadius} ${innerRadius} 0 ${large} 0 ${d.join(' ')} Z`;
  const points = [], samples = Math.max(5, Math.ceil((end - start) / 5));
  for (let i = 0; i <= samples; i++) points.push(point(start + (end - start) * i / samples, radius));
  for (let i = samples; i >= 0; i--) points.push(point(start + (end - start) * i / samples, innerRadius));
  return { path, polygon: points.map(p => p.map(n => `${(n / radius * 50).toFixed(3)}%`).join(' ')).join(','), angle: -90 + rotation + index * step };
}
export function resolveWheelAppearance(config, menu, radius) {
  const appearance = normalizeRadialAppearance(menu.appearance || config.appearance);
  // The visible inner arc and the actual cancel zone must agree even at tiny scales.
  appearance.innerRatio = Math.max(appearance.innerRatio, Math.min(65, Math.round((Number(config.deadZone) || 0) / Math.max(1, radius) * 100)));
  return appearance;
}
const symbols = { prev: '↑', next: '↓', recent1: '⇥', recent2: 'Ⅱ', recent3: 'Ⅲ', quickEdit: '✎', quickDelete: '×', quickPage: '›', quickPageLeft: '‹', showRange: '#', togglePin: '◇', toggleFavPanel: '▤', openFavoritesManager: '▦', currentHead: '↥', currentTail: '↧', toggleCollapse: '−', toggleOrientation: '↔', rangePrev: '‹', rangeNext: '›', resetRange: '↺' };
export function shortcutSymbol(item) { return item.icon || (item.submenu ? '▦' : symbols[item.action?.id] || '·'); }
export function createFeature() {
  function createRadialView({ menu, appearance, radius, onChoose, onCenter, onHover, selected = -1, preview = false }) {
    const a = normalizeRadialAppearance(appearance);
    const ring = document.createElement('div'); ring.className = `stcj-radial-ring stcj-wheel-${a.shape}${preview ? ' stcj-wheel-preview' : ''}`;
    ring.style.width = ring.style.height = `${radius * 2}px`;
    ring.setAttribute('role', 'menu'); ring.setAttribute('aria-label', menu.label);
    const variables = { surface: a.surface, highlight: a.highlight, text: a.text, border: a.border, accent: a.accent, center: a.center, glow: `${a.glow}px`, opacity: a.opacity / 100, font: `${a.fontSize}px` };
    for (const [key, value] of Object.entries(variables)) ring.style.setProperty(`--wheel-${key}`, value);
    const inner = radius * a.innerRatio / 100;
    const buttons = menu.items.map((item, index) => {
      const geometry = sectorGeometry(index, menu.items.length, radius, inner, a.shape === 'solid' ? 0 : a.gap + (a.shape === 'petals' ? 4 : 0), a.rotation);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'stcj-radial-item'; button.title = item.label;
      button.setAttribute('role', 'menuitem'); button.setAttribute('aria-label', `${index + 1}. ${item.label}${item.submenu ? '，子轮盘' : ''}`);
      button.dataset.index = index; button.style.clipPath = `polygon(${geometry.polygon})`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${radius * 2} ${radius * 2}`); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', geometry.path); svg.append(path); button.append(svg);
      const content = document.createElement('span'); content.className = 'stcj-sector-content';
      const distance = (radius + inner) / 2, angle = geometry.angle * Math.PI / 180;
      content.style.left = `${radius + Math.cos(angle) * distance}px`; content.style.top = `${radius + Math.sin(angle) * distance}px`;
      content.style.width = `${Math.max(28, Math.min(radius * .66, 2 * Math.PI * distance / Math.max(1, menu.items.length) * .73))}px`;
      if (item.color) content.style.color = item.color;
      if (a.showIcons) { const icon = document.createElement('span'); icon.className = 'stcj-sector-icon'; icon.textContent = shortcutSymbol(item); content.append(icon); }
      if (a.showLabels) { const label = document.createElement('span'); label.className = 'stcj-sector-label'; label.textContent = item.label; content.append(label); }
      if (item.submenu) { const arrow = document.createElement('span'); arrow.className = 'stcj-sector-child'; arrow.textContent = '›'; content.append(arrow); }
      button.append(content); button.addEventListener('click', event => { event.stopPropagation(); onChoose?.(index); });
      if (onHover) button.addEventListener('pointerenter', () => onHover(index));
      ring.append(button); return button;
    });
    const center = document.createElement('button'); center.type = 'button'; center.className = 'stcj-radial-center';
    center.style.width = center.style.height = `${Math.min(radius * .57, inner * 1.5)}px`;
    center.setAttribute('aria-label', menu.id === 'main' ? '取消轮盘' : '返回主轮盘');
    const symbol = document.createElement('span'); symbol.className = 'stcj-center-symbol'; symbol.textContent = menu.id === 'main' ? a.centerSymbol : '↶';
    const caption = document.createElement('small'); caption.textContent = menu.id === 'main' ? '取消' : '返回'; center.append(symbol, caption);
    center.addEventListener('click', event => { event.stopPropagation(); onCenter?.(); }); ring.append(center);
    function setSelected(index) { buttons.forEach((button, i) => { button.classList.toggle('is-selected', i === index); button.setAttribute('aria-current', i === index ? 'true' : 'false'); }); }
    setSelected(selected);
    return { element: ring, buttons, center, setSelected };
  }
  return { createRadialView };
}
