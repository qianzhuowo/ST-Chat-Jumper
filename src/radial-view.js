import { normalizeRadialAppearance } from './radial-config.js';
import { actionIconSvg, iconSvg } from './action-catalog.js';
import { resolveIconSource } from './icon-library.js';

export const requiredServices = [];
// Original browser renderer. Geometry is standard polar math, not a port of an upstream renderer.
export function sectorGeometry(index, count, radius, innerRadius, gap = 3, rotation = 0, arc = null, corner = 0) {
  if (!Number.isFinite(count) || count < 1) return { path: '', polygon: '', angle: 0 };
  const span = arc ? arc.span : 360;
  const arcStart = arc ? arc.start : -90 + rotation - 180 / count;
  const step = span / count, space = Math.min(gap, step * .45);
  const start = arcStart + index * step + space / 2;
  const end = start + Math.min(359.95, step - space);
  const point = (angle, r) => { const a = angle * Math.PI / 180; return [radius + Math.cos(a) * r, radius + Math.sin(a) * r]; };
  const fmt = p => p.map(n => +n.toFixed(3)).join(' ');
  const large = end - start > 180 ? 1 : 0;
  const outer = radius - 2, sweepRad = (end - start) * Math.PI / 180;
  // Smooth corners: fillet size is limited by ring thickness and by each arc's length.
  const full = end - start >= 359;
  const r = full ? 0 : Math.max(0, Math.min(Number(corner) || 0, (outer - innerRadius) / 2 - .5, innerRadius * sweepRad * .45, outer * sweepRad * .45));
  let path;
  if (r < .05) {
    const [a, b, c, d] = [point(start, outer), point(end, outer), point(end, innerRadius), point(start, innerRadius)];
    path = `M ${fmt(a)} A ${outer} ${outer} 0 ${large} 1 ${fmt(b)} L ${fmt(c)} A ${innerRadius} ${innerRadius} 0 ${large} 0 ${fmt(d)} Z`;
  } else {
    const dOut = r / outer * 180 / Math.PI, dIn = r / innerRadius * 180 / Math.PI;
    const largeOut = end - start - 2 * dOut > 180 ? 1 : 0, largeIn = end - start - 2 * dIn > 180 ? 1 : 0;
    path = `M ${fmt(point(start + dOut, outer))} A ${outer} ${outer} 0 ${largeOut} 1 ${fmt(point(end - dOut, outer))}`
      + ` Q ${fmt(point(end, outer))} ${fmt(point(end, outer - r))} L ${fmt(point(end, innerRadius + r))}`
      + ` Q ${fmt(point(end, innerRadius))} ${fmt(point(end - dIn, innerRadius))} A ${innerRadius} ${innerRadius} 0 ${largeIn} 0 ${fmt(point(start + dIn, innerRadius))}`
      + ` Q ${fmt(point(start, innerRadius))} ${fmt(point(start, innerRadius + r))} L ${fmt(point(start, outer - r))}`
      + ` Q ${fmt(point(start, outer))} ${fmt(point(start + dOut, outer))} Z`;
  }
  const points = [], samples = Math.max(5, Math.ceil((end - start) / 5));
  for (let i = 0; i <= samples; i++) points.push(point(start + (end - start) * i / samples, radius));
  for (let i = samples; i >= 0; i--) points.push(point(start + (end - start) * i / samples, innerRadius));
  return { path, polygon: points.map(p => p.map(n => `${(n / radius * 50).toFixed(3)}%`).join(' ')).join(','), angle: arcStart + (index + .5) * step };
}
// StarPie model: the child tier extends straight out of its parent cell and evenly
// subdivides exactly the parent's angular span; anything outside that span is a miss.
export function resolveSubringArc(mainCount, parentIndex, childCount, mainRotation = 0) {
  if (!Number.isFinite(mainCount) || mainCount < 1 || !(parentIndex >= 0) || !Number.isFinite(childCount) || childCount < 1) return null;
  const span = 360 / mainCount;
  const center = -90 + mainRotation + parentIndex * span;
  return { center, span, start: center - span / 2 };
}
export function arcHitIndex(angleDeg, arc, count) {
  if (!arc || !count) return -1;
  const relative = ((angleDeg - arc.start) % 360 + 360) % 360;
  if (relative >= arc.span) return -1;
  return Math.min(count - 1, Math.floor(relative / (arc.span / count)));
}
export function resolveWheelAppearance(config, menu, radius) {
  const appearance = normalizeRadialAppearance(menu?.appearance || config.appearance);
  // The visible inner arc and the actual cancel zone must agree even at tiny scales.
  appearance.innerRatio = Math.max(appearance.innerRatio, Math.min(65, Math.round((Number(config.deadZone) || 0) / Math.max(1, radius) * 100)));
  return appearance;
}
export function resolveSubringRotation(mainCount, parentIndex, mainRotation = 0, subRotation = 0) {
  if (!Number.isFinite(mainCount) || mainCount < 1 || parentIndex < 0) return subRotation;
  // Keep the first child sector visually aligned with its owning primary sector.
  const parentCenter = -90 + mainRotation + parentIndex * (360 / mainCount);
  return subRotation + parentCenter + 90;
}

export function resolveSubringBounds(radius, innerRadius, subAppearance, preview = false) {
  // One proportional geometry for runtime and preview; child scale cannot change it.
  const subInner = radius * 1.04;
  const subOuter = radius * 1.55;
  return { subInner, subOuter };
}
// Same trusted SVG set as the floating toolbar (action-catalog.js); empty cells have no icon.
// A chosen library/custom icon wins over the action's default icon.
export function sectorIconSvg(item) {
  const source = resolveIconSource(item);
  if (source?.markup) return source.markup;
  if (source?.path) return '';
  return item?.action ? actionIconSvg(item.action) : item?.submenu ? iconSvg('more') : '';
}
// Builds the icon node with DOM APIs; custom path data is pre-validated and never parsed as markup.
export function createSectorIcon(item) {
  if (!item || item.showIcon === false) return null;
  const source = resolveIconSource(item);
  const icon = document.createElement('span');
  icon.className = 'stcj-sector-icon';
  if (source?.path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', source.viewBox || '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (source.mode === 'stroke') {
      svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', String(source.strokeWidth || 2)); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    } else svg.setAttribute('fill', 'currentColor');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', source.path);
    svg.append(path); icon.append(svg);
    return icon;
  }
  const markup = sectorIconSvg(item);
  if (!markup) return null;
  icon.innerHTML = markup;
  return icon;
}

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

function buildRingButtons({ container, items, count, outerRadius, innerRadius, appearance, className, indexAttr, tier, extraIndexAttr, onClick, onHover, parentOpenIndex = -1, arc = null }) {
  const gap = appearance.shape === 'solid' ? 0 : appearance.gap + (appearance.shape === 'petals' ? 4 : 0);
  const arcFraction = arc ? arc.span / 360 : 1;
  return items.map((item, index) => {
    const geometry = sectorGeometry(index, count, outerRadius, innerRadius, gap, appearance.rotation, arc, appearance.corner);
    const distance = (outerRadius + innerRadius) / 2;
    // Narrow child cells keep the icon and expose the label through title/aria instead of clipping it.
    const compact = tier === 'sub' && item.showIcon !== false && 2 * Math.PI * distance * arcFraction / Math.max(1, count) < 46;
    const isEmpty = !item.action && !item.submenu;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${className}${index === parentOpenIndex ? ' is-submenu-open' : ''}${isEmpty ? ' is-empty-sector' : ''}${compact ? ' is-compact' : ''}${item.submenu && item.action ? ' has-parent-action' : ''}`;
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
    const angle = geometry.angle * Math.PI / 180;
    content.style.left = `${outerRadius + Math.cos(angle) * distance}px`;
    content.style.top = `${outerRadius + Math.sin(angle) * distance}px`;
    content.style.width = `${Math.max(32, Math.min((outerRadius - innerRadius) * (tier === 'sub' ? 2.1 : 1.35), 2 * Math.PI * distance * arcFraction / Math.max(1, count) * .73))}px`;
    if (item.color) content.style.color = item.color;
    const icon = createSectorIcon(item);
    if (icon) content.append(icon);
    if (item.showLabel) {
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
    const subArc = subA && parentIndex >= 0 ? resolveSubringArc(menu.items.length, parentIndex, submenu.items.length, a.rotation) : null;
    if (subA && parentIndex >= 0 && !subArc) subA.rotation = resolveSubringRotation(menu.items.length, parentIndex, a.rotation, subA.rotation);
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
      subringEl.className = `stcj-radial-subring stcj-wheel-${subA.shape}${subArc ? ' is-fan' : ''}`;
      subringEl.dataset.submenuId = submenu.id;
      subringEl.dataset.layout = subArc ? 'fan' : 'ring';
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
        arc: subArc,
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
    // The main wheel's centre may carry an icon chosen in 「扇区与动作」; the text symbol is the fallback.
    const centerIcon = !isSubFocus && a.centerIconId ? createSectorIcon({ iconId: a.centerIconId }) : null;
    if (centerIcon) { centerIcon.className = 'stcj-center-icon'; symbol.append(centerIcon); }
    else symbol.textContent = isSubFocus ? '↶' : a.centerSymbol;
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
    return { element: ring, buttons, subButtons, subring: subringEl, center, setSelected, setSubSelected, subringBounds: bounds, subArc, subRotation: subA ? subA.rotation : 0 };
  }
  return { createRadialView };
}
