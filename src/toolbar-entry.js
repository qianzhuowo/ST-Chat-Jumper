// Quick hide/show entry for the floating toolbar, placed into the host's send form or the
// Quick Reply bar. It runs the same toggleGlobalHide service as the settings button.
export const requiredServices = ['getToolbarEntryPlacement', 'saveToolbarEntryPlacement', 'toggleGlobalHide'];

const ENTRY_ID = 'stcj-toolbar-entry';
const QR_CONTAINERS = '#qr--bar > .qr--buttons, #qr--popout > .qr--body > .qr--buttons';

export function createFeature({ state, dependencies }) {
  let observer = null;
  let scheduled = false;

  function quickReplyContainer() {
    const candidates = [...document.querySelectorAll(QR_CONTAINERS)];
    return candidates.find(el => el.getClientRects().length > 0) || candidates[0] || null;
  }

  // [parent, insertBefore] for the placement; null while the host anchor is not rendered.
  function targetOf(placement) {
    if (placement === 'leftSendForm') {
      const anchor = document.getElementById('extensionsMenuButton');
      const parent = anchor?.parentElement || document.getElementById('leftSendForm');
      return parent ? [parent, anchor?.parentElement === parent ? anchor.nextSibling : null] : null;
    }
    if (placement === 'rightSendForm') {
      const anchor = document.getElementById('send_but');
      const parent = anchor?.parentElement || document.getElementById('rightSendForm');
      return parent ? [parent, anchor?.parentElement === parent ? anchor : null] : null;
    }
    const parent = quickReplyContainer();
    return parent ? [parent, parent.firstChild] : null;
  }

  function createEntry(placement) {
    const inQuickReply = placement === 'qrButtons';
    const entry = document.createElement(inQuickReply ? 'button' : 'div');
    entry.id = ENTRY_ID;
    entry.dataset.placement = placement;
    if (inQuickReply) {
      entry.type = 'button';
      entry.className = 'qr--button stcj-toolbar-entry';
      entry.innerHTML = '<i class="fa-solid" aria-hidden="true"></i><span>悬浮条</span>';
    } else {
      // Same shape as the host's send-form icons; host keyboard.js turns Enter into a click.
      entry.className = 'stcj-toolbar-entry fa-solid interactable';
      entry.tabIndex = 0;
      entry.setAttribute('role', 'button');
    }
    entry.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dependencies.toggleGlobalHide();
    });
    return entry;
  }

  function renderEntryState(entry) {
    const hidden = !!state.layout.globalHidden;
    const icon = entry.querySelector('i') || entry;
    icon.classList.toggle('fa-eye', hidden);
    icon.classList.toggle('fa-eye-slash', !hidden);
    entry.title = hidden ? '显示 Chat Jumper 悬浮条' : '隐藏 Chat Jumper 悬浮条';
    entry.setAttribute('aria-label', entry.title);
    entry.setAttribute('aria-pressed', String(hidden));
  }

  function syncToolbarEntry() {
    const placement = dependencies.getToolbarEntryPlacement();
    let entry = document.getElementById(ENTRY_ID);
    if (entry && entry.dataset.placement !== placement) {
      entry.remove();
      entry = null;
    }
    if (placement === 'disabled') {
      stopObserver();
      return;
    }
    startObserver();
    const target = targetOf(placement);
    if (!target) return;
    entry ??= createEntry(placement);
    // Only the parent is enforced: other extensions may insert next to the same anchor.
    if (entry.parentElement !== target[0]) target[0].insertBefore(entry, target[1]);
    renderEntryState(entry);
  }

  // The send form and the Quick Reply bar are re-rendered by the host; re-insert when dropped.
  function startObserver() {
    if (observer || typeof window.MutationObserver !== 'function') return;
    observer = new MutationObserver(() => {
      if (scheduled || document.getElementById(ENTRY_ID)?.isConnected) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (observer) syncToolbarEntry();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
  }

  function setToolbarEntryPlacement(placement) {
    dependencies.saveToolbarEntryPlacement(placement);
    syncToolbarEntry();
  }

  function destroyToolbarEntry() {
    stopObserver();
    document.getElementById(ENTRY_ID)?.remove();
  }

  return { syncToolbarEntry, setToolbarEntryPlacement, destroyToolbarEntry };
}
