// Integration with the Swipe Previewer extension (SillyTavernSwipePreviewer). It patches a
// `.st-swipe-previewer-button` into the host message template and every rendered message and
// opens its swipe panel from a delegated click, so we drive that same native button.
export const requiredServices = ['getAnchorMesId', 'getMessageElement', 'getSelectionInfo', 'toastWarn'];

const PREVIEW_BUTTON = '.st-swipe-previewer-button';

export function createFeature({ dependencies }) {
  // Installed and enabled: its module only runs when enabled, and it patches the template at load.
  function isSwipePreviewerAvailable() {
    return !!document.querySelector(`#message_template ${PREVIEW_BUTTON}, #chat .mes[mesid] ${PREVIEW_BUTTON}`);
  }

  // Same target rule as quick edit: the floor holding the selected text, else the current floor.
  function openSwipePreviewer() {
    if (!isSwipePreviewerAvailable()) {
      dependencies.toastWarn('未检测到已启用的 Swipe Previewer 扩展。');
      return false;
    }
    const mesId = dependencies.getSelectionInfo()?.mesId ?? dependencies.getAnchorMesId();
    const button = dependencies.getMessageElement(mesId)?.querySelector(PREVIEW_BUTTON);
    if (!button) {
      dependencies.toastWarn(`第 ${mesId} 楼暂无分支预览按钮，请稍后重试。`);
      return false;
    }
    button.click();
    return true;
  }

  return { isSwipePreviewerAvailable, openSwipePreviewer };
}
