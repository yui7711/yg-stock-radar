/* =========================================================================
 * decision.js — 妖股雷达 · 四大栏目专题判定（v20261110h）
 * -------------------------------------------------------------------------
 * 对外接口：
 *   window.YGDecision.build(d)                  -> 判定结果对象
 *   window.YGDecision.render(rootEl, view, d)  -> 把对应栏目 HTML 写入 rootEl
 *
 * view: 'v_turn' 八大拐点 / 'v_sw' 主线切换 / 'v_sec' 板块主线与角色 /
 *       'v_plan' 操作策略（具体标的与操作逻辑）
 *
 * 数据：完全沿用本站原有数据源 —— 东方财富涨停/炸板/跌停池、历史 5 日涨停池、
 *       fuyao 连板天梯、snapshot.json 收盘快照；本模块不新增第三方数据源。
 *       market.roleUniverse / market.poolQuotes 由 market-today.js 同域东财接口补齐。
 * 口径：规则与阈值取自本站 26 章《情绪周期判定手册》原文（manual-data.js），
 *       版式与判定清单对齐参考站，所有不可得字段一律标「? 缺项」且不计入分母，
 *       绝不猜测补值。红=涨、绿=跌；✓/× 为信号是否成立，与涨跌无关。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, def) {
    if (v == null || v === '' || v === '-') return def == null ? null : def;
    var n = Number(v);
    return isFinite(n) ? n : (def == null ? null : def);
  }
  function has(v) { return typeof v === 'number' && isFinite(v); }
  function fx(v, k) { return has(v) ? Number(v).toFixed(k == null ? 2 : k) : '—'; }
  function yi(yuan) { return has(yuan) ? (yuan / 1e8).toFixed(2) : '—'; }
  function signed(v, k, unit) { return has(v) ? (v > 0 ? '+' : '') + Number(v).toFixed(k == null ? 2 : k) + (unit || '') : '—'; }
  function pct(v) { return has(v) ? (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '—'; }
  function compact(s) { return String(s || '').replace(/-/g, '').slice(0, 8); }
  function dayLabel(s) { var t = compact(s); return /^\d{8}$/.test(t) ? t.slice(4, 6) + '.' + t.slice(6, 8) : String(s || '—'); }
  function shortDate(s) { var t = compact(s); return /^\d{8}$/.test(t) ? t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8) : String(s || '—'); }
  function shiftDay(c, delta) {
    var y = Number(c.slice(0, 4)), m = Number(c.slice(4, 6)), d = Number(c.slice(6, 8));
    var dt = new Date(Date.UTC(y, m - 1, d + delta));
    return String(dt.getUTCFullYear()) + ('0' + (dt.getUTCMonth() + 1)).slice(-2) + ('0' + dt.getUTCDate()).slice(-2);
  }
  function countBy(list, fn) {
    var m = {}; (list || []).forEach(function (x) { var k = fn(x) || '其他'; m[k] = (m[k] || 0) + 1; });
    return m;
  }
  function normInd(s) { return String(s || '').replace(/[ⅠⅡⅢⅣ\s（）()]/g, '').trim(); }
  /* 东财涨停池 hybk 是缩略行业名（汽车零部），活跃股池 f100 是全称（汽车零部件）；
     以「共同前缀 ≥3 字」匹配，避免把不同分支误合并。 */
  function indMatch(a, b) {
    a = normInd(a); b = normInd(b);
    if (!a || !b) return false;
    if (a === b) return true;
    var i = 0, n = Math.min(a.length, b.length);
    while (i < n && a[i] === b[i]) i++;
    return i >= 3;
  }
  function tag(t, cls) { return '<span class="dc-tag ' + (cls || '') + '">' + esc(t) + '</span>'; }
  function sig(t, ok, why) { return { t: t, ok: ok === true ? true : (ok === false ? false : null), why: why || '' }; }
  function hitInfo(list) {
    var yes = list.filter(function (x) { return x.ok === true; }).length;
    var judged = list.filter(function (x) { return x.ok !== null; }).length;
    return { yes: yes, judged: judged, miss: list.length - judged, rate: judged ? Math.round(yes / judged * 100) : 0 };
  }
  function sigRows(list) {
    return list.map(function (x) {
      var c = x.ok === true ? 'y' : x.ok === false ? 'n' : 'u';
      var ic = x.ok === true ? '✓' : x.ok === false ? '×' : '?';
      return '<div class="dc-sig"><span class="dc-sig-i ' + c + '" title="' + esc(x.why || '') + '">' + ic + '</span>' +
        '<span class="dc-sig-t">' + esc(x.t) + '</span></div>';
    }).join('');
  }
  function whyBox(list) {
    var rows = list.filter(function (x) { return x.why; });
    if (!rows.length) return '';
    return '<details class="dc-why"><summary>数据依据（' + rows.length + ' 条）</summary><ul>' +
      rows.map(function (x) {
        var c = x.ok === true ? 'y' : x.ok === false ? 'n' : 'u';
        return '<li class="' + c + '">' + esc(x.t) + '<br><em>' + esc(x.why) + '</em></li>';
      }).join('') + '</ul></details>';
  }

  /* ---------------- 个股标准化 ---------------- */
  function normPool(x, M, qmap) {
    var q = qmap[x.code] || {};
    return {
      code: x.code || '', name: x.name || '', sector: x.sector || x.hybk || '其他',
      boards: num(x.lbc, 1), price: num(x.price), changePct: num(x.zdp),
      amount: num(x.amount), cap: num(x.cap, (has(x.ltsz) ? x.ltsz / 1e8 : null)),
      turnover: num(x.hs), fund: num(x.fund), firstTime: x.firstTime || '',
      fbt: num(x.fbt), zbc: num(x.zbc, 0), floatMv: num(x.ltsz),
      mainNet: num(q.mainNet), volumeRatio: num(q.volumeRatio),
      market: x.market, source: 'market'
    };
  }
  function normSnap(s, date) {
    var cap = num(s.cap);
    return {
      code: String(s.c || s.code || ''), name: s.n || s.name || '',
      sector: s.sec || s.sector || '其他', boards: num(s.b, 1),
      price: num(s.p), changePct: num(s.pct), amount: null, cap: cap,
      turnover: num(s.to), fund: has(s.seal) ? s.seal * 1e4 : null,
      firstTime: s.first || '', fbt: null, zbc: num(s.open, 0),
      floatMv: has(cap) ? cap * 1e8 : null,
      mainNet: has(s.mf) ? s.mf * 1e8 : null, volumeRatio: num(s.vr),
      source: 'snapshot', date: date
    };
  }
  function fundLine(s) {
    var p = [];
    if (has(s.fund)) p.push('封单 ' + yi(s.fund) + ' 亿');
    if (has(s.amount)) p.push('成交 ' + yi(s.amount) + ' 亿');
    if (has(s.mainNet)) p.push('主力净额 ' + signed(s.mainNet / 1e8, 2) + ' 亿');
    if (has(s.turnover)) p.push('换手 ' + fx(s.turnover, 1) + '%');
    if (has(s.volumeRatio)) p.push('量比 ' + fx(s.volumeRatio, 2));
    if (has(s.cap)) p.push('流通 ' + fx(s.cap, 0) + ' 亿');
    return p.length ? p.join(' · ') : '缺资金数据（东财资金字段未取到）';
  }
  function metaLine(s) {
    var p = [];
    if (s.boards) p.push(s.boards + ' 板');
    else p.push('非涨停');
    if (has(s.changePct)) p.push(pct(s.changePct));
    if (s.firstTime) p.push('首封 ' + s.firstTime);
    if (has(s.zbc)) p.push('开板 ' + s.zbc + ' 次');
    return p.join(' · ');
  }
  function stockLink(s) {
    if (!s || !s.code) return '—';
    var pre = String(s.market) === '1' ? 'sh' : (/^(6|9)/.test(s.code) ? 'sh' : 'sz');
    return '<a class="dc-stk" href="https://quote.eastmoney.com/' + pre + s.code + '.html" target="_blank" rel="noopener">' +
      esc(s.name) + '</a><span class="dc-code">' + esc(s.code) + '</span>';
  }

  /* ---------------- 评分 / 阶段 ---------------- */
  var STAGE_ROWS = [
    { lo: 0, hi: 20, n: '冰点期', pos: '0–10%', act: '空仓等待，只做记录', cap: 2, ban: ['打板', '追高'], allow: ['观察'] },
    { lo: 20, hi: 35, n: '修复期', pos: '10–30%', act: '小仓试错低位首板 / 2 板', cap: 3, ban: ['重仓', '接高位'], allow: ['低位首板', '2 板试错'] },
    { lo: 35, hi: 50, n: '启动期', pos: '30–50%', act: '加仓，打 2 板 / 3 板成龙点', cap: 4, ban: ['杂毛', '非主线'], allow: ['成龙点', '主线龙头'] },
    { lo: 50, hi: 68, n: '确认期', pos: '60–80%', act: '持有龙头，分歧转一致加仓', cap: 5, ban: ['卖飞龙头', '追杂毛'], allow: ['龙头', '分歧转一致'] },
    { lo: 68, hi: 90, n: '高潮期', pos: '50–70%', act: '持股并分批减仓，转补涨套利', cap: 8, ban: ['追缩量加速板', '加仓'], allow: ['补涨套利', '持有'] },
    { lo: 90, hi: 101, n: '分歧期', pos: '≤40%', act: '先减仓再判良性 / 恶性', cap: 3, ban: ['开新仓', '接首阴'], allow: ['减仓', '观察'] }
  ];
  function temperature(m) {
    var dims = [
      { k: '昨日涨停溢价', max: 15, val: m.prem, unit: '%', s: !has(m.prem) ? 0 : m.prem > 3 ? 15 : m.prem >= 1.5 ? 12 : m.prem >= 0 ? 8 : m.prem >= -3 ? 4 : 0 },
      { k: '涨停家数', max: 15, val: m.ztCount, unit: '家', s: !has(m.ztCount) ? 0 : m.ztCount >= 100 ? 15 : m.ztCount >= 85 ? 13 : m.ztCount >= 60 ? 11 : m.ztCount >= 40 ? 8 : m.ztCount >= 25 ? 5 : 2 },
      { k: '最高连板高度', max: 15, val: m.maxBoards, unit: '板', s: !has(m.maxBoards) ? 0 : m.maxBoards >= 8 ? 15 : m.maxBoards === 7 ? 13 : m.maxBoards === 6 ? 12 : m.maxBoards === 5 ? 10 : m.maxBoards === 4 ? 8 : m.maxBoards === 3 ? 5 : 2 },
      { k: '连板家数', max: 10, val: m.lianban, unit: '家', s: !has(m.lianban) ? 0 : m.lianban >= 22 ? 10 : m.lianban >= 14 ? 8 : m.lianban >= 8 ? 6 : m.lianban >= 5 ? 4 : 2 },
      { k: '炸板率', max: 10, val: m.zbRate, unit: '%', s: !has(m.zbRate) ? 0 : m.zbRate < 15 ? 10 : m.zbRate < 22 ? 8 : m.zbRate < 30 ? 6 : m.zbRate < 40 ? 3 : 0 },
      { k: '连板晋级率', max: 10, val: m.promoRate, unit: '%', s: !has(m.promoRate) ? 0 : m.promoRate > 45 ? 10 : m.promoRate >= 30 ? 7 : m.promoRate >= 15 ? 4 : 1 },
      { k: '大面股数量', max: 10, val: m.damian, unit: '家', s: !has(m.damian) ? 0 : m.damian === 0 ? 10 : m.damian === 1 ? 9 : m.damian <= 3 ? 7 : m.damian <= 6 ? 4 : m.damian <= 10 ? 2 : 0 },
      { k: '上涨家数占比', max: 10, val: m.upRatio, unit: '%', s: !has(m.upRatio) ? 0 : m.upRatio > 70 ? 10 : m.upRatio > 55 ? 8 : m.upRatio > 40 ? 5 : 2 },
      { k: '量能变化', max: 5, val: m.volChange, unit: '%', s: !has(m.volChange) ? 0 : m.volChange > 0 ? 5 : m.volChange > -10 ? 3 : m.volChange > -20 ? 2 : 0 }
    ];
    var got = 0, eff = 0;
    dims.forEach(function (x) { got += x.s; if (has(x.val)) eff += x.max; });
    return { T: eff ? Math.round(got / eff * 100) : 0, dims: dims, eff: eff };
  }
  function stageOf(T) {
    for (var i = 0; i < STAGE_ROWS.length; i++) if (T >= STAGE_ROWS[i].lo && T < STAGE_ROWS[i].hi) return STAGE_ROWS[i];
    return STAGE_ROWS[STAGE_ROWS.length - 1];
  }
  function posCapOf(stage) {
    var m = /(\d+)\s*[–-]\s*(\d+)/.exec(stage.pos || '');
    if (m) return Number(m[2]);
    var one = /(\d+)/.exec(stage.pos || '');
    return one ? Number(one[1]) : 50;
  }
  function capPos(range, cap) {
    var m = /(\d+)\s*[–-]\s*(\d+)/.exec(range || '');
    if (!m) return range || '—';
    var lo = Number(m[1]), hi = Number(m[2]);
    if (hi <= cap) return range;
    if (lo >= cap) return '0%（阶段限仓）';
    return lo + '–' + cap + '%';
  }

  /* ---------------- 手册买点规则 ---------------- */
  function entryOf(role, lb, dragonLb, stage) {
    var cap = posCapOf(stage);
    var raw, e;
    if (role === '龙头') {
      if (lb >= 6) e = {
        timing: '禁买区（高位缩量加速板）', method: '不买', pos: '0%', certainty: '—',
        cond: '手册禁区：6 板以上缩量加速是最危险买点；只可持有或分批兑现',
        stop: '跌破 5 日线清仓 / 天量减半', target: '—', note: '持有者按见顶 12 信号分批减仓'
      };
      else if (lb === 3) e = {
        timing: '② 成龙点（3 板）', method: '打板 / 半路', pos: '25–35%', certainty: '很高（65%）',
        cond: '已上 3 板且带动同题材涨停 ≥3 家、板块评分达准主线以上 → 成龙点成立',
        stop: '次日低开 −2% 且不能快速翻红 → 离场', target: '看至 5–7 板分批兑现',
        note: '3 板 = 资金共识，确定性提升最陡峭的位置'
      };
      else if (lb === 2) e = {
        timing: '② 成龙点（明日 3 板）', method: '打板', pos: '25–35%', certainty: '很高（65%）',
        cond: '明日上 3 板并带动板块 ≥3 家涨停 → 成龙点成立再打板；不提前埋伏',
        stop: '炸板不回封 → 次日走', target: '成龙后 2–5 板空间', note: '候选观察，不提前埋伏'
      };
      else if (lb >= 4) e = {
        timing: '① 分歧转一致（最优）', method: '半路 / 打板', pos: '30–40%', certainty: '最高（>70%）',
        cond: '分歧日回封 → 次日高开 +2% 以上快速上板；开盘 15 分钟不破均价线，分时突破前高半路买入',
        stop: '次日低开 −2% 以下即证伪', target: '加速主升 2–5 板', note: '全体系确定性最高买点'
      };
      else e = {
        timing: '③ 卡位成功日 / ④ 弱转强', method: '打板 / 低吸+半路', pos: '15–25%', certainty: '中高（55–60%）',
        cond: '同板级最先上板且封单最大；或分歧日次日盘中翻红上板',
        stop: '跌破均价线不回 → 止损', target: '1–3 板', note: '首板 / 低位为主'
      };
      raw = e.pos;
      e.stopRule = '断板次日不反包 / 破 5 日线 / −8%';
      e.winRule = '见顶信号 ≥3 减 1/3、≥5 清仓；天量（3 倍）减 1/2';
      e.timeRule = '买入后 3 日不创新高即减';
    } else if (role === '中军') {
      e = {
        timing: '① 缩量回踩均线 / ② 板块启动初期', method: '低吸（不追高、不打板）',
        pos: '15–20%', certainty: '高',
        cond: '沿 5 / 10 日线上行、缩量回调至均线企稳 → 低吸；或主线刚确认、中军刚放量突破 → 半路',
        stop: '收盘跌破 10 日线离场；放量下跌 = 出货', target: '趋势跟随 20%–30% 分批',
        note: '低吸不追高、沿均线做、看量能；中军是主线温度计',
        stopRule: '破 10 日线 / −7%', winRule: '放量滞涨或板块见顶分批减', timeRule: '5 日不涨即减'
      };
      raw = e.pos;
    } else {
      e = {
        timing: '② 补涨 2 板确认（最佳）', method: '打板', pos: '15–20%', certainty: '高（需龙头不死）',
        cond: '龙头 ≥4 板时，同题材正宗未涨标的首板 → 次日连板成功再打板',
        stop: '龙头断板 → 补涨立刻走',
        target: '天花板 = 龙头高度 −2~3 板（当前龙头 ' + (dragonLb || '—') + ' 板 → 上限约 ' + Math.max((dragonLb || 2) - 2, 1) + ' 板）',
        note: '只做正宗补涨不做玄学补涨；每天第一件事看龙头还在不在',
        stopRule: '不连板 / 龙头见顶 / −5%', winRule: '达「龙头高度 −2 板」即走', timeRule: '2 日'
      };
      raw = e.pos;
    }
    e.posRaw = raw;
    e.pos = capPos(raw, cap);
    e.posNote = '买点档 ' + raw + '，【' + stage.n + '】周期上限 ' + stage.pos + ' → 取更保守 ' + e.pos;
    return e;
  }

  /* ---------------- 读取与指标 ---------------- */
  function read(d) {
    d = d || {};
    var M = (d.market && d.market.ok) ? d.market : null;
    var snapDate = d.date || (d.overview && d.overview.date) || '—';
    var marketDate = M ? (M.dateISO || M.date) : null;
    var live = !!(M && M.ztPool && M.ztPool.length);
    var qmap = (M && M.poolQuotes) || {};
    var pool = live ? M.ztPool.map(function (x) { return normPool(x, M, qmap); })
      : (d.stocks || []).map(function (x) { return normSnap(x, snapDate); });
    var ov = d.overview || {};
    var ztCount = live ? num(M.ztCount, pool.length) : num(ov.limitUp, pool.length);
    var ladder = countBy(pool, function (x) { return x.boards; });
    var maxBoards = live ? num(M.maxBoards, 7) : (pool.length ? Math.max.apply(null, pool.map(function (x) { return x.boards; })) : null);
    var lianban = live ? num(M.lianbanCount, pool.filter(function (x) { return x.boards >= 2; }).length) : pool.filter(function (x) { return x.boards >= 2; }).length;
    var zbCount = live ? num(M.zbCount) : num(ov.zhaban);
    var dtCount = live ? num(M.dtCount) : null;
    var zbRate = live ? num(M.zbRate) : ((has(ztCount) && has(zbCount) && ztCount + zbCount > 0) ? zbCount / (ztCount + zbCount) * 100 : null);
    var m = {
      ztCount: ztCount, zbCount: zbCount, dtCount: dtCount, zbRate: zbRate,
      maxBoards: maxBoards, lianban: lianban, ladder: ladder,
      prem: live ? num(M.prem) : null,
      promoRate: live ? num(M.promoRate) : null,
      damian: live ? num(M.damian) : null,
      upRatio: live ? num(M.upRatio) : null,
      volChange: live ? num(M.volChange) : null,
      amountToday: live ? num(M.amountToday) : null
    };
    var sectorCounts = live && M.sectorCounts && M.sectorCounts.length
      ? M.sectorCounts.map(function (x) {
        var v = num(x.limitCount, 0);
        return { sector: x.sector, n: v, limitCount: v };   // 两个键都给，兼容历史池 / 工具箱口径
      })
      : Object.keys(countBy(pool, function (x) { return x.sector; })).map(function (k) {
        var v = countBy(pool, function (x) { return x.sector; })[k];
        return { sector: k, n: v, limitCount: v };
      }).sort(function (a, b) { return b.n - a.n; });
    var topSector = sectorCounts.length ? sectorCounts[0] : { sector: '—', n: 0 };

    /* 时间序列（升序）：历史 5 日 + 今日 */
    var series = [];
    if (M && M.history && M.history.length) {
      M.history.slice().reverse().forEach(function (h) {
        series.push({
          compact: h.compact, date: h.date, ztCount: num(h.ztCount), dtCount: num(h.dtCount),
          maxBoards: num(h.maxBoards), lianban: num(h.lianban),
          zbRate: (has(h.ztCount) && has(h.zbCount) && h.ztCount + h.zbCount > 0) ? h.zbCount / (h.ztCount + h.zbCount) * 100 : null,
          sectorCounts: h.sectorCounts || []
        });
      });
    }
    series.push({
      compact: compact(marketDate || snapDate), date: shortDate(marketDate || snapDate),
      ztCount: ztCount, dtCount: dtCount, maxBoards: maxBoards, lianban: lianban,
      zbRate: zbRate, sectorCounts: sectorCounts, today: true
    });
    function secCount(row, name) {
      var f = (row.sectorCounts || []).filter(function (x) { return x.sector === name; })[0];
      return f ? num(f.limitCount, num(f.n, 0)) : 0;   // 历史池用 limitCount，今日池同时给 n / limitCount
    }
    var uni = (M && M.roleUniverse) || [];
    var dtPool = live ? (M.dtPool || []) : [];
    var zbPool = live ? (M.zbPool || []) : [];
    var quotes = (M && M.quotes) || {};
    var T = temperature(m), stage = stageOf(T.T);
    return {
      d: d, M: M, live: live, snapDate: snapDate, marketDate: marketDate,
      pool: pool, m: m, series: series, sectorCounts: sectorCounts, topSector: topSector,
      secCount: secCount, uni: uni, dtPool: dtPool, zbPool: zbPool, quotes: quotes,
      T: T.T, thermo: T, stage: stage,
      dateMixed: !!(marketDate && compact(marketDate) !== compact(snapDate))
    };
  }

  /* ---------------- ① 八大拐点 ---------------- */
  function turningCheck(X) {
    var s = X.series, t = s[s.length - 1], p = s[s.length - 2] || {}, pp = s[s.length - 3] || {};
    var m = X.m, zt = m.ztCount, dt = m.dtCount, mb = m.maxBoards, lb = m.lianban;
    var zb = m.zbRate, prem = m.prem, promo = m.promoRate, dm = m.damian;
    var prevZt = p.ztCount, prevDt = p.dtCount, prevMb = p.maxBoards, prevZb = p.zbRate;
    var peakDt = null;
    s.forEach(function (r) { if (has(r.dtCount) && (peakDt == null || r.dtCount > peakDt)) peakDt = r.dtCount; });
    var maxSec = X.topSector.n || 0, secN = X.sectorCounts.filter(function (x) { return x.n > 0; }).length;
    var l1 = m.ladder['1'] || 0, l2 = m.ladder['2'] || 0, l3 = m.ladder['3'] || 0, l4 = m.ladder['4'] || 0;
    var l3plus = Object.keys(m.ladder).reduce(function (a, k) { return Number(k) >= 3 ? a + m.ladder[k] : a; }, 0);
    var share = has(zt) && zt ? maxSec / zt * 100 : null;
    var df = X.pool.filter(function (x) { return x.zbc > 0; }).length;   // 当日分歧回封股
    var E = function (label, v) { return label + ' = ' + (has(v) ? v : '缺'); };
    var defs = [
      { id: 1, n: '① 出清拐点', a: '崩塌 → 冰点｜跌不动了', from: '崩塌期', to: '冰点期',
        op: '空仓观察为主，开始筛选下一轮候选方向（记录崩塌末期逆势红盘、抗跌、有资金吸筹的票）',
        sig: [
          sig('跌停家数较高峰减少 50% 以上', has(dt) && has(peakDt) ? dt <= peakDt * 0.5 : null, '今日跌停 ' + (has(dt) ? dt : '缺') + ' 家 / 近 5 日峰值 ' + (has(peakDt) ? peakDt : '缺') + ' 家'),
          sig('涨停家数连续 2 日不再创新低（横在 15–25 家）', has(zt) && has(prevZt) && has(pp.ztCount) ? (zt >= pp.ztCount && zt >= 15 && zt <= 25) : null, '近 3 日涨停家数 ' + [pp.ztCount, prevZt, zt].map(function (v) { return has(v) ? v : '缺'; }).join(' → ')),
          sig('昨日涨停溢价止跌（溢价 ≥ −1%）', has(prem) ? prem >= -1 : null, E('昨日涨停今日溢价', prem) + '%'),
          sig('跌停家数 < 10 家 且 涨停家数 ≥ 20 家（确认）', has(dt) && has(zt) ? (dt < 10 && zt >= 20) : null, '跌停 ' + (has(dt) ? dt : '缺') + ' 家 / 涨停 ' + (has(zt) ? zt : '缺') + ' 家'),
          sig('最高板降至 ≤2 板（出清完成形态）', has(mb) ? mb <= 2 : null, E('最高连板', mb) + ' 板')
        ] },
      { id: 2, n: '② 试错拐点', a: '冰点 → 修复｜有人开始干活了', from: '冰点期', to: '修复期',
        op: '小仓 10–30% 试错低位首板与 2 板，找下一主线种子；错了当天 / 次日必须认错',
        sig: [
          sig('最高板从 2 板升到 3 板并封住（最硬指标）', has(mb) ? mb >= 3 : null, E('最高连板', mb) + ' 板（近 5 日 ' + s.map(function (r) { return has(r.maxBoards) ? r.maxBoards : '缺'; }).join('/') + '）'),
          sig('涨停家数回升到 25 家以上', has(zt) ? zt >= 25 : null, E('涨停家数', zt)),
          sig('出现 ≥3 家涨停的板块效应', has(maxSec) ? maxSec >= 3 : null, '最大板块【' + X.topSector.sector + '】涨停 ' + maxSec + ' 家'),
          sig('连板家数 ≥6 家（确认）', has(lb) ? lb >= 6 : null, E('连板家数', lb)),
          sig('跌停家数 < 15 家（证伪：重回 15+ 为二次探底）', has(dt) ? dt < 15 : null, E('跌停家数', dt))
        ] },
      { id: 3, n: '③ 启动拐点', a: '修复 → 启动｜打板开始赚钱了', from: '修复期', to: '启动期',
        op: '加仓窗口开启（30–50%）：打 2 板、打 3 板（成龙点），向已确认主线集中，做龙头不做杂毛',
        sig: [
          sig('昨日涨停溢价首次转正（≥0%，核心标志）', has(prem) ? prem >= 0 : null, E('昨日涨停今日溢价', prem) + '%'),
          sig('炸板率降至 30% 以下', has(zb) ? zb < 30 : null, E('炸板率', has(zb) ? fx(zb, 2) : null) + '%'),
          sig('出现「3板 + 2~3家2板 + 5家以上首板」梯队雏形', (l3plus >= 1 && l2 >= 2 && l1 >= 5), '3板及以上 ' + l3plus + ' 家 / 2板 ' + l2 + ' 家 / 首板 ' + l1 + ' 家'),
          sig('连板晋级率 > 25%', has(promo) ? promo > 25 : null, E('连板晋级率', has(promo) ? fx(promo, 2) : null) + '%（fuyao 连板天梯口径）'),
          sig('最高板升到 4 板 + 板块涨停占比 >20%（确认）', has(mb) && has(share) ? (mb >= 4 && share > 20) : null, '最高 ' + (has(mb) ? mb : '缺') + ' 板 / 最大板块占比 ' + (has(share) ? fx(share, 1) : '缺') + '%')
        ] },
      { id: 4, n: '④ 确认拐点', a: '启动 → 确认｜分歧转一致', from: '启动期', to: '确认期',
        op: '全体系最佳买点之一：确认分歧转一致当日龙头加仓 / 上车（半路或打板），仓位升至 60–80%',
        sig: [
          sig('出现爆量分歧后回封的龙头（放巨量 + 烂板 + 回封）', df > 0, '当日涨停池内开板后回封 ' + df + ' 只（东财 pool[].zbc）'),
          sig('分歧发生在 3–4 板相对低位（非 6 板以上）', (l3 + l4) > 0, '3 板 ' + l3 + ' 家 / 4 板 ' + l4 + ' 家'),
          sig('板块内有新的低位首板补位', (l1 >= 5 && maxSec >= 3), '全市场首板 ' + l1 + ' 家 / 最大板块 ' + maxSec + ' 家涨停'),
          sig('当日无中位股批量跌停', has(dt) ? dt < 3 : null, E('全市场跌停家数', dt) + '（中位股跌停明细缺失，按全市场代理）'),
          sig('分歧次日高开 +2% 以上快速上板 / 缩量板（最终确认）', null, '需下一交易日分时数据，本静态快照不可得 → 标缺，不计入分母')
        ] },
      { id: 5, n: '⑤ 加速拐点', a: '确认 → 高潮｜缩量加速、补涨狂潮', from: '确认期', to: '高潮期',
        op: '持股 + 分批减仓：龙头不追高不加仓，仓位 80% → 50–70%，转向补涨股套利（低位、快进快出）',
        sig: [
          sig('涨停家数突破 85–100 家', has(zt) ? zt >= 85 : null, E('涨停家数', zt)),
          sig('最高板 ≥6 板', has(mb) ? mb >= 6 : null, E('最高连板', mb) + ' 板'),
          sig('补涨潮：涨停行业分散度上升（≥6 个行业有涨停）', secN >= 6, '当日有涨停的行业 ' + secN + ' 个'),
          sig('炸板率极低（<18%，封板质量高）', has(zb) ? zb < 18 : null, E('炸板率', has(zb) ? fx(zb, 2) : null) + '%'),
          sig('大面股为 0 且溢价 > +3%（极强）', has(dm) && has(prem) ? (dm === 0 && prem > 3) : null, '大面股 ' + (has(dm) ? dm : '缺') + ' 家 / 溢价 ' + (has(prem) ? prem : '缺') + '%')
        ] },
      { id: 6, n: '⑥ 见顶拐点', a: '高潮 → 分歧｜天量烂板、中位先死', from: '高潮期', to: '分歧期',
        op: '无条件减仓至 40% 以下（第一动作），再用良性 / 恶性分歧表定性；良性留龙头底仓，恶性清仓',
        sig: [
          sig('炸板率较前一日跳升 10 个百分点以上至 30%+', has(zb) && has(prevZb) ? (zb - prevZb >= 10 && zb >= 30) : (has(zb) ? zb >= 30 : null), '今日炸板率 ' + (has(zb) ? fx(zb, 2) : '缺') + '% / 上一交易日 ' + (has(prevZb) ? fx(prevZb, 2) : '缺') + '%'),
          sig('中位股批量跌停 / 断板（最领先信号）', has(dt) ? dt >= 3 : null, E('全市场跌停家数', dt) + '（中位股跌停明细缺失，按全市场代理）'),
          sig('大面股数量上升至 3 家以上', has(dm) ? dm >= 3 : null, E('大面股', dm)),
          sig('昨日涨停溢价回落（较前一日下降）', null, '缺前一日溢价序列（历史报价未提供）→ 标缺，不计入分母'),
          sig('出现天地板 / 高位爆量不封', has(dt) && has(m.zbCount) ? (dt >= 1 && m.zbCount >= 5 && dt >= 3) : null, '今日跌停 ' + (has(dt) ? dt : '缺') + ' 家 / 炸板 ' + (has(m.zbCount) ? m.zbCount : '缺') + ' 家（天地板需分时，按跌停 + 炸板代理）')
        ] },
      { id: 7, n: '⑦ 退潮拐点', a: '分歧 → 退潮｜龙头断板、不反包', from: '分歧期', to: '退潮期',
        op: '清掉旧主线全部仓位（龙头 / 中位 / 补涨 / 跟风一律不留），降至 0–20%，极小仓试错新方向低位首板或 2 板',
        sig: [
          sig('连板高度塌陷：最高板较前一日降 2 板以上', has(mb) && has(prevMb) ? (prevMb - mb >= 2) : null, '最高板 ' + (has(prevMb) ? prevMb : '缺') + ' → ' + (has(mb) ? mb : '缺')),
          sig('大面股 ≥5 家', has(dm) ? dm >= 5 : null, E('大面股', dm)),
          sig('昨日涨停溢价转负', has(prem) ? prem < 0 : null, E('昨日涨停今日溢价', prem) + '%'),
          sig('晋级率跌破 25%', has(promo) ? promo < 25 : null, E('连板晋级率', has(promo) ? fx(promo, 2) : null) + '%'),
          sig('跌停家数 ≥10 家', has(dt) ? dt >= 10 : null, E('跌停家数', dt))
        ] },
      { id: 8, n: '⑧ 崩塌拐点', a: '退潮 → 崩塌｜多杀多、核按钮遍地', from: '退潮期', to: '崩塌期',
        op: '绝对空仓（0%）。唯一工作：记录谁抗跌、哪个方向先止跌、量能何时见地量、何时出现反核',
        sig: [
          sig('跌停家数 ≥20 家并继续增加', has(dt) ? (dt >= 20 && (has(prevDt) ? dt > prevDt : true)) : null, '今日 ' + (has(dt) ? dt : '缺') + ' 家 / 上一交易日 ' + (has(prevDt) ? prevDt : '缺') + ' 家'),
          sig('昨日涨停溢价 −3% 以下', has(prem) ? prem <= -3 : null, E('昨日涨停今日溢价', prem) + '%'),
          sig('炸板率 > 45%', has(zb) ? zb > 45 : null, E('炸板率', has(zb) ? fx(zb, 2) : null) + '%'),
          sig('涨停家数 < 35 家 且 大面股 > 10 家（确认）', has(zt) && has(dm) ? (zt < 35 && dm > 10) : null, '涨停 ' + (has(zt) ? zt : '缺') + ' 家 / 大面股 ' + (has(dm) ? dm : '缺') + ' 家'),
          sig('最高板 ≤2 板', has(mb) ? mb <= 2 : null, E('最高连板', mb) + ' 板')
        ] }
    ];
    var cards = defs.map(function (c) {
      var h = hitInfo(c.sig);
      c.hit = h;
      c.status = h.yes >= 3 ? 'strong' : (h.yes >= 2 ? 'warn' : '');
      return c;
    });
    /* 唯一结论：命中最多者；强信号 ≥3 条；与当前温度阶段一致者优先 */
    var ranking = cards.slice().sort(function (a, b) {
      var ca = (a.from === X.stage.n || a.to === X.stage.n) ? 1 : 0;
      var cb = (b.from === X.stage.n || b.to === X.stage.n) ? 1 : 0;
      return (cb - ca) || (b.hit.yes - a.hit.yes) || (b.hit.rate - a.hit.rate);
    });
    var pick = ranking[0];
    var runner = ranking[1];
    var conf = pick.hit.yes >= 4 ? '高' : (pick.hit.yes >= 3 ? '中高' : '中');
    return {
      cards: cards,
      conclusion: {
        n: pick.n, a: pick.a, op: pick.op, yes: pick.hit.yes, judged: pick.hit.judged,
        lead: pick.hit.yes - (runner ? runner.hit.yes : 0), conf: conf,
        evidence: pick.sig.filter(function (x) { return x.ok === true; }).map(function (x) { return x.t; }),
        stage: X.stage.n, T: X.T,
        note: pick.hit.yes >= 3 ? '命中 ≥3 条 → 强信号' : '命中不足 3 条 → 弱信号，周期延续'
      }
    };
  }

  /* ---------------- ② 板块主线判定 + 角色 ---------------- */
  function findJun(X, sector, ztList) {
    var matched = X.uni.filter(function (u) { return indMatch(u.industry, sector); });
    if (matched.length) {
      var sorted = matched.slice().sort(function (a, b) { return (b.floatMv || 0) - (a.floatMv || 0); });
      var big = sorted.filter(function (u) { return has(u.floatMv) && u.floatMv >= 100 * 1e8 && has(u.amount) && u.amount >= 5 * 1e8; })[0] || sorted[0];
      var u = big || {};
      return {
        code: u.code || '', name: u.name || '', sector: sector, boards: 0,
        price: num(u.price), changePct: num(u.changePct), amount: num(u.amount),
        cap: has(u.floatMv) ? u.floatMv / 1e8 : null, floatMv: num(u.floatMv),
        turnover: num(u.turnover), fund: null, firstTime: '', zbc: 0,
        mainNet: num(u.mainNet), volumeRatio: num(u.volumeRatio),
        source: 'universe', industry: u.industry || ''
      };
    }
    /* 降级：板块内流通市值最大的涨停股作为中军代理（明确标注，不冒充趋势票） */
    var list = ztList.slice().sort(function (a, b) { return (b.cap || 0) - (a.cap || 0); });
    var f = list[0] || null;
    if (f) { var c = Object.assign({}, f); c.source = 'proxy'; return c; }
    return null;
  }
  function scoreSectors(X) {
    var s = X.series, today = s[s.length - 1], zt = X.m.ztCount || 0;
    var groups = {};
    X.pool.forEach(function (x) { (groups[x.sector] = groups[x.sector] || []).push(x); });
    var names = Object.keys(groups);
    var prev = s[s.length - 2] || null;
    var prevPool = (X.M && X.M.prevZtPool) || [];
    var out = names.map(function (name) {
      var list = groups[name];
      var n = list.length;
      /* 持续性：连续（含今日）涨停 ≥2 家的交易日数 */
      var days = 0;
      for (var i = s.length - 1; i >= 0; i--) {
        if (X.secCount(s[i], name) >= 2) days++; else break;
      }
      var persist = days >= 5 ? 25 : days >= 3 ? 18 : days === 2 ? 10 : days === 1 ? 3 : 0;
      var share = zt ? n / zt * 100 : 0;
      var shareScore = share > 35 ? 20 : share >= 25 ? 15 : share >= 15 ? 10 : share >= 8 ? 5 : 2;
      var b1 = list.filter(function (x) { return x.boards === 1; }).length;
      var b2 = list.filter(function (x) { return x.boards === 2; }).length;
      var b3 = list.filter(function (x) { return x.boards >= 3; }).length;
      var ladderScore = (b3 && b2 && b1) ? 20 : ((b3 || b2) && b1) ? 12 : b1 ? 4 : 0;
      var jun = findJun(X, name, list);
      var junUp = jun && has(jun.changePct) && jun.changePct > 0 && ((has(jun.volumeRatio) && jun.volumeRatio >= 1) || (has(jun.mainNet) && jun.mainNet > 0));
      var junScore = jun ? (junUp ? 15 : 7) : 0;
      /* 催化：本站静态快照无消息面文本，按手册「缺项不猜测」记 0 并在评分卡标注 */
      var catalyst = 0;
      /* 赚钱效应：板块内连板晋级率（T-1 连板股今日是否仍在涨停池），无样本则用全市场晋级率代理 */
      var cand = prevPool.filter(function (x) { return (x.sector || x.hybk || '') === name && (x.lbc || 1) >= 2; });
      var todayCodes = {}; X.pool.forEach(function (x) { todayCodes[x.code] = 1; });
      var promoted = cand.filter(function (x) { return todayCodes[x.code]; }).length;
      var earnRate = cand.length ? promoted / cand.length * 100 : X.m.promoRate;
      var earn = !has(earnRate) ? 0 : earnRate > 45 ? 10 : earnRate >= 30 ? 6 : earnRate >= 15 ? 3 : 0;
      var score = persist + shareScore + ladderScore + junScore + catalyst + earn;
      var level = score >= 70 ? '主线' : score >= 50 ? '准主线 / 强支线' : score >= 30 ? '支线' : '一日游 / 杂毛';
      var lvCls = score >= 70 ? 'd' : score >= 50 ? 'g' : score >= 30 ? 'b' : 'n';
      var maxB = list.length ? Math.max.apply(null, list.map(function (x) { return x.boards; })) : 0;
      var dragon = list.slice().sort(function (a, b) {
        return (b.boards - a.boards) || ((a.fbt || 9e9) - (b.fbt || 9e9)) || ((b.fund || 0) - (a.fund || 0));
      })[0] || null;
      var bub = list.filter(function (x) { return x !== dragon; }).sort(function (a, b) {
        return (a.boards - b.boards) || ((a.fbt || 9e9) - (b.fbt || 9e9));
      })[0] || null;
      var six = {
        height: maxB >= 3, ladder: (b2 > 0 && b1 > 0), jun: !!jun,
        persist: days >= 2, dragon: !!dragon && n >= 3, logic: (!!jun && (b2 > 0 || b3 > 0))
      };
      return {
        name: name, n: n, maxBoards: maxB, score: score, level: level, lvCls: lvCls,
        dims: { persist: persist, share: shareScore, shareVal: share, ladder: ladderScore, jun: junScore, catalyst: catalyst, earn: earn },
        earnRate: earnRate, days: days, six: six, sixOk: Object.keys(six).filter(function (k) { return six[k]; }).length,
        list: list, dragon: dragon, jun: jun, bub: bub,
        counts: s.map(function (r) { return X.secCount(r, name); })
      };
    });
    out.sort(function (a, b) { return (b.score - a.score) || (b.n - a.n) || (b.maxBoards - a.maxBoards); });
    return out;
  }
  function dragonAudit(d, code) {
    try {
      if (global.YGAutoFill && typeof global.YGAutoFill.dragon === 'function') {
        var a = global.YGAutoFill.dragon(d, code);
        if (a && a.good) return a;
      }
    } catch (e) { /* 体检失败不影响主页面 */ }
    return null;
  }
  function buildRoles(X, sec, d) {
    var stage = X.stage, dragonLb = sec.maxBoards;
    var roles = [];
    function make(role, s, logic, cond, extra) {
      if (!s) return;
      var e = entryOf(role, s.boards || 0, dragonLb, stage);
      roles.push({
        role: role, s: s, logic: logic, cond: cond || e.cond, entry: e,
        fundText: fundLine(s), meta: metaLine(s), extra: extra || ''
      });
    }
    if (sec.dragon) {
      var audit = dragonAudit(d, sec.dragon.code);
      var dn = sec.dragon;
      make('龙头', dn,
        '【' + sec.name + '】评分 ' + sec.score + ' 分（' + sec.level + '）；板块内最高板 ' + dn.boards + ' 板，带动同板块涨停 ' + sec.n + ' 家 → 按手册「3 板定理 / 板块最高板」判定为板块龙头',
        '买点触发器：' + entryOf('龙头', dn.boards, dragonLb, stage).cond,
        audit ? ('龙头成色 ' + audit.goodHits + '/17 → ' + (audit.isDragon ? '真龙头' : '未达真龙头门槛') +
          '；见顶 12 信号命中 ' + audit.badHits + ' → ' + (audit.isTop ? '已见顶' : '未见顶')) : '');
      if (audit) roles[roles.length - 1].audit = audit;
    }
    if (sec.jun) {
      var proxy = sec.jun.source === 'proxy';
      make('中军', sec.jun,
        (proxy ? '【代理口径】板块内流通市值最大的涨停股（全市场活跃股池未匹配到该行业）：' : '') +
        '流通 ' + fx(sec.jun.cap, 0) + ' 亿、成交 ' + yi(sec.jun.amount) + ' 亿' +
        (proxy ? '' : '，来自东财全市场活跃股池（按成交额前 400）') + ' → 按手册「中大市值趋势票」识别为板块中军／压舱石',
        '沿 5 / 10 日线缩量回踩企稳再低吸；中军大阴破位（跌 5%+ 且破 10 日线）即主线末期信号',
        proxy ? '代理口径，非趋势票，请勿据此判定主线持续性' : '');
    }
    if (sec.bub) {
      var bb = sec.bub;
      make('补涨', bb,
        '板块内低位同属性标的（' + bb.boards + ' 板，首封 ' + (bb.firstTime || '—') + '）；按手册「位置比价效应 / 天花板法则」，补涨高度 ≈ 龙头 ' + dragonLb + ' 板 − 2~3 板',
        '龙头 ≥4 板时同题材正宗首板 → 次日连板成功再打板；龙头断板则补涨立即离场',
        '天花板约 ' + Math.max(dragonLb - 2, 1) + ' 板，当前 ' + bb.boards + ' 板');
    }
    return roles;
  }

  /* ---------------- ③ 主线切换 ---------------- */
  function switchCheck(X, sectors) {
    var s = X.series, t = s[s.length - 1], prev = s[s.length - 2] || null;
    var prevTop = prev ? (prev.sectorCounts || []).slice().sort(function (a, b) {
      return num(b.limitCount, num(b.n, 0)) - num(a.limitCount, num(a.n, 0));
    })[0] : null;
    var oldName = prevTop ? prevTop.sector : (X.topSector.sector || '—');
    var newSec = sectors.filter(function (x) { return x.name !== oldName; })[0] || sectors[0] || null;
    var newName = newSec ? newSec.name : (X.topSector.sector || '—');
    var oldToday = X.secCount(t, oldName), newToday = X.secCount(t, newName);
    var oldPrev = prev ? X.secCount(prev, oldName) : 0;
    var peakOld = 0; s.forEach(function (r) { peakOld = Math.max(peakOld, X.secCount(r, oldName)); });
    var oldList = X.pool.filter(function (x) { return x.sector === oldName; });
    var newList = X.pool.filter(function (x) { return x.sector === newName; });
    var oldMax = oldList.length ? Math.max.apply(null, oldList.map(function (x) { return x.boards; })) : 0;
    var newMax = newList.length ? Math.max.apply(null, newList.map(function (x) { return x.boards; })) : 0;
    var oldDt = X.dtPool.filter(function (x) { return (x.hybk || x.sector || '') === oldName; }).length;
    var prevOldDragon = (X.M && X.M.prevZtPool || []).filter(function (x) { return (x.sector || x.hybk || '') === oldName; })
      .sort(function (a, b) { return (b.lbc || 1) - (a.lbc || 1); })[0] || null;
    var oldJun = findJun(X, oldName, oldList);
    var newJun = newSec ? newSec.jun : null;
    var oldLowPrev = (X.M && X.M.prevZtPool || []).filter(function (x) { return (x.sector || x.hybk || '') === oldName && (x.lbc || 1) <= 2; }).length;
    var oldLowToday = oldList.filter(function (x) { return x.boards <= 2; }).length;
    var dragonQuote = prevOldDragon ? X.quotes[prevOldDragon.code] : null;
    var dragonBroke = prevOldDragon && !X.pool.some(function (x) { return x.code === prevOldDragon.code; });
    var dragonNoRebound = dragonQuote && has(dragonQuote.changePct) ? dragonQuote.changePct < 9.5 : null;

    var dead = [
      sig('① 龙头断板且次日不反包（最硬）', prevOldDragon ? (dragonBroke ? (dragonNoRebound === null ? null : dragonNoRebound) : false) : null,
        'T-1【' + oldName + '】最高板 ' + (prevOldDragon ? (prevOldDragon.n || prevOldDragon.name || '—') + ' ' + (prevOldDragon.lbc || 1) + ' 板' : '缺') +
        '，今日' + (dragonBroke ? '未涨停' : '仍涨停') + (dragonQuote && has(dragonQuote.changePct) ? '、今日 ' + fx(dragonQuote.changePct, 2) + '%' : '')),
      sig('② 板块涨停家数从峰值回落 >50%', (peakOld > 0) ? oldToday < peakOld * 0.5 : null,
        '【' + oldName + '】近 ' + s.length + ' 日峰值 ' + peakOld + ' 家 → 今日 ' + oldToday + ' 家'),
      sig('③ 板块指数跌破 5 日线 / 走平下行', null, '缺板块指数日线数据 → 标缺，不计入分母'),
      sig('④ 中军大阴破位', oldJun ? (has(oldJun.changePct) ? oldJun.changePct <= -5 : null) : null,
        oldJun ? '【' + oldName + '】中军 ' + oldJun.name + ' 今日 ' + pct(oldJun.changePct) : '缺中军数据'),
      sig('⑤ 补涨股不再涨停（补涨逻辑失效）', oldLowPrev ? oldLowToday < oldLowPrev : (oldLowToday === 0),
        '低位（≤2 板）涨停 T-1 ' + oldLowPrev + ' 家 → 今日 ' + oldLowToday + ' 家'),
      sig('⑥ 板块内 3 只以上中位股跌停', has(oldDt) ? oldDt >= 3 : null, '今日跌停池中【' + oldName + '】' + oldDt + ' 只'),
      sig('⑦ 板块昨日涨停溢价连续 2 日为负', null, '缺板块级连续 2 日溢价序列 → 标缺，不计入分母')
    ];
    /* 新主线 7 条（手册 sw-2，必须全部满足） */
    var newCounts = s.map(function (r) { return X.secCount(r, newName); });
    var resDays = newCounts.filter(function (v) { return v >= 2; }).length;
    var inc3 = newCounts.slice(-3);
    var b1 = newList.filter(function (x) { return x.boards === 1; }).length;
    var b2 = newList.filter(function (x) { return x.boards === 2; }).length;
    var b3 = newList.filter(function (x) { return x.boards >= 3; }).length;
    var born = [
      sig('① 连续 ≥3 个交易日有涨停共振', resDays >= 3, '【' + newName + '】近 ' + s.length + ' 日涨停数 ' + newCounts.join(' / ') + '（≥2 家视为共振，' + resDays + ' 日达标）'),
      sig('② 出现 ≥3 板的高标且为方向正宗标的', newMax >= 3, '板块最高 ' + newMax + ' 板，涨停 ' + newToday + ' 家'),
      sig('③ 板块涨停家数 ≥5 家且逐日递增', (newToday >= 5 && inc3.length === 3 && inc3[2] > inc3[1] && inc3[1] > inc3[0]), '近 3 日 ' + inc3.join(' → ') + ' 家'),
      sig('④ 出现梯队（有 2 板、有首板补位）', (b2 > 0 && b1 > 0) || (b3 > 0 && b2 > 0), '首板 ' + b1 + ' / 2板 ' + b2 + ' / 3板以上 ' + b3),
      sig('⑤ 有中军（中大市值票）放量启动', newJun ? (has(newJun.cap) && newJun.cap >= 100 && (has(newJun.mainNet) ? newJun.mainNet > 0 : true)) : null,
        newJun ? '中军 ' + newJun.name + '：流通 ' + fx(newJun.cap, 0) + ' 亿 / 主力净额 ' + signed(has(newJun.mainNet) ? newJun.mainNet / 1e8 : null, 2) + ' 亿' : '缺中军数据'),
      sig('⑥ 有持续催化（政策 / 产业 / 事件）', null, '本站静态快照不含消息面文本，按手册缺项标注，不计入分母'),
      sig('⑦ 板块涨停家数 > 旧主线退潮后涨停家数', newToday > oldToday, '新【' + newName + '】' + newToday + ' 家 > 旧【' + oldName + '】' + oldToday + ' 家')
    ];
    var newPrev = prev ? X.secCount(prev, newName) : 0;
    var finalOk = [
      sig('新方向最高板 > 旧主线退潮时高度', (newMax > oldMax), '新 ' + newMax + ' 板 vs 旧 ' + oldMax + ' 板'),
      sig('新方向涨停家数连续 2 日 > 旧主线', (newToday > oldToday && newPrev > oldPrev), 'T-1：' + newPrev + ' vs ' + oldPrev + '；今日：' + newToday + ' vs ' + oldToday),
      sig('旧主线龙头进入 A 字杀（连续跌停）', prevOldDragon && dragonQuote && has(dragonQuote.changePct) ? dragonQuote.changePct <= -9 : null,
        prevOldDragon ? 'T-1 龙头今日 ' + (dragonQuote && has(dragonQuote.changePct) ? fx(dragonQuote.changePct, 2) + '%' : '缺报价') : '缺 T-1 龙头数据')
    ];
    var dh = hitInfo(dead), bh = hitInfo(born), fh = hitInfo(finalOk);
    var deadOk = dh.yes >= 3, bornOk = (bh.yes === bh.judged && bh.judged > 0);
    var switchOn = deadOk && bornOk && fh.yes >= 2;
    /* v20261112d：把「为什么选这个方向」摊开，避免把评分第一名误读成「已判定新主线」。
       本站用东财 hybk 行业细分，参考站类页面用概念板块，两者颗粒度不同、名字不可直接对比。 */
    var runnerUp = sectors.filter(function (x) { return x.name !== oldName; })[1] || null;
    var basis = {
      caliber: '东财涨停池 hybk 行业细分口径',
      oldRule: 'T-1 涨停家数最多的行业',
      oldPrev: oldPrev,
      pickRule: '100 分评分卡排序 → 排除旧主线 → 取第一名',
      candName: newName,
      candScore: newSec ? newSec.score : null,
      candDays: newSec ? newSec.days : 0,
      candMaxB: newMax,
      candN: newToday,
      runner: runnerUp ? {
        name: runnerUp.name, score: runnerUp.score,
        diff: (newSec ? newSec.score - runnerUp.score : 0)
      } : null,
      qualified: (newMax >= 3 || (newSec && newSec.days >= 3)),
      deadJudged: dh.judged, deadTotal: dead.length,
      bornJudged: bh.judged, bornTotal: born.length,
      intraday: !!(X.d && X.d.intraday),
      ztCount: X.m.ztCount,
      marketDate: X.marketDate || X.snapDate
    };
    /* 行业涨停家数 4 日趋势（自然日，非交易日显示 —） */
    var base = t.compact;
    var days = [shiftDay(base, -3), shiftDay(base, -2), shiftDay(base, -1), base];
    var rowMap = {};
    days.forEach(function (c) {
      var row = s.filter(function (r) { return r.compact === c; })[0];
      (row ? (row.sectorCounts || []) : []).forEach(function (x) {
        var nm = x.sector; if (!rowMap[nm]) rowMap[nm] = { name: nm, vals: [0, 0, 0, 0], has: [false, false, false, false] };
      });
    });
    /* 只展示 4 日中出现过的行业，按最后一日家数排序，最多 10 行 */
    days.forEach(function (c, i) {
      var row = s.filter(function (r) { return r.compact === c; })[0];
      if (!row) return;
      Object.keys(rowMap).forEach(function (nm) {
        var f = (row.sectorCounts || []).filter(function (x) { return x.sector === nm; })[0];
        rowMap[nm].vals[i] = f ? num(f.limitCount, num(f.n, 0)) : 0;
        rowMap[nm].has[i] = true;
      });
    });
    var trends = Object.keys(rowMap).map(function (k) { return rowMap[k]; })
      .sort(function (a, b) { return b.vals[3] - a.vals[3] || b.vals[2] - a.vals[2]; }).slice(0, 10);
    return {
      oldName: oldName, newName: newName, oldToday: oldToday, newToday: newToday,
      oldPrev: oldPrev, newPrev: newPrev, peakOld: peakOld,
      dead: dead, born: born, finalOk: finalOk, dh: dh, bh: bh, fh: fh,
      deadOk: deadOk, bornOk: bornOk, switchOn: switchOn,
      mode: deadOk ? '硬切换（旧主线断崖）' : '软切换（接力式）',
      verdict: switchOn ? ('主线切换成立：全面转向【' + newName + '】') :
        (deadOk ? ('旧主线【' + oldName + '】已确认死亡，但新方向候选【' + newName + '】' + bh.yes + '/' + bh.judged + ' 未全部满足 → 先轻仓试错，确认后再加') :
          ('主线延续：【' + oldName + '】死亡信号仅 ' + dh.yes + '/' + dh.judged + ' 条（需 ≥3）；新方向候选【' + newName + '】' + bh.yes + '/' + bh.judged + ' 条，未提示切换')),
      reason: '旧主线死亡 ' + dh.yes + '/' + dh.judged + '（需 ≥3）／新方向诞生 ' + bh.yes + '/' + bh.judged + '（需全部）／终局 ' + fh.yes + '/' + fh.judged + '（需 ≥2）',
      basis: basis, days: days, trends: trends
    };
  }

  /* ---------------- ④ 操作策略 ---------------- */
  function planCheck(X, sectors, d) {
    var stage = X.stage, cap = stage.cap;
    var riskOff = /冰点期|分歧期/.test(stage.n) || X.T >= 90;
    var cand = [];
    sectors.slice(0, 8).forEach(function (sec) {
      var roles = sec._roles || [];
      roles.forEach(function (r) {
        var e = r.entry, s = r.s;
        var posN = Number((/(\d+)(?:\s*[–-]\s*(\d+))?/.exec(e.pos || '') || [])[2] || (/(\d+)/.exec(e.pos || '') || [])[1] || 0);
        if (/不参与|不买|禁买|清仓|空仓|避险/.test(e.pos + e.method + e.timing)) return;
        if (posN <= 0) return;
        if (riskOff) return;
        if (r.role === '龙头' && s.boards > cap + 1) return;
        if (s.zbc >= 3) return;                                  // 弱封否决
        var topN = r.audit ? r.audit.badHits : 0;
        if (topN >= 3) return;                                    // 见顶 ≥3 否决
        var mfS = has(s.mainNet) ? (s.mainNet > 0 ? 12 : -10) : 0;
        var roleW = r.role === '龙头' ? 30 : r.role === '补涨' ? 18 : 12;
        var cert = /最高/.test(e.certainty) ? 20 : /很高/.test(e.certainty) ? 16 : /高/.test(e.certainty) ? 14 : 8;
        var hitS = r.audit ? Math.round(r.audit.goodHits / 17 * 8) : 0;
        var rank = Math.round(sec.score * 0.35 + roleW + cert + Math.min(15, posN * 0.35) + mfS + hitS - topN * 5);
        cand.push({ role: r.role, sec: sec, s: s, e: e, rank: rank, fundText: r.fundText, logic: r.logic, audit: r.audit });
      });
    });
    cand.sort(function (a, b) { return b.rank - a.rank; });
    var picked = [], used = {};
    for (var i = 0; i < cand.length && picked.length < 3; i++) {
      if (used[cand[i].sec.name] || cand[i].rank < 40) continue;
      picked.push(cand[i]); used[cand[i].sec.name] = 1;
    }
    /* 分歧性质：良性 / 恶性打分（手册 dv-2 精简版） */
    var dv = [
      sig('昨日涨停溢价为正', has(X.m.prem) ? X.m.prem > 0 : null, '溢价 ' + (has(X.m.prem) ? fx(X.m.prem, 2) : '缺') + '%'),
      sig('大面股 ≤1 家', has(X.m.damian) ? X.m.damian <= 1 : null, '大面股 ' + (has(X.m.damian) ? X.m.damian : '缺') + ' 家'),
      sig('炸板率 <22%', has(X.m.zbRate) ? X.m.zbRate < 22 : null, '炸板率 ' + (has(X.m.zbRate) ? fx(X.m.zbRate, 2) : '缺') + '%'),
      sig('上涨家数占比 >60%', has(X.m.upRatio) ? X.m.upRatio > 60 : null, '上涨占比 ' + (has(X.m.upRatio) ? fx(X.m.upRatio, 1) : '缺') + '%'),
      sig('晋级率 >30%', has(X.m.promoRate) ? X.m.promoRate > 30 : null, '晋级率 ' + (has(X.m.promoRate) ? fx(X.m.promoRate, 2) : '缺') + '%'),
      sig('跌停家数 <5 家', has(X.m.dtCount) ? X.m.dtCount < 5 : null, '跌停 ' + (has(X.m.dtCount) ? X.m.dtCount : '缺') + ' 家')
    ];
    var dvh = hitInfo(dv);
    var dvScore = dvh.yes - (dvh.judged - dvh.yes);
    var dvVerdict = dvScore >= 4 ? '良性分歧' : dvScore <= -3 ? '恶性分歧' : '中性 / 观察';
    return { stage: stage, riskOff: riskOff, candidates: cand.length, picked: picked, dv: dv, dvh: dvh, dvScore: dvScore, dvVerdict: dvVerdict };
  }

  /* ---------------- 汇总 ---------------- */
  var CACHE = { sig: null, data: null };
  function build(d) {
    var X = read(d);
    var sigv = [X.marketDate, X.snapDate, X.pool.length, X.uni.length, X.series.length,
      X.m.ztCount, X.m.prem, X.m.promoRate, X.m.dtCount, X.T].join('|');
    if (CACHE.sig === sigv && CACHE.data) return CACHE.data;
    var sectors = scoreSectors(X);
    sectors.slice(0, 8).forEach(function (sec) { sec._roles = buildRoles(X, sec, d); });
    var B = {
      X: X, turning: turningCheck(X), sectors: sectors,
      sw: switchCheck(X, sectors), plan: planCheck(X, sectors, d)
    };
    CACHE.sig = sigv; CACHE.data = B;
    return B;
  }

  /* ---------------- 渲染：公共头 ---------------- */
  /* v20261112b：时段 / 数据时点统一走 YGSession，不再自行写「盘前 / 最近收盘」；
     全市场活跃股池按实际可用性标注，接口不可达时写「? 缺项」而非「（实测）」。 */
  function caliber(X) {
    var S = global.YGSession;
    var d = X.d || {};
    var intraday = !!d.intraday;
    var fallback = !!(d.liveFallback || d.session === 'fallback');
    var dtl = d.dataTimeLabel || (S && S.dataTimeLabel ? S.dataTimeLabel(d) : '');
    var uniOk = !!(X.M && X.M.roleUniverse && X.M.roleUniverse.length);
    var uniTxt = uniOk ? ' + 全市场活跃股池（实测）'
      : ' + 全市场活跃股池 ? 缺项（接口不可达，中军判定已降级为涨停池代理）';
    var src = X.live
      ? '东方财富' + (intraday ? '当日盘中实时' : (fallback ? '最近已收盘交易日' : '当日')) +
        '涨停 / 炸板 / 跌停池 + 历史 5 日池' + uniTxt
      : '本站收盘快照 ' + shortDate(X.snapDate) + '（当日实时行情不可用，已降级）';
    return '<div class="dc-caliber"><span class="dc-dot"></span>' +
      '<b>数据口径：</b>' + esc(src) +
      '　·　行情日 <b>' + esc(shortDate(X.marketDate || X.snapDate)) + '</b>' +
      (dtl ? '　·　<b>' + esc(dtl) + '</b>' : '') +
      (d.degraded ? '　·　<b>实时接口不可达，已降级</b>' : '') +
      (X.dateMixed ? '　·　<b class="dc-warn">个股明细快照 ' + esc(shortDate(X.snapDate)) + '，与当日行情日期不同</b>' : '') +
      '　·　✓ 成立 / × 不成立 / <i>? 缺项（不计入分母）</i>；所有结论由数据自动判定，非人工勾选。' +
      '</div>';
  }
  function secTitle(t, en, note) {
    return '<div class="dc-sec-title"><span class="dc-bar"></span><b>' + esc(t) + '</b>' +
      (en ? '<span class="dc-en">' + esc(en) + '</span>' : '') +
      (note ? '<span class="dc-sec-note">' + esc(note) + '</span>' : '') + '</div>';
  }

  /* v20261112e：结论横幅——把每个栏目最关键结论一次性、高亮凸显在顶部 */
  function judgeBanner(o) {
    if (!o) return '';
    var items = (o.items || []).map(function (it) {
      return '<div class="dc-j-item"><span class="k">' + esc(it.k) + '</span>' +
        '<span class="v ' + (it.cls || '') + '">' + esc(it.v == null || it.v === '' ? '—' : it.v) + '</span></div>';
    }).join('');
    return '<div class="dc-judge ' + (o.cls || '') + '">' +
      (o.eyebrow ? '<div class="dc-j-eyebrow">' + esc(o.eyebrow) + '</div>' : '') +
      (o.title ? '<div class="dc-j-title">' + o.title + '</div>' : '') +
      (o.sub ? '<div class="dc-j-sub">' + o.sub + '</div>' : '') +
      (items ? '<div class="dc-j-rows">' + items + '</div>' : '') +
      '</div>';
  }

  /* ---------------- 渲染：拐点识别 ---------------- */
  function renderTurning(B) {
    var X = B.X, c = B.turning.conclusion;
    // v20261112f：去重——顶部结论横幅(judgeBanner)已承载「标题/温度/置信/命中信号/领先次优/动作结论」，
    // 此处只保留横幅没有的「命中证据明细 + 完整对应动作」，不再重复标题与元数据，避免信息重叠。
    var head = '<div class="dc-verdict slim"><div class="dc-vd-ev"><b>命中证据：</b>' +
      esc((c.evidence || []).join('　·　') || '无') + '</div>' +
      '<div class="dc-vd-pos"><b>对应动作：</b>' + esc(c.op) + '</div></div>';
    var cards = B.turning.cards.map(function (p) {
      return '<div class="dc-tp ' + p.status + '">' +
        '<div class="dc-tp-h"><div><div class="dc-tp-n">' + esc(p.n) + '</div><div class="dc-tp-a">' + esc(p.a) + '</div></div>' +
        '<div class="dc-tp-ring" style="--p:' + p.hit.rate + '"><span>' + p.hit.yes + '/' + (p.hit.judged || '—') + '</span></div></div>' +
        '<div class="dc-tp-sigs">' + sigRows(p.sig) + '</div>' +
        whyBox(p.sig) +
        '<div class="dc-tp-op"><b>操作：</b>' + esc(p.op) + '</div></div>';
    }).join('');
    return caliber(X) +
      judgeBanner({
        eyebrow: '拐点唯一结论（全自动校验）',
        title: c.n + ' · ' + c.a,
        cls: c.yes >= 3 ? 'up' : 'warn',
        sub: esc(c.note) + '　·　当前温度 <b>' + c.T + '</b> / ' + esc(c.stage) + '　·　<b>' + esc(c.conf) + '</b> 置信',
        items: [
          { k: '命中信号', v: c.yes + '/' + c.judged, cls: c.yes >= 3 ? 'up' : '' },
          { k: '领先次优', v: '+' + Math.max(c.lead, 0) },
          { k: '当前阶段', v: c.stage },
          { k: '对应动作', v: c.yes >= 3 ? '可据此动作' : '周期延续观望' }
        ]
      }) +
      '<div class="dc-notice blue"><b>用法：</b>程序按当日真实数据逐条检测手册八大拐点信号；命中 ≥3 条视为强信号。' +
      '<span class="dc-chip up">✓ 命中</span> 信号成立　<span class="dc-chip flat">× 未命中</span> 不成立　' +
      '<span class="dc-chip gold">? 缺项</span> 数据不可得，自动从分母剔除（不猜测、不补值）。</div>' +
      head + secTitle('八大拐点 · 逐条信号明细', 'TURNING POINTS', '按手册编号 ①→⑧ 排列') +
      '<div class="dc-tp-grid">' + cards + '</div>';
  }

  /* ---------------- 渲染：主线切换 ---------------- */
  function renderSwitch(B) {
    var X = B.X, sw = B.sw;
    var line = function (arr, title, cls) {
      var h = hitInfo(arr);
      return '<div class="dc-card ' + cls + '"><div class="dc-card-h"><b>' + esc(title) + '</b>' +
        '<span class="dc-card-sub">' + h.yes + ' / ' + h.judged + ' 条成立' + (h.miss ? '（' + h.miss + ' 项缺）' : '') + '</span></div>' +
        '<div class="dc-card-b">' + sigRows(arr) + whyBox(arr) + '</div></div>';
    };
    var fin = '<div class="dc-card"><div class="dc-card-b">' + sigRows(sw.finalOk) + whyBox(sw.finalOk) +
      '<div class="dc-tp-op"><b>U 型仓位曲线：</b>旧高潮 70% → 旧分歧 40% → 旧退潮 20%（试错新方向）→ 新确认 80%。在 U 型底部保持轻仓，是穿越切换期的关键。</div></div></div>';
    /* v20261112d：把候选选择依据与口径差异摊开，回答「为什么选这个板块 / 为什么和参考站不一样」 */
    var b = sw.basis || {};
    var bRow = function (k, v) {
      return '<div class="dc-basis-row"><span class="dc-basis-k">' + esc(k) + '</span><span class="dc-basis-v">' + v + '</span></div>';
    };
    var runnerTxt = b.runner
      ? '次优「' + esc(b.runner.name) + '」' + b.runner.score + ' 分，落后 ' + (Math.max(0, Math.round((b.runner.diff || 0) * 10) / 10)) + ' 分' +
        (b.runner.diff <= 3 ? '（<b>分差很小，盘中随时可能反转</b>）' : '')
      : '无次优候选';
    var basisHtml = '<div class="dc-card dc-basis"><div class="dc-card-b">' +
      bRow('板块口径', '<b>' + esc(b.caliber || '') + '</b>。参考站同类页面用的是<b>概念板块</b>：会把跨行业的同题材个股合并成一个板块（例如把光伏设备、电力、专用设备里的光伏股合成「光伏概念」，于是 3 家涨停、最高 5 板）；本站按行业细分，同一批个股会被拆到「光伏设备」「专用设备」「燃气Ⅱ」等不同行业名下，家数、高度与评分自然不同。<b>两边板块名不可直接对比</b>；本站暂无实时概念标签数据源，不把行业名硬改成概念名。') +
      bRow('旧主线怎么定', esc(b.oldRule || '') + '（T-1 共 ' + (b.oldPrev == null ? '—' : b.oldPrev) + ' 家）→ 【' + esc(sw.oldName) + '】。参考站取「上一收盘快照的主线标签」（如「汽车制造」），来源不同、名称不同，但指向的方向通常接近。') +
      bRow('新方向怎么选', esc(b.pickRule || '') + '。本次候选【' + esc(b.candName || sw.newName) + '】：评分 <b>' + (b.candScore == null ? '—' : b.candScore) + '</b> 分 · 连续共振 ' + (b.candDays || 0) + ' 日 · 最高 ' + (b.candMaxB || 0) + ' 板 · 今日 ' + (b.candN || 0) + ' 家涨停。' + runnerTxt + '。') +
      bRow('候选资格', b.qualified
        ? '已具备手册新方向的基本特征（有 ≥3 板高标，或连续 ≥3 日涨停共振）。'
        : '<b>观察级候选</b>：既无 ≥3 板高标、也无连续 ≥3 日共振，只是当前评分最高，<b>尚未构成手册定义的新方向</b>。') +
      bRow('分母宽严差异', '本站板块指数日线、板块级连续溢价、消息面数据不可得 → 按手册标「? 缺项」并<b>不计入分母</b>，故旧主线死亡 ' + (b.deadJudged || 0) + '/' + (b.deadTotal || 0) + '、新方向诞生 ' + (b.bornJudged || 0) + '/' + (b.bornTotal || 0) + '；参考站接入了实时头条/快讯与板块指数，催化与指数项可判定，分母不同 → <b>两边「X/Y 条成立」不可直接比大小</b>。') +
      bRow('盘中稳定性', (b.intraday ? '当前为<b>盘中实时、未收盘</b>（' + (b.ztCount == null ? '—' : b.ztCount) + ' 只涨停），多数行业仅 1–3 家涨停，评分极易反转，候选名可能在盘中变化；' : '') + '应以收盘后完整涨停池为准。') +
      '</div></div>';
    var days = sw.days.map(function (c) { return c.slice(4); });
    var rows = sw.trends.map(function (r) {
      var last = r.vals[3], first = r.vals[0];
      var t = last > first ? '<span class="dc-up">↑ 走强</span>' : last < first ? '<span class="dc-down">↓ 走弱</span>' : '<span class="dc-flat">→ 持平</span>';
      return '<tr><td><b>' + esc(r.name) + '</b></td>' + r.vals.map(function (v, i) {
        return '<td>' + (r.has[i] ? (v || '—') : '—') + '</td>';
      }).join('') + '<td>' + t + '</td></tr>';
    }).join('');
    var trend = '<div class="dc-card"><div class="dc-tb-wrap"><table class="dc-tb"><thead><tr>' +
      '<th>行业（东财涨停池 hybk 口径）</th>' + days.map(function (d) { return '<th>' + esc(d) + '</th>'; }).join('') + '<th>趋势</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="6" class="dc-empty">暂无行业涨停序列数据</td></tr>') + '</tbody></table></div>' +
      '<div class="dc-tp-op"><b>怎么看：</b>涨停家数<b>逐日递增</b>的行业 = 资金正在流入（新方向候选）；<b>从峰值腰斩</b>的行业 = 资金正在撤离（旧主线死亡）。非交易日显示 —。' +
      '<br><b>口径提示：</b>本表按东财 hybk 行业细分统计，概念板块口径（跨行业聚合）下的家数会更高，两者不可混读。</div></div>';
    var swState, swCls;
    if (sw.switchOn) { swState = '主线切换成立 → 新主线【' + sw.newName + '】'; swCls = 'up'; }
    else if (sw.deadOk) { swState = '旧主线【' + sw.oldName + '】已确认死亡，新方向候选【' + sw.newName + '】待验证'; swCls = 'warn'; }
    else { swState = '主线延续：【' + sw.oldName + '】仍为主线'; swCls = ''; }
    return caliber(X) +
      judgeBanner({
        eyebrow: '主线切换结论',
        title: swState,
        cls: swCls,
        sub: esc(sw.verdict) + '　·　<b>' + esc(sw.mode) + '</b>',
        items: [
          { k: '旧主线', v: sw.oldName },
          { k: '旧主线死亡', v: sw.dh.yes + '/' + sw.dh.judged, cls: sw.deadOk ? 'down' : '' },
          { k: '新方向候选', v: sw.newName, cls: 'up' },
          { k: '候选评分', v: (b.candScore == null ? '—' : b.candScore) + ' 分' + (b.qualified ? '' : '（观察级）'), cls: 'up' },
          { k: '终局成立', v: sw.fh.yes + '/' + sw.fh.judged }
        ]
      }) +
      secTitle('为什么是这个方向 · 口径与选择依据', 'BASIS', '先解释板块口径与候选来源，再看判定清单') + basisHtml +
      secTitle('旧主线死亡 vs 新方向成立', 'SWITCH CHECKLIST', '手册 sw-2：旧死亡 ≥3 条确认；新成立需全部满足（候选 ≠ 已判定主线）') +
      '<div class="dc-grid2">' +
      line(sw.dead, '⟵ 旧主线死亡确认 · ' + sw.oldName, 'dead') +
      line(sw.born, '⟶ 新方向候选确认 · ' + sw.newName + '（待 7 条验证）', 'born') + '</div>' +
      secTitle('切换终局确认', 'FINAL（三选二）', '当前 ' + sw.fh.yes + '/' + sw.fh.judged + ' 条成立') + fin +
      secTitle('行业涨停家数 4 日趋势（真实数据）', 'INDUSTRY TREND', '按当日收盘涨停池逐日统计') + trend +
      '<div class="dc-notice"><b>切换期四个致命错误：</b>① 旧主线退潮初期抢反弹（首阴不接，反包封住才考虑）；② 把一日游当新主线（严格执行 7 条清单）；③ 切换期重仓（≤30%）；④ 舍不得旧主线仓位（确认死亡后无条件清仓）。</div>' +
      '<div class="dc-foot">结论基于手册 sw-1 / sw-2 / sw-3 规则；「?」为数据不可得（板块指数、消息面、板块级连续溢价），不猜测补值。</div>';
  }

  /* ---------------- 渲染：板块主线与角色 ---------------- */
  function roleCard(r, sec, idx) {
    var k = r.role === '龙头' ? 'dragon' : r.role === '中军' ? 'jun' : 'bub';
    var e = r.entry;
    var f = function (l, v) { return '<div class="dc-f"><label>' + esc(l) + '</label><span>' + esc(v == null || v === '' ? '—' : v) + '</span></div>'; };
    var auditHtml = '';
    if (r.audit) {
      var a = r.audit;
      var g = (a.good || []).map(function (x) { return '<span class="dc-chk ' + (x.hit === true ? 'y' : x.hit === false ? 'n' : 'u') + '">' + (x.hit === true ? '✓' : x.hit === false ? '×' : '?') + ' ' + esc(x.name) + '<i>' + esc(x.why || '') + '</i></span>'; }).join('');
      var b = (a.bad || []).map(function (x) { return '<span class="dc-chk ' + (x.hit === true ? 'n' : x.hit === false ? 'y' : 'u') + '">' + (x.hit === true ? '⚠' : x.hit === false ? '·' : '?') + ' ' + esc(x.name) + '<i>' + esc(x.why || '') + '</i></span>'; }).join('');
      auditHtml = '<details class="dc-audit"><summary>ⓘ 龙头成色 17 项 / 见顶 12 信号自动体检（命中 ' + a.goodHits + '/17，见顶 ' + a.badHits + '/12）</summary>' +
        '<div class="dc-audit-r"><b>是否真龙头：' + (a.isDragon ? '是' : '否') + '　·　是否见顶：' + (a.isTop ? '是' : '否') + '</b><br>' + esc(a.verdict || '') + '</div>' +
        '<div class="dc-audit-c"><div><b>龙头成色 17 项</b>' + g + '</div><div><b>见顶 12 信号</b>' + b + '</div></div></details>';
    }
    return '<div class="dc-role ' + k + '">' +
      '<div class="dc-role-h"><span class="dc-role-tag ' + k + '">' + esc(r.role) + '</span>' +
      '<b class="dc-role-n">' + stockLink(r.s) + '</b>' +
      '<span class="dc-role-meta">' + esc(r.meta) + '</span>' +
      (r.extra ? '<span class="dc-role-extra">' + esc(r.extra) + '</span>' : '') +
      '<span class="dc-role-sec">' + esc(sec.name) + ' · ' + sec.score + ' 分</span></div>' +
      '<div class="dc-fields">' +
      f('买点类型', e.timing) + f('手法', e.method) + f('建议仓位', e.pos) +
      f('确定性', e.certainty) + f('止损', e.stop) + f('目标', e.target) + '</div>' +
      '<div class="dc-why-lines">' +
      '<div><b>触发条件：</b>' + esc(r.cond) + '</div>' +
      '<div><b>逻辑：</b>' + esc(r.logic) + '</div>' +
      '<div><b>资金面：</b>' + esc(r.fundText) + '</div>' +
      '<div><b>卖点 / 止盈：</b>止损 ' + esc(e.stopRule) + '　·　止盈 ' + esc(e.winRule) + '　·　时间止损 ' + esc(e.timeRule) + '</div>' +
      '<div class="dc-pos-note"><b>仓位口径：</b>' + esc(e.posNote) + '</div></div>' +
      auditHtml + '</div>';
  }
  function renderSectors(B) {
    var X = B.X, list = B.sectors;
    var cards = list.slice(0, 8).map(function (sec, i) {
      var dims = sec.dims;
      var six = Object.keys(sec.six).map(function (k) {
        var label = { height: '高度', ladder: '梯队', jun: '中军', persist: '持续', dragon: '龙头', logic: '逻辑' }[k];
        return '<span class="' + (sec.six[k] ? 'ok' : 'no') + '">' + label + (sec.six[k] ? '✓' : '✗') + '</span>';
      }).join('');
      var roles = (sec._roles || []).map(function (r) { return roleCard(r, sec, i); }).join('');
      var open = i < 2;
      return '<div class="dc-sec ' + (i === 0 ? 'top1' : '') + '">' +
        '<div class="dc-sec-h"><span class="dc-rank">' + (i + 1) + '</span>' +
        '<b class="dc-sec-n">' + esc(sec.name) + '</b>' +
        tag(sec.level, sec.lvCls) + tag('涨停 ' + sec.n + ' 家', 'plain') + tag('最高 ' + sec.maxBoards + ' 板', 'plain') +
        '<span class="dc-score"><b>' + sec.score + '</b><i>分</i></span></div>' +
        '<div class="dc-six">' + six + '<span class="no">六有 ' + sec.sixOk + '/6</span></div>' +
        '<details class="dc-sec-body"' + (open ? ' open' : '') + '>' +
        '<summary>' + (open ? '收起' : '展开') + '评分明细与龙头 / 中军 / 补涨买卖点</summary>' +
        '<div class="dc-score-note">评分卡：持续 ' + dims.persist + '/25（连续 ' + sec.days + ' 日）· 涨停占比 ' + dims.share + '/20（' + fx(dims.shareVal, 1) + '%）· 梯队 ' + dims.ladder +
        '/20 · 中军 ' + dims.jun + '/15 · 催化 ' + dims.catalyst + '/10（缺消息面文本，记 0）· 赚钱效应 ' + dims.earn + '/10（' +
        (has(sec.earnRate) ? fx(sec.earnRate, 1) + '%' : '缺') + '）。「逻辑」为技术面代理（有中军 + 有梯队），非消息面判定。</div>' +
        (roles || '<div class="dc-empty">该板块暂无可识别的龙头 / 中军 / 补涨标的</div>') +
        '</details></div>';
    }).join('');
    var levelRows = [
      { n: '主线（≥70 分）', c: 'g1', t: '资金共识最强，仓位可给到最高档，只做主线内龙头与最强前排。' },
      { n: '准主线 / 强支线（50–70 分）', c: 'g2', t: '有资金认可但强度不足，可参与但仓位减半，只做最高板或最强前排。' },
      { n: '支线（30–50 分）', c: 'g3', t: '主线分歧期的资金避风港、退潮后的接替候选；观察为主，不做重仓。' },
      { n: '一日游 / 杂毛（<30 分）', c: 'g4', t: '无持续性、无梯队，不参与。' }
    ].map(function (g) {
      var arr = list.filter(function (x) {
        return g.c === 'g1' ? x.score >= 70 : g.c === 'g2' ? (x.score >= 50 && x.score < 70)
          : g.c === 'g3' ? (x.score >= 30 && x.score < 50) : x.score < 30;
      });
      if (!arr.length) return '';
      return '<div class="dc-grp ' + g.c + '"><div class="dc-grp-h"><b>' + esc(g.n) + '</b><span>' + arr.length + ' 个</span></div>' +
        '<div class="dc-grp-i">' + arr.map(function (x) { return '<span>' + esc(x.name) + '<i>' + x.score + ' 分 · 涨停 ' + x.n + ' 家 · ' + x.maxBoards + ' 板</i></span>'; }).join('') + '</div>' +
        '<div class="dc-grp-d">' + esc(g.t) + '</div></div>';
    }).join('');
    var top1 = list[0] || { name: '—', score: '—', n: 0, maxBoards: 0 };
    var g1 = list.filter(function (x) { return x.score >= 70; }).length;
    var g2 = list.filter(function (x) { return x.score >= 50 && x.score < 70; }).length;
    var g3 = list.filter(function (x) { return x.score >= 30 && x.score < 50; }).length;
    return caliber(X) +
      judgeBanner({
        eyebrow: '题材主线排序（按 100 分评分卡降序）',
        title: '当前主线候选（第 1 名）= 【' + top1.name + '】 ' + top1.score + ' 分',
        cls: 'up',
        sub: '排序正确：六维（持续性/涨停占比/梯队/中军/催化/赚钱效应）加权得分由当日真实数据<b>自动计算、降序排列，无人工干预</b>；第 1 名即当前最强主线候选，其后依次为 准主线 → 支线 → 一日游。',
        items: [
          { k: '第 1 名', v: top1.name + ' ' + top1.score + ' 分', cls: 'up' },
          { k: '涨停', v: top1.n + ' 家' },
          { k: '最高板', v: top1.maxBoards + ' 板' },
          { k: '主线/准主线/支线', v: g1 + '/' + g2 + '/' + g3 },
          { k: '总板块', v: list.length + ' 个' }
        ]
      }) +
      '<div class="dc-notice blue"><b>判定口径：</b>按手册 ml-1「主线强度量化评分卡（100 分）」六维打分并按分数排序；' +
      '板块 = 东财涨停池行业（hybk）<b>细分口径</b>；概念板块（跨行业聚合，例如把光伏设备 / 电力 / 专用设备里的光伏股合成一个「光伏概念」）不在本表内，' +
      '因此家数、最高板与排名会和概念口径不同，<b>两边板块名不可直接对比</b>。角色由板块内个股自动识别：龙头 = 最高板 / 最早封板，' +
      '中军 = 同行业全市场活跃股中流通市值最大者，补涨 = 板块内最低位最早封板标的。' +
      '具体标的的逻辑、触发条件、资金面、买卖点均由当日数据自动推导。</div>' +
      secTitle('板块主线判定（按评分排序）', 'SECTOR RANKING', '共 ' + list.length + ' 个有涨停板块 · 展示前 8') +
      '<div class="dc-sec-list">' + cards + '</div>' +
      secTitle('主线 / 支线归类', 'CLASSIFICATION', '按 100 分评分卡分档') + levelRows +
      '<div class="dc-foot">买卖点为手册 methods / position / dragon / zhongjun / buzhang 章节的规则化输出，非投资建议；' +
      '仓位一律取「买点档」与「当前周期档」中更保守的一档（手册原则：减仓优先于判断）。</div>';
  }

  /* ---------------- 渲染：操作策略 ---------------- */
  function renderPlan(B) {
    var X = B.X, st = B.plan.stage, p = B.plan, m = X.m;
    // 按数据日自动冻结当日批次：即使一次都没点结算按钮，也先存档，跨日刷新后仍可回来结算。
    // 注意：build() 的返回对象上没有 snapDate，真实数据日在 B.X.snapDate。
    // 情绪周期随当日批次一起冻结存档：温度 T + 阶段名（冰点/修复/启动/确认/高潮/分歧），
    // 供日后回看日历时还原「推荐当日」的市场环境。
    wrEnsureSnapshot(wrSnapshotDate(B), p.picked, wrSnapshotLabel(B), { T: X.T, stage: st.n });
    var chain = '<div class="dc-chain">' +
      '<div class="dc-chain-c"><span class="dc-chain-k k1">① 环境层</span>' +
      '<div class="dc-chain-v">情绪温度 <b>' + X.T + '</b> · ' + esc(st.n) + '</div>' +
      '<div class="dc-chain-x">涨停 ' + (has(m.ztCount) ? m.ztCount : '—') + ' 家　最高 ' + (has(m.maxBoards) ? m.maxBoards : '—') + ' 板　炸板率 ' + (has(m.zbRate) ? fx(m.zbRate, 2) + '%' : '—') + '　两市量能 ' + (has(m.volChange) ? fx(m.volChange, 1) + '%' : '—') + '</div></div>' +
      '<div class="dc-chain-c"><span class="dc-chain-k k2">② 策略层</span>' +
      '<div class="dc-chain-v">总仓位 <b>' + esc(st.pos) + '</b></div>' +
      '<div class="dc-chain-x">' + esc(st.act) + '　·　板位上限 ' + st.cap + ' 板</div>' +
      '<div class="dc-tagrow">' + (st.allow || []).map(function (x) { return '<span class="ok">可做 ' + esc(x) + '</span>'; }).join('') +
      (st.ban || []).map(function (x) { return '<span class="no">禁止 ' + esc(x) + '</span>'; }).join('') + '</div></div>' +
      '<div class="dc-chain-c"><span class="dc-chain-k k3">③ 个股层</span>' +
      '<div class="dc-chain-v">' + (p.picked.length ? '优中选优 <b>' + p.picked.length + '</b> 只' : '<b>无合格标的</b>') + '</div>' +
      '<div class="dc-chain-x">候选池：评分前 8 板块的龙头 / 中军 / 补涨，共 ' + p.candidates + ' 个候选；按板块评分 + 角色权重 + 确定性 + 资金面 + 龙头体检打分排序</div>' +
      '<div class="dc-tagrow"><span class="ok">每板块只留 1 只</span><span class="ok">全站最多 3 只</span><span class="ok">宁缺毋滥</span></div></div></div>';
    var f = function (l, v) { return '<div class="dc-f"><label>' + esc(l) + '</label><span>' + esc(v == null || v === '' ? '—' : v) + '</span></div>'; };
    var targets = p.picked.map(function (t, i) {
      var e = t.e, s = t.s;
      return '<div class="dc-target"><div class="dc-tg-h">' +
        '<span class="dc-role-tag ' + (t.role === '龙头' ? 'dragon' : t.role === '中军' ? 'jun' : 'bub') + '">' + esc(t.role) + '</span>' +
        '<b class="dc-tg-n">' + stockLink(s) + '</b>' +
        '<span class="dc-tg-c">' + esc(metaLine(s)) + '</span>' +
        '<span class="dc-tg-sec">' + esc(t.sec.name) + ' ' + t.sec.score + ' 分</span>' +
        '<span class="dc-tg-rank">优选 #' + (i + 1) + ' · ' + t.rank + ' 分</span></div>' +
        '<div class="dc-fields">' + f('买点类型', e.timing) + f('手法', e.method) + f('建议仓位', e.pos) +
        f('确定性', e.certainty) + f('止损', e.stop) + f('目标', e.target) + '</div>' +
        '<div class="dc-why-lines"><div><b>触发条件：</b>' + esc(e.cond) + '</div>' +
        '<div><b>逻辑：</b>' + esc(t.logic) + '　' + esc(e.note || '') + '</div>' +
        '<div><b>资金面：</b>' + esc(t.fundText) + '</div>' +
        '<div><b>卖点 / 止盈：</b>止损 ' + esc(e.stopRule) + '　·　止盈 ' + esc(e.winRule) + '　·　时间止损 ' + esc(e.timeRule) + '</div>' +
        '<div class="dc-pos-note"><b>仓位口径：</b>' + esc(e.posNote) + '</div></div></div>';
    }).join('');
    var dvCls = p.dvScore >= 4 ? 'up' : p.dvScore <= -3 ? 'dn' : 'gold';
    var dv = '<div class="dc-card"><div class="dc-dv-h"><div class="dc-dv-big">' + esc(p.dvVerdict) + '</div>' +
      tag('得分 ' + (p.dvScore > 0 ? '+' : '') + p.dvScore, dvCls) +
      '<span class="dc-sec-note">≥+4 良性　≤−3 恶性　·　命中 ' + p.dvh.yes + '/' + p.dvh.judged + '</span></div>' +
      '<div class="dc-card-b">' + sigRows(p.dv) + whyBox(p.dv) + '</div></div>';
    return caliber(X) +
      '<div class="dc-prenote"><b>【盘前预案】</b>本页基于<b>当日收盘数据</b>生成，是<b>次日开盘后的作战预案</b>。个股「触发条件」均指向次日开盘（如“次日高开+2%上板”“明日上3板再打板”），需盘中条件命中才执行，非实时喊单。请先核对顶部「数据时点」是否为最新交易日。</div>' +
      judgeBanner({
        eyebrow: '操作结论',
        title: '环境【' + st.n + '】· 总仓位 ' + st.pos,
        cls: p.riskOff ? 'warn' : 'up',
        sub: p.riskOff ? '当前处于手册<b>禁买阶段，不开新仓</b>；空仓等待也是仓位管理的一部分。' : '环境允许开新仓，按下方优中选优结果执行。',
        items: [
          { k: '情绪温度', v: X.T, cls: X.T >= 90 || X.T < 20 ? 'down' : '' },
          { k: '板位上限', v: st.cap + ' 板' },
          { k: '优中选优', v: p.picked.length + '/3 只', cls: p.picked.length ? 'up' : '' },
          { k: '分歧性质', v: p.dvVerdict },
          { k: '候选池', v: p.candidates + ' 个' }
        ]
      }) +
      '<div class="dc-notice ' + (p.riskOff ? 'warm' : 'green') + '"><b>环境判定：</b>按【' + esc(st.n) + '】执行（温度 ' + X.T + '）。' +
      (p.riskOff ? '当前处于手册禁买阶段，不开新仓。' : '环境允许开新仓，按下方优中选优结果执行。') + '</div>' +
      chain + secTitle('具体标的与操作逻辑', 'BEST TARGETS', '买点 / 手法 / 仓位 / 止损 / 目标 / 触发条件 / 资金面') +
      '<div class="dc-tp-op"><b>优中选优口径：</b>只从评分前 8 板块的<b>龙头 / 中军 / 正宗补涨</b>中，' +
      '按「明日买点 + 阶段仓位 + 确定性 + 封板质量 + 资金面 + 见顶信号」综合打分，' +
      '剔除禁买区、0 仓位、弱封（开板≥3 次）、板位超上限、见顶≥3、退潮期不开新仓者，每板块只留最优 1 只、全站最多 3 只。宁缺毋滥。</div>' +
      (p.riskOff ? '<div class="dc-notice warm"><b>⚠ 阶段禁买：</b>当前【' + esc(st.n) + '】按手册不开新仓，故不展示任何可操作标的。空仓等待也是仓位管理的一部分。</div>' : '') +
      (targets || (p.riskOff ? '' : '<div class="dc-notice"><b>当前无符合环境限制的标的。</b>这不是故障，而是策略结论：环境不允许时不硬做。手册原则：管住手就是盈利。</div>')) +
      secTitle('操作策略正确率统计', 'WIN RATE', '按日冻结存档 · T+1 交易日结算 · 可按日期查询') +
      '<div class="wr-wrap">' + wrInnerHTML() + '</div>' +
      secTitle('分歧性质判定', 'DIVERGENCE', '手册 dv-2 精简自动校验') + dv +
      '<div class="dc-foot">本页所有标的与操作逻辑均由当日收盘数据按手册规则自动生成，仅作方法论研究，不构成投资建议。</div>';
  }

  /* ---------------- 入口 ---------------- */
  function render(rootEl, view, d) {
    if (!rootEl) return '';
    var B;
    try { B = build(d); }
    catch (e) {
      rootEl.innerHTML = '<div class="dc-notice warm"><b>判定模块加载失败：</b>' + esc(e && e.message ? e.message : e) + '</div>';
      return '';
    }
    var html = '';
    try {
      if (view === 'v_turn') html = renderTurning(B);
      else if (view === 'v_sw') html = renderSwitch(B);
      else if (view === 'v_sec') html = renderSectors(B);
      else if (view === 'v_plan') html = renderPlan(B);
    } catch (e) {
      html = '<div class="dc-notice warm"><b>渲染失败：</b>' + esc(e && e.message ? e.message : e) + '</div>';
    }
    rootEl.innerHTML = html;
    if (view === 'v_plan' && B && B.plan && B.plan.picked) wrAttach(rootEl);
    return html;
  }

  /* ---------------- 操作策略正确率台账（v20261112m） ---------------- */
  var WR_KEY = 'yg_winrate_v1';
  // 模块级上下文：dataDate 跟随当前快照，selectedDate 是用户当前查看的冻结日，
  // curPicks 保存最近一次渲染的优中选优结果，供「用当前标的重设本批次」使用。
  // 事件委托只绑一次，handler 内部一律从这里 / DOM data / localStorage 取最新值，
  // 不再捕获渲染时的 date / picked，避免跨日刷新后闭包陈旧。
  // calMonth：日历当前显示的月份（YYYY-MM），与 selectedDate 解耦——
  // 用户翻到别的月看历史时，selectedDate 仍指向当前选中日，翻月只改视图。
  var wrState = { dataDate: '—', selectedDate: '', curPicks: [], curLabel: '', calMonth: '', curMood: null };

  function wrLoad() {
    try {
      var o = JSON.parse(localStorage.getItem(WR_KEY) || '{}');
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }
  function wrSave(o) { try { localStorage.setItem(WR_KEY, JSON.stringify(o)); } catch (e) {} }
  function wrKeys(all) { return Object.keys(all).sort().reverse(); }

  /* ---------------- 交易日 / 结算日（T+1 交易日口径） ----------------
   * 数据日 D 收盘后筛出的标的，是「次日开盘」的盘前预案；晋级结果只能在 D 的
   * 下一个交易日（结算日）确认：周五 → 下周一，节前最后交易日 → 节后首个交易日。
   * 休市日依据上交所 2026 年公告；周末一律不交易（含调休上班的周末，A股不开盘）。
   * 2027 年起公告未发布，退化为「仅跳过周末」。
   */
  var WR_HOLIDAYS_2026 = {
    '01-01': 1, '01-02': 1, '01-03': 1,
    '02-15': 1, '02-16': 1, '02-17': 1, '02-18': 1, '02-19': 1, '02-20': 1, '02-21': 1, '02-22': 1, '02-23': 1,
    '04-04': 1, '04-05': 1, '04-06': 1,
    '05-01': 1, '05-02': 1, '05-03': 1, '05-04': 1, '05-05': 1,
    '06-19': 1, '06-20': 1, '06-21': 1,
    '09-25': 1, '09-26': 1, '09-27': 1,
    '10-01': 1, '10-02': 1, '10-03': 1, '10-04': 1, '10-05': 1, '10-06': 1, '10-07': 1
  };
  /** 北京时间「今天」YYYY-MM-DD：即使用户在其他时区，结算日判断也不偏移。 */
  function wrTodayStr() {
    var d = new Date();
    var bj = new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60000);
    return bj.getFullYear() + '-' + wrPad(bj.getMonth() + 1) + '-' + wrPad(bj.getDate());
  }
  /** 是否交易日：周一至周五，且不在 2026 休市日内。 */
  function wrIsTradingDay(k) {
    var p = wrParseDayKey(k);
    if (!p) return false;
    var dow = new Date(p.y, p.mo - 1, p.d).getDay();
    if (dow === 0 || dow === 6) return false;
    if (p.y === 2026 && WR_HOLIDAYS_2026[wrPad(p.mo) + '-' + wrPad(p.d)]) return false;
    return true;
  }
  /** 数据日 D 的结算日 = D 之后第一个交易日。 */
  function wrNextTradingDay(k) {
    var p = wrParseDayKey(k);
    if (!p) return '';
    var d = new Date(p.y, p.mo - 1, p.d);
    for (var i = 0; i < 15; i++) {
      d.setDate(d.getDate() + 1);
      var nk = wrKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
      if (wrIsTradingDay(nk)) return nk;
    }
    return '';
  }
  /** 批次结算日：优先取冻结时写入的值，老记录惰性推导。 */
  function wrSettleDateOf(rec, dateKey) {
    if (rec && typeof rec.settleDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rec.settleDate)) return rec.settleDate;
    return wrNextTradingDay(dateKey);
  }
  /** 是否已到结算日；结算日不可推导时放行，避免误锁死老台账。 */
  function wrIsMature(rec, dateKey) {
    var sd = wrSettleDateOf(rec, dateKey);
    return sd ? (wrTodayStr() >= sd) : true;
  }
  function wrWeekName(k) {
    var p = wrParseDayKey(k);
    return p ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(p.y, p.mo - 1, p.d).getDay()] : '';
  }
  function wrShort(k) { return wrParseDayKey(k) ? String(k).slice(5) : k; }

  /**
   * 取当前快照的数据日。build() 返回 B.X.snapDate；兼容旧口径 B.snapDate / B.d.date。
   */
  function wrSnapshotDate(B) {
    var X = B && B.X;
    return (X && X.snapDate) || (X && X.d && X.d.date) || (X && X.marketDate)
      || (B && B.snapDate) || (B && B.d && B.d.date) || '—';
  }

  /**
   * 取当前快照的数据时点标签（短格式 MM-DD HH:mm，如「11-16 14:05」）。
   * 来源优先级：d.asOfBJ（快照自带时刻）→ d.dataTimeLabel → YGSession.dataTimeLabel(d)，
   * 后两者是面向用户的整句（如「盘中实时 2026-11-16 14:05 · 未收盘，数据会变动」），
   * 这里只抽取其中的日期与时刻片段，绝不把整句塞进按钮。
   * 取不到时返回空串：按钮与确认弹窗均优雅降级，不外露原始时间戳。
   * 与 curPicks 同步取自同一次渲染，不额外触发数据读取。
   */
  function wrSnapshotLabel(B) {
    var X = B && B.X;
    var d = (X && X.d) || {};
    var raw = d.asOfBJ || d.dataTimeLabel || '';
    if (!raw) {
      var S = global.YGSession;
      if (S && S.dataTimeLabel) { try { raw = S.dataTimeLabel(d) || ''; } catch (e) { raw = ''; } }
    }
    raw = String(raw || '');
    if (!raw) return '';
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var m = raw.match(/(\d{1,2})[-/月](\d{1,2})日?[\sT]+(\d{1,2}):(\d{2})/);
    if (m) return p2(+m[1]) + '-' + p2(+m[2]) + ' ' + p2(+m[3]) + ':' + m[4];
    var t = raw.match(/(\d{1,2}):(\d{2})/);
    if (t) return p2(+t[1]) + ':' + t[2];
    return '';
  }

  /**
   * 按数据日冻结当日标的：**首次冻结即锁定**。
   * - 该数据日记录不存在 → 创建并写入当前 picks（此后不再自动变更）。
   * - 记录已存在且 picks 非空 → 批次锁定，绝不自动补票（盘中标的漂移不得撑大当日分母）。
   * - 记录已存在但 picks 为空数组（禁买日 / 当日无合格标的）→ 允许用当前 picks 填充一次；
   *   已被用户显式重设过的记录（reset 标记）不再自动填充，避免重设被静默撤销。
   * - 任何情况下都不会覆盖 / 清空已结算的 result。
   * @param {string} date 当前快照数据日（由 wrSnapshotDate(B) 解析）
   * @param {Array} picked 当日优中选优标的
   * @param {Object} mood 当日情绪周期 {T, stage}，随批次冻结存档
   */
  function wrEnsureSnapshot(date, picked, label, mood) {
    var key = date || '—';
    var all = wrLoad();
    var rec = all[key];
    var isNew = (!rec || typeof rec !== 'object');
    if (isNew) rec = { date: key, picks: [], settleDate: wrNextTradingDay(key) };
    var addedSettle = false;
    if (!rec.settleDate) { rec.settleDate = wrNextTradingDay(key); addedSettle = !!rec.settleDate; } // 老记录补齐结算日
    // 情绪周期随当日批次冻结；只在缺失时补（老记录无此字段），不覆盖已存值。
    var addedMood = false;
    if (mood && typeof mood === 'object' && !rec.mood) {
      rec.mood = { T: (mood.T != null ? mood.T : null), stage: mood.stage || '' };
      addedMood = true;
    }
    if (!Array.isArray(rec.picks)) rec.picks = [];

    if (isNew || (rec.picks.length === 0 && !rec.resetAt && !rec.reset)) {
      var seen = {};
      rec.picks.forEach(function (p) { if (p && p.code) seen[p.code] = true; });
      var added = false;
      (picked || []).forEach(function (t) {
        var s = t && t.s;
        var code = s && s.code ? s.code : '';
        if (!code || seen[code]) return;
        rec.picks.push({ code: code, name: s.name || '', role: t.role || '', result: null, frozenAt: Date.now() });
        seen[code] = true;
        added = true;
      });
      if (isNew || added || addedSettle || addedMood) {
        rec.frozenAt = rec.frozenAt || Date.now();
        all[key] = rec; wrSave(all);
      }
    } else if (addedSettle || addedMood) {
      // 已锁定的老批次缺结算日 / 情绪周期：仅补字段，不动 picks / result，然后落盘。
      all[key] = rec; wrSave(all);
    }

    // 当前快照的标的始终记在内存里，供「用当前标的重设本批次」使用（不落盘）。
    // curLabel 与 curPicks 同步取自同一次渲染，保证按钮上标的时点与实际重设内容一致。
    wrState.curPicks = picked || [];
    wrState.curLabel = label || '';
    wrState.curMood = mood || null;

    // 数据跨日时选中日回到当前数据日；同一日内保留用户已选择的日期。
    var rolled = wrState.dataDate !== key;
    wrState.dataDate = key;
    if (!wrState.selectedDate || rolled || !all[wrState.selectedDate]) {
      wrState.selectedDate = all[key] ? key : (wrKeys(all)[0] || key);
    }
  }

  /**
   * 用当前快照的标的**替换**指定数据日的批次（仅当前数据日可用）。
   * 仍在新列表中的 code 保留其已结算 result；不在新列表中的旧 code 从台账移除。
   * @return {Object} 变更统计 {settledTotal, settledKept, settledRemoved, removed, kept, total}
   */
  function wrResetBatch(date, picked) {
    var all = wrLoad();
    var old = all[date] || { date: date, picks: [] };
    var oldPicks = Array.isArray(old.picks) ? old.picks : [];
    var byCode = {};
    oldPicks.forEach(function (p) { if (p && p.code) byCode[p.code] = p; });

    var settledTotal = 0, settledKept = 0, kept = 0;
    oldPicks.forEach(function (p) {
      if (p && (p.result === 'win' || p.result === 'loss')) settledTotal++;
    });

    var next = [];
    (picked || []).forEach(function (t) {
      var s = t && t.s;
      var code = s && s.code ? s.code : '';
      if (!code) return;
      var prev = byCode[code];
      var rec = { code: code, name: s.name || '', role: t.role || '', result: null, frozenAt: Date.now() };
      if (prev) {
        rec.result = prev.result;
        rec.settledAt = prev.settledAt;
        rec.frozenAt = prev.frozenAt || rec.frozenAt;
        kept++;
        if (prev.result === 'win' || prev.result === 'loss') settledKept++;
        delete byCode[code];
      }
      next.push(rec);
    });

    // 剩余的旧 code（不在新列表中）将被移除
    var removedCodes = Object.keys(byCode);
    var settledRemoved = 0;
    removedCodes.forEach(function (c) {
      var r = byCode[c].result;
      if (r === 'win' || r === 'loss') settledRemoved++;
    });

    all[date] = { date: date, picks: next, frozenAt: old.frozenAt || Date.now(), resetAt: Date.now(), settleDate: wrSettleDateOf(old, date), mood: old.mood || wrState.curMood || null };
    wrSave(all);
    return {
      settledTotal: settledTotal, settledKept: settledKept, settledRemoved: settledRemoved,
      removed: removedCodes.length, kept: kept, total: next.length
    };
  }

  function wrSetResult(date, code, name, role, res) {
    var all = wrLoad();
    var r = all[date] || { date: date, picks: [] };
    // T+1 交易日口径：未到结算日不允许结算，避免当天就误判晋级结果。
    if (!wrIsMature(r, date)) return false;
    if (!Array.isArray(r.picks)) r.picks = [];
    var found = null;
    r.picks.forEach(function (p) { if (p && p.code === code) found = p; });
    if (!found) { found = { code: code, name: name, role: role, result: null }; r.picks.push(found); }
    found.name = name; found.role = role; found.result = res;
    r.settledAt = Date.now();
    all[date] = r; wrSave(all);
  }
  function wrDelDate(date) { var all = wrLoad(); delete all[date]; wrSave(all); }
  function wrClearAll() { wrSave({}); }

  /** 统计某日的胜 / 总 / 待结算，所有口径统一走这里。 */
  function wrDayStat(r) {
    var picks = (r && Array.isArray(r.picks)) ? r.picks : [];
    var w = 0, n = 0, p = 0;
    picks.forEach(function (x) {
      if (x && x.result === 'win') { w++; n++; }
      else if (x && x.result === 'loss') { n++; }
      else p++;
    });
    return { picks: picks, w: w, n: n, p: p };
  }
  function wrRateCls(rate) { return rate == null ? '' : (rate >= 60 ? 'up' : rate >= 40 ? 'gold' : 'down'); }

  /**
   * 该批次的生效时间（本地时间 MM-DD HH:mm）。
   * 取 max(frozenAt, resetAt)：首次冻结的时间戳，与显式重设的时间戳中较晚者——
   * 即「这一批标的最终定稿于何时」。不新增持久化字段，直接用已有时间戳推导。
   */
  function wrBatchTime(r) {
    if (!r || typeof r !== 'object') return '';
    var ts = 0;
    if (r.frozenAt) ts = Math.max(ts, r.frozenAt);
    if (r.resetAt) ts = Math.max(ts, r.resetAt);
    if (!ts) return '';
    var dt = new Date(ts);
    if (isNaN(dt.getTime())) return '';
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return p2(dt.getMonth() + 1) + '-' + p2(dt.getDate()) + ' ' + p2(dt.getHours()) + ':' + p2(dt.getMinutes());
  }

  /* ---------------- 日历视图（按日查询 / 补结算） ---------------- */
  function wrPad(n) { return (n < 10 ? '0' : '') + n; }
  /** 解析台账 key（YYYY-MM-DD）→ {y, mo, d}；非法返回 null。 */
  function wrParseDayKey(k) {
    var m = String(k || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  }
  /** 月份视图平移 step 个月，返回 YYYY-MM。 */
  function wrMonthShift(ym, step) {
    var m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return ym;
    var dt = new Date(+m[1], +m[2] - 1 + step, 1);
    return dt.getFullYear() + '-' + wrPad(dt.getMonth() + 1);
  }
  function wrKeyOf(y, mo, d) { return y + '-' + wrPad(mo) + '-' + wrPad(d); }

  /** 情绪阶段 → 语义色 class。冰点/分歧=冷色警示，高潮=红热，确认=金，启动/修复=绿蓝。 */
  function wrMoodCls(stage) {
    var s = String(stage || '');
    if (/冰点/.test(s)) return 'ice';
    if (/分歧/.test(s)) return 'diverge';
    if (/高潮/.test(s)) return 'climax';
    if (/确认/.test(s)) return 'confirm';
    if (/启动/.test(s)) return 'start';
    if (/修复/.test(s)) return 'repair';
    return 'na';
  }
  /** 批次情绪短标签：阶段名（去「期」）+ 温度，如「高潮 68」。老记录无 mood 返回空。 */
  function wrMoodTag(rec) {
    var m = rec && rec.mood;
    if (!m || (!m.stage && m.T == null)) return '';
    var stage = String(m.stage || '').replace(/期$/, '');
    var T = m.T != null ? (' ' + m.T) : '';
    return (stage || '情绪') + T;
  }

  /**
   * 月历：每天若有冻结批次，显示状态徽标——
   *   待结算（琥珀，显示待结算笔数）/ 已结算（绿，显示当日正确率）/ 空仓（灰，无合格标的）。
   * 点有标记的日子 → 选中该日 → 下方列出当天推荐股供逐个结算。
   * 这样即使某天忘记结算，翻日历一眼就能看到「待结算」色块，点进去补上即可，正确率自动重算。
   */
  function wrCalHTML(all, date) {
    if (!wrState.calMonth || !/^\d{4}-\d{2}$/.test(wrState.calMonth)) {
      var pk = wrParseDayKey(date) || wrParseDayKey(wrKeys(all)[0] || '');
      wrState.calMonth = pk ? pk.y + '-' + wrPad(pk.mo) : '';
    }
    var cm = String(wrState.calMonth).match(/^(\d{4})-(\d{2})$/);
    if (!cm) return '';
    var y = +cm[1], mo = +cm[2];
    var firstDow = (new Date(y, mo - 1, 1).getDay() + 6) % 7; // 周一为一周起点
    var daysIn = new Date(y, mo, 0).getDate();
    var h = '';
    h += '<div class="wr-cal">';
    h += '<div class="wr-cal-h">'
      + '<button type="button" class="wr-cal-nav" data-nav="-1" title="上个月">‹</button>'
      + '<span class="wr-cal-title">' + y + '年' + mo + '月</span>'
      + '<button type="button" class="wr-cal-nav" data-nav="1" title="下个月">›</button>'
      + '<button type="button" class="wr-cal-jump" data-jump="data" title="回到当前数据日">回到数据日</button>'
      + '</div>';
    h += '<div class="wr-cal-wd"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span class="we">六</span><span class="we">日</span></div>';
    h += '<div class="wr-cal-grid">';
    var i;
    for (i = 0; i < firstDow; i++) h += '<div class="wr-cal-cell blank"></div>';
    for (var d = 1; d <= daysIn; d++) {
      var k = wrKeyOf(y, mo, d);
      var rec = all[k];
      var cls = 'wr-cal-cell', st = '', tip = k, attrs = '';
      if (rec) {
        var s = wrDayStat(rec);
        var sd = wrSettleDateOf(rec, k);
        var mature = wrIsMature(rec, k);
        if (s.p > 0 && !mature) {
          // 已冻结但结算日未到：当天结果还不确定，禁止提前结算。
          cls += ' waiting';
          st = sd ? '待' + wrShort(sd) : '待开奖';
          tip += ' · 筛选日 ' + wrShort(k) + '，结算日 ' + (sd ? wrShort(sd) + '（' + wrWeekName(sd) + '，下一交易日）' : '待定')
            + '，' + s.p + ' 笔未到结算日，当天收盘后再来结算';
        } else if (s.p > 0) {
          cls += ' pending'; st = '待' + s.p;
          tip += ' · 结算日 ' + (sd ? wrShort(sd) : '已到') + '，' + s.p + ' 笔待结算，点此补结算';
        } else if (s.n > 0) {
          cls += ' settled';
          var rate = s.w / s.n * 100;
          st = (rate >= 99.5 ? Math.round(rate) : rate.toFixed(0)) + '%';
          tip += ' · 晋级 ' + s.w + '/' + s.n + '（' + rate.toFixed(1) + '%）';
        } else {
          cls += ' empty'; st = '空仓'; tip += ' · 当日无合格标的';
        }
        attrs = ' data-day="' + esc(k) + '"';
      } else {
        cls += ' nodata'; tip += ' · 无冻结记录';
      }
      if (k === date) cls += ' sel';
      if (k === wrState.dataDate) cls += ' dataday';
      var moodTag = wrMoodTag(rec);
      if (moodTag) tip += ' · 当日情绪 ' + moodTag;
      h += '<div class="' + cls + '"' + attrs + ' title="' + esc(tip) + '">'
        + '<span class="wr-cal-num">' + d + '</span>'
        + (moodTag ? '<span class="wr-cal-mood m-' + wrMoodCls(rec.mood.stage) + '">' + esc(moodTag) + '</span>' : '')
        + (st ? '<span class="wr-cal-st">' + esc(st) + '</span>' : '')
        + (k === wrState.dataDate ? '<i class="wr-cal-dot" title="数据日"></i>' : '')
        + '</div>';
    }
    h += '</div>';
    h += '<div class="wr-cal-lg"><span><i class="lg waiting"></i>待开奖（未到结算日）</span>'
      + '<span><i class="lg pending"></i>待结算</span>'
      + '<span><i class="lg settled"></i>已结算</span>'
      + '<span><i class="lg empty"></i>空仓</span>'
      + '<span><i class="lg dataday"></i>数据日</span>'
      + '<span class="wr-cal-lgtip">日期下方小字为当日情绪周期（阶段 + 温度）；点日期查看当天推荐股，「待开奖」要等结算日收盘后才能结算</span></div>';
    h += '</div>';
    return h;
  }

  /** 待结算日期列表（供提醒条快速跳转）：只列已到结算日、可立即结算的批次。 */
  function wrPendingList(all) {
    var out = [];
    wrKeys(all).forEach(function (k) {
      var s = wrDayStat(all[k]);
      if (s.p > 0 && wrIsMature(all[k], k)) out.push({ date: k, p: s.p });
    });
    return out;
  }
  /** 未到结算日的批次（含待结算笔数 + 结算日），用于「即将开奖」提示。 */
  function wrWaitingList(all) {
    var out = [];
    wrKeys(all).forEach(function (k) {
      var s = wrDayStat(all[k]);
      if (s.p > 0 && !wrIsMature(all[k], k)) out.push({ date: k, p: s.p, settle: wrSettleDateOf(all[k], k) });
    });
    return out;
  }

  /**
   * 渲染整块正确率面板。数据只来自 localStorage + wrState，
   * 不接收渲染时的快照参数，因此跨日刷新后仍然正确。
   */
  function wrInnerHTML() {
    var all = wrLoad();
    var keys = wrKeys(all);
    if (!wrState.selectedDate || !all[wrState.selectedDate]) {
      wrState.selectedDate = (wrState.dataDate && all[wrState.dataDate]) ? wrState.dataDate : (keys[0] || wrState.dataDate || '—');
    }
    var date = wrState.selectedDate;
    var ds = wrDayStat(all[date]);
    var picks = ds.picks;

    // 累计口径：全部已结算标的的胜 / 总。待结算不进分母；未到结算日的单独计入 waiting。
    var totW = 0, totN = 0, days = 0, pend = 0, waiting = 0;
    keys.forEach(function (k) {
      var s = wrDayStat(all[k]);
      totW += s.w; totN += s.n;
      if (s.n) days++;
      if (s.p > 0) { if (wrIsMature(all[k], k)) pend += s.p; else waiting += s.p; }
    });
    var cumRate = totN ? totW / totN * 100 : null;
    var pendList = wrPendingList(all);
    var waitList = wrWaitingList(all);

    // 当日口径：跟随用户所选的冻结日。
    var dayRate = ds.n ? ds.w / ds.n * 100 : null;
    var curMature = wrIsMature(all[date], date);
    var curSettle = wrSettleDateOf(all[date], date);

    var html = '';
    html += '<div class="wr-summary">'
      + '<div class="wr-big ' + wrRateCls(cumRate) + '"><span class="wr-num">' + (cumRate == null ? '—' : cumRate.toFixed(1) + '%') + '</span><span class="wr-cap">累计正确率</span></div>'
      + '<div class="wr-sub">累计 <b>' + totW + '/' + totN + '</b> 胜 · 已结算 <b>' + days + '</b> 天'
      + (pend ? ' · <span class="wr-pend">' + pend + ' 笔待结算</span>' : '')
      + (waiting ? ' · <span class="wr-wait">' + waiting + ' 笔待开奖</span>' : '') + '</div>'
      + '<div class="wr-day ' + wrRateCls(dayRate) + '"><span class="wr-day-cap">当日（' + esc(date) + '）正确率</span><span class="wr-day-num">' + (dayRate == null ? '待结算' : dayRate.toFixed(1) + '%') + '</span><span class="wr-day-sub">' + (dayRate == null ? (ds.p ? '（' + ds.p + (curMature ? ' 笔待结算' : ' 笔待开奖') + '）' : '（0 已结算）') : ds.w + '/' + ds.n + (ds.p ? ' · ' + ds.p + (curMature ? ' 待结算' : ' 待开奖') : '')) + '</span></div>'
      + '</div>';

    // 待结算提醒：只列已到结算日、可立即结算的批次，把「忘记结算」变成一眼可见的清单。
    if (pendList.length) {
      var chips = pendList.map(function (o) {
        return '<button type="button" class="wr-pchip" data-day="' + esc(o.date) + '">' + esc(o.date.slice(5)) + ' <b>待' + o.p + '</b></button>';
      }).join('');
      html += '<div class="wr-remind"><b>⚠ 有 ' + pendList.length + ' 天共 ' + pend + ' 笔待结算</b>'
        + '<span>忘记结算会让正确率偏低，点日期补上即可自动重算：</span>' + chips + '</div>';
    }
    // 待开奖提醒：已冻结但结算日未到，告知具体开奖日，避免当天就误判。
    if (waitList.length) {
      var wchips = waitList.map(function (o) {
        return '<span class="wr-wchip">' + esc(o.date.slice(5)) + ' → ' + esc(wrShort(o.settle)) + ' <b>' + o.p + ' 笔</b></span>';
      }).join('');
      html += '<div class="wr-waitbar"><b>⏳ 另有 ' + waitList.length + ' 天 ' + waiting + ' 笔未到结算日</b>'
        + '<span>（筛选日 → 结算日，均为下一交易日；到日收盘后再结算）：</span>' + wchips + '</div>';
    }

    var selBt = wrBatchTime(all[date]);
    var selMood = wrMoodTag(all[date]);
    var settleLine = ''
      + (curSettle ? '筛选日 <b>' + esc(date) + '</b>（' + wrWeekName(date) + '）→ 结算日 <b class="wr-settle-d">' + esc(curSettle) + '</b>（' + wrWeekName(curSettle) + '，下一交易日）' : '结算日待定')
      + (selMood ? '　·　当日情绪 <b class="wr-mood-' + wrMoodCls(all[date].mood.stage) + '">' + esc(selMood) + '</b>' : '')
      + (selBt ? '　·　本批次定稿于 <b class="wr-bt">' + esc(selBt) + '</b>' : '');
    html += '<div class="wr-settle"><div class="wr-settle-hrow"><div class="wr-settle-h">按日期结算（点下方日历选择日期，可结算任意已到结算日的批次）'
      + '</div>';
    html += '<div class="wr-settle-line">' + settleLine
      + (picks.length && !curMature ? '<span class="wr-notyet">· ⏳ 未到结算日，' + esc(curSettle || '结算日') + ' 收盘后再回来结算</span>' : (picks.length ? '<span class="wr-ready">· ✅ 已到结算日，可结算</span>' : ''))
      + '</div>';
    // 「用当前标的重设本批次」仅对当前数据日开放，历史日不提供，避免误改旧台账。
    if (date === wrState.dataDate) {
      var canReset = !!(wrState.curPicks && wrState.curPicks.length);
      var curLabel = wrState.curLabel || '';
      // 「用当前标的（快照 X）重设本批次」：把当前标的与它所属的快照时点绑在一起，
      // 避免被读成「冻结批次自身的快照时点」（批次定稿时间在标题行单独标注）。
      html += '<button type="button" class="wr-reset" data-date="' + esc(date) + '"' + (canReset ? '' : ' disabled title="当前快照无合格标的"') + '>'
        + '用当前标的' + (curLabel ? '<span class="wr-reset-lb">（快照 ' + esc(curLabel) + '）</span>' : '') + '重设本批次</button>';
    }
    html += '</div>';
    html += wrCalHTML(all, date);
    html += '<div class="wr-dayhint">每天打开本页会自动把当日标的<b>冻结存档</b>。<b>结算口径：</b>数据日 D 收盘后筛出的标的是「次日开盘」的盘前预案，晋级结果只能在 <b>D 的下一个交易日（结算日）</b>确认——周一至周四筛的次日结算，<b>周五筛的下周一结算</b>，节前最后交易日筛的<b>节后首个交易日结算</b>（休市日见上交所 2026 年公告）。日历状态：蓝色「待 MM-DD」= 未到结算日、还不能判晋级；橙色「待 N」= 结算日已到、有 N 只待你结算；绿色百分比 = 已结算；灰色「空仓」= 当日无合格标的。<b>偶尔忘记也没关系，改天回到日历补结算，累计正确率会自动重算。</b>本批次以<b>首次打开本页时</b>的标的为准并锁定；盘中标的若有变化，可点上方「用当前标的…重设本批次」（收盘后建议重设一次）。「当日正确率」随所选日期变化，「累计正确率」始终统计全部已结算标的。</div>';

    if (!picks.length) {
      html += '<div class="wr-empty">该日无合格标的（阶段禁买），无需结算。</div>';
    } else {
      if (!curMature) {
        html += '<div class="wr-locknote">⏳ 该批次结算日为 <b>' + esc(curSettle || '下一交易日') + '</b>，' + esc(curSettle || '当日') + ' 收盘前结果未定，暂不能结算（下方按钮已锁定）。到日后再回来逐只选晋级 / 未晋级。</div>';
      }
      html += '<div class="wr-rows">';
      picks.forEach(function (x) {
        var code = x && x.code ? x.code : '';
        var name = x && x.name ? x.name : '';
        var role = x && x.role ? x.role : '';
        var res = x ? x.result : null;
        var lock = curMature ? '' : ' disabled title="未到结算日（' + esc(curSettle || '下一交易日') + '）"';
        html += '<div class="wr-row' + (curMature ? '' : ' locked') + '">'
          + '<span class="wr-role ' + (role === '龙头' ? 'dragon' : role === '中军' ? 'jun' : 'bub') + '">' + esc(role) + '</span>'
          + '<span class="wr-nm">' + esc(name) + '</span>'
          + '<span class="wr-cd">' + esc(code) + '</span>'
          + '<span class="wr-btns">'
          + '<button type="button" class="wr-btn win' + (res === 'win' ? ' on' : '') + '" data-date="' + esc(date) + '" data-code="' + esc(code) + '" data-name="' + esc(name) + '" data-role="' + esc(role) + '" data-res="win"' + lock + '>晋级 ✓</button>'
          + '<button type="button" class="wr-btn lose' + (res === 'loss' ? ' on' : '') + '" data-date="' + esc(date) + '" data-code="' + esc(code) + '" data-name="' + esc(name) + '" data-role="' + esc(role) + '" data-res="loss"' + lock + '>未晋级 ✗</button>'
          + '</span></div>';
      });
      html += '</div>';
      html += '<div class="wr-hint">达标 = 结算日按预案晋级 / 触发（成龙点上板、分歧转一致上板、补涨冲板）；未达标 = 证伪 / 炸板 / 未触发。正确率为<b>下一交易日</b>结果统计，非盘中实时喊单。</div>';
    }
    html += '</div>';

    html += '<div class="wr-hist"><div class="wr-settle-h">历史台账（' + keys.length + ' 天）</div>';
    if (!keys.length) {
      html += '<div class="wr-empty">暂无记录。打开本页时会自动冻结当日标的，到结算日（下一交易日）后再点上面的按钮即可开始累计正确率。</div>';
    } else {
      html += '<table class="wr-tb"><thead><tr><th>筛选日</th><th>结算日</th><th>当日情绪</th><th>批次时间</th><th>当日胜/总</th><th>当日正确率</th><th>操作</th></tr></thead><tbody>';
      keys.forEach(function (k) {
        var s = wrDayStat(all[k]);
        var rate = s.n ? s.w / s.n * 100 : null;
        var bt = wrBatchTime(all[k]);
        var sd = wrSettleDateOf(all[k], k);
        var mature = wrIsMature(all[k], k);
        var rateTxt = rate != null ? rate.toFixed(1) + '%' : (s.p ? (mature ? '待结算' : '待开奖') : '—');
        var mt = wrMoodTag(all[k]);
        html += '<tr><td>' + esc(k) + '</td><td class="wr-settle-d">' + (sd ? esc(sd) + ' ' + wrWeekName(sd) : '—') + '</td><td class="wr-mood-' + wrMoodCls(all[k].mood && all[k].mood.stage) + '">' + (mt ? esc(mt) : '—') + '</td><td class="wr-bt">' + (bt ? esc(bt) : '—') + '</td><td>' + (s.n ? (s.w + '/' + s.n) : '—') + (s.p ? ' <span class="' + (mature ? 'wr-pend' : 'wr-wait') + '">+' + s.p + '</span>' : '') + '</td><td class="' + wrRateCls(rate) + '">' + rateTxt + '</td><td><button type="button" class="wr-del" data-date="' + esc(k) + '">删除</button></td></tr>';
      });
      html += '</tbody></table>';
      html += '<button type="button" class="wr-clear">清空全部台账</button>';
    }
    html += '</div>';
    return html;
  }

  /**
   * 事件委托：不捕获 date / picked，点击时从 wrState 与 DOM data 属性取最新上下文。
   * rootEl.__wrBound 只保证不重复绑定，不影响上下文刷新。
   */
  function wrAttach(rootEl) {
    if (!rootEl || rootEl.__wrBound) return;
    rootEl.__wrBound = true;
    rootEl.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      var refresh = function () {
        var wrap = rootEl.querySelector('.wr-wrap');
        if (wrap) wrap.innerHTML = wrInnerHTML();
      };
      // 日历：翻上/下月
      var nav = e.target.closest('.wr-cal-nav');
      if (nav) {
        wrState.calMonth = wrMonthShift(wrState.calMonth, +nav.getAttribute('data-nav') || 0);
        refresh();
        return;
      }
      // 日历：回到当前数据日
      var jump = e.target.closest('.wr-cal-jump');
      if (jump) {
        var jd = wrParseDayKey(wrState.dataDate);
        if (jd) {
          wrState.calMonth = jd.y + '-' + wrPad(jd.mo);
          wrState.selectedDate = wrState.dataDate;
        }
        refresh();
        return;
      }
      // 日历日期格 / 待结算提醒 chip：选中该日并翻到对应月份
      var cell = e.target.closest('.wr-cal-cell[data-day], .wr-pchip');
      if (cell) {
        var pickedDay = cell.getAttribute('data-day');
        if (pickedDay) {
          wrState.selectedDate = pickedDay;
          var pd = wrParseDayKey(pickedDay);
          if (pd) wrState.calMonth = pd.y + '-' + wrPad(pd.mo);
          refresh();
        }
        return;
      }
      var rst = e.target.closest('.wr-reset');
      if (rst) {
        // 仅允许重设当前数据日的批次；历史日台账不可被覆盖。
        var rstDate = rst.getAttribute('data-date');
        if (rstDate !== wrState.dataDate) return;
        var cur = wrState.curPicks || [];
        var all0 = wrLoad();
        var old0 = all0[rstDate] || { picks: [] };
        var oldPicks = Array.isArray(old0.picks) ? old0.picks : [];
        var settledTotal = 0, settledKept = 0, removed = 0;
        var oldByCode = {};
        oldPicks.forEach(function (p) { if (p && p.code) oldByCode[p.code] = p; });
        oldPicks.forEach(function (p) { if (p && (p.result === 'win' || p.result === 'loss')) settledTotal++; });
        var newCodes = {};
        cur.forEach(function (t) {
          var code = t && t.s && t.s.code ? t.s.code : '';
          if (!code) return;
          newCodes[code] = true;
          var prev = oldByCode[code];
          if (prev && (prev.result === 'win' || prev.result === 'loss')) settledKept++;
        });
        Object.keys(oldByCode).forEach(function (c) { if (!newCodes[c]) removed++; });
        var settledRemoved = settledTotal - settledKept;
        var lb = wrState.curLabel || '';
        var msg = '将用当前标的覆盖 ' + rstDate + ' 的本批次'
          + (lb ? '（快照 ' + lb + '，当前 ' + cur.length + ' 只）' : '（当前 ' + cur.length + ' 只）')
          + '；已结算 ' + settledTotal
          + ' 笔中 ' + settledKept + ' 笔保留，' + settledRemoved + ' 笔将移除；旧批次另有 ' + (removed - settledRemoved)
          + ' 只未结算标的不再计入。继续？';
        if (typeof confirm === 'function' && confirm(msg)) {
          wrResetBatch(rstDate, cur);
          refresh();
        }
        return;
      }
      var btn = e.target.closest('.wr-btn');
      if (btn) {
        wrSetResult(btn.getAttribute('data-date'), btn.getAttribute('data-code'), btn.getAttribute('data-name'), btn.getAttribute('data-role'), btn.getAttribute('data-res'));
        refresh();
        return;
      }
      var del = e.target.closest('.wr-del');
      if (del) {
        var delDate = del.getAttribute('data-date');
        if (typeof confirm === 'function' && confirm('确认删除 ' + delDate + ' 的结算记录？')) {
          wrDelDate(delDate);
          if (wrState.selectedDate === delDate) wrState.selectedDate = wrState.dataDate;
          refresh();
        }
        return;
      }
      var clr = e.target.closest('.wr-clear');
      if (clr) {
        if (typeof confirm === 'function' && confirm('确认清空全部正确率台账？此操作不可恢复。')) {
          wrClearAll();
          wrState.selectedDate = wrState.dataDate;
          refresh();
        }
      }
    });
  }
  global.YGWinRate = { attach: wrAttach };

  global.YGDecision = { build: build, render: render };
})(typeof window !== 'undefined' ? window : this);
