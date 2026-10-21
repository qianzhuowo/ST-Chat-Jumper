import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "clamp",
  "normalizeFavoritePreviewMode"
];

export function createFeature({ state, dependencies }) {
  function getButtonSettings() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return getDefaultButtonSettings();

      if (!ctx.extensionSettings[constants.EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[constants.EXT_SETTINGS_KEY] = { buttons: getDefaultButtonSettings() };
      }

      const stored = ctx.extensionSettings[constants.EXT_SETTINGS_KEY].buttons;
      if (!Array.isArray(stored)) {
        ctx.extensionSettings[constants.EXT_SETTINGS_KEY].buttons = getDefaultButtonSettings();
        return ctx.extensionSettings[constants.EXT_SETTINGS_KEY].buttons;
      }

      // 合并：确保新增按钮有默认值，移除已删除按钮
      const validIds = new Set(constants.CONFIGURABLE_BUTTONS.map(b => b.id));
      const result = [];
      const seenIds = new Set();

      // 保留已有配置（按 stored 的顺序）
      for (const item of stored) {
        if (validIds.has(item.id) && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          result.push({
            id: item.id,
            enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
            order: typeof item.order === 'number' ? item.order : result.length,
          });
        }
      }

      // 补充新增的按钮（append 到末尾）
      for (const def of constants.CONFIGURABLE_BUTTONS) {
        if (!seenIds.has(def.id)) {
          result.push({ id: def.id, enabled: def.defaultEnabled, order: result.length });
        }
      }

      ctx.extensionSettings[constants.EXT_SETTINGS_KEY].buttons = result;
      return result;
    } catch {
      return getDefaultButtonSettings();
    }
  }

  function getDefaultButtonSettings() {
    return constants.CONFIGURABLE_BUTTONS.map(b => ({
      id: b.id,
      enabled: b.defaultEnabled,
      order: b.order,
    }));
  }

  function saveButtonSettings(buttons) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[constants.EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[constants.EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[constants.EXT_SETTINGS_KEY].buttons = buttons;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  function getRangeStep() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return constants.DEFAULT_RANGE_STEP;
      const ext = ctx.extensionSettings[constants.EXT_SETTINGS_KEY];
      if (ext && typeof ext.rangeStep === 'number' && Number.isFinite(ext.rangeStep) && ext.rangeStep >= 1) {
        return Math.round(ext.rangeStep);
      }
    } catch {
      /* ignore */
    }
    return constants.DEFAULT_RANGE_STEP;
  }

  function saveRangeStep(step) {
    try {
      const val = Math.max(1, Math.round(Number(step)));
      if (!Number.isFinite(val)) return;
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[constants.EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[constants.EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[constants.EXT_SETTINGS_KEY].rangeStep = val;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  function getRangeContext() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return constants.DEFAULT_RANGE_CONTEXT;
      const ext = ctx.extensionSettings[constants.EXT_SETTINGS_KEY];
      if (ext && typeof ext.rangeContext === 'number' && Number.isFinite(ext.rangeContext) && ext.rangeContext >= 1) {
        return Math.round(ext.rangeContext);
      }
    } catch {
      /* ignore */
    }
    return constants.DEFAULT_RANGE_CONTEXT;
  }

  function saveRangeContext(val) {
    try {
      const v = Math.max(1, Math.round(Number(val)));
      if (!Number.isFinite(v)) return;
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[constants.EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[constants.EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[constants.EXT_SETTINGS_KEY].rangeContext = v;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  function getRangePagingMode() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return constants.DEFAULT_RANGE_PAGING_MODE;
      const ext = ctx.extensionSettings[constants.EXT_SETTINGS_KEY];
      return ext?.rangePagingMode === 'shift' ? 'shift' : constants.DEFAULT_RANGE_PAGING_MODE;
    } catch {
      return constants.DEFAULT_RANGE_PAGING_MODE;
    }
  }

  function saveRangePagingMode(mode) {
    try {
      const nextMode = mode === 'shift' ? 'shift' : 'expand';
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[constants.EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[constants.EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[constants.EXT_SETTINGS_KEY].rangePagingMode = nextMode;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  function loadFavoritesPreviewMode() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return constants.FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT;
      const ext = ctx.extensionSettings[constants.EXT_SETTINGS_KEY];
      return dependencies.normalizeFavoritePreviewMode(ext?.favoritesPreviewMode);
    } catch {
      return constants.FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT;
    }
  }

  function saveFavoritesPreviewMode(mode) {
    try {
      const nextMode = dependencies.normalizeFavoritePreviewMode(mode);
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[constants.EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[constants.EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[constants.EXT_SETTINGS_KEY].favoritesPreviewMode = nextMode;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  function formatRangePagingModeLabel(mode = getRangePagingMode()) {
    return mode === 'shift' ? '平移' : '扩展';
  }

  function isButtonEnabled(buttonId) {
    const buttons = getButtonSettings();
    const cfg = buttons.find(b => b.id === buttonId);
    return cfg ? cfg.enabled : true;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(constants.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};

      const orientation =
        parsed.orientation === 'horizontal' || parsed.orientation === 'vertical' ? parsed.orientation : constants.DEFAULT_ORIENTATION;

      const x = typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : null;
      const y = typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? parsed.y : null;
      const rx = typeof parsed.rx === 'number' && Number.isFinite(parsed.rx) ? dependencies.clamp(parsed.rx, 0, 1) : null;
      const ry = typeof parsed.ry === 'number' && Number.isFinite(parsed.ry) ? dependencies.clamp(parsed.ry, 0, 1) : null;
      const collapsed = typeof parsed.collapsed === 'boolean' ? parsed.collapsed : constants.DEFAULT_SETTINGS.collapsed;
      const scale = normalizeRootScale(parsed.scale);
      const favPanelX = typeof parsed.favPanelX === 'number' && Number.isFinite(parsed.favPanelX) ? parsed.favPanelX : null;
      const favPanelY = typeof parsed.favPanelY === 'number' && Number.isFinite(parsed.favPanelY) ? parsed.favPanelY : null;
      const favPanelRx = typeof parsed.favPanelRx === 'number' && Number.isFinite(parsed.favPanelRx) ? dependencies.clamp(parsed.favPanelRx, 0, 1) : null;
      const favPanelRy = typeof parsed.favPanelRy === 'number' && Number.isFinite(parsed.favPanelRy) ? dependencies.clamp(parsed.favPanelRy, 0, 1) : null;
      const favPanelCustom = typeof parsed.favPanelCustom === 'boolean' ? parsed.favPanelCustom : constants.DEFAULT_SETTINGS.favPanelCustom;
      const favPanelW = typeof parsed.favPanelW === 'number' && Number.isFinite(parsed.favPanelW)
        ? dependencies.clamp(parsed.favPanelW, constants.FAV_PANEL_MIN_W, constants.FAV_PANEL_MAX_W) : null;
      const favPanelH = typeof parsed.favPanelH === 'number' && Number.isFinite(parsed.favPanelH)
        ? dependencies.clamp(parsed.favPanelH, constants.FAV_PANEL_MIN_H, constants.FAV_PANEL_MAX_H) : null;

      return {
        ...constants.DEFAULT_SETTINGS,
        ...parsed,
        x,
        y,
        rx,
        ry,
        orientation,
        collapsed,
        scale,
        favPanelX,
        favPanelY,
        favPanelRx,
        favPanelRy,
        favPanelCustom,
        favPanelW,
        favPanelH,
      };
    } catch {
      return { ...constants.DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(constants.STORAGE_KEY, JSON.stringify(state.layout.settings));
    } catch {
      /* ignore */
    }
  }

  function normalizeRootScale(value) {
    const scale = Number(value);
    if (!Number.isFinite(scale)) return constants.DEFAULT_SCALE;
    return dependencies.clamp(scale, constants.MIN_SCALE, constants.MAX_SCALE);
  }

  function getRootScalePercent(value = state.layout.settings.scale) {
    return Math.round(normalizeRootScale(value) * 100);
  }

  function formatRootScalePercent(value = state.layout.settings.scale) {
    return `${getRootScalePercent(value)}%`;
  }

  function getRootScaleSliderProgress(value = state.layout.settings.scale) {
    const percent = getRootScalePercent(value);
    return dependencies.clamp(((percent - constants.MIN_SCALE * 100) / ((constants.MAX_SCALE - constants.MIN_SCALE) * 100)) * 100, 0, 100);
  }

  function loadGlobalHidden() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return false;
      const ext = ctx.extensionSettings[constants.EXT_SETTINGS_KEY];
      if (ext && typeof ext.globalHidden === 'boolean') {
        return ext.globalHidden;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  function saveGlobalHidden(hidden) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.extensionSettings) return;
      if (!ctx.extensionSettings[constants.EXT_SETTINGS_KEY]) {
        ctx.extensionSettings[constants.EXT_SETTINGS_KEY] = {};
      }
      ctx.extensionSettings[constants.EXT_SETTINGS_KEY].globalHidden = !!hidden;
      ctx.saveSettingsDebounced?.();
    } catch {
      /* ignore */
    }
  }

  return { getButtonSettings, getDefaultButtonSettings, saveButtonSettings, getRangeStep, saveRangeStep, getRangeContext, saveRangeContext, getRangePagingMode, saveRangePagingMode, loadFavoritesPreviewMode, saveFavoritesPreviewMode, formatRangePagingModeLabel, isButtonEnabled, loadSettings, saveSettings, normalizeRootScale, getRootScalePercent, formatRootScalePercent, getRootScaleSliderProgress, loadGlobalHidden, saveGlobalHidden };
}
