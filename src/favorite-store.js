import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "clamp",
  "computeTextHash",
  "formatFavoriteSwipeLabel",
  "formatFloorLabel",
  "getCurrentChatId",
  "getCurrentMessageSnapshot",
  "getHostContext",
  "getMessageContentText",
  "getMessageCurrentSwipeIndex",
  "getMessageSwipeEntries",
  "getMessageSwipeEntry",
  "log",
  "normalizeFavoriteSwipeIndex",
  "normalizeFavoriteText",
  "renderFavoritesManager",
  "toastError",
  "updateFavoritesUI"
];

export function createFeature({ state, dependencies }) {
  function getCurrentChatMessages() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      return Array.isArray(ctx?.chat) ? ctx.chat : [];
    } catch {
      return [];
    }
  }

  function ensureFavoritesMetadata() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (!ctx?.chatMetadata || typeof ctx.chatMetadata !== 'object') return null;
      if (ctx.chatMetadata[constants.FAVORITES_METADATA_KEY] == null) {
        ctx.chatMetadata[constants.FAVORITES_METADATA_KEY] = [];
      }
      return ctx.chatMetadata;
    } catch {
      return null;
    }
  }

  function isFavoriteTextMatch(item, rawText) {
    const normalizedText = dependencies.normalizeFavoriteText(rawText);
    if (!normalizedText) return false;
    const textHash = dependencies.computeTextHash(normalizedText);
    if (item?.textHash && textHash === item.textHash) return true;
    if (item?.previewText) {
      const expected = dependencies.normalizeFavoriteText(item.previewText).slice(0, 48);
      const actual = normalizedText.slice(0, 48);
      if (expected && actual && expected === actual) return true;
    }
    return false;
  }

  function isFavoriteMetadataMatch(item, message) {
    return !!item
      && !!message
      && item.sendDate
      && message?.send_date != null
      && String(message.send_date) === String(item.sendDate)
      && item.sender
      && String(message?.name || '') === String(item.sender || '');
  }

  function resolveFavoriteMessageSnapshot(item, message) {
    const storedSwipeIndex = dependencies.normalizeFavoriteSwipeIndex(item?.swipeIndex);
    if (!message) {
      return {
        text: String(item?.previewText || ''),
        swipeIndex: storedSwipeIndex,
        matched: false,
        swipeMissing: false,
        reasoning: '',
        media: null,
      };
    }

    const baseReasoning = message?.extra?.reasoning ? String(message.extra.reasoning) : '';
    const swipeEntries = dependencies.getMessageSwipeEntries(message);
    const toSnapshot = (entry, matched = true, swipeMissing = false) => ({
      text: String(entry?.text || ''),
      swipeIndex: Number.isInteger(entry?.index) ? entry.index : -1,
      matched,
      swipeMissing,
      reasoning: entry?.reasoning || baseReasoning,
      media: entry?.media ?? message?.extra?.media ?? null,
    });

    if (swipeEntries.length) {
      if (storedSwipeIndex >= 0 && storedSwipeIndex < swipeEntries.length) {
        const storedEntry = swipeEntries[storedSwipeIndex];
        if (isFavoriteTextMatch(item, storedEntry.text)) return toSnapshot(storedEntry, true, false);
      }
      const matchedEntry = swipeEntries.find((entry) => isFavoriteTextMatch(item, entry.text));
      if (matchedEntry) return toSnapshot(matchedEntry, true, false);
    }

    const baseText = dependencies.getMessageContentText(message);
    if (isFavoriteTextMatch(item, baseText)) {
      return {
        text: baseText,
        swipeIndex: swipeEntries.length ? dependencies.getMessageCurrentSwipeIndex(message) : -1,
        matched: true,
        swipeMissing: false,
        reasoning: baseReasoning,
        media: message?.extra?.media ?? null,
      };
    }

    const fallbackEntry = swipeEntries.length
      ? (dependencies.getMessageSwipeEntry(message, storedSwipeIndex >= 0 && storedSwipeIndex < swipeEntries.length ? storedSwipeIndex : dependencies.getMessageCurrentSwipeIndex(message)) || swipeEntries[0])
      : null;
    return {
      text: String(item?.previewText || fallbackEntry?.text || baseText || ''),
      swipeIndex: storedSwipeIndex >= 0 ? storedSwipeIndex : (fallbackEntry ? fallbackEntry.index : -1),
      matched: false,
      swipeMissing: false,
      reasoning: '',
      media: fallbackEntry?.media ?? message?.extra?.media ?? null,
    };
  }

  function normalizeFavoriteItem(item, index) {
    const now = Date.now() + index;
    const source = item && typeof item === 'object' ? item : {};
    const legacyMessageId = typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))
      ? item
      : (source.messageId ?? source.mesId ?? source.mes_id ?? source.floor ?? source.floorId ?? source.id);
    const legacyPreview = source.previewText ?? source.preview ?? source.text ?? source.messageText ?? source.mes ?? '';
    const legacyNote = source.note ?? source.memo ?? source.remark ?? source.comment ?? '';
    const previewText = dependencies.normalizeFavoriteText(legacyPreview);
    const sendDate = source.sendDate ?? source.send_date ?? source.date ?? '';
    const stableId = typeof source.id === 'string' && source.id && !/^\d+$/.test(source.id)
      ? source.id
      : `stcj-fav-${now}-${index}`;
    return {
      id: stableId,
      messageId: Math.max(0, Math.round(Number(legacyMessageId) || 0)),
      swipeIndex: dependencies.normalizeFavoriteSwipeIndex(source.swipeIndex ?? source.swipe_id ?? source.swipeId),
      note: String(legacyNote || ''),
      textHash: String(source.textHash ?? source.text_hash ?? source.hash ?? ''),
      previewText,
      sender: String(source.sender ?? source.name ?? source.characterName ?? ''),
      sendDate: sendDate == null ? '' : String(sendDate),
      createdAt: Number.isFinite(Number(source.createdAt ?? source.created_at)) ? Number(source.createdAt ?? source.created_at) : now,
      updatedAt: Number.isFinite(Number(source.updatedAt ?? source.updated_at)) ? Number(source.updatedAt ?? source.updated_at) : now,
    };
  }

  function parseStoredFavoriteRecords(metadata) {
    const stored = metadata?.[constants.FAVORITES_METADATA_KEY];
    if (Array.isArray(stored)) return { ok: true, format: 'array', records: stored };
    if (stored == null) return { ok: true, format: 'empty', records: [] };
    if (typeof stored === 'string') {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return { ok: true, format: 'json-array', records: parsed };
        if (parsed && typeof parsed === 'object') {
          return parseStoredFavoriteRecords({ [constants.FAVORITES_METADATA_KEY]: parsed });
        }
      } catch (error) {
        dependencies.log('收藏读取失败：旧 JSON 字符串无法解析，保留原字段', error);
      }
      return { ok: false, format: 'invalid-json', records: [] };
    }
    if (typeof stored !== 'object') return { ok: false, format: typeof stored, records: [] };
    if (Array.isArray(stored.items)) return { ok: true, format: 'object-items', records: stored.items };
    if (Array.isArray(stored.favorites)) return { ok: true, format: 'object-favorites', records: stored.favorites };
    if (Array.isArray(stored.favoriteMesIds)) return { ok: true, format: 'legacy-id-list', records: stored.favoriteMesIds };
    const records = Object.entries(stored).map(([floor, value]) => {
      if (value && typeof value === 'object') {
        return { ...value, messageId: value.messageId ?? value.mesId ?? floor };
      }
      return { messageId: floor, note: typeof value === 'string' ? value : '' };
    });
    return { ok: true, format: 'object-map', records };
  }

  function hydrateLegacyFavoriteItem(item, messages) {
    const message = messages?.[item.messageId];
    if (!message) return item;
    if (item.previewText && item.textHash && item.sender && item.sendDate) return item;
    const snapshot = dependencies.getCurrentMessageSnapshot(message);
    const rawText = snapshot.text || dependencies.getMessageContentText(message) || '';
    const normalizedText = dependencies.normalizeFavoriteText(rawText);
    if (!item.previewText && normalizedText) item.previewText = normalizedText.slice(0, 160);
    if (!item.textHash && normalizedText) item.textHash = dependencies.computeTextHash(normalizedText);
    if (!item.sender) item.sender = String(message.name || '');
    if (!item.sendDate && message.send_date != null) item.sendDate = String(message.send_date);
    if (item.swipeIndex < 0 && snapshot.swipeIndex >= 0) item.swipeIndex = snapshot.swipeIndex;
    return item;
  }

  function applyFavoriteItemUpdate(item, mesId, message) {
    if (!item || !message) return item;
    const snapshot = resolveFavoriteMessageSnapshot(item, message);
    const normalizedText = dependencies.normalizeFavoriteText(snapshot.text || dependencies.getMessageContentText(message) || '');
    item.messageId = Math.max(0, Math.round(Number(mesId) || 0));
    item.swipeIndex = dependencies.normalizeFavoriteSwipeIndex(snapshot.swipeIndex);
    if (normalizedText) {
      item.previewText = normalizedText.slice(0, 160);
      item.textHash = dependencies.computeTextHash(normalizedText);
    }
    item.sender = String(message?.name || item.sender || '');
    item.sendDate = message?.send_date == null ? '' : String(message.send_date);
    item.updatedAt = Date.now();
    return item;
  }

  function syncFavoriteItemsToMetadata(chatId = dependencies.getCurrentChatId(), metadata = ensureFavoritesMetadata(), snapshot = state.favorites.favoriteItems) {
    if (!chatId || !metadata) return false;
    metadata[constants.FAVORITES_METADATA_KEY] = snapshot.map((item, index) => normalizeFavoriteItem(item, index));
    return true;
  }

  function persistFavoritesSnapshot(chatId, metadata, snapshot, ctx) {
    if (!chatId || !metadata || !Array.isArray(snapshot)) return false;
    metadata[constants.FAVORITES_METADATA_KEY] = snapshot.map((item, index) => normalizeFavoriteItem(item, index));
    // saveMetadataDebounced 会在调用时读取“当前聊天”，不能在已经切换后拿它保存旧聊天。
    if (dependencies.getCurrentChatId() === chatId) {
      try { ctx?.saveMetadataDebounced?.(); } catch { /* ignore */ }
    }
    state.favorites.pendingFavoriteSnapshots.delete(chatId);
    return true;
  }

  function flushPendingFavoriteSnapshot(chatId) {
    const pending = chatId ? state.favorites.pendingFavoriteSnapshots.get(chatId) : null;
    if (pending) persistFavoritesSnapshot(pending.chatId, pending.metadata, pending.snapshot, pending.ctx);
  }

  function flushAllPendingFavoriteSnapshots() {
    for (const chatId of [...state.favorites.pendingFavoriteSnapshots.keys()]) {
      flushPendingFavoriteSnapshot(chatId);
    }
  }

  function persistFavoritesNow() {
    if (state.favorites.favoritesSaveTimer) { clearTimeout(state.favorites.favoritesSaveTimer); state.favorites.favoritesSaveTimer = null; }
    const chatId = dependencies.getCurrentChatId();
    flushPendingFavoriteSnapshot(chatId);
  }

  function scheduleFavoritesSave() {
    const ctx = dependencies.getHostContext();
    const chatId = dependencies.getCurrentChatId(ctx);
    const metadata = ctx?.chatMetadata;
    if (!chatId || !metadata) return;
    const snapshot = state.favorites.favoriteItems.map((item, index) => normalizeFavoriteItem(item, index));
    metadata[constants.FAVORITES_METADATA_KEY] = snapshot;
    state.favorites.pendingFavoriteSnapshots.set(chatId, { chatId, metadata, snapshot, ctx });
    if (state.favorites.favoritesSaveTimer) clearTimeout(state.favorites.favoritesSaveTimer);
    state.favorites.favoritesSaveTimer = setTimeout(() => { state.favorites.favoritesSaveTimer = null; flushPendingFavoriteSnapshot(chatId); }, constants.FAVORITES_SAVE_DEBOUNCE);
  }

  async function saveExplicitFavoriteChange() {
    // 用户主动写操作不能走双重 debounce：tt 重载/切换聊天会取消宿主待保存任务。
    const ctx = dependencies.getHostContext();
    const chatId = dependencies.getCurrentChatId(ctx);
    if (!chatId || !ctx?.chatMetadata) return false;
    if (state.favorites.favoritesSaveTimer) { clearTimeout(state.favorites.favoritesSaveTimer); state.favorites.favoritesSaveTimer = null; }
    state.favorites.pendingFavoriteSnapshots.delete(chatId);
    const metadata = ctx.chatMetadata;
    try {
      if (typeof ctx.saveMetadata === 'function') {
        await ctx.saveMetadata();
      } else if (typeof ctx.saveMetadataDebounced === 'function') {
        ctx.saveMetadataDebounced();
      } else {
        throw new Error('宿主缺少聊天元数据保存接口');
      }
      return true;
    } catch (error) {
      dependencies.log('收藏保存失败', error);
      dependencies.toastError('收藏更改尚未保存，请勿切换聊天；稍后重试。');
      return false;
    } finally {
      if (dependencies.getHostContext()?.chatMetadata === metadata) touchFavoritesUI();
    }
  }

  function touchFavoritesUI() {
    const root = document.getElementById(constants.ROOT_ID);
    if (root) dependencies.updateFavoritesUI(root);
    if (state.favorites.favoritesModalOpen) dependencies.renderFavoritesManager();
  }

  function refreshFavoritesFromMetadata() {
    const metadata = ensureFavoritesMetadata();
    const messages = getCurrentChatMessages();
    const parsed = parseStoredFavoriteRecords(metadata);
    if (!parsed.ok) {
      console.warn('[STCJ] 收藏诊断', {
        chatId: dependencies.getCurrentChatId(),
        stage: 'read',
        format: parsed.format,
        raw: 0,
        normalized: 0,
        resolved: 0,
        renderable: 0,
      });
      return false;
    }

    state.favorites.favoriteItems = parsed.records
      .map((item, index) => hydrateLegacyFavoriteItem(normalizeFavoriteItem(item, index), messages));
    const resolutions = state.favorites.favoriteItems.map((item) => resolveFavoriteTarget(item, messages));
    const resolved = resolutions.filter((entry) => entry?.message).length;
    const renderable = state.favorites.favoriteItems.filter((item, index) => {
      const message = resolutions[index]?.message;
      const liveText = message ? dependencies.getCurrentMessageSnapshot(message).text || dependencies.getMessageContentText(message) : '';
      return !!dependencies.normalizeFavoriteText(liveText || item.previewText || item.note);
    }).length;
    console.info('[STCJ] 收藏诊断', {
      chatId: dependencies.getCurrentChatId(),
      stage: 'ready',
      format: parsed.format,
      raw: parsed.records.length,
      normalized: state.favorites.favoriteItems.length,
      resolved,
      renderable,
    });

    // 只有成功读取后才回写规范化结构，禁止解析失败时覆盖旧数据。
    if (metadata) metadata[constants.FAVORITES_METADATA_KEY] = state.favorites.favoriteItems;
    if (state.favorites.favoriteQuickMenuId && !state.favorites.favoriteItems.some((item) => item.id === state.favorites.favoriteQuickMenuId)) {
      state.favorites.favoriteQuickMenuId = null;
    }
    touchFavoritesUI();
    return true;
  }

  function buildFavoriteItemFromMessage(mesId, message) {
    const snapshot = dependencies.getCurrentMessageSnapshot(message);
    const normalizedText = dependencies.normalizeFavoriteText(snapshot.text || dependencies.getMessageContentText(message) || '');
    const now = Date.now();
    return {
      id: `stcj-fav-${now}-${Math.random().toString(16).slice(2, 8)}`,
      messageId: mesId,
      swipeIndex: dependencies.normalizeFavoriteSwipeIndex(snapshot.swipeIndex),
      note: '',
      textHash: dependencies.computeTextHash(normalizedText),
      previewText: normalizedText.slice(0, 160),
      sender: String(message?.name || ''),
      sendDate: message?.send_date == null ? '' : String(message.send_date),
      createdAt: now,
      updatedAt: now,
    };
  }

  function isFavoriteFingerprintMatch(item, message) {
    if (!item || !message) return false;
    return resolveFavoriteMessageSnapshot(item, message).matched;
  }

  function findFavoriteByRange(item, messages, start, end) {
    const safeStart = dependencies.clamp(start, 0, Math.max(0, messages.length - 1));
    const safeEnd = dependencies.clamp(end, 0, Math.max(0, messages.length - 1));
    for (let i = safeStart; i <= safeEnd; i++) {
      if (isFavoriteFingerprintMatch(item, messages[i])) {
        return { mesId: i, message: messages[i], status: 'fallback' };
      }
    }
    return null;
  }

  function getCurrentChatIndex(messages = getCurrentChatMessages()) {
    const key = dependencies.getCurrentChatId() + '|' + messages.length;
    if (state.host.currentChatIndex && state.host.currentChatIndexKey === key) return state.host.currentChatIndex;
    const index = new Map();
    messages.forEach((message, mesId) => {
      const snapshot = dependencies.getCurrentMessageSnapshot(message);
      const hash = dependencies.computeTextHash(dependencies.normalizeFavoriteText(snapshot.text || dependencies.getMessageContentText(message) || ''));
      if (hash) { const list = index.get(hash) || []; list.push(mesId); index.set(hash, list); }
    });
    state.host.currentChatIndexKey = key; state.host.currentChatIndex = index; return index;
  }

  function resolveFavoriteTarget(item, messages = getCurrentChatMessages()) {
    if (!item || !Array.isArray(messages) || !messages.length) {
      return { mesId: item?.messageId ?? -1, message: null, status: 'missing' };
    }

    const exactId = Math.max(0, Math.min(messages.length - 1, Math.round(Number(item.messageId) || 0)));
    const exactMessage = messages[exactId];
    if (exactMessage && (isFavoriteFingerprintMatch(item, exactMessage) || isFavoriteMetadataMatch(item, exactMessage))) {
      return { mesId: exactId, message: exactMessage, status: 'exact' };
    }

    const indexedIds = item.textHash ? getCurrentChatIndex(messages).get(item.textHash) : null;
    if (indexedIds?.length) {
      const mesId = indexedIds.reduce((best, id) => Math.abs(id - exactId) < Math.abs(best - exactId) ? id : best, indexedIds[0]);
      return { mesId, message: messages[mesId], status: 'fallback' };
    }

    const nearby = findFavoriteByRange(item, messages, exactId - 12, exactId + 12);
    if (nearby) return nearby;

    const full = findFavoriteByRange(item, messages, 0, messages.length - 1);
    if (full) return full;

    // 收藏属于当前聊天的 metadata；文本/分支被编辑后仍保留原楼层作为可用回退。
    if (exactMessage) return { mesId: exactId, message: exactMessage, status: 'fallback' };
    return { mesId: exactId, message: null, status: 'missing' };
  }

  function ensureFavoriteResolved(item, resolution) {
    if (!item || !resolution?.message) return resolution;
    if (resolution.status === 'missing') return resolution;
    const snapshot = resolveFavoriteMessageSnapshot(item, resolution.message);
    if (!snapshot.matched) return resolution;
    if (item.messageId === resolution.mesId
      && resolution.status === 'exact'
      && dependencies.normalizeFavoriteSwipeIndex(item.swipeIndex) === dependencies.normalizeFavoriteSwipeIndex(snapshot.swipeIndex)) return resolution;
    applyFavoriteItemUpdate(item, resolution.mesId, resolution.message);
    scheduleFavoritesSave();
    return resolution;
  }

  function findFavoriteIndexByIdentity(candidate) {
    return state.favorites.favoriteItems.findIndex((item) => {
      if (String(item.id) === String(candidate.id)) return true;
      if (item.messageId === candidate.messageId && item.textHash && candidate.textHash && item.textHash === candidate.textHash) return true;
      if (item.sender && candidate.sender && item.sender === candidate.sender && item.sendDate && candidate.sendDate && item.sendDate === candidate.sendDate && item.textHash === candidate.textHash) {
        return true;
      }
      return false;
    });
  }

  function getFavoriteItemById(favoriteId) {
    return state.favorites.favoriteItems.find((item) => item.id === favoriteId) || null;
  }

  function getRecentFavoriteItems() {
    const recentItems = [...state.favorites.favoriteItems]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, constants.FAVORITES_RECENT_LIMIT);

    return recentItems
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function getFavoriteQuickLabel(item, resolution) {
    const floorText = dependencies.formatFloorLabel(resolution?.mesId ?? item.messageId);
    const resolvedSwipeIndex = resolution?.message
      ? resolveFavoriteMessageSnapshot(item, resolution.message).swipeIndex
      : item?.swipeIndex;
    const swipeText = dependencies.formatFavoriteSwipeLabel(resolvedSwipeIndex);
    const note = String(item?.note || '').trim();
    const prefix = swipeText ? `${floorText} · ${swipeText}` : floorText;
    return note ? `${prefix} · ${note}` : prefix;
  }

  function getFavoriteListSummary(item, resolution = null) {
    const note = String(item?.note || '').trim();
    if (note) return note;
    const resolvedPreview = item?.previewText || dependencies.getCurrentMessageSnapshot(resolution?.message).text || '';
    return resolvedPreview ? dependencies.normalizeFavoriteText(resolvedPreview).slice(0, 60) : '无备注';
  }

  function getFavoriteResolvedSnapshot(item, resolution) {
    if (!resolution?.message || resolution.status === 'missing') return null;
    return resolveFavoriteMessageSnapshot(item, resolution.message);
  }

  function getFavoriteResolvedSwipeIndex(item, resolution) {
    return dependencies.normalizeFavoriteSwipeIndex(getFavoriteResolvedSnapshot(item, resolution)?.swipeIndex ?? item?.swipeIndex);
  }

  function hasMultipleFavoriteSwipesOnSameFloor(item, resolution, detailEntries) {
    if (!item || !resolution || !Array.isArray(detailEntries) || detailEntries.length < 2) return false;
    const targetFloor = resolution.status === 'missing' ? item.messageId : resolution.mesId;
    const swipeSet = new Set();

    detailEntries.forEach((entry) => {
      const entryFloor = entry?.resolution?.status === 'missing'
        ? entry?.item?.messageId
        : entry?.resolution?.mesId;
      if (entryFloor !== targetFloor) return;
      const swipeIndex = getFavoriteResolvedSwipeIndex(entry?.item, entry?.resolution);
      if (swipeIndex >= 0) swipeSet.add(swipeIndex);
    });

    return swipeSet.size > 1;
  }

  function isFavoriteCurrentDisplayedSwipe(item, resolution) {
    if (!resolution?.message || resolution.status === 'missing') return false;
    const favoriteSwipeIndex = getFavoriteResolvedSwipeIndex(item, resolution);
    const currentSwipeIndex = dependencies.getMessageCurrentSwipeIndex(resolution.message);
    return favoriteSwipeIndex >= 0 && currentSwipeIndex >= 0 && favoriteSwipeIndex === currentSwipeIndex;
  }

  function buildFavoriteCurrentBranchBadgeHtml(item, resolution, detailEntries) {
    if (!hasMultipleFavoriteSwipesOnSameFloor(item, resolution, detailEntries)) return '';
    if (!isFavoriteCurrentDisplayedSwipe(item, resolution)) return '';
    return '<span class="stcj-current-branch-badge" title="当前聊天记录中实际展示的分支">当前分支</span>';
  }

  function getFavoriteStatusLabel(status, snapshot) {
    if (status === 'missing') return '楼层失效';
    if (snapshot?.swipeMissing) return '分支已删';
    return '';
  }

  function getFavoriteStatusDescription(status, snapshot) {
    if (status === 'missing') return '原收藏楼层已不存在或无法定位。';
    if (snapshot?.swipeMissing) {
      const swipeText = dependencies.formatFavoriteSwipeLabel(snapshot.swipeIndex);
      return swipeText
        ? `原收藏的 ${swipeText} 已被删除或不存在，当前只能回退到该楼层。`
        : '原收藏的分支已被删除或不存在，当前只能回退到该楼层。';
    }
    return '';
  }

  function getFavoriteSortModeLabel(mode) {
    switch (mode) {
      case 'floor_asc': return '楼层 ↑';
      case 'floor_desc': return '楼层 ↓';
      default: return '收藏顺序';
    }
  }

  function sortFavoriteItems(items, mode) {
    const list = [...items];
    const pickItem = (entry) => entry?.item || entry;
    const pickFloor = (entry) => entry?.resolution?.status === 'missing'
      ? Number.MAX_SAFE_INTEGER
      : (entry?.resolution?.mesId ?? pickItem(entry).messageId);
    const pickSwipe = (entry) => {
      const idx = getFavoriteResolvedSwipeIndex(pickItem(entry), entry?.resolution);
      return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
    };
    switch (mode) {
      case 'floor_asc':
        return list.sort((a, b) => pickFloor(a) - pickFloor(b)
          || pickSwipe(a) - pickSwipe(b)
          || pickItem(a).createdAt - pickItem(b).createdAt);
      case 'floor_desc':
        return list.sort((a, b) => pickFloor(b) - pickFloor(a)
          || pickSwipe(b) - pickSwipe(a)
          || pickItem(b).createdAt - pickItem(a).createdAt);
      default:
        return list.sort((a, b) => (pickItem(b).createdAt || 0) - (pickItem(a).createdAt || 0));
    }
  }

  function buildFavoriteDetailEntries() {
    const messages = getCurrentChatMessages();
    return state.favorites.favoriteItems
      .map((item) => {
        const resolution = ensureFavoriteResolved(item, resolveFavoriteTarget(item, messages));
        return {
          item,
          resolution,
          floor: resolution.status === 'missing' ? Number.MAX_SAFE_INTEGER : resolution.mesId,
        };
      })
      .sort((a, b) => a.floor - b.floor
        || getFavoriteResolvedSwipeIndex(a.item, a.resolution) - getFavoriteResolvedSwipeIndex(b.item, b.resolution)
        || a.item.createdAt - b.item.createdAt);
  }

  function addFavorite(mesId) {
    const messages = getCurrentChatMessages();
    const message = messages[mesId];
    if (!message) return false;

    const candidate = buildFavoriteItemFromMessage(mesId, message);
    if (findFavoriteIndexByIdentity(candidate) >= 0) return false;

    state.favorites.favoriteItems.unshift(candidate);
    syncFavoriteItemsToMetadata();
    return saveExplicitFavoriteChange();
  }

  function removeFavoriteById(favoriteId) {
    const index = state.favorites.favoriteItems.findIndex((item) => item.id === favoriteId);
    if (index < 0) return false;
    state.favorites.favoriteItems.splice(index, 1);
    if (state.favorites.favoriteQuickMenuId === favoriteId) state.favorites.favoriteQuickMenuId = null;
    syncFavoriteItemsToMetadata();
    return saveExplicitFavoriteChange();
  }

  function updateFavoriteNoteById(favoriteId, nextNote) {
    const item = getFavoriteItemById(favoriteId);
    if (!item) return false;
    item.note = String(nextNote || '');
    item.updatedAt = Date.now();
    syncFavoriteItemsToMetadata();
    return saveExplicitFavoriteChange();
  }

  return { getCurrentChatMessages, ensureFavoritesMetadata, isFavoriteTextMatch, isFavoriteMetadataMatch, resolveFavoriteMessageSnapshot, normalizeFavoriteItem, parseStoredFavoriteRecords, hydrateLegacyFavoriteItem, applyFavoriteItemUpdate, syncFavoriteItemsToMetadata, persistFavoritesSnapshot, flushPendingFavoriteSnapshot, flushAllPendingFavoriteSnapshots, persistFavoritesNow, scheduleFavoritesSave, saveExplicitFavoriteChange, touchFavoritesUI, refreshFavoritesFromMetadata, buildFavoriteItemFromMessage, isFavoriteFingerprintMatch, findFavoriteByRange, getCurrentChatIndex, resolveFavoriteTarget, ensureFavoriteResolved, findFavoriteIndexByIdentity, getFavoriteItemById, getRecentFavoriteItems, getFavoriteQuickLabel, getFavoriteListSummary, getFavoriteResolvedSnapshot, getFavoriteResolvedSwipeIndex, hasMultipleFavoriteSwipesOnSameFloor, isFavoriteCurrentDisplayedSwipe, buildFavoriteCurrentBranchBadgeHtml, getFavoriteStatusLabel, getFavoriteStatusDescription, getFavoriteSortModeLabel, sortFavoriteItems, buildFavoriteDetailEntries, addFavorite, removeFavoriteById, updateFavoriteNoteById };
}
