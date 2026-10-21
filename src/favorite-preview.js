import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "getCurrentMessageSnapshot",
  "getMessageContentText",
  "resolveFavoriteMessageSnapshot"
];

export function createFeature({ state, dependencies, hostImports }) {
  function formatFloorLabel(mesId) {
    // SillyTavern 的楼层/mesid 从 0 开始
    return `第 ${mesId} 楼`;
  }

  function normalizeFavoriteSwipeIndex(value) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(-1, Math.trunc(num)) : -1;
  }

  function formatFavoriteSwipeLabel(swipeIndex) {
    const idx = normalizeFavoriteSwipeIndex(swipeIndex);
    return idx >= 0 ? `分支 ${idx + 1}` : '';
  }

  function formatFavoriteSwipeBadgeLabel(swipeIndex) {
    const idx = normalizeFavoriteSwipeIndex(swipeIndex);
    return idx >= 0 ? `S${idx + 1}` : '';
  }

  function buildFavoriteSwipeBadgeHtml(swipeIndex) {
    const badge = formatFavoriteSwipeBadgeLabel(swipeIndex);
    if (!badge) return '';
    return `<span class="stcj-swipe-badge" title="${escapeHtml(formatFavoriteSwipeLabel(swipeIndex))}">${escapeHtml(badge)}</span>`;
  }

  function normalizeFavoriteText(value) {
    return String(value ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function computeTextHash(text) {
    const source = String(text ?? '');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatFavoriteTimestamp(value) {
    if (value == null || value === '') return '时间未知';
    try {
      const num = Number(value);
      const date = new Date(Number.isFinite(num) ? num : value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    } catch {
      return String(value);
    }
  }

  function renderFavoriteMarkdownFallback(text) {
    const codeBlocks = [];
    const source = String(text ?? '').replace(/\r\n?/g, '\n');
    let html = escapeHtml(source);

    html = html.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const token = `@@STCJCODEBLOCK${codeBlocks.length}@@`;
      const safeLang = lang ? `<div class="stcj-md-code-lang">${escapeHtml(lang)}</div>` : '';
      codeBlocks.push(`<pre class="stcj-md-code-block">${safeLang}<code>${code}</code></pre>`);
      return token;
    });

    html = html
      .replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>');

    html = html
      .split(/\n{2,}/)
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (/^@@STCJCODEBLOCK\d+@@$/.test(trimmed)) return trimmed;
        if (trimmed.startsWith('<blockquote>')) return trimmed.replace(/\n/g, '<br>');
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');

    codeBlocks.forEach((block, index) => {
      html = html.replace(`@@STCJCODEBLOCK${index}@@`, block);
    });

    return html || '<p class="stcj-empty-copy">无内容</p>';
  }

  function renderFavoriteMarkdown(text) {
    const raw = String(text ?? '');
    let html = '';
    try { if (typeof window.marked?.parse === 'function') html = window.marked.parse(raw, { breaks: true }); } catch { /* ignore */ }
    return sanitizeFavoriteOutput(html || renderFavoriteMarkdownFallback(raw));
  }

  function normalizeFavoritePreviewMode(mode) {
    return constants.FAVORITES_PREVIEW_MODE_ORDER.includes(mode) ? mode : constants.FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT;
  }

  function getFavoritePreviewModeLabel(mode) {
    switch (normalizeFavoritePreviewMode(mode)) {
      case constants.FAVORITES_PREVIEW_MODES.SWIPE_HTML:
        return '轻前端';
      case constants.FAVORITES_PREVIEW_MODES.STAR_MAIN:
        return '全前端';
      default:
        return '文本';
    }
  }

  function buildFavoritePreviewModeSwitchHtml() {
    const mode = normalizeFavoritePreviewMode(state.favorites.favoritesPreviewMode);
    return `
      <div class="stcj-pill-switch stcj-preview-mode-switch is-${mode}">
        <span class="stcj-pill-switch-thumb"></span>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesPreviewMode" data-preview-mode="${constants.FAVORITES_PREVIEW_MODES.SWIPE_DEFAULT}" title="纯文本预览，最快最稳">文本</button>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesPreviewMode" data-preview-mode="${constants.FAVORITES_PREVIEW_MODES.SWIPE_HTML}" title="轻量前端渲染，适合简单页面">轻前端</button>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesPreviewMode" data-preview-mode="${constants.FAVORITES_PREVIEW_MODES.STAR_MAIN}" title="完整前端渲染，效果最丰富">全前端</button>
      </div>
    `;
  }

  function normalizeFavoriteSortMode(mode) {
    return ['floor_asc', 'floor_desc', 'created_desc'].includes(mode) ? mode : 'floor_asc';
  }

  function buildFavoriteSortModeSwitchHtml() {
    const mode = normalizeFavoriteSortMode(state.favorites.favoritesModalSort);
    return `
      <div class="stcj-pill-switch stcj-sort-mode-switch is-${mode}">
        <span class="stcj-pill-switch-thumb"></span>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesSortMode" data-sort-mode="floor_asc">顺序</button>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesSortMode" data-sort-mode="floor_desc">倒序</button>
        <button type="button" class="stcj-pill-switch-option" data-action="setFavoritesSortMode" data-sort-mode="created_desc">收藏顺序</button>
      </div>`;
  }

  function getFavoritePreviewFrameId(favoriteId) {
    return `stcj-preview-frame-${favoriteId}`;
  }

  function getMessageFormattingFn() {
    if (typeof hostImports.coreMessageFormatting === 'function') return hostImports.coreMessageFormatting;

    const formatter =
      window.messageFormatting ||
      globalThis.messageFormatting ||
      window.SillyTavern?.messageFormatting;
    return typeof formatter === 'function' ? formatter : null;
  }

  function applySillyTavernMessageFormatting(text, senderName, isUser, mesId) {
    const raw = String(text ?? '');
    if (!raw) return '';
    const formatter = getMessageFormattingFn();
    if (!formatter) return '';
    try {
      return String(formatter(raw, senderName || null, false, !!isUser, Number.isFinite(mesId) ? mesId : null, {}, false) || '');
    } catch {
      return '';
    }
  }

  function sanitizeFavoriteOutput(html) {
    try {
      if (window.DOMPurify?.sanitize) {
        return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
      }
    } catch {
      /* ignore */
    }

    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = String(html ?? '');
      const blockedTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'];
      blockedTags.forEach((tag) => tpl.content.querySelectorAll(tag).forEach((node) => node.remove()));
      tpl.content.querySelectorAll('*').forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          const value = String(attr.value || '').trim().toLowerCase();
          if (name.startsWith('on')) el.removeAttribute(attr.name);
          if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
            el.removeAttribute(attr.name);
          }
        }
      });
      return tpl.innerHTML;
    } catch {
      return escapeHtml(String(html ?? ''));
    }
  }

  function decorateFavoriteInlineSemantics(html) {
    const raw = String(html ?? '');
    if (!raw) return '';

    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = raw;
      const skipTags = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'KBD', 'SAMP']);
      const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const value = String(node?.nodeValue || '');
          if (!value || !/[“”"『』「」*]/.test(value)) return NodeFilter.FILTER_REJECT;
          let parent = node.parentElement;
          while (parent) {
            if (skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
            parent = parent.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes = [];
      let current = walker.nextNode();
      while (current) {
        textNodes.push(current);
        current = walker.nextNode();
      }

      const tokenRe = /("[^"\n]{1,500}"|“[^”\n]{1,500}”|『[^』\n]{1,500}』|「[^」\n]{1,500}」|\*[^*\n]{1,500}\*)/g;
      textNodes.forEach((node) => {
        const text = String(node.nodeValue || '');
        tokenRe.lastIndex = 0;
        if (!tokenRe.test(text)) return;
        tokenRe.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        text.replace(tokenRe, (match, _group, offset) => {
          if (offset > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
          if (match.startsWith('*') && match.endsWith('*')) {
            const em = document.createElement('em');
            em.className = 'stcj-inline-emphasis';
            em.textContent = match.slice(1, -1);
            frag.appendChild(em);
          } else {
            const span = document.createElement('span');
            span.className = 'stcj-inline-quote';
            span.textContent = match;
            frag.appendChild(span);
          }
          lastIndex = offset + match.length;
          return match;
        });
        if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        node.parentNode?.replaceChild(frag, node);
      });
      return tpl.innerHTML;
    } catch {
      return raw;
    }
  }

  async function importFavoritesRegexEngine() {
    try {
      return await eval('import("/scripts/extensions/regex/engine.js")');
    } catch {
      return null;
    }
  }

  function getFavoritesRegexEngine() {
    if (!state.favorites.favoritesRegexEnginePromise) state.favorites.favoritesRegexEnginePromise = importFavoritesRegexEngine();
    return state.favorites.favoritesRegexEnginePromise;
  }

  async function applyFavoritesRegexPipeline(text, placement) {
    const raw = String(text ?? '');
    if (!raw) return '';

    const api = window.ST_API;
    if (api?.regexScript?.process) {
      try {
        const result = await api.regexScript.process({ text: raw, placement });
        return String(result?.text ?? raw);
      } catch {
        /* ignore */
      }
    }

    const engine = await getFavoritesRegexEngine();
    if (!engine?.getScriptsByType || !engine?.SCRIPT_TYPES || !engine?.runRegexScript) return raw;

    const options = { allowedOnly: true };
    const scripts = [
      ...(engine.getScriptsByType(engine.SCRIPT_TYPES.GLOBAL, options) || []),
      ...(engine.getScriptsByType(engine.SCRIPT_TYPES.SCOPED, options) || []),
      ...(engine.getScriptsByType(engine.SCRIPT_TYPES.PRESET, options) || []),
    ];

    let out = raw;
    for (const script of scripts) {
      try {
        if (!script || script.disabled || script.promptOnly) continue;
        const placements = Array.isArray(script.placement) ? script.placement : (typeof script.placement === 'number' ? [script.placement] : []);
        if (placements.length && !placements.includes(placement)) continue;
        out = engine.runRegexScript(script, out);
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  function buildFavoritePreviewSrcdoc(htmlBody, token, frameKey) {
    const body = String(htmlBody ?? '');
    const heightScript = `(() => {
      const getHeight = () => {
        const body = document.body;
        const doc = document.documentElement;
        if (!body || !doc) return 0;

        const measuredNodes = Array.from(body.children || []).filter((node) => {
          if (!node || typeof node.getBoundingClientRect !== 'function') return false;
          const style = window.getComputedStyle(node);
          if (style.position === 'fixed' || style.position === 'absolute') return false;
          return true;
        });

        let contentBottom = 0;
        for (const node of measuredNodes) {
          const rect = node.getBoundingClientRect();
          if (!rect || !Number.isFinite(rect.bottom)) continue;
          contentBottom = Math.max(contentBottom, rect.bottom);
        }

        const bodyRect = body.getBoundingClientRect();
        const visualHeight = contentBottom > 0 && Number.isFinite(bodyRect.top)
          ? Math.max(0, Math.ceil(contentBottom - bodyRect.top))
          : 0;

        return Math.max(
          visualHeight,
          Math.ceil(body.getBoundingClientRect().height || 0),
          Math.ceil(doc.getBoundingClientRect().height || 0)
        );
      };

      const send = () => {
        const h = getHeight();
        parent.postMessage({ protocol: 'stcj-favorites-preview-v1', type: 'height', token: ${JSON.stringify(token)}, key: ${JSON.stringify(frameKey)}, height: h }, '*');
      };
      let raf = 0; const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(send); };
      const ro = window.ResizeObserver ? new ResizeObserver(schedule) : null;
      if (ro) ro.observe(document.documentElement);
      if (ro && document.body) ro.observe(document.body);
      const mo = new MutationObserver(schedule);
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      window.addEventListener('load', send);
      setTimeout(send, 0); setTimeout(send, 50); setTimeout(send, 200); setTimeout(send, 500);
    })();`;
    return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>:root{color-scheme:dark;scrollbar-color:rgba(255,255,255,0.20) transparent;scrollbar-width:thin;}html,body{overflow-x:hidden;scrollbar-color:rgba(255,255,255,0.20) transparent;scrollbar-width:thin;}body{margin:0;padding:12px;font-family:var(--main-font,sans-serif);background:#111;color:#d4d4d4;line-height:1.6;}body::-webkit-scrollbar,pre::-webkit-scrollbar{width:8px;height:8px;}body::-webkit-scrollbar-track,pre::-webkit-scrollbar-track{background:transparent;}body::-webkit-scrollbar-thumb,pre::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:999px;border:2px solid transparent;background-clip:padding-box;}body::-webkit-scrollbar-thumb:hover,pre::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.28);border:2px solid transparent;background-clip:padding-box;}img{max-width:100%;height:auto;}em,i,.stcj-inline-emphasis{color:#ffb55e;}u,ins{color:#4fc1ff;text-decoration-color:rgba(79,193,255,0.85);text-decoration-thickness:1.5px;text-underline-offset:2px;}.stcj-inline-quote{color:#58b6ff;}strong,b{color:#dcdcaa;}pre{overflow-x:hidden;overflow-y:auto;padding:8px 10px;background:#1e1e1e;border:1px solid #2d2d30;border-radius:8px;margin:6px 0;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:0.95em;color:#d4d4d4;box-shadow:inset 0 1px 0 rgba(255,255,255,0.02);}code{color:#ce9178;background:rgba(110,118,129,0.18);padding:0 4px;border-radius:4px;border:1px solid rgba(110,118,129,0.18);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;}pre code{color:inherit;background:transparent;padding:0;border:none;border-radius:0;}a{color:#3794ff;text-decoration-color:rgba(55,148,255,0.72);text-underline-offset:2px;}a:hover{color:#4daafc;}table{border-collapse:collapse;}th,td{border:1px solid rgba(255,255,255,0.15);padding:6px 8px;}blockquote{border-left:3px solid #58b6ff;margin:8px 0;padding:10px 0 10px 12px;background:rgba(45,56,74,0.50);color:#b9e3ff;border-radius:0 10px 10px 0;}.stcj-preview-reasoning{margin:0 0 12px;border:1px solid rgba(88,182,255,0.18);background:rgba(37,37,38,0.92);}.stcj-preview-reasoning > summary{cursor:pointer;color:#c8dff5;font-weight:600;}.stcj-preview-reasoning-body{margin-top:8px;color:#d4d4d4;}</style><script>${heightScript}</script></head><body>${body}</body></html>`;
  }

  function ensureFavoritesPreviewMessageListener() {
    if (state.favorites.favoritesPreviewMessageListenerAttached) return;
    const onPreviewMessage = (event) => {
      const data = event?.data;
      if (!data || data.protocol !== 'stcj-favorites-preview-v1' || data.type !== 'height') return;
      if (data.token !== state.favorites.favoritesPreviewIframeToken) return;
      const frame = document.getElementById(getFavoritePreviewFrameId(data.key));
      if (!frame || event.source !== frame.contentWindow) return;
      // srcdoc 通常是 opaque/null origin；source + token + frame key 构成边界校验。
      if (event.origin && event.origin !== 'null' && event.origin !== location.origin) return;
      const height = Math.min(2400, Math.max(96, Math.round(Number(data.height) || 0)));
      frame.style.height = `${height}px`;
    };
    window.addEventListener('message', onPreviewMessage);
    ensureFavoritesPreviewMessageListener.detach = () => {
      try { window.removeEventListener('message', onPreviewMessage); } catch { /* ignore */ }
    };
    state.favorites.favoritesPreviewMessageListenerAttached = true;
  }

  function hasRenderableFavoriteHtml(html) {
    const raw = String(html || '').trim();
    if (!raw) return false;
    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = raw;
      if (normalizeFavoriteText(tpl.content.textContent || '')) return true;
      return !!tpl.content.querySelector('img,video,audio,canvas,svg,table,pre,code,details');
    } catch {
      return false;
    }
  }

  function buildFavoriteRenderableHtml(rawText, formattedHtml) {
    const sanitizedFormatted = formattedHtml ? sanitizeFavoriteOutput(formattedHtml) : '';
    const output = hasRenderableFavoriteHtml(sanitizedFormatted)
      ? sanitizedFormatted
      : renderFavoriteMarkdown(rawText);
    return decorateFavoriteInlineSemantics(output || '<div class="stcj-empty-copy">原消息内容不可用。</div>');
  }

  async function prepareFavoritePreviewPayload(item, resolution) {
    const message = resolution.status === 'missing' ? null : resolution.message;
    const mesId = resolution.status === 'missing' ? item.messageId : resolution.mesId;
    const snapshot = resolution.status === 'missing' ? null : dependencies.resolveFavoriteMessageSnapshot(item, message);
    const senderName = item.sender || message?.name || '未知发送者';
    const isUser = !!message?.is_user;
    const liveText = message
      ? String(dependencies.getCurrentMessageSnapshot(message).text || dependencies.getMessageContentText(message) || '')
      : '';
    // 收藏指向具体分支，不能用当前显示分支覆盖收藏快照。
    // 分支已改动/不存在时保留收藏摘要，不冒充另一分支的完整正文。
    const originalText = snapshot?.matched
      ? String(snapshot.text || '')
      : String(item.previewText || liveText || snapshot?.text || '');
    const originalReasoning = resolution.status === 'missing' || !snapshot
      ? ''
      : String(snapshot.reasoning || '');
    const regexText = await applyFavoritesRegexPipeline(originalText, 2);
    const rawText = String(regexText || originalText || '');
    const regexReasoning = await applyFavoritesRegexPipeline(originalReasoning, 6);
    const reasoningRaw = String(regexReasoning || originalReasoning || '');
    const formattedHtml = applySillyTavernMessageFormatting(rawText, senderName, isUser, mesId);
    const reasoningHtml = reasoningRaw ? applySillyTavernMessageFormatting(reasoningRaw, null, false, null) : '';
    const processedPreviewHtml = buildFavoriteRenderableHtml(rawText, formattedHtml);
    const processedReasoningHtml = reasoningHtml ? decorateFavoriteInlineSemantics(sanitizeFavoriteOutput(reasoningHtml)) : '';
    return {
      rawText,
      formattedHtml,
      reasoningRaw,
      reasoningHtml,
      processedPreviewHtml,
      processedReasoningHtml,
      senderName,
      isUser,
      swipeIndex: snapshot?.swipeIndex ?? normalizeFavoriteSwipeIndex(item?.swipeIndex),
      swipeMissing: !!snapshot?.swipeMissing,
      mesId,
      deleted: resolution.status === 'missing' || !!snapshot?.swipeMissing,
    };
  }

  function buildFavoriteReasoningBlock(html, className = 'stcj-preview-reasoning') {
    if (!html) return '';
    return `<details class="${className}"><summary>思考了一会</summary><div class="${className}-body">${html}</div></details>`;
  }

  function renderFavoritePreviewMarkupByMode(mode, item, payload) {

    if (mode === constants.FAVORITES_PREVIEW_MODES.SWIPE_HTML) {
      return {
        html: `<iframe class="stcj-preview-iframe" id="${getFavoritePreviewFrameId(item.id)}" data-preview-frame-key="${item.id}" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe>`,
        payload,
      };
    }

    if (mode === constants.FAVORITES_PREVIEW_MODES.STAR_MAIN) {
      const reasoningBlock = payload.processedReasoningHtml
        ? `<details class="fav-reasoning-details"><summary class="fav-reasoning-summary"><span>思考了一会</span><i class="fa-solid fa-chevron-down reasoning-arrow"></i></summary><div class="fav-reasoning-content">${payload.processedReasoningHtml}</div></details>`
        : '';
      const previewBody = payload.processedPreviewHtml;
      return {
        html: `<div class="stcj-star-preview favorite-item ${payload.isUser ? 'role-user' : 'role-ai'}">${reasoningBlock}<div class="fav-preview ${payload.deleted ? 'deleted' : ''}">${previewBody}</div></div>`,
        payload,
      };
    }

    const reasoningBlock = buildFavoriteReasoningBlock(payload.processedReasoningHtml);
    const previewBody = payload.processedPreviewHtml;
    return {
      html: `<div class="stcj-swipe-preview-default">${reasoningBlock}${previewBody || '<div class="stcj-empty-copy">原消息内容不可用。</div>'}</div>`,
      payload,
    };
  }

  function renderHtmlCodeIframesInElement(container) {
    if (!container) return;
    container.querySelectorAll('pre').forEach((preEl, index) => {
      const codeContent = preEl.textContent || '';
      if (!codeContent.includes('<body') || !codeContent.includes('</body>')) return;

      const frameKey = `inline-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
      const heightScript = `<script>(()=>{const send=()=>parent.postMessage({protocol:'stcj-favorites-preview-v1',type:'height',token:${JSON.stringify(state.favorites.favoritesPreviewIframeToken)},key:${JSON.stringify(frameKey)},height:Math.max(document.body?.scrollHeight||0,document.documentElement?.scrollHeight||0)},'*');let raf=0;const schedule=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(send)};new ResizeObserver(schedule).observe(document.documentElement);if(document.body)new ResizeObserver(schedule).observe(document.body);new MutationObserver(schedule).observe(document.body||document.documentElement,{childList:true,subtree:true});addEventListener('load',schedule);schedule()})()<\/script>`;
      let srcdoc = codeContent;
      const headTagMatch = srcdoc.match(/<head(?:\s[^>]*)?>/i);
      if (headTagMatch) {
        const injectionPoint = headTagMatch.index + headTagMatch[0].length;
        srcdoc = srcdoc.slice(0, injectionPoint) + heightScript + srcdoc.slice(injectionPoint);
      } else {
        srcdoc = heightScript + srcdoc;
      }

      const iframe = document.createElement('iframe');
      iframe.id = getFavoritePreviewFrameId(frameKey);
      iframe.className = 'stcj-star-inline-iframe';
      iframe.dataset.previewFrameKey = frameKey;
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.setAttribute('loading', 'lazy');
      iframe.style.height = '160px';
      iframe.setAttribute('srcdoc', srcdoc);
      preEl.replaceWith(iframe);
    });
  }

  return { formatFloorLabel, normalizeFavoriteSwipeIndex, formatFavoriteSwipeLabel, formatFavoriteSwipeBadgeLabel, buildFavoriteSwipeBadgeHtml, normalizeFavoriteText, computeTextHash, escapeHtml, formatFavoriteTimestamp, renderFavoriteMarkdownFallback, renderFavoriteMarkdown, normalizeFavoritePreviewMode, getFavoritePreviewModeLabel, buildFavoritePreviewModeSwitchHtml, normalizeFavoriteSortMode, buildFavoriteSortModeSwitchHtml, getFavoritePreviewFrameId, getMessageFormattingFn, applySillyTavernMessageFormatting, sanitizeFavoriteOutput, decorateFavoriteInlineSemantics, importFavoritesRegexEngine, getFavoritesRegexEngine, applyFavoritesRegexPipeline, buildFavoritePreviewSrcdoc, ensureFavoritesPreviewMessageListener, hasRenderableFavoriteHtml, buildFavoriteRenderableHtml, prepareFavoritePreviewPayload, buildFavoriteReasoningBlock, renderFavoritePreviewMarkupByMode, renderHtmlCodeIframesInElement };
}
