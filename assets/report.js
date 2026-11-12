/* =========================================================================
 * report.js — 复盘报告系统（v20261112b）
 * -------------------------------------------------------------------------
 * 参考站「复盘报告」：午盘 / 收盘报告列表 + 详情页，报告生成时刻冻结数据。
 * 本站是纯前端 GitHub Pages 静态站，无服务端，因此：
 *   · 报告保存在浏览器 localStorage（key yg_reports_v1），最多 60 份；
 *   · 不冒充服务端落盘，列表页蓝色说明条如实写明；
 *   · 支持导出 / 导入 JSON 备份、删除单条；
 *   · 自动补生成：北京时间交易日 ≥11:31 补 noon、≥15:01 补 close；
 *     周末跳过；提前生成（如 10:23 生成收盘复盘）在头部如实标注。
 *
 * 结论全部复用既有模块，不重复造轮子：
 *   YGDecision.build(d)   -> 周期 / 拐点 / 板块评分 / 角色 / 计划 / 标的
 *   YGAutoFill.build(d)   -> 情绪温度计九维自动填值与取数依据
 *   YGViewsDeep.screen(d) -> 完整推导八段 / 主线 / 龙头体检（按需加载后调用）
 *   YGAutoFill.dragon(d, code) -> 龙头体检明细（详情页按需）
 * 报告对象冻结「生成时刻」的精简数据快照，详情页只读该快照，不读实时数据。
 * v_rep 不参与实时刷新；「刷新列表」只重读 localStorage 存档。
 *
 * 对外接口（window.YGReport）：
 *   render(rootEl, ctx) / renderList(rootEl, ctx) / renderDetail(rootEl, report, ctx)
 *   generate(type, ctx) -> Promise<report>   type: 'noon' | 'close'
 *   list() / remove(id) / exportAll() / importAll(json) / ensureAuto(ctx)
 *   open(id, ctx) / close(ctx)
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'yg_reports_v1';
  var MAX = 60;
  var AUTO_KEY = 'yg_reports_last_auto_v1';
  var currentId = null;
  var lastCtx = null;
  var busy = false;

  /* ------------------------------------------------------------------ 工具 */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v) { return (v == null || v === '' || isNaN(Number(v))) ? null : Number(v); }
  function has(v) { return v != null && v !== '' && !(typeof v === 'number' && isNaN(v)); }
  function fx(v, d) { var n = num(v); return n == null ? '—' : n.toFixed(d == null ? 2 : d); }
  function txt(v, suffix) { return has(v) ? esc(String(v) + (suffix || '')) : '<span class="yg-rep-na">— ? 缺项</span>'; }
  function S() { return global.YGSession || null; }
  function compact(s) { return String(s == null ? '' : s).replace(/-/g, '').slice(0, 8); }
  function isoOf(c) {
    var s = compact(c);
    return /^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : String(c || '');
  }
  function bjStamp() {
    var s = S();
    return s ? (s.todayISO() + ' ' + s.hhmmss()) : new Date().toISOString().replace('T', ' ').slice(0, 19);
  }
  function padId() { return String(Date.now()).slice(-6); }

  /* -------------------------------------------------------------- 持久化 */
  function readAll() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (r) { return r && typeof r === 'object' && r.id && r.date && r.type; });
    } catch (e) { return []; }
  }
  function sortReports(rs) {
    return rs.slice().sort(function (a, b) {
      var c = String(b.date || '').localeCompare(String(a.date || ''));
      if (c) return c;
      var t = String(b.type || '').localeCompare(String(a.type || ''));
      if (t) return t;
      return String(b.genAt || '').localeCompare(String(a.genAt || ''));
    });
  }
  function writeAll(rs) {
    var out = sortReports(rs).slice(0, MAX);
    try { global.localStorage && global.localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* 配额满时静默降为内存态 */ }
    return out;
  }
  function list() { return sortReports(readAll()); }
  function get(id) {
    var rs = readAll();
    for (var i = 0; i < rs.length; i++) if (rs[i].id === id) return rs[i];
    return null;
  }
  function remove(id) {
    var rs = readAll(), n = rs.length;
    var out = rs.filter(function (r) { return r.id !== id; });
    if (out.length === n) return false;
    writeAll(out);
    if (currentId === id) currentId = null;
    return true;
  }
  function exportAll() { return JSON.stringify({ app: 'yg-stock-radar', key: KEY, exportedAt: bjStamp(), reports: list() }, null, 2); }
  function importAll(json) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    var arr = Array.isArray(data) ? data : (data && Array.isArray(data.reports) ? data.reports : null);
    if (!arr) throw new Error('JSON 中未找到 reports 数组');
    var incoming = arr.filter(function (r) {
      return r && typeof r === 'object' && r.id && r.date && (r.type === 'noon' || r.type === 'close');
    }).map(function (r) {
      return {
        id: String(r.id), date: compact(r.date), type: r.type,
        typeLabel: r.typeLabel || (r.type === 'close' ? '收盘复盘（15:00）' : '午盘复盘（11:30）'),
        genAt: r.genAt || bjStamp(), sessionLabel: r.sessionLabel || '',
        dataAsOf: r.dataAsOf || '', early: !!r.early, T: num(r.T), stage: r.stage || null,
        summary: Array.isArray(r.summary) ? r.summary : [],
        conclusion: r.conclusion || null, plan: r.plan || null, targets: Array.isArray(r.targets) ? r.targets : [],
        mainline: Array.isArray(r.mainline) ? r.mainline : [], turning: Array.isArray(r.turning) ? r.turning : [],
        indTrend: Array.isArray(r.indTrend) ? r.indTrend : [], risks: Array.isArray(r.risks) ? r.risks : [],
        sources: Array.isArray(r.sources) ? r.sources : [], disclaimer: r.disclaimer || '',
        frozen: r.frozen || null
      };
    });
    var byId = {};
    var merged = list().concat(incoming);
    merged.forEach(function (r) { byId[r.id] = r; });
    var out = Object.keys(byId).map(function (k) { return byId[k]; });
    writeAll(out);
    return incoming.length;
  }

  /* ---------------------------------------------- 冻结生成时刻的数据快照 */
  /** 只保留复现结论所需的字段，剔除 market.ztPool/history/quotes 等大数组，
      避免 60 份报告撑爆 localStorage 5MB 配额；缺项一律 null，不编造。 */
  function pickFrozen(d) {
    d = d || {};
    var m = d.market || {};
    var ov = d.overview || {};
    var st = d.stats || {};
    function stockLite(x) {
      x = x || {};
      return {
        code: x.code || x.c || '', name: x.name || x.n || '',
        boards: num(x.boards != null ? x.boards : x.b), pct: num(x.pct != null ? x.pct : x.changePct),
        sector: x.sector || x.sec || '', seal: num(x.seal),
        cap: num(x.cap), turnover: num(x.turnover != null ? x.turnover : x.to),
        openTimes: num(x.openTimes != null ? x.openTimes : x.open),
        firstTime: x.firstTime || x.first || ''
      };
    }
    return {
      date: d.date || '', dateCompact: compact(d.date),
      source: d.source || '', sourceLabel: d.sourceLabel || '',
      notice: d.notice || '', dataTimeLabel: d.dataTimeLabel || '',
      intraday: !!d.intraday, session: d.session || '', preMarket: !!d.preMarket,
      overview: {
        date: ov.date || d.date || '', limitUp: num(ov.limitUp), maxBoards: num(ov.maxBoards),
        lianban: num(ov.lianban), zhaban: num(ov.zhaban), limitDown: num(ov.limitDown),
        sealRate: num(ov.sealRate), hotSectors: num(ov.hotSectors)
      },
      stats: {
        open_stock_count: num(st.open_stock_count), seal_rate: num(st.seal_rate),
        exact_boards: Array.isArray(st.exact_boards) ? st.exact_boards.slice(0, 12) : []
      },
      market: {
        date: m.date || '', ok: !!m.ok, ztCount: num(m.ztCount), zbCount: num(m.zbCount),
        dtCount: num(m.dtCount), zbRate: num(m.zbRate), sealRate: num(m.sealRate),
        maxBoards: num(m.maxBoards), lianbanCount: num(m.lianbanCount),
        prem: num(m.prem), promoRate: num(m.promoRate), damian: num(m.damian),
        upRatio: num(m.upRatio), amountToday: num(m.amountToday), volChange: num(m.volChange),
        upCount: num(m.upCount), downCount: num(m.downCount), backtracked: !!m.backtracked,
        mode: m.mode || '', errors: Array.isArray(m.errors) ? m.errors.slice(0, 12) : [],
        ztPoolLite: (m.ztPool || []).slice(0, 30).map(stockLite)
      },
      stocks: (d.stocks || []).slice(0, 30).map(stockLite),
      sectors: (d.sectors || []).slice(0, 12).map(function (x) {
        return { sector: x.sector || x.name || '', limitCount: num(x.limitCount != null ? x.limitCount : x.n), heat: num(x.heat) };
      }),
      lhb: (d.lhb || []).slice(0, 20).map(function (x) {
        return { name: x.name || x.n || '', net_value: num(x.net_value), org_net_value: num(x.org_net_value) };
      }),
      stocksTotal: (d.stocks || []).length,
      frozenAt: bjStamp()
    };
  }

  /* ------------------------------------------------------------ 结论组装 */
  function pickVal() {
    for (var i = 0; i < arguments.length; i++) {
      var n = num(arguments[i]);
      if (n != null) return n;
    }
    return null;
  }
  function sectorCountTop(list, n) {
    return (list || []).slice().sort(function (a, b) {
      var av = num(a.limitCount != null ? a.limitCount : a.n) || 0;
      var bv = num(b.limitCount != null ? b.limitCount : b.n) || 0;
      return bv - av;
    }).slice(0, n || 8).map(function (x) {
      return [String(x.sector || x.name || '—'), num(x.limitCount != null ? x.limitCount : x.n) || 0];
    });
  }
  function industryTrend(d) {
    var m = (d && d.market) || {};
    var rows = [];
    var hist = (m.history || []).slice(0, 3).reverse();
    hist.forEach(function (h) {
      rows.push({ date: compact(h.date || h.compact), top: sectorCountTop(h.sectorCounts, 8) });
    });
    rows.push({ date: compact(m.date || (d && d.date)), top: sectorCountTop(m.sectorCounts, 8) });
    return rows.filter(function (r) { return r.top.length; });
  }
  function sixOf(sec) {
    var six = sec && sec.six;
    if (!six) return [];
    if (Array.isArray(six)) return six.map(function (v, i) { return { k: String(v.k || v.name || ('维度' + (i + 1))), ok: !!v.ok }; });
    return Object.keys(six).map(function (k) { return { k: k, ok: !!six[k] }; });
  }
  function roleLite(o) {
    if (!o) return null;
    return {
      code: o.code || o.c || '', name: o.name || o.n || '',
      boards: num(o.boards != null ? o.boards : o.lb), pct: num(o.pct != null ? o.pct : o.changePct),
      turnover: num(o.turnover), cap: num(o.cap != null ? o.cap : o.mktcap)
    };
  }
  function buildTargets(B, V) {
    var out = [];
    var picked = (B && B.plan && B.plan.picked) || [];
    picked.forEach(function (p) {
      var s = p.s || {}, e = p.e || {}, sec = p.sec || {};
      out.push({
        role: p.role || '—', sector: sec.name || sec.sector || '—',
        code: s.code || '', name: s.name || '', boards: num(s.boards != null ? s.boards : s.lb),
        pct: num(s.pct != null ? s.pct : s.changePct), rank: num(p.rank),
        entry: {
          timing: e.timing || e.time || '—', method: e.method || e.act || '—',
          pos: e.pos || '—', certainty: e.certainty || '—',
          stop: e.stop || e.stopLoss || '—', target: e.target || e.goal || '—',
          cond: e.cond || e.condition || '—'
        },
        logic: Array.isArray(p.logic) ? p.logic : (p.logic ? [String(p.logic)] : []),
        fundText: p.fundText || ''
      });
    });
    if (!out.length && V && Array.isArray(V.picks)) {
      V.picks.slice(0, 3).forEach(function (p) {
        out.push({
          role: p.roleCn || p.role || '—', sector: p.sector || '—', code: p.code || '',
          name: p.name || '', boards: num(p.boards != null ? p.boards : p.lb), pct: num(p.pct),
          rank: num(p.rank),
          entry: { timing: p.entry || '—', method: '—', pos: '—', certainty: '—', stop: p.stopLine || '—', target: '—', cond: '—' },
          logic: [], fundText: ''
        });
      });
    }
    return out;
  }
  function buildMainline(B) {
    return ((B && B.sectors) || []).slice(0, 4).map(function (sec) {
      return {
        name: sec.name || sec.sector || '—', kind: sec.kind || '板块',
        score: num(sec.score), level: sec.level || '—',
        ztN: num(sec.ztN != null ? sec.ztN : (sec.limitCount != null ? sec.limitCount : sec.n)),
        maxLB: num(sec.maxLB != null ? sec.maxLB : sec.maxBoards),
        six: sixOf(sec),
        dragon: roleLite(sec.dragon), jun: roleLite(sec.jun), bub: roleLite(sec.bub),
        reasons: Array.isArray(sec.reasons) ? sec.reasons.slice(0, 4) : []
      };
    });
  }
  function buildTurning(B, V) {
    var cards = (B && B.turning && B.turning.cards) || [];
    var hits = cards.filter(function (c) { return c.hit && num(c.hit.yes) >= 2; }).map(function (c) {
      return {
        n: c.n || '—', a: c.a || '', op: c.op || '',
        yes: num(c.hit.yes), judged: num(c.hit.judged)
      };
    });
    if (!hits.length && V && Array.isArray(V.turning)) {
      hits = V.turning.slice(0, 4).map(function (t) {
        return { n: t.n || t.name || '—', a: t.a || '', op: t.op || t.action || '', yes: num(t.hitN != null ? t.hitN : t.hit), judged: null };
      });
    }
    return hits;
  }
  function buildSummary(d, B, F) {
    var m = (d && d.market) || {}, ov = (d && d.overview) || {}, st = (d && d.stats) || {};
    var X = B ? B.X : null;
    var mm = X ? X.m : {};
    var T = X ? num(X.T) : null;
    var stage = X && X.stage && X.stage.n ? X.stage.n : null;
    var zt = pickVal(m.ztCount, mm.ztCount, ov.limitUp, (d && d.stocks || []).length);
    var dt = pickVal(m.dtCount, mm.dtCount, ov.limitDown);
    var zb = pickVal(m.zbCount, mm.zbCount);
    var zbr = pickVal(m.zbRate, mm.zbRate);
    var maxLB = pickVal(m.maxBoards, mm.maxBoards, ov.maxBoards);
    var lb = pickVal(m.lianbanCount, mm.lianban, ov.lianban);
    var prem = pickVal(m.prem, mm.prem);
    var promo = pickVal(m.promoRate, mm.promoRate);
    var damian = pickVal(m.damian, mm.damian);
    var upr = pickVal(m.upRatio, X ? X.m && X.m.upRatio : null);
    var amt = pickVal(m.amountToday);
    var vol = pickVal(m.volChange);
    var fund = pickVal((d && d.stocks || []).reduce(function (a, s) { return a + (num(s.seal) || 0); }, 0));
    var items = [
      { k: '情绪温度 T', v: T, s: '', c: 'blue' },
      { k: '周期阶段', v: stage, s: '', c: '' },
      { k: '涨停家数', v: zt, s: ' 家', c: 'red' },
      { k: '跌停家数', v: dt, s: ' 家', c: 'green' },
      { k: '炸板家数', v: zb, s: ' 家', c: '' },
      { k: '炸板率', v: zbr, s: '%', c: '' },
      { k: '最高连板', v: maxLB, s: ' 板', c: 'gold' },
      { k: '连板家数', v: lb, s: ' 家', c: '' },
      { k: '昨日溢价', v: prem, s: '%', c: '' },
      { k: '晋级率', v: promo, s: '%', c: '' },
      { k: '大面股', v: damian, s: ' 家', c: '' },
      { k: '上涨占比', v: upr, s: '%', c: '' },
      { k: '两市成交', v: amt == null ? null : Math.round(amt / 1e8), s: ' 亿', c: '' },
      { k: '量能变化', v: vol, s: '%', c: '' },
      { k: '封单总额', v: fund == null ? null : Math.round(fund / 1e4 * 10) / 10, s: ' 亿', c: '' },
      { k: '快照个股', v: (d && d.stocks || []).length, s: ' 只', c: '' }
    ];
    return items.map(function (it) {
      if (it.v == null) return { k: it.k, v: null, c: '' };
      var v = typeof it.v === 'number' ? (Math.round(it.v * 100) / 100) + it.s : String(it.v);
      return { k: it.k, v: v, c: it.c || '' };
    });
  }

  /** 组装报告对象（纯数据，无 DOM 依赖）。 */
  function compose(type, d, usedClose) {
    var s = S();
    var B = null, F = null, V = null, deepOk = false;
    try { if (global.YGDecision && global.YGDecision.build) B = global.YGDecision.build(d || {}); } catch (e) { B = null; }
    try { if (global.YGAutoFill && global.YGAutoFill.build) F = global.YGAutoFill.build(d || {}); } catch (e) { F = null; }
    try {
      if (global.YGViewsDeep && global.YGViewsDeep.screen) { V = global.YGViewsDeep.screen(d || {}); deepOk = true; }
    } catch (e) { V = null; }

    // 报告列表日期 = 生成日（北京时间今天），与参考站 20261112_close 一致；
    // 真实「数据时点」单独存 dataAsOf / frozen.date，盘中提前生成时两者会不同，
    // 由头部如实标注，绝不把 11-11 的收盘数据冒充成 11-12 的收盘复盘。
    // 自动补生成也按生成日检查，避免同一天重复补。
    var dateCompact = s ? s.todayCompact() : compact(d && d.date);
    var dataDateCompact = compact(d && d.date) || dateCompact;
    var minutes = s ? s.minutes() : 0;
    var early = s && s.isWeekend() ? true
      : (type === 'noon' ? minutes < 11 * 60 + 31 : minutes < 15 * 60 + 1);
    var sessionLabel = s ? s.phaseLabel() : '—';
    var dataAsOf = (d && d.dataTimeLabel) || (s ? s.dataTimeLabel(d || {}) : '');
    var X = B ? B.X : null;
    var stage = X && X.stage && X.stage.n ? X.stage.n : (V && V.cycle && V.cycle.stage) || null;
    var T = X ? num(X.T) : num(F && F.thermo && F.thermo.dir);

    var conclusion = null;
    if (B && B.turning && B.turning.conclusion) {
      var c = B.turning.conclusion;
      conclusion = {
        n: c.n || '—', a: c.a || '', op: c.op || '', conf: c.conf || '—',
        yes: num(c.yes), judged: num(c.judged),
        evidence: Array.isArray(c.evidence) ? c.evidence.slice(0, 8) : [],
        stage: c.stage || stage, T: num(c.T), note: c.note || '',
        switchVerdict: (B.sw && B.sw.verdict) || '',
        divergence: (B.plan && B.plan.dvVerdict) || ''
      };
    } else if (V && V.cycle) {
      conclusion = {
        n: V.cycle.stage || '—', a: '按阈值卡计票的周期定位', op: V.cycle.total || '',
        conf: '—', yes: null, judged: null,
        evidence: (V.cycle.signals || []).slice(0, 6).map(function (x) { return x.name + '=' + x.val + '→' + x.band; }),
        stage: V.cycle.stage || '', T: T, note: '', switchVerdict: (V.switchVerdict && V.switchVerdict.verdict) || '',
        divergence: ''
      };
    }

    var mainline = buildMainline(B);
    var targets = buildTargets(B, V);
    var C = (V && V.cycle) || {};
    var stageCap = num(C.stageCap != null ? C.stageCap : (X && X.stage && X.stage.cap));
    var total = C.total || (stageCap != null ? stageCap + ' 成' : '—');
    var riskOff = !!(C.riskOff || (B && B.plan && B.plan.riskOff));
    var allow = riskOff ? ['空仓观察', '只做记录不做开仓'] : ['主线最高板换手回封', '龙头分歧转一致'];
    var ban = riskOff ? ['任何开仓', '中位股', '补涨'] : ['中位股', '一字板排队', '非主线补涨'];
    var plan = {
      position: total, act: riskOff ? '风控优先：降仓 / 空仓观察' : '按阶段仓位执行，优先最高板与前排',
      allow: allow, ban: ban,
      maxBoard: stageCap != null ? stageCap + ' 板' : '—',
      single: '单票 ≤40%', noMain: !mainline.length,
      targetCount: targets.length,
      divergence: (B && B.plan && B.plan.dvVerdict) || (V && V.cycle && V.cycle.stage) || '—'
    };

    var risks = [];
    if (riskOff) risks.push('当前处于 ' + (stage || '减仓') + ' 阶段，按手册「减仓优先于判断」执行，空仓观察也是仓位管理。');
    if (B && B.plan && B.plan.riskOff) risks.push('决策模块判定风险关闭（riskOff），候选标的已过滤，不允许硬做。');
    risks.push('三层风控：单笔 ≤总资金 2%、单票 ≤40%、单日回撤 ≥3% 不开新仓；绝不补仓 / 扛单 / 退潮满仓 / 杠杆。');
    if (V && V.report && Array.isArray(V.report.sections)) {
      V.report.sections.forEach(function (sec) { if (sec && /风控|明日/.test(sec.title || '')) risks.push(String(sec.body || '').slice(0, 260)); });
    }
    if (!B) risks.push('⚠ 专题判定模块未加载，本期结论仅来自完整推导模块，部分明细标「? 缺项」。');
    if (!deepOk) risks.push('⚠ 完整推导模块（按需加载）不可用，八段推导与龙头体检本期标「? 缺项」。');

    var sources = [];
    sources.push({ n: '个股明细 ' + isoOf(dataDateCompact) + ' / ' + ((d && d.sourceLabel) || (d && d.source) || '—'), ok: !!(d && d.stocks && d.stocks.length) });
    sources.push({ n: '汇总行情 ' + ((d && d.market && d.market.date) || '—'), ok: !!(d && d.market && d.market.ok) });
    sources.push({ n: 'YGDecision 专题判定', ok: !!B });
    sources.push({ n: 'YGAutoFill 自动填值', ok: !!F });
    sources.push({ n: 'YGViewsDeep 完整推导', ok: deepOk });
    sources.push({ n: '口径 ' + (usedClose ? 'close（收盘回溯）' : 'live / 当前页数据'), ok: true });

    var disclaimer = '本报告由妖股雷达基于公开行情数据在浏览器本地自动生成，纯静态 GitHub Pages、无服务端，报告保存在本机 localStorage；' +
      '盘中数据会持续变动，历史报告已冻结生成时刻数据、不随行情更新。所有结论由规则自动判定，不构成任何投资建议，据此操作风险自负。';

    return {
      id: dateCompact + '_' + type + (early ? '_' + padId() : ''),
      date: dateCompact, type: type,
      typeLabel: type === 'close' ? '收盘复盘（15:00）' : '午盘复盘（11:30）',
      genAt: bjStamp(), sessionLabel: sessionLabel, dataAsOf: dataAsOf,
      early: !!early, earlyReason: early ? (s && s.isWeekend() ? '非交易日生成' :
        (type === 'noon' ? '未到 11:31 午盘时点' : '未到 15:01 收盘时点')) : '',
      T: T, stage: stage,
      summary: buildSummary(d, B, F),
      conclusion: conclusion, plan: plan, targets: targets,
      mainline: mainline, turning: buildTurning(B, V),
      indTrend: industryTrend(d), risks: risks,
      sources: sources, disclaimer: disclaimer,
      deepSections: (V && V.report && Array.isArray(V.report.sections)) ? V.report.sections.map(function (x) {
        return { title: x.title || '', body: String(x.body || '').slice(0, 1200) };
      }) : [],
      frozen: pickFrozen(d || {})
    };
  }

  /* ------------------------------------------------------------ 生成 / 存取 */
  function generate(type, ctx) {
    ctx = ctx || lastCtx || {};
    var t = (type === 'close') ? 'close' : 'noon';
    var d = null, usedClose = false;
    busy = true;
    return Promise.resolve()
      .then(function () {
        if (ctx && typeof ctx.fetchCloseData === 'function') {
          return ctx.fetchCloseData().then(function (x) { usedClose = !!(x && x.mode === 'close'); return x; },
            function () { return ctx.data; });
        }
        return ctx.data || null;
      })
      .then(function (dd) {
        d = dd || {};
        if (ctx && typeof ctx.loadDeepAssets === 'function') {
          return Promise.resolve(ctx.loadDeepAssets()).catch(function () { return false; });
        }
        return false;
      })
      .then(function () { return compose(t, d, usedClose); })
      .then(function (rep) {
        var rs = readAll(), replaced = false;
        if (!rep.early) {
          for (var i = 0; i < rs.length; i++) {
            if (rs[i].date === rep.date && rs[i].type === rep.type && !rs[i].early) { rs[i] = rep; replaced = true; break; }
          }
        }
        if (!replaced) rs.push(rep);
        writeAll(rs);
        busy = false;
        return rep;
      }, function (e) {
        busy = false;
        throw e;
      });
  }

  /** 自动补生成：交易日 ≥11:31 补 noon、≥15:01 补 close；周末跳过。 */
  function ensureAuto(ctx) {
    ctx = ctx || lastCtx || {};
    var s = S();
    if (!s || s.isWeekend() || busy) return Promise.resolve(0);
    var m = s.minutes(), date = s.todayCompact(), todo = [];
    if (m >= 11 * 60 + 31) todo.push('noon');
    if (m >= 15 * 60 + 1) todo.push('close');
    if (!todo.length) return Promise.resolve(0);
    var added = 0;
    return todo.reduce(function (p, t) {
      return p.then(function () {
        var key = date + '_' + t;
        var exists = readAll().some(function (r) { return r.date === date && r.type === t; });
        if (exists) return null;
        try { if (global.localStorage && global.localStorage.getItem(AUTO_KEY) === key) return null; } catch (e) { /* ignore */ }
        try { global.localStorage && global.localStorage.setItem(AUTO_KEY, key); } catch (e) { /* ignore */ }
        return generate(t, ctx).then(function () { added++; }, function () { return null; });
      });
    }, Promise.resolve()).then(function () {
      // 只在「仍停留在报告列表页」时重绘，避免打断详情阅读
      if (added && !currentId && ctx && typeof ctx.rerender === 'function') ctx.rerender();
      return added;
    });
  }

  /* -------------------------------------------------------------- 列表渲染 */
  function renderList(rootEl, ctx) {
    if (!rootEl) return;
    lastCtx = ctx || lastCtx || {};
    var rs = list();
    var html = '<div class="yg-rep-root">' +
      '<div class="yg-rep-notice"><b>本地存档说明：</b>本站是<b>纯静态 GitHub Pages</b>，没有服务端，' +
      '报告不会上传或落盘到服务器，只保存在<b>当前浏览器 localStorage</b>（<code>' + KEY + '</code>，最多 ' + MAX + ' 份）。' +
      '清理浏览器数据、换设备 / 换浏览器都会丢失，请定期用「导出 JSON」备份，换设备后用「导入 JSON」恢复。' +
      '<b>自动补生成</b>：打开本站或进入本页时，若北京时间交易日已过 11:31 / 15:01 且当日尚无对应报告，会自动补一份（周末跳过；无后台定时服务，不开页面就不会生成）；' +
      '<b>提前生成</b>会如实标注生成时刻与数据时点。报告生成后<b>冻结当时数据</b>，不随盘中行情变动。</div>' +
      '<div class="yg-rep-btn-row">' +
      '<button class="yg-rep-btn" id="ygRepGenNoon" type="button">生成午盘复盘（11:30）</button>' +
      '<button class="yg-rep-btn ghost" id="ygRepGenClose" type="button">生成收盘复盘（15:00）</button>' +
      '<button class="yg-rep-btn ghost" id="ygRepReload" type="button">刷新列表</button>' +
      '</div>' +
      '<div class="yg-rep-sec-title"><span class="bar"></span>报告列表 <span class="en">REPORTS</span>' +
      '<span class="tools">' +
      '<button class="yg-rep-btn ghost mini" id="ygRepExport" type="button">导出 JSON</button>' +
      '<button class="yg-rep-btn ghost mini" id="ygRepImport" type="button">导入 JSON</button>' +
      '<input type="file" id="ygRepFile" accept=".json,application/json" style="display:none" />' +
      '</span></div>' +
      '<div id="ygRepMsg" class="yg-rep-foot"></div>' +
      '<div class="yg-rep-list">' +
      (rs.length ? rs.map(function (r) {
        return '<div class="yg-rep-item" data-rep="' + esc(r.id) + '">' +
          '<div class="main"><div class="yg-rep-d">' + esc(r.date) + ' · ' + esc(r.typeLabel) +
          (r.early ? '<span class="yg-rep-early">提前生成 · 非收盘时点</span>' : '') + '</div>' +
          '<div class="yg-rep-t">生成于 ' + esc(r.genAt) + ' · ' + esc(r.sessionLabel || '—') +
          (r.stage ? ' · ' + esc(r.stage) : '') + '<br>数据时点：' + esc(r.dataAsOf || '—') + '</div></div>' +
          '<button class="yg-rep-del" data-del="' + esc(r.id) + '" type="button" title="删除这份报告">✕</button>' +
          '<div class="yg-rep-s"><b>' + (r.T == null ? '—' : esc(r.T)) + '</b><span>情绪温度</span></div>' +
          '</div>';
      }).join('') : '<div class="yg-rep-empty">暂无报告。点击上方按钮生成，或等待交易日 11:31 / 15:01 自动补生成。<br>报告只存在本机浏览器，记得导出 JSON 备份。</div>') +
      '</div></div>';
    rootEl.innerHTML = html;

    function msg(t, isWarn) {
      var box = rootEl.querySelector('#ygRepMsg');
      if (box) { box.textContent = t; box.style.color = isWarn ? 'var(--up)' : 'var(--ink-3)'; }
    }
    function gen(t) {
      var btns = rootEl.querySelectorAll('.yg-rep-btn');
      Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
      msg('正在按当前数据冻结生成报告…');
      return generate(t, ctx).then(function (rep) {
        currentId = rep.id;
        renderDetail(rootEl, rep, ctx);
        return rep;
      }, function (e) {
        msg('生成失败：' + (e && e.message ? e.message : String(e)) + '（可重试或刷新页面）', true);
        Array.prototype.forEach.call(btns, function (b) { b.disabled = false; });
      });
    }
    var bNoon = rootEl.querySelector('#ygRepGenNoon');
    var bClose = rootEl.querySelector('#ygRepGenClose');
    var bReload = rootEl.querySelector('#ygRepReload');
    var bExport = rootEl.querySelector('#ygRepExport');
    var bImport = rootEl.querySelector('#ygRepImport');
    var fInput = rootEl.querySelector('#ygRepFile');
    if (bNoon) bNoon.onclick = function () { gen('noon'); };
    if (bClose) bClose.onclick = function () { gen('close'); };
    if (bReload) bReload.onclick = function () { renderList(rootEl, ctx); };
    if (bExport) bExport.onclick = function () {
      try {
        var blob = new Blob([exportAll()], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'yg_reports_' + (S() ? S().todayCompact() : 'backup') + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        msg('已导出 ' + list().length + ' 份报告。');
      } catch (e) { msg('导出失败：' + (e && e.message || e), true); }
    };
    if (bImport) bImport.onclick = function () { if (fInput) fInput.click(); };
    if (fInput) fInput.onchange = function () {
      var file = fInput.files && fInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = importAll(String(reader.result || ''));
          renderList(rootEl, ctx);
          var box = rootEl.querySelector('#ygRepMsg');
          if (box) { box.textContent = '已导入 ' + n + ' 份报告，当前共 ' + list().length + ' 份。'; box.style.color = 'var(--down)'; }
        } catch (e) { msg('导入失败：' + (e && e.message || e), true); }
      };
      reader.onerror = function () { msg('读取文件失败', true); };
      reader.readAsText(file, 'utf-8');
      fInput.value = '';
    };
    Array.prototype.forEach.call(rootEl.querySelectorAll('.yg-rep-del'), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        var id = b.getAttribute('data-del');
        if (!id) return;
        if (!global.confirm || global.confirm('确定删除这份复盘报告？删除后不可恢复（可从 JSON 备份导入）。')) {
          remove(id); renderList(rootEl, ctx);
          msg('已删除报告 ' + id + '。');
        }
      };
    });
    Array.prototype.forEach.call(rootEl.querySelectorAll('.yg-rep-item'), function (item) {
      item.onclick = function () {
        var id = item.getAttribute('data-rep');
        var rep = get(id);
        if (!rep) { renderList(rootEl, ctx); return; }
        currentId = id;
        renderDetail(rootEl, rep, ctx);
      };
    });
    // 自动补生成（异步；仅在列表页重绘，不打断详情）
    ensureAuto(ctx);
  }

  /* -------------------------------------------------------------- 详情渲染 */
  function kvGrid(items) {
    if (!items || !items.length) return '<div class="yg-rep-empty">盘面数据缺项</div>';
    return '<div class="yg-rep-kv">' + items.map(function (it) {
      return '<div><label>' + esc(it.k) + '</label><b class="' + esc(it.c || '') + '">' +
        (it.v == null ? '<span class="yg-rep-na">— ? 缺项</span>' : esc(it.v)) + '</b></div>';
    }).join('') + '</div>';
  }
  function targetHtml(t) {
    var roleCls = t.role === '中军' ? 'jun' : (t.role === '补涨' ? 'bub' : '');
    var e = t.entry || {};
    return '<div class="yg-rep-target">' +
      '<div class="h"><span class="role ' + roleCls + '">' + esc(t.role) + '</span>' +
      '<span class="n">' + esc(t.name || '—') + '</span>' +
      '<span class="c">' + esc(t.code || '—') + ' · ' + (t.boards == null ? '—' : t.boards + ' 板') +
      ' · 涨 ' + (t.pct == null ? '—' : fx(t.pct, 2) + '%') + '</span>' +
      '<span class="sec">' + esc(t.sector || '—') + '</span></div>' +
      '<div class="yg-rep-grid">' +
      '<div><label>买点</label><span>' + esc(e.timing) + '</span></div>' +
      '<div><label>手法</label><span>' + esc(e.method) + '</span></div>' +
      '<div><label>仓位</label><span>' + esc(e.pos) + '</span></div>' +
      '<div><label>确定性</label><span>' + esc(e.certainty) + '</span></div>' +
      '<div><label>止损</label><span>' + esc(e.stop) + '</span></div>' +
      '<div><label>目标</label><span>' + esc(e.target) + '</span></div>' +
      '</div>' +
      '<div class="yg-rep-why"><b>触发条件：</b>' + esc(e.cond) +
      (t.logic && t.logic.length ? '<br><b>逻辑：</b>' + esc(t.logic.join('　·　')) : '') +
      (t.fundText ? '<br><b>资金：</b>' + esc(t.fundText) : '') +
      (t.rank != null ? '<br><b>排序分：</b>' + esc(t.rank) : '') + '</div></div>';
  }
  function sectorHtml(x) {
    var roles = [['龙头', x.dragon, ''], ['中军', x.jun, 'jun'], ['补涨', x.bub, 'bub']];
    var rolesHtml = roles.map(function (r) {
      if (!r[1]) return '';
      var o = r[1];
      return '<div><div class="t">' + esc(r[0]) + '</div><div class="n">' + esc(o.name || '—') +
        (o.boards != null ? ' <i>' + esc(o.boards) + '板</i>' : '') + '</div>' +
        '<div class="x">涨 ' + (o.pct == null ? '—' : fx(o.pct, 2) + '%') +
        (o.turnover != null ? ' · 换手 ' + fx(o.turnover, 1) + '%' : '') +
        (o.cap != null ? ' · 流通 ' + fx(o.cap, 1) + '亿' : '') + '</div></div>';
    }).join('');
    return '<div class="yg-rep-sec-card"><div class="h">' +
      '<span class="n">' + esc(x.name) + '</span><span class="chip">' + esc(x.kind) + '</span>' +
      '<span class="sc"><b>' + (x.score == null ? '—' : esc(x.score)) + '</b> 分 / ' + esc(x.level) + '</span></div>' +
      '<div class="six">' + (x.six || []).map(function (s2) {
        return '<span class="' + (s2.ok ? '' : 'no') + '">' + esc(s2.k) + (s2.ok ? ' ✓' : ' ✗') + '</span>';
      }).join('') +
      '<span class="no">涨停 ' + (x.ztN == null ? '—' : esc(x.ztN)) + ' 家</span>' +
      '<span class="no">最高 ' + (x.maxLB == null ? '—' : esc(x.maxLB) + ' 板') + '</span></div>' +
      (rolesHtml ? '<div class="yg-rep-roles">' + rolesHtml + '</div>' : '') + '</div>';
  }
  function indTrendHtml(rows) {
    if (!rows || !rows.length) return '<div class="yg-rep-empty">行业涨停家数趋势：历史池数据缺项</div>';
    var names = [];
    rows.forEach(function (r) {
      (r.top || []).forEach(function (p) { if (names.indexOf(p[0]) < 0) names.push(p[0]); });
    });
    names = names.slice(0, 8);
    var head = '<tr><th>行业</th>' + rows.map(function (r) { return '<th>' + esc(String(r.date || '').slice(4)) + '</th>'; }).join('') + '</tr>';
    var body = names.map(function (n) {
      return '<tr><td>' + esc(n) + '</td>' + rows.map(function (r) {
        var f = (r.top || []).filter(function (p) { return p[0] === n; })[0];
        return '<td>' + (f ? esc(f[1]) : '—') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="yg-rep-tb-wrap"><table class="yg-rep-tb">' + head + body + '</table></div>';
  }
  function renderDetail(rootEl, report, ctx) {
    if (!rootEl || !report) return;
    lastCtx = ctx || lastCtx || {};
    currentId = report.id;
    var c = report.conclusion || {};
    var p = report.plan || {};
    var src = (report.sources || []).map(function (x) { return esc(x.n) + (x.ok ? ' ✓' : ' ✗'); }).join('　·　');
    var html = '<div class="yg-rep-root">' +
      '<div class="yg-rep-btn-row">' +
      '<button class="yg-rep-btn ghost" id="ygRepBack" type="button">← 返回列表</button>' +
      '<button class="yg-rep-btn ghost" id="ygRepReload2" type="button">重新读取</button>' +
      '</div>' +
      '<div class="yg-rep-h"><h2>' + esc(report.date) + ' · ' + esc(report.typeLabel) + '</h2>' +
      '<p><span class="lbl">生成时刻：</span><span class="hl">' + esc(report.genAt) + '</span>　·　' +
      '<span class="lbl">时段：</span>' + esc(report.sessionLabel || '—') + '</p>' +
      '<p><span class="lbl">数据时点：</span>' + esc(report.dataAsOf || '—') +
      '<br><span class="lbl">数据日期：</span>' + esc(isoOf((report.frozen && report.frozen.dateCompact) || '')) +
      '　·　<span class="lbl">报告日期（生成日）：</span>' + esc(report.date) + '</p>' +
      '<p><span class="lbl">数据源：</span>' + src + '</p>' +
      (report.early ? '<div class="yg-rep-early-banner"><b>提前生成 · 非收盘时点</b>：' +
        esc(report.earlyReason || '未到标准生成时点') + '。本报告已冻结上述「生成时刻」的数据，' +
        '并非午盘 / 全天收盘定稿，请勿当作收盘复盘使用；到点后系统会再自动补生成正式报告。</div>' : '') +
      '</div>';

    html += '<div class="yg-rep-sec"><h4>盘面总结</h4><div class="yg-rep-card">' + kvGrid(report.summary) + '</div></div>';

    html += '<div class="yg-rep-sec"><h4>唯一结论</h4>';
    if (c && c.n) {
      html += '<div class="yg-rep-verdict"><div class="l"><div class="k">全自动校验 · 唯一结论</div>' +
        '<div class="v">' + esc(c.n) + '</div><div class="a">' + esc(c.a || '') + '</div></div>' +
        '<div class="r"><div>置信度 <b>' + esc(c.conf || '—') + '</b>　·　命中 <b>' +
        (c.yes == null ? '—' : esc(c.yes)) + '/' + (c.judged == null ? '—' : esc(c.judged)) + '</b>　·　情绪温度 <b>' +
        (report.T == null ? '—' : esc(report.T)) + '</b>　·　阶段 <b>' + esc(report.stage || '—') + '</b></div>' +
        (c.evidence && c.evidence.length ? '<div class="ev"><b>命中特征：</b>' + esc(c.evidence.join('　·　')) + '</div>' : '') +
        (c.op ? '<div class="ev"><b>对应动作：</b>' + esc(c.op) + '</div>' : '') +
        (c.switchVerdict ? '<div class="ev"><b>主线切换：</b>' + esc(c.switchVerdict) + '</div>' : '') +
        (c.divergence ? '<div class="ev"><b>分歧性质：</b>' + esc(c.divergence) + '</div>' : '') +
        (c.note ? '<div class="ev">' + esc(c.note) + '</div>' : '') + '</div></div>';
    } else html += '<div class="yg-rep-empty">唯一结论：判定模块不可用，本期标「? 缺项」</div>';
    html += '</div>';

    html += '<div class="yg-rep-sec"><h4>交易计划 · 仓位与纪律</h4><div class="yg-rep-chain">' +
      '<div><div class="k">总仓位</div><div class="v">' + esc(p.position || '—') + '</div><div class="x">' + esc(p.act || '') + '</div></div>' +
      '<div><div class="k">允许 / 禁止</div><div class="yg-rep-tagrow">' +
      (p.allow || []).map(function (x) { return '<span class="ok">' + esc(x) + '</span>'; }).join('') +
      (p.ban || []).map(function (x) { return '<span class="no">' + esc(x) + '</span>'; }).join('') +
      '</div><div class="x">板位上限 ' + esc(p.maxBoard || '—') + '　·　' + esc(p.single || '—') + '</div></div>' +
      '<div><div class="k">标的</div><div class="v">共 ' + esc(p.targetCount == null ? (report.targets || []).length : p.targetCount) + ' 只</div>' +
      '<div class="x">' + (p.noMain ? '无板块达主线门槛，仅观察' : '来自主线板块') + '　·　' + esc(p.divergence || '—') + '</div></div>' +
      '</div></div>';

    html += '<div class="yg-rep-sec"><h4>具体交易标的</h4>';
    if (p.noMain) html += '<div class="yg-rep-notice warn"><b>⚠ 观察级：</b>当前无板块达到主线门槛，以下标的仅为观察对象，不建议实际开仓。</div>';
    html += ((report.targets || []).length ? report.targets.map(targetHtml).join('')
      : '<div class="yg-rep-empty">本期无符合环境限制的标的 → 结论是空仓等待（缺项不编造）</div>') + '</div>';

    html += '<div class="yg-rep-sec"><h4>主线与个股判定</h4>' +
      ((report.mainline || []).length ? report.mainline.map(sectorHtml).join('')
        : '<div class="yg-rep-empty">板块评分数据缺项</div>') + '</div>';

    html += '<div class="yg-rep-sec"><h4>行业涨停家数趋势</h4><div class="yg-rep-card">' + indTrendHtml(report.indTrend) + '</div></div>';

    html += '<div class="yg-rep-sec"><h4>拐点信号命中（≥2 条）</h4><div class="yg-rep-card">' +
      ((report.turning || []).length ? report.turning.map(function (t) {
        return '<div class="yg-rep-sig"><span class="i">' + esc(t.yes == null ? '?' : t.yes) + '</span>' +
          '<span><b>' + esc(t.n) + '</b> ' + esc(t.a || '') + '　—　' + esc(t.op || '') + '</span></div>';
      }).join('') : '<div class="yg-rep-na">本期无命中 ≥2 条的拐点信号（或判定模块缺项）</div>') + '</div></div>';

    if (report.deepSections && report.deepSections.length) {
      html += '<div class="yg-rep-sec"><h4>完整推导摘要（按需加载模块）</h4><div class="yg-rep-card">' +
        report.deepSections.slice(0, 4).map(function (s2) {
          return '<div style="margin:6px 0"><b>' + esc(s2.title) + '</b><br>' + esc(s2.body) + '</div>';
        }).join('') + '</div></div>';
    }

    html += '<div class="yg-rep-sec"><h4>风险提示</h4><div class="yg-rep-card"><ul class="yg-rep-ul">' +
      (report.risks || []).map(function (r) {
        return '<li class="' + (/⚠|风控|不允许/.test(r) ? 'warn' : '') + '">' + esc(r) + '</li>';
      }).join('') + '</ul></div></div>';

    html += '<div class="yg-rep-disclaimer"><b>免责声明：</b>' + esc(report.disclaimer || '') + '</div>' +
      '<div class="yg-rep-foot">报告 ID：' + esc(report.id) + '　·　冻结个股 ' +
      esc((report.frozen && report.frozen.stocksTotal) != null ? report.frozen.stocksTotal : '—') +
      ' 只　·　本页只读 localStorage 冻结存档，不参与 5 秒实时刷新。</div></div>';
    rootEl.innerHTML = html;

    var bBack = rootEl.querySelector('#ygRepBack');
    var bReload = rootEl.querySelector('#ygRepReload2');
    if (bBack) bBack.onclick = function () { currentId = null; renderList(rootEl, ctx); };
    if (bReload) bReload.onclick = function () {
      var rep = get(currentId);
      if (!rep) { currentId = null; renderList(rootEl, ctx); return; }
      renderDetail(rootEl, rep, ctx);
    };
  }

  /* ------------------------------------------------------------ 对外入口 */
  function render(rootEl, ctx) {
    if (!rootEl) return;
    lastCtx = ctx || lastCtx || {};
    var rep = currentId ? get(currentId) : null;
    if (currentId && !rep) currentId = null;
    if (rep) renderDetail(rootEl, rep, ctx);
    else renderList(rootEl, ctx);
  }
  function open(id, ctx) {
    var rep = get(id);
    if (rep) currentId = id;
    return rep;
  }
  function close() { currentId = null; }

  global.YGReport = {
    render: render,
    renderList: renderList,
    renderDetail: renderDetail,
    generate: generate,
    list: list,
    get: get,
    remove: remove,
    exportAll: exportAll,
    importAll: importAll,
    ensureAuto: ensureAuto,
    open: open,
    close: close
  };
})(typeof window !== 'undefined' ? window : this);
