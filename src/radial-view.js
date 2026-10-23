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
  const appearance = normalizeRadialAppearance(menu?.appearance || config.appearance);
  // The visible inner arc and the actual cancel zone must agree even at tiny scales.
  appearance.innerRatio = Math.max(appearance.innerRatio, Math.min(65, Math.round((Number(config.deadZone) || 0) / Math.max(1, radius) * 100)));
  return appearance;
}
export function resolveSubringBounds(radius, innerRadius, subAppearance, preview = false) {
  const gapPx = preview ? 5 : 7;
  const subScale = (Number(subAppearance?.scale) || 100) / 100;
  const primaryBand = Math.max(20, radius - innerRadius);
  const rawBand = Math.round(primaryBand * (preview ? 0.68 : 0.82) * subScale);
  const subInner = Math.round(radius + gapPx);
  const subOuter = preview
    ? Math.max(subInner + 28, Math.min(164, subInner + rawBand))
    : Math.max(subInner + 36, subInner + rawBand);
  return { subInner, subOuter };
}
const symbols = { prev: '↑', next: '↓', recent1: '⇥', recent2: 'Ⅱ', recent3: 'Ⅲ', quickEdit: '✎', quickDelete: '×', quickPage: '›', quickPageLeft: '‹', showRange: '#', togglePin: '◇', toggleFavPanel: '▤', openFavoritesManager: '▦', currentHead: '↥', currentTail: '↧', toggleCollapse: '−', toggleOrientation: '↔', rangePrev: '‹', rangeNext: '›', resetRange: '↺' };
export function shortcutSymbol(item) { return item.icon || (item.submenu ? '▦' : symbols[item.action?.id] || '·'); }

function applyWheelVariables(target, a) {
  const variables = {
    surface: a.surface,
    highlight: a.highlight,
    text: a.text,
    border: a.border,
    accent: a.accent,
    center: a.center,
    glow: `${a.glow}px`,
    opacity: a.opacity / 100,
    font: `${a.fontSize}px`,
  };
  for (const [key, value] of Object.entries(variables)) target.style.setProperty(`--wheel-${key}`, value);
}

function buildRingButtons({ container, items, count, outerRadius, innerRadius, appearance, className, indexAttr, tier, extraIndexAttr, onClick, onHover, parentOpenIndex = -1 }) {
  const gap = appearance.shape === 'solid' ? 0 : appearance.gap + (appearance.shape === 'petals' ? 4 : 0);
  return items.map((item, index) => {
    const geometry = sectorGeometry(index, count, outerRadius, innerRadius, gap, appearance.rotation);
    const isEmpty = !item.action && !item.submenu;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${className}${index === parentOpenIndex ? ' is-submenu-open' : ''}${isEmpty ? ' is-empty-sector' : ''}`;
    button.title = item.label;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-label', `${index + 1}. ${item.label}${item.submenu ? '，子轮盘' : ''}`);
    button.dataset[indexAttr] = index;
    if (extraIndexAttr) button.dataset[extraIndexAttr] = index;
    button.dataset.tier = tier;
    button.style.clipPath = `polygon(${geometry.polygon})`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${outerRadius * 2} ${outerRadius * 2}`);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', geometry.path);
    svg.append(path);
    button.append(svg);
    const content = document.createElement('span');
    content.className = 'stcj-sector-content';
    const distance = (outerRadius + innerRadius) / 2, angle = geometry.angle * Math.PI / 180;
    content.style.left = `${outerRadius + Math.cos(angle) * distance}px`;
    content.style.top = `${outerRadius + Math.sin(angle) * distance}px`;
    content.style.width = `${Math.max(32, Math.min((outerRadius - innerRadius) * (tier === 'sub' ? 2.1 : 1.35), 2 * Math.PI * distance / Math.max(1, count) * .73))}px`;
    if (item.color) content.style.color = item.color;
    if (appearance.showIcons) {
      const icon = document.createElement('span');
      icon.className = 'stcj-sector-icon';
      icon.textContent = shortcutSymbol(item);
      content.append(icon);
    }
    if (appearance.showLabels) {
      const label = document.createElement('span');
      label.className = 'stcj-sector-label';
      label.textContent = item.label;
      content.append(label);
    }
    if (item.submenu) {
      const arrow = document.createElement('span');
      arrow.className = 'stcj-sector-child';
      arrow.textContent = '›';
      content.append(arrow);
    }
    button.append(content);
    button.addEventListener('click', event => { event.stopPropagation(); onClick?.(index); });
    if (onHover) button.addEventListener('pointerenter', () => onHover(index));
    container.append(button);
    return button;
  });
}

export function createFeature() {
  function createRadialView({
    menu,
    appearance,
    radius,
    onChoose,
    onSubChoose,
    onCenter,
    onHover,
    onSubHover,
    selected = -1,
    submenu = null,
    subAppearance = null,
    subSelected = -1,
    parentIndex = -1,
    activeTier = 'main',
    preview = false,
  }) {
    const a = normalizeRadialAppearance(appearance);
    const hasSubmenu = !!(submenu && Array.isArray(submenu.items) && submenu.items.length > 0);
    const subA = hasSubmenu ? normalizeRadialAppearance(subAppearance || submenu.appearance || appearance) : null;
    const inner = radius * a.innerRatio / 100;
    const bounds = hasSubmenu ? resolveSubringBounds(radius, inner, subA, preview) : null;

    const ring = document.createElement('div');
    ring.className = `stcj-radial-ring stcj-wheel-${a.shape}${preview ? ' stcj-wheel-preview' : ''}${hasSubmenu ? ' has-co-screen-subring' : ''}`;
    ring.style.width = ring.style.height = `${radius * 2}px`;
    ring.setAttribute('role', 'menu');
    ring.setAttribute('aria-label', hasSubmenu && activeTier === 'sub' ? `${menu.label} · ${submenu.label}` : menu.label);
    applyWheelVariables(ring, a);

    let subButtons = [];
    let subringEl = null;
    if (hasSubmenu) {
      subringEl = document.createElement('div');
      subringEl.className = `stcj-radial-subring stcj-wheel-${subA.shape}`;
      subringEl.dataset.submenuId = submenu.id;
      subringEl.setAttribute('role', 'group');
      subringEl.setAttribute('aria-label', `${submenu.label} 二级轮盘`);
      subringEl.style.width = subringEl.style.height = `${bounds.subOuter * 2}px`;
      applyWheelVariables(subringEl, subA);
      const subClassName = activeTier === 'sub' ? 'stcj-radial-item stcj-radial-subitem' : 'stcj-radial-subitem';
      const subPrimaryAttr = activeTier === 'sub' ? 'index' : 'subIndex';
      const subSecondaryAttr = activeTier === 'sub' ? 'subIndex' : null;
      subButtons = buildRingButtons({
        container: subringEl,
        items: submenu.items,
        count: submenu.items.length,
        outerRadius: bounds.subOuter,
        innerRadius: bounds.subInner,
        appearance: subA,
        className: subClassName,
        indexAttr: subPrimaryAttr,
        extraIndexAttr: subSecondaryAttr,
        tier: 'sub',
        onClick: onSubChoose || onChoose,
        onHover: onSubHover,
      });
      ring.append(subringEl);
    }

    const mainClassName = hasSubmenu && activeTier === 'sub' ? 'stcj-radial-parent-item' : 'stcj-radial-item';
    const mainIndexAttr = hasSubmenu && activeTier === 'sub' ? 'parentIndex' : 'index';
    const buttons = buildRingButtons({
      container: ring,
      items: menu.items,
      count: menu.items.length,
      outerRadius: radius,
      innerRadius: inner,
      appearance: a,
      className: mainClassName,
      indexAttr: mainIndexAttr,
      tier: 'main',
      parentOpenIndex: parentIndex,
      onClick: onChoose,
      onHover,
    });

    const center = document.createElement('button');
    center.type = 'button';
    center.className = 'stcj-radial-center';
    center.style.width = center.style.height = `${Math.min(radius * .57, inner * 1.5)}px`;
    const isSubFocus = (hasSubmenu && activeTier === 'sub') || menu.id !== 'main';
    center.setAttribute('aria-label', isSubFocus ? '返回主轮盘' : '取消轮盘');
    const symbol = document.createElement('span');
    symbol.className = 'stcj-center-symbol';
    symbol.textContent = isSubFocus ? '↶' : a.centerSymbol;
    const caption = document.createElement('small');
    caption.textContent = isSubFocus ? '返回' : '取消';
    center.append(symbol, caption);
    center.addEventListener('click', event => { event.stopPropagation(); onCenter?.(); });
    ring.append(center);

    function setSelected(index) {
      buttons.forEach((button, i) => {
        const isCurrent = i === index;
        button.classList.toggle('is-selected', isCurrent);
        button.setAttribute('aria-current', isCurrent ? 'true' : 'false');
      });
    }
    function setSubSelected(index) {
      subButtons.forEach((button, i) => {
        const isCurrent = i === index;
        button.classList.toggle('is-selected', isCurrent);
        button.setAttribute('aria-current', isCurrent ? 'true' : 'false');
      });
    }
    setSelected(selected);
    setSubSelected(subSelected);
    return { element: ring, buttons, subButtons, subring: subringEl, center, setSelected, setSubSelected, subringBounds: bounds };
  }
  return { createRadialView };
}
