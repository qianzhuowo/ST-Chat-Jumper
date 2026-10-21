import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [];

export function createFeature({ state, dependencies }) {
  function getIcon(iconName, title = '') {
    let svg = constants.ICONS[iconName];
    if (typeof svg === 'function') svg = svg(arguments[2] || '');
    if (!svg) return '';
    return svg;
  }

  function setIcon(el, iconName, extra) {
    if (!el) return;
    el.innerHTML = typeof constants.ICONS[iconName] === 'function' ? constants.ICONS[iconName](extra) : constants.ICONS[iconName];
  }

  return { getIcon, setIcon };
}
