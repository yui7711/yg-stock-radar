/* =========================================================================
 * manual.js — 妖股雷达 · 「情绪周期交易体系 · 完整判定手册」全文阅读器
 * -------------------------------------------------------------------------
 * 纯原生 JS（IIFE），零外部依赖。暴露：
 *   window.YGManual = { render: function (rootEl, opts) { ... } }
 *
 * opts 可选（三个参数可组合；不传时行为与旧版全文模式 100% 一致）：
 *   chapterIds: Array<string>  只渲染指定 id 的章节（保持数据源原顺序）；
 *                              章节树 / 搜索索引 / 顶部统计同步限定。
 *   compact:    boolean        true 时隐藏大标题、免责声明、口径小卡。
 *   showTree:   boolean        false 时隐藏左栏章节树，文章单列占满宽度。
 *
 * 数据来源：assets/manual-data.js 的 window.YGManualChapters（兼容 window.CHAPTERS）
 *   [{ id, icon, title, lead, sections: [{ id, title, en, blocks: [...] }] }, ...]
 *
 * 重要：p / box / table / kv / check / tl / flow / stages / duo / cnodes / case
 * 等块的字段内含 HTML 片段（<b>、<span class="tag t-dn">、<em> 等），必须原样
 * 写入 innerHTML；仅 formula 与「结构性纯文本」做转义。整体转义会导致格式全丢。
 *
 * 可重复调用：每次 render() 先撤销上一实例的 AbortController / rAF /
 * MutationObserver；所有事件（含 window 级 scroll / resize）都挂在同一 signal 上，
 * 交互事件统一委托在 rootEl 上；不创建任何常驻定时器。
 * ========================================================================= */
(function (global) {
  'use strict';

  var DOC = global.document;

  /* ----------------------------------------------------------------------
   * 常量：照抄 _ref/hb_index.html footer 的免责声明原文（含版本行）
   * -------------------------------------------------------------------- */
  var DISCLAIMER_HTML =
    '<p class="mn-notice-p"><b>免责声明：</b>本手册为交易方法论与研究框架整理，所有数值阈值为基于历史统计的<em>经验参考区间</em>，需随市场容量、制度与流动性环境动态校准。内容不构成任何投资建议，不推荐任何具体标的。市场有风险，决策请独立判断。</p>' +
    '<p class="mn-notice-dim">情绪周期交易体系 · 判定手册 v1.0</p>';

  var CALIBER_NOTE = '本站结论条使用 5 阶段简化口径，本手册为参考体系 8 阶段原表，两者口径不同，不互相覆盖';

  var MOBILE_QUERY = '(max-width: 820px)';
  var MAX_RESULTS = 18;

  /* ----------------------------------------------------------------------
   * 通用工具
   * -------------------------------------------------------------------- */

  /** HTML 转义：仅用于 formula、结构性纯文本与搜索查询词。 */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 去除标签，返回纯文本（搜索索引用）。 */
  function strip(value) {
    return String(value == null ? '' : value)
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  }

  /** 递归收集任意字段中的纯文本，保证 12 种块的所有正文都被索引覆盖。 */
  function collectText(value, out) {
    if (value == null) return;
    var type = typeof value;
    if (type === 'string') { out.push(strip(value)); return; }
    if (type === 'number' || type === 'boolean') { out.push(String(value)); return; }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) collectText(value[i], out);
      return;
    }
    if (type === 'object') {
      Object.keys(value).forEach(function (key) { collectText(value[key], out); });
    }
  }

  /** 收集单个 block 的正文纯文本：排除块类型标记 t，保留内嵌对象的 t 标题。 */
  function blockText(block) {
    var out = [];
    Object.keys(block).forEach(function (key) {
      if (key === 't') return;
      collectText(block[key], out);
    });
    return out.join(' ');
  }

  /** 章 / 节锚点 id 加 mn- 前缀，避免与主站其它 id 冲突。 */
  function chAnchor(id) { return 'mn-ch-' + id; }
  function secAnchor(id) { return 'mn-sec-' + id; }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  /** 归一化可选参数：非对象 / 缺省一律退回全文模式，保证向后兼容。 */
  function normalizeOptions(opts) {
    var raw = (opts && typeof opts === 'object') ? opts : {};
    var hasChapterFilter = Array.isArray(raw.chapterIds);
    return {
      hasChapterFilter: hasChapterFilter,
      chapterIds: hasChapterFilter ? raw.chapterIds : null,
      compact: raw.compact === true,
      showTree: raw.showTree !== false
    };
  }

  /** 按 id 白名单过滤章节：遍历数据源，天然保持原数组顺序。 */
  function filterChapters(source, ids) {
    var wanted = Object.create(null);
    ids.forEach(function (id) { wanted[String(id)] = true; });
    return source.filter(function (ch) {
      return !!ch && wanted[String(ch.id)] === true;
    });
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 大小写不敏感高亮，输出已转义的安全 HTML。 */
  function highlight(text, query) {
    var raw = String(text == null ? '' : text);
    if (!query) return esc(raw);
    var re = new RegExp(escapeRegExp(query), 'gi');
    var out = '';
    var last = 0;
    var match;
    while ((match = re.exec(raw)) !== null) {
      out += esc(raw.slice(last, match.index));
      out += '<mark class="mn-hl">' + esc(match[0]) + '</mark>';
      last = match.index + match[0].length;
      if (match[0].length === 0) re.lastIndex += 1;
    }
    out += esc(raw.slice(last));
    return out;
  }

  /* ----------------------------------------------------------------------
   * renderBlock —— 直接移植 _ref/hb_app.js，仅把类名统一为 mn- 前缀、
   * 增加空数组防御；正文 HTML 片段一律原样插入（不转义）。
   * 覆盖 12 种类型：p / formula / box / table / kv / check / tl / flow /
   *                 stages / duo / cnodes / case
   * -------------------------------------------------------------------- */
  function renderBlock(b) {
    switch (b.t) {
      case 'p':
        return '<p class="mn-p">' + b.v + '</p>';

      case 'formula':
        return '<div class="mn-formula">' + esc(b.v) + '</div>';

      case 'box': {
        var body = (b.b || []).map(function (x) { return '<p>' + x + '</p>'; }).join('');
        return '<div class="mn-box mn-box--' + esc(b.k || 'info') + '">' +
          '<div class="mn-box-title">' + (b.ti || '') + '</div>' + body + '</div>';
      }

      case 'table': {
        var cap = b.cap ? '<div class="mn-table-cap">' + b.cap + '</div>' : '';
        var head = (b.head || []).map(function (x) { return '<th>' + x + '</th>'; }).join('');
        var rows = (b.rows || []).map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
        }).join('');
        return '<div class="mn-table-wrap">' + cap +
          '<table class="mn-table"><thead><tr>' + head + '</tr></thead><tbody>' + rows +
          '</tbody></table></div>';
      }

      case 'kv':
        return '<div class="mn-kv">' + (b.items || []).map(function (it) {
          return '<div>' + it[0] + '</div><div>' + it[1] + '</div>';
        }).join('') + '</div>';

      case 'check':
        return '<div class="mn-check">' + (b.items || []).map(function (x, i) {
          return '<div class="mn-check-item"><span class="mn-check-num">' + (i + 1) +
            '</span><span>' + x + '</span></div>';
        }).join('') + '</div>';

      case 'tl':
        return '<div class="mn-tl">' + (b.items || []).map(function (x) {
          return '<div class="mn-tl-item"><h6>' + x.t + '</h6><p>' + x.p + '</p></div>';
        }).join('') + '</div>';

      case 'flow':
        return '<div class="mn-flow">' + (b.items || []).map(function (x) {
          return '<div class="mn-flow-node"><div class="mn-flow-t">' + x.t +
            '</div><div class="mn-flow-s">' + x.s + '</div><div class="mn-flow-x">' + x.x +
            '</div></div>';
        }).join('') + '</div>';

      case 'duo':
        return '<div class="mn-duo">' +
          '<div class="mn-duo-good"><h6>' + b.good.t + '</h6><ul class="mn-list">' +
          (b.good.items || []).map(function (x) { return '<li>' + x + '</li>'; }).join('') +
          '</ul></div>' +
          '<div class="mn-duo-bad"><h6>' + b.bad.t + '</h6><ul class="mn-list">' +
          (b.bad.items || []).map(function (x) { return '<li>' + x + '</li>'; }).join('') +
          '</ul></div></div>';

      case 'case': {
        var meta = (b.meta || []).map(function (m) {
          return '<div>' + m[0] + '</div><div>' + m[1] + '</div>';
        }).join('');
        return '<div class="mn-case">' +
          '<div class="mn-case-head"><div class="mn-case-title">' + b.name +
          '</div><div class="mn-case-sub">' + (b.sub || '') + '</div></div>' +
          '<div class="mn-case-body">' +
          (meta ? '<div class="mn-kv">' + meta + '</div>' : '') +
          (b.why ? '<div class="mn-box mn-box--key mn-case-why">' +
            '<div class="mn-box-title">为什么选这个案例</div><p>' + b.why + '</p></div>' : '') +
          '</div></div>';
      }

      case 'cnodes':
        return '<div class="mn-cnodes">' + (b.items || []).map(function (x, i) {
          return '<div class="mn-cnode">' +
            '<div class="mn-cnode-head"><span class="mn-cn-idx">' + (i + 1) + '</span>' +
            '<div class="mn-cn-hd"><div class="mn-cn-t">' + x.title + '</div>' +
            '<div class="mn-cn-d">' + x.d + ' · ' + x.date + '</div></div>' +
            '<span class="tag t-' + esc(x.tc || 'gy') + '">' + x.tag + '</span></div>' +
            '<div class="mn-cnode-body">' +
            '<div class="mn-cn-row"><span class="mn-cn-lb mn-cn-lb--1">盘面</span><span>' + x.scene + '</span></div>' +
            '<div class="mn-cn-row"><span class="mn-cn-lb mn-cn-lb--2">判定</span><span>' + x.judge + '</span></div>' +
            '<div class="mn-cn-row"><span class="mn-cn-lb mn-cn-lb--3">操作</span><span>' + x.op + '</span></div>' +
            '<div class="mn-cn-row"><span class="mn-cn-lb mn-cn-lb--4">结果</span><span>' + x.res + '</span></div>' +
            '</div></div>';
        }).join('') + '</div>';

      case 'stages':
        return '<div class="mn-stages">' + (b.items || []).map(function (s, i) {
          var tags = (s.tags || []).map(function (tg) {
            return '<span class="tag t-' + esc(tg[1]) + '">' + tg[0] + '</span>';
          }).join('');
          var cols = (s.cols || []).map(function (c) {
            return '<div class="mn-st-col"><h6>' + c.h + '</h6><ul>' +
              (c.li || []).map(function (x) { return '<li>' + x + '</li>'; }).join('') +
              '</ul></div>';
          }).join('');
          var foot = (s.foot || []).map(function (f) {
            return '<div><b>' + f[0] + '：</b>' + f[1] + '</div>';
          }).join('');
          return '<div class="mn-stage" data-mn-st="' + i + '">' +
            '<div class="mn-stage-head"><span class="mn-st-idx">' + (i + 1) + '</span>' +
            '<div><div class="mn-st-name">' + s.n + '</div>' +
            '<div class="mn-st-alias">' + (s.a || '') + '</div></div>' +
            '<div class="mn-st-meta">' + tags + '</div></div>' +
            '<div class="mn-stage-body"><div class="mn-st-grid">' + cols + '</div>' +
            (foot ? '<div class="mn-st-foot">' + foot + '</div>' : '') +
            '</div></div>';
        }).join('') + '</div>';

      default:
        return '';
    }
  }

  /* ----------------------------------------------------------------------
   * 章节 / 章节树 / 顶部结构构建
   * -------------------------------------------------------------------- */

  /** 渲染单章全文（head + 全部 section + 全部 block）。 */
  function buildChapterHtml(ch, index) {
    var secHtml = (ch.sections || []).map(function (sec) {
      return '<section class="mn-sec" id="' + secAnchor(sec.id) + '" data-mn-sec="' + esc(sec.id) + '">' +
        '<h3 class="mn-sec-title">' + sec.title +
        (sec.en ? ' <span class="mn-sec-en">' + sec.en + '</span>' : '') + '</h3>' +
        (sec.blocks || []).map(renderBlock).join('') + '</section>';
    }).join('');

    return '<article class="mn-chapter" id="' + chAnchor(ch.id) + '" data-mn-ch="' + esc(ch.id) + '">' +
      '<header class="mn-chapter-head">' +
      '<div class="mn-chapter-kicker">CHAPTER ' + two(index + 1) + '</div>' +
      '<h2 class="mn-chapter-title"><span class="mn-chapter-icon">' + ch.icon + '</span> ' +
      ch.title + '</h2>' +
      (ch.lead ? '<p class="mn-chapter-lead">' + ch.lead + '</p>' : '') +
      '</header>' + secHtml + '</article>';
  }

  /** 渲染左侧章节树：26 章 + 每章节列表。 */
  function buildTreeHtml(chapters) {
    return '<div class="mn-tree">' + chapters.map(function (ch, ci) {
      var links = (ch.sections || []).map(function (sec, si) {
        return '<button type="button" class="mn-link" data-mn-target="' + secAnchor(sec.id) +
          '" data-mn-sec="' + esc(sec.id) + '" data-mn-ch="' + esc(ch.id) + '">' +
          '<span class="mn-link-num">' + (si + 1) + '</span>' +
          '<span class="mn-link-text">' + esc(strip(sec.title)) + '</span></button>';
      }).join('');

      return '<div class="mn-group' + (ci === 0 ? ' is-open' : '') +
        '" data-mn-group="' + esc(ch.id) + '">' +
        '<button type="button" class="mn-group-title" data-mn-target="' + chAnchor(ch.id) +
        '" data-mn-group-toggle="' + esc(ch.id) + '">' +
        '<span class="mn-group-text"><span class="mn-group-icon">' + ch.icon + '</span> ' +
        esc(strip(ch.title)) + '</span><span class="mn-group-arrow">▶</span></button>' +
        '<div class="mn-group-list">' + links + '</div></div>';
    }).join('') + '</div>';
  }

  function buildHeaderHtml(chapterCount, sectionCount, blockCount) {
    return '<header class="mn-header">' +
      '<div class="mn-header-kicker">REFERENCE MANUAL · 完整原文</div>' +
      '<h1 class="mn-header-title">情绪周期交易体系 · 完整判定手册</h1>' +
      '<div class="mn-header-meta">' +
      '<span class="mn-stat"><b>' + chapterCount + '</b> 章 / <b>' + sectionCount + '</b> 节</span>' +
      '<span class="mn-stat mn-stat--sub">' + blockCount + ' 个内容块 · 全文无删减</span>' +
      '</div></header>';
  }

  function buildNoticeHtml() {
    return '<section class="mn-notice">' +
      '<div class="mn-notice-body">' + DISCLAIMER_HTML + '</div>' +
      '<div class="mn-caliber"><span class="mn-caliber-icon">ⓘ</span>' +
      '<span class="mn-caliber-text">' + CALIBER_NOTE + '</span></div>' +
      '</section>';
  }

  function buildToolbarHtml() {
    return '<div class="mn-toolbar"><div class="mn-search">' +
      '<svg class="mn-search-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>' +
      '<input class="mn-search-input" type="text" inputmode="search" autocomplete="off" ' +
      'spellcheck="false" aria-label="搜索手册全文" ' +
      'placeholder="搜索概念 / 判定 / 策略…（如：良性分歧、成龙点、补涨）">' +
      '<button type="button" class="mn-search-clear" hidden aria-label="清空搜索">✕</button>' +
      '<div class="mn-search-result" role="listbox"></div>' +
      '</div></div>';
  }

  /** 构建搜索索引：章节 + 小节，正文用递归 strip 后的纯文本。 */
  function buildIndex(chapters) {
    var index = [];
    chapters.forEach(function (ch) {
      var chapterText = (strip(ch.title) + ' ' + strip(ch.lead || ''))
        .replace(/\s+/g, ' ').trim();
      index.push({
        kind: '章节',
        title: strip(ch.title),
        target: chAnchor(ch.id),
        chId: ch.id,
        secId: '',
        text: chapterText,
        lower: chapterText.toLowerCase()
      });

      (ch.sections || []).forEach(function (sec) {
        var parts = [strip(sec.title), strip(sec.en || '')];
        (sec.blocks || []).forEach(function (b) { parts.push(blockText(b)); });
        var text = parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
        index.push({
          kind: '小节',
          title: strip(sec.title),
          target: secAnchor(sec.id),
          chId: ch.id,
          secId: sec.id,
          text: text,
          lower: text.toLowerCase()
        });
      });
    });
    return index;
  }

  /* ----------------------------------------------------------------------
   * render(rootEl, opts) —— 主入口
   * -------------------------------------------------------------------- */
  function render(rootEl, opts) {
    if (!rootEl || typeof rootEl.querySelector !== 'function') {
      throw new TypeError('YGManual.render(rootEl): rootEl 必须是 DOM 元素');
    }

    /* 1) 撤销上一实例（切 tab 来回时避免监听 / Observer 累积）。 */
    var previous = rootEl.__ygManualCleanup;
    if (typeof previous === 'function') previous();

    var options = normalizeOptions(opts);
    var sourceChapters = global.YGManualChapters || global.CHAPTERS || [];
    if (!Array.isArray(sourceChapters)) sourceChapters = [];
    var chapters = options.hasChapterFilter
      ? filterChapters(sourceChapters, options.chapterIds)
      : sourceChapters;

    var sectionCount = 0;
    var blockCount = 0;
    chapters.forEach(function (ch) {
      (ch.sections || []).forEach(function (sec) {
        sectionCount += 1;
        blockCount += (sec.blocks || []).length;
      });
    });

    /* 2) 本实例的资源句柄：所有监听共用 signal，全部可被一次性撤销。 */
    var controller = (typeof global.AbortController === 'function')
      ? new global.AbortController() : null;
    var signal = controller ? controller.signal : null;
    var rafId = 0;
    var observer = null;
    var shell = null; /* 本实例的根容器，cleanup 时一并移除，保证「每次重建」 */
    var cleaned = false;

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (controller) controller.abort();
      if (rafId) { global.cancelAnimationFrame(rafId); rafId = 0; }
      if (observer) { observer.disconnect(); observer = null; }
      if (shell && shell.parentNode === rootEl) rootEl.removeChild(shell);
      if (rootEl.__ygManualCleanup === cleanup) {
        try { delete rootEl.__ygManualCleanup; }
        catch (e) { rootEl.__ygManualCleanup = undefined; }
      }
    }
    rootEl.__ygManualCleanup = cleanup;

    /** 统一绑定：全部带上 AbortSignal。 */
    function on(target, type, handler, options) {
      var opt = Object.assign({}, options || {});
      if (signal) opt.signal = signal;
      target.addEventListener(type, handler, opt);
    }

    /* 3) 生成骨架并挂载。 */
    shell = DOC.createElement('div');
    shell.className = 'mn-root' +
      (options.compact ? ' mn-compact' : '') +
      (options.showTree ? '' : ' mn-single');

    /* 数据源本身为空且未启用章节过滤：保留原有降级提示（向后兼容）。 */
    if (!chapters.length && !options.hasChapterFilter) {
      shell.innerHTML = buildHeaderHtml(0, 0, 0) + buildNoticeHtml() +
        '<div class="mn-empty">完整手册数据未加载，请刷新页面重试。</div>';
      rootEl.appendChild(shell);
      return;
    }

    /* 章节过滤后为空：仍走完整流程（事件 / cleanup 一致），给出友好提示。 */
    var emptyMessage = '未找到对应章节：请检查栏目配置的 chapterIds' +
      '（手册数据源共 ' + sourceChapters.length + ' 章）。';

    var headerPart = options.compact
      ? ''
      : buildHeaderHtml(chapters.length, sectionCount, blockCount);
    var noticePart = options.compact ? '' : buildNoticeHtml();
    var sidePart = options.showTree
      ? '<aside class="mn-side">' +
          '<details class="mn-toc" open>' +
            '<summary class="mn-toc-summary"><span class="mn-toc-summary-title">☰ 目录</span>' +
            '<span class="mn-toc-summary-meta">' + chapters.length + ' 章 / ' + sectionCount +
            ' 节</span></summary>' +
            buildTreeHtml(chapters) +
          '</details>' +
        '</aside>'
      : '';
    var articlePart = chapters.length
      ? chapters.map(buildChapterHtml).join('')
      : '<div class="mn-empty mn-empty--nomatch">' + emptyMessage + '</div>';
    var footPart = chapters.length
      ? '<footer class="mn-foot">情绪周期交易体系 · 判定手册 v1.0</footer>'
      : '';

    shell.innerHTML = headerPart + noticePart + buildToolbarHtml() +
      '<div class="mn-layout">' + sidePart +
        '<div class="mn-main">' +
          '<div class="mn-article">' + articlePart + '</div>' + footPart +
        '</div>' +
      '</div>';

    rootEl.appendChild(shell);

    /* 4) 缓存本实例内的 DOM 引用与映射表。 */
    var searchInput = shell.querySelector('.mn-search-input');
    var resultBox = shell.querySelector('.mn-search-result');
    var toc = shell.querySelector('.mn-toc');
    var tree = shell.querySelector('.mn-tree');
    var secs = [].slice.call(shell.querySelectorAll('.mn-sec'));
    var index = buildIndex(chapters);

    var linkBySec = {};
    shell.querySelectorAll('.mn-link').forEach(function (el) {
      linkBySec[el.dataset.mnSec] = el;
    });
    var groupByCh = {};
    shell.querySelectorAll('.mn-group').forEach(function (el) {
      groupByCh[el.dataset.mnGroup] = el;
    });

    /* 5) 高亮 / 展开 / 滚动定位。 */
    function setActive(secId, chId) {
      shell.querySelectorAll('.mn-link.is-active').forEach(function (el) {
        el.classList.remove('is-active');
      });
      shell.querySelectorAll('.mn-group.is-current').forEach(function (el) {
        el.classList.remove('is-current');
      });
      if (secId && linkBySec[secId]) linkBySec[secId].classList.add('is-active');
      if (chId && groupByCh[chId]) groupByCh[chId].classList.add('is-current');
    }

    function openGroup(chId) {
      if (!chId || !groupByCh[chId]) return;
      var target = groupByCh[chId];
      if (target.classList.contains('is-open')) return;
      shell.querySelectorAll('.mn-group.is-open').forEach(function (el) {
        el.classList.remove('is-open');
      });
      target.classList.add('is-open');
    }

    function toggleGroup(chId) {
      var target = groupByCh[chId];
      if (!target) return;
      shell.querySelectorAll('.mn-group.is-open').forEach(function (el) {
        el.classList.remove('is-open');
      });
      target.classList.add('is-open');
    }

    function scrollLinkIntoView(link) {
      if (!link || !tree) return;
      var linkRect = link.getBoundingClientRect();
      var treeRect = tree.getBoundingClientRect();
      if (!treeRect.height) return; /* 移动端抽屉收起时树不可见 */
      if (linkRect.top < treeRect.top + 24 || linkRect.bottom > treeRect.bottom - 24) {
        tree.scrollTop += (linkRect.top - treeRect.top) - treeRect.height / 2;
      }
    }

    function runSpy() {
      if (cleaned || !DOC.documentElement.contains(shell)) return;
      var threshold = isMobile() ? 132 : 96;
      var current = null;
      for (var i = 0; i < secs.length; i++) {
        if (secs[i].getBoundingClientRect().top <= threshold) current = secs[i];
        else break; /* sections 按文档顺序，rect.top 单调递增 */
      }
      if (!current) current = secs[0];
      if (!current) return;

      var secId = current.dataset.mnSec;
      var chapter = current.closest('.mn-chapter');
      var chId = chapter ? chapter.dataset.mnCh : '';
      setActive(secId, chId);
      openGroup(chId);
      scrollLinkIntoView(linkBySec[secId]);
    }

    var spyScheduled = false;
    function scheduleSpy() {
      if (spyScheduled || cleaned) return;
      spyScheduled = true;
      rafId = global.requestAnimationFrame(function () {
        rafId = 0;
        spyScheduled = false;
        runSpy();
      });
    }

    function jumpTo(anchorId, flash) {
      var node = shell.querySelector('#' + anchorId);
      if (!node) return;
      try {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        global.scrollTo(0, node.getBoundingClientRect().top + global.pageYOffset - 96);
      }

      if (flash) {
        shell.querySelectorAll('.mn-flash').forEach(function (n) {
          n.classList.remove('mn-flash');
        });
        void node.offsetWidth; /* 强制重排以重启动画 */
        node.classList.add('mn-flash');
      }

      var chapter = node.closest('.mn-chapter');
      var chId = chapter ? chapter.dataset.mnCh : node.dataset.mnCh;
      openGroup(chId);
      if (node.dataset.mnSec) setActive(node.dataset.mnSec, chId);
      if (toc && isMobile()) toc.open = false; /* 移动端跳完收起抽屉 */
      scheduleSpy();
    }

    /* 6) 搜索：实时过滤索引，展示命中片段，点击跳转 + 闪烁高亮。 */
    function runSearch(rawQuery) {
      if (!resultBox) return;
      var q = String(rawQuery || '').trim();
      var clearBtn = shell.querySelector('.mn-search-clear');
      if (clearBtn) clearBtn.hidden = !q;

      if (!q) {
        resultBox.classList.remove('is-on');
        resultBox.innerHTML = '';
        shell.querySelectorAll('.mn-flash').forEach(function (n) {
          n.classList.remove('mn-flash');
        });
        return;
      }

      var lower = q.toLowerCase();
      var res = [];
      for (var i = 0; i < index.length && res.length < MAX_RESULTS; i++) {
        var it = index[i];
        if (it.title.toLowerCase().indexOf(lower) >= 0 || it.lower.indexOf(lower) >= 0) {
          res.push(it);
        }
      }

      if (!res.length) {
        resultBox.innerHTML = '<div class="mn-search-empty">未找到「' + esc(q) + '」相关内容</div>';
      } else {
        resultBox.innerHTML =
          '<div class="mn-search-count">共 ' + res.length + ' 条命中' +
          (res.length === MAX_RESULTS ? '（最多显示 ' + MAX_RESULTS + ' 条）' : '') + '</div>' +
          res.map(function (r) {
            var pos = r.lower.indexOf(lower);
            var snippet = pos >= 0
              ? r.text.slice(Math.max(0, pos - 40), pos + 120)
              : r.text.slice(0, 140);
            return '<button type="button" class="mn-search-item" data-mn-target="' + r.target + '">' +
              '<span class="mn-search-line"><span class="mn-search-kind">' + r.kind + '</span>' +
              '<span class="mn-search-title">' + highlight(r.title, q) + '</span></span>' +
              '<span class="mn-search-snippet">' + highlight(snippet, q) + '</span></button>';
          }).join('');
      }
      resultBox.classList.add('is-on');
    }

    function clearSearch(focus) {
      if (searchInput) searchInput.value = '';
      if (resultBox) {
        resultBox.classList.remove('is-on');
        resultBox.innerHTML = '';
      }
      var clearBtn = shell.querySelector('.mn-search-clear');
      if (clearBtn) clearBtn.hidden = true;
      shell.querySelectorAll('.mn-flash').forEach(function (n) {
        n.classList.remove('mn-flash');
      });
      if (focus && searchInput) searchInput.focus();
    }

    /* 7) 委托事件：全部绑在 rootEl 或共用 signal 的 window 上。 */
    function onClick(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var el;

      /* 阶段卡折叠 */
      el = target.closest('.mn-stage-head');
      if (el && shell.contains(el)) {
        var stage = el.closest('.mn-stage');
        if (stage) stage.classList.toggle('is-collapsed');
        return;
      }

      /* 搜索结果项：先清搜索（会移除旧 flash），再跳转（重新加 flash） */
      el = target.closest('.mn-search-item');
      if (el && shell.contains(el)) {
        clearSearch(false);
        jumpTo(el.dataset.mnTarget, true);
        return;
      }

      /* 清空按钮 */
      el = target.closest('.mn-search-clear');
      if (el && shell.contains(el)) {
        clearSearch(true);
        return;
      }

      /* 章节组标题 / 小节链接：平滑滚动到锚点 */
      el = target.closest('[data-mn-target]');
      if (el && shell.contains(el)) {
        if (el.dataset.mnGroupToggle) toggleGroup(el.dataset.mnGroupToggle);
        jumpTo(el.dataset.mnTarget, false);
        return;
      }

      /* 点击搜索框以外（本模块内）→ 收起结果面板 */
      if (resultBox && !target.closest('.mn-search')) {
        resultBox.classList.remove('is-on');
      }
    }
    on(rootEl, 'click', onClick);

    function onInput(event) {
      if (!event.target || !event.target.classList ||
          !event.target.classList.contains('mn-search-input')) return;
      runSearch(event.target.value);
    }
    on(rootEl, 'input', onInput);

    function onKeydown(event) {
      if (!event.target || !event.target.classList ||
          !event.target.classList.contains('mn-search-input')) return;
      if (event.key === 'Escape') {
        clearSearch(false);
        event.target.blur();
        return;
      }
      if (event.key === 'Enter' && resultBox) {
        var first = resultBox.querySelector('.mn-search-item');
        if (first) {
          clearSearch(false);
          jumpTo(first.dataset.mnTarget, true);
        }
      }
    }
    on(rootEl, 'keydown', onKeydown);

    /* 8) 桌面/移动断点：details 抽屉状态，只在跨断点时同步。 */
    function isMobile() {
      if (global.matchMedia) return global.matchMedia(MOBILE_QUERY).matches;
      return global.innerWidth <= 820;
    }
    function syncTocOpen() {
      if (toc) toc.open = !isMobile();
    }
    var lastMobile = isMobile();

    function onResize() {
      var now = isMobile();
      if (now !== lastMobile) {
        lastMobile = now;
        syncTocOpen();
      }
      scheduleSpy();
    }
    on(global, 'scroll', scheduleSpy, { passive: true });
    on(global, 'resize', onResize);

    /* 9) 若主站清空了 rootEl（切到其它 tab），自动撤销本实例的全部资源。 */
    if (typeof global.MutationObserver === 'function') {
      observer = new global.MutationObserver(function () {
        if (!cleaned && !rootEl.contains(shell)) cleanup();
      });
      observer.observe(rootEl, { childList: true });
    }

    /* 10) 初始状态。 */
    syncTocOpen();
    runSpy();
  }

  global.YGManual = { render: render };
})(typeof window !== 'undefined' ? window : globalThis);
