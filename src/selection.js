import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "clamp",
  "getMessageTextContainer"
];

export function createFeature({ state, dependencies }) {
  function getSelectionContextInElement(containerEl, env) {
    try {
      const win = env?.win || window;
      const doc = env?.doc || document;
      const sel = win.getSelection?.();
      if (!sel || sel.rangeCount <= 0 || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      if (!containerEl.contains(range.commonAncestorContainer)) return null;

      // 用 Range.toString() 来获得与 offset 计算一致的“显示文本”
      const fullRange = doc.createRange();
      fullRange.selectNodeContents(containerEl);
      const displayText = fullRange.toString();

      const preStart = doc.createRange();
      preStart.selectNodeContents(containerEl);
      preStart.setEnd(range.startContainer, range.startOffset);
      const start = preStart.toString().length;

      const preEnd = doc.createRange();
      preEnd.selectNodeContents(containerEl);
      preEnd.setEnd(range.endContainer, range.endOffset);
      const end = preEnd.toString().length;

      const selectedText = range.toString();
      const before = displayText.slice(Math.max(0, start - 60), start);
      const after = displayText.slice(end, end + 60);

      return { selectedText, before, after, displayText, start, end };
    } catch {
      return null;
    }
  }

  function getSelectionInfo() {
    // 1) 主文档选择
    try {
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        const mesEl = el?.closest?.('#chat .mes[mesid]') || null;
        if (mesEl) {
          const mesId = parseInt(mesEl.getAttribute('mesid') || '', 10);
          if (!Number.isNaN(mesId)) {
            const container = dependencies.getMessageTextContainer(mesEl) || mesEl;
            const selectionCtx = getSelectionContextInElement(container, { win: window, doc: document });
            return { mesEl, mesId, selectionCtx };
          }
        }
      }
    } catch {
      /* ignore */
    }

    // 2) iframe 内选择（同源/可访问的情况下）
    try {
      const frames = document.querySelectorAll('#chat iframe');
      for (const iframe of frames) {
        try {
          const win = iframe.contentWindow;
          const doc = iframe.contentDocument;
          if (!win || !doc) continue;
          const sel = win.getSelection?.();
          if (!sel || sel.isCollapsed || sel.rangeCount <= 0) continue;

          const mesEl = iframe.closest?.('#chat .mes[mesid]') || null;
          if (!mesEl) continue;

          const mesId = parseInt(mesEl.getAttribute('mesid') || '', 10);
          if (Number.isNaN(mesId)) continue;

          const container = doc.body || doc.documentElement;
          if (!container) continue;
          const selectionCtx = getSelectionContextInElement(container, { win, doc });
          return { mesEl, mesId, selectionCtx };
        } catch {
          // 跨域 iframe / blob 访问失败等：跳过
          continue;
        }
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  function normalizeAndMap(text, options) {
    const opts = {
      ignoreMarkdown: true,
      ignoreHtmlTags: false,
      treatBrAsNewline: true,
      ignorePunct: false,
      ...(options || {}),
    };

    /** @type {number[]} normIndex -> originalIndex */
    const map = [];
    let out = '';
    let lastWasSpace = false;

    for (let i = 0; i < text.length; i++) {
      let ch = text[i];
      if (ch === '\r') continue;

      // 处理 HTML 标签：在原文里经常存在（例如 <quest>xxx</quest> 或 <br>），
      // 但在选区（显示文本）里不会包含标签本体，导致无法匹配。
      if (opts.ignoreHtmlTags && ch === '<') {
        const close = text.indexOf('>', i + 1);
        // 避免把普通文本里的 "<" 误当标签：要求 200 字符内闭合
        if (close !== -1 && close - i <= 200) {
          const rawTag = text.slice(i + 1, close).trim();
          const tagName = rawTag.replace(/^[!/\s]+/, '').split(/[\s/>]/)[0]?.toLowerCase?.() || '';

          if (opts.treatBrAsNewline && (tagName === 'br' || tagName === 'p' || tagName === '/p' || tagName === 'div' || tagName === '/div')) {
            // 用一个空白占位，后续会统一折叠空白
            if (!lastWasSpace) {
              out += ' ';
              map.push(i);
              lastWasSpace = true;
            }
          }

          i = close;
          continue;
        }
      }

      // HTML entity（非常粗略的处理，主要覆盖常见场景；更复杂的交给模糊匹配兜底）
      if (opts.ignoreHtmlTags && ch === '&') {
        const semi = text.indexOf(';', i + 1);
        if (semi !== -1 && semi - i <= 20) {
          const ent = text.slice(i + 1, semi);
          let decoded = null;
          if (ent === 'nbsp') decoded = ' ';
          else if (ent === 'lt') decoded = '<';
          else if (ent === 'gt') decoded = '>';
          else if (ent === 'amp') decoded = '&';
          else if (ent === 'quot') decoded = '"';
          else if (ent === 'apos') decoded = "'";
          else if (ent.startsWith('#x')) {
            const code = parseInt(ent.slice(2), 16);
            if (Number.isFinite(code)) decoded = String.fromCharCode(code);
          } else if (ent.startsWith('#')) {
            const code = parseInt(ent.slice(1), 10);
            if (Number.isFinite(code)) decoded = String.fromCharCode(code);
          }

          if (decoded != null) {
            ch = decoded;
            i = semi;
          }
        }
      }

      if (opts.ignoreMarkdown && (ch === '*' || ch === '_' || ch === '~' || ch === '`')) continue;

      // 极端兜底：模糊匹配时忽略标点/符号（包含中英文标点），提升“正则处理/隐藏符号”场景的命中率
      if (opts.ignorePunct) {
        try {
          if (/\p{P}|\p{S}/u.test(ch)) continue;
        } catch {
          // older runtime fallback: 仅忽略常见标点
          if (/[\.,!?:;\-—–()\[\]{}<>"'“”‘’、，。！？：；【】（）《》]/.test(ch)) continue;
        }
      }

      // 统一空白：不同换行/空格都归一为一个空格，且连续空白折叠
      if (/\s/.test(ch)) {
        if (lastWasSpace) continue;
        ch = ' ';
        lastWasSpace = true;
      } else {
        lastWasSpace = false;
      }

      const lower = ch.toLowerCase();
      out += lower;
      // 注意：out 的索引是 UTF-16 code unit；这里 ch 是单个 code unit（我们按 i 遍历）
      map.push(i);
    }

    return { norm: out, map };
  }

  function commonSuffixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let count = 0;
    for (let i = 1; i <= n; i++) {
      if (a[a.length - i] !== b[b.length - i]) break;
      count++;
    }
    return count;
  }

  function commonPrefixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) break;
      count++;
    }
    return count;
  }

  function findBestMatchInEditor(rawText, selectionCtx, options) {
    if (!rawText || !selectionCtx?.selectedText) return null;

    const { selectedText, before, after, start, displayText } = selectionCtx;
    const displayLen = (displayText?.length || 0);
    const expectedRatio =
      typeof options?.expectedRatioOverride === 'number' && Number.isFinite(options.expectedRatioOverride)
        ? dependencies.clamp(options.expectedRatioOverride, 0, 1)
        : (displayLen > 0 ? dependencies.clamp(start / displayLen, 0, 1) : 0);

    const { norm: rawNorm, map: rawMap } = normalizeAndMap(String(rawText), options);
    const { norm: selNorm } = normalizeAndMap(String(selectedText), options);
    const { norm: beforeNorm } = normalizeAndMap(String(before || ''), options);
    const { norm: afterNorm } = normalizeAndMap(String(after || ''), options);

    if (!selNorm) return null;

    /** @type {number[]} */
    const indices = [];
    for (let idx = rawNorm.indexOf(selNorm); idx !== -1; idx = rawNorm.indexOf(selNorm, idx + 1)) {
      indices.push(idx);
      if (indices.length > 200) break; // 防御：避免极端长文本 + 极短 needle 卡死
    }

    if (!indices.length) return null;

    const expected = Math.round(rawNorm.length * expectedRatio);
    let best = { idx: indices[0], score: -Infinity };

    for (const idx of indices) {
      const left = rawNorm.slice(Math.max(0, idx - beforeNorm.length), idx);
      const right = rawNorm.slice(idx + selNorm.length, idx + selNorm.length + afterNorm.length);

      const scoreBefore = commonSuffixLen(left, beforeNorm);
      const scoreAfter = commonPrefixLen(right, afterNorm);

      // 越接近“选区大致相对位置”越好（用于进一步打破平分）
      const posPenalty = Math.abs(idx - expected) * 0.02;

      const score = scoreBefore + scoreAfter - posPenalty;
      if (score > best.score) best = { idx, score };
    }

    const startNorm = best.idx;
    const endNorm = best.idx + selNorm.length - 1;
    if (startNorm < 0 || endNorm >= rawMap.length) return null;

    const rawStart = rawMap[startNorm];
    const rawEnd = rawMap[endNorm] + 1;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) return null;

    return { start: rawStart, end: rawEnd, score: best.score };
  }

  function computeMatchWithFallbacks(text, selectionCtx, extra) {
    if (!text || !selectionCtx?.selectedText) return null;
    const expectedRatioOverride = extra?.expectedRatioOverride;

    // 1) 严格：忽略 Markdown 符号 + 空白归一
    let match = findBestMatchInEditor(text, selectionCtx, {
      ignoreMarkdown: true,
      ignorePunct: false,
      expectedRatioOverride,
    });

    // 2) HTML 兜底：忽略标签（解决 <quest>xxx</quest> / <br> / 自定义标签等导致的差异）
    if (!match) {
      match = findBestMatchInEditor(text, selectionCtx, {
        ignoreMarkdown: true,
        ignoreHtmlTags: true,
        ignorePunct: false,
        expectedRatioOverride,
      });
    }

    // 3) 更模糊兜底：忽略标点/符号
    if (!match) {
      match = findBestMatchInEditor(text, selectionCtx, {
        ignoreMarkdown: true,
        ignoreHtmlTags: true,
        ignorePunct: true,
        expectedRatioOverride,
      });
    }

    return match;
  }

  function pickBetterMatch(a, b) {
    if (!a) return b;
    if (!b) return a;
    const sa = typeof a.score === 'number' ? a.score : -Infinity;
    const sb = typeof b.score === 'number' ? b.score : -Infinity;
    return sb > sa ? b : a;
  }

  function mapMatchToTextarea(textareaText, otherText, otherMatch) {
    if (!textareaText || !otherText || !otherMatch) return null;
    if (textareaText === otherText) return otherMatch;

    try {
      const needle = otherText.slice(otherMatch.start, otherMatch.end);
      if (!needle) return null;

      // 先尝试直接查找（仅当唯一命中时使用，避免重复子串误判）
      const first = textareaText.indexOf(needle);
      if (first !== -1) {
        const second = textareaText.indexOf(needle, first + needle.length);
        if (second === -1) {
          return { start: first, end: first + needle.length, score: otherMatch.score };
        }
      }

      const before = otherText.slice(Math.max(0, otherMatch.start - 60), otherMatch.start);
      const after = otherText.slice(otherMatch.end, otherMatch.end + 60);
      const pseudo = {
        selectedText: needle,
        before,
        after,
        displayText: otherText,
        start: otherMatch.start,
        end: otherMatch.end,
      };

      const ratio = otherText.length > 0 ? dependencies.clamp(otherMatch.start / otherText.length, 0, 1) : 0;
      return computeMatchWithFallbacks(textareaText, pseudo, { expectedRatioOverride: ratio });
    } catch {
      return null;
    }
  }

  function computeBestMatchForTextarea(textareaText, ctxText, selectionCtx) {
    if (!textareaText || !selectionCtx?.selectedText) return null;

    const base = computeMatchWithFallbacks(textareaText, selectionCtx, null);
    let best = base;

    if (ctxText) {
      const ctxMatch = computeMatchWithFallbacks(ctxText, selectionCtx, null);
      if (ctxMatch) {
        const ratio = ctxText.length > 0 ? dependencies.clamp(ctxMatch.start / ctxText.length, 0, 1) : 0;

        // 用 ctx 的“相对位置”帮助 textarea 在重复子串中选对位置
        const adjusted = computeMatchWithFallbacks(textareaText, selectionCtx, { expectedRatioOverride: ratio });
        best = pickBetterMatch(best, adjusted);

        // 用 ctx 命中的前后上下文，反推 textarea 中的位置。
        // 显著改善“选区来自 iframe 渲染 UI（上下文与原文完全不同）”时的定位效果。
        try {
          const needle = ctxText.slice(ctxMatch.start, ctxMatch.end);
          const before = ctxText.slice(Math.max(0, ctxMatch.start - 60), ctxMatch.start);
          const after = ctxText.slice(ctxMatch.end, ctxMatch.end + 60);
          const ctxDrivenCtx = {
            selectedText: needle,
            before,
            after,
            displayText: ctxText,
            start: ctxMatch.start,
            end: ctxMatch.end,
          };
          const ctxDriven = computeMatchWithFallbacks(textareaText, ctxDrivenCtx, { expectedRatioOverride: ratio });
          best = pickBetterMatch(best, ctxDriven);
        } catch {
          /* ignore */
        }

        // 若仍然失败，则尝试把 ctx 命中的片段映射回 textarea
        if (!best) {
          const mapped = mapMatchToTextarea(textareaText, ctxText, ctxMatch);
          if (mapped) best = mapped;
        }
      }
    }

    return best;
  }

  return { getSelectionContextInElement, getSelectionInfo, normalizeAndMap, commonSuffixLen, commonPrefixLen, findBestMatchInEditor, computeMatchWithFallbacks, pickBetterMatch, mapMatchToTextarea, computeBestMatchForTextarea };
}
