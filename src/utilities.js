import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [];

export function createFeature({ state, dependencies }) {
  function log(...args) {
    // eslint-disable-next-line no-console
    console.log('[ST Chat Jumper]', ...args);
  }

  function toastInfo(msg) {
    try {
      if (window.toastr?.info) window.toastr.info(msg);
    } catch {
      /* ignore */
    }
  }

  function toastWarn(msg) {
    try {
      if (window.toastr?.warning) window.toastr.warning(msg);
    } catch {
      /* ignore */
    }
  }

  function toastError(msg) {
    try {
      if (window.toastr?.error) window.toastr.error(msg);
      else toastWarn(msg);
    } catch {
      /* ignore */
    }
  }

  function toastSuccess(msg) {
    try {
      if (window.toastr?.success) window.toastr.success(msg);
      else toastInfo(msg);
    } catch {
      /* ignore */
    }
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function getNowMs() {
    try {
      return typeof performance?.now === 'function' ? performance.now() : Date.now();
    } catch {
      return Date.now();
    }
  }

  function suppressButtonActions(duration = 150) {
    state.layout.suppressButtonActionUntil = getNowMs() + duration;
  }

  function shouldSuppressButtonAction() {
    return getNowMs() < state.layout.suppressButtonActionUntil;
  }

  function triggerHapticFeedback(duration = 12) {
    try {
      if (typeof navigator?.vibrate !== 'function') return;
      navigator.vibrate(duration);
    } catch {
      /* ignore */
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return { log, toastInfo, toastWarn, toastError, toastSuccess, clamp, getNowMs, suppressButtonActions, shouldSuppressButtonAction, triggerHapticFeedback, sleep };
}
