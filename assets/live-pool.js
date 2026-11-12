/* =========================================================================
 * live-pool.js — 个股明细「自动最新」：浏览器直连东方财富涨停池
 * -------------------------------------------------------------------------
 * 背景（v20261112a）：
 *   data/snapshot.json 是定时任务生成的静态收盘快照，一旦推送链路中断就会长期
 *   停留在旧交易日；而 assets/market-today.js 抓的是当日实时汇总行情，于是出现
 *   「行情日 11-12 / 个股明细 11-09」的错位。
 *
 * 本模块在页面打开时直接请求东财 push2ex getTopicZTPool（CORS 已实测：
 *   Access-Control-Allow-Origin 回显来源域），并发回溯最近 5 个自然日，
 *   取第一个 pool.length > 0 的交易日作为「最近有数据的收盘交易日」。
 *   盘前 / 非交易日当天 tc=0，会被自动跳过，不会再出现「涨停 0」。
 *
 * 池数据经 toSnapshotJson() 映射为 data/snapshot.json 的同形结构，再交给
 *   YGData.buildFromSnapshot() 复用 computeConceptHeat / scoreStock /
 *   buildOverview / buildLadder / topMonsters / sectorZtCountFor 等既有函数，
 *   返回与 fetchSnapshot() 完全一致的 daily data 形状，下游零改动。
 *
 * 字段口径（东财池实测 20261111）：
 *   c 代码 / n 名称 / p 价格×1000 / zdp 涨跌幅 / lbc 连板数 / fbt 首封时间
 *   lbt 最后封板时间 / zbc 开板次数 / fund 封单额(元) / hs 换手率(%)
 *   ltsz 流通市值(元) / hybk 行业板块 / amount 成交额(元) / zttj 涨停统计
 *   缺失字段（量比、主力净流入、龙虎榜、午盘封单）一律 null + 「缺项」，
 *   绝不编造、绝不从 snapshot.stats 估算顶替。
 *
 * 对外接口：
 *   window.YGLivePool.fetch()  -> Promise<dailyData|null>
 *   window.YGLivePool.getLast() -> 最近一次成功结果或 null
 * ========================================================================= */
(function (global) {
  'use strict';

  var UT_POOL = '7eea3edcaed734bea9cbfc24409ed989';
  var POOL_BASE = 'https://push2ex.eastmoney.com/getTopicZTPool?ut=' + UT_POOL +
    '&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=';
  var TIMEOUT_MS = 4500;      // 单请求独立超时，与 market-today.js 一致
  var LOOKBACK_DAYS = 5;      // 回溯最近 5 个自然日
  var CACHE_MS = 60000;       // 60s 内复用，避免 5s 自动刷新反复打接口

  var cache = { at: 0, data: null, date: null, queriedDate: null };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function beijingNow() {
    var d = new Date();
    var utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
    return new Date(utcMs + 8 * 3600000);
  }
  function beijingTodayISO() {
    var bj = beijingNow();
    return bj.getUTCFullYear() + '-' + pad2(bj.getUTCMonth() + 1) + '-' + pad2(bj.getUTCDate());
  }
  /** 15:00 收盘前，当日涨停池是「盘中未完结」的残缺数据（例如 09:35 只有十几只），
      不是收盘快照。为保证个股明细与汇总行情都落在同一个「已收盘交易日」，
      收盘前一律跳过今天，从 T-1 起回溯；15:00 后才把今日纳入候选。 */
  function isSessionComplete() {
    var bj = beijingNow();
    return (bj.getUTCHours() * 60 + bj.getUTCMinutes()) >= 15 * 60;
  }
  function shiftISO(iso, delta) {
    var y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
    var dt = new Date(Date.UTC(y, m - 1, d + delta));
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }
  function compactOf(iso) { return iso.replace(/-/g, ''); }
  function isoOf(compact) { return compact.slice(0, 4) + '-' + compact.slice(4, 6) + '-' + compact.slice(6, 8); }
  function finite(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function round(v, digits) {
    var p = Math.pow(10, digits == null ? 0 : digits);
    return Math.round(v * p) / p;
  }
  function hhmm(v) {
    var n = finite(v);
    if (n == null) return '';
    var s = String(Math.floor(n));
    while (s.length < 6) s = '0' + s;
    return s.slice(0, 2) + ':' + s.slice(2, 4);
  }
  /** 东财池日期字段 qdate 是「查询时刻」而非交易日（20261111 会返回 qdate=20261112），
      故日期一律以请求参数为准，绝不采信 qdate。 */
  function fetchZtPool(compactDate) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    var task;
    try {
      var opts = { mode: 'cors', credentials: 'omit', cache: 'no-store' };
      if (ctrl) opts.signal = ctrl.signal;
      task = global.fetch(POOL_BASE + compactDate, opts).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || j.rc !== 0) throw new Error('rc=' + (j && j.rc));
        var pool = (j.data && Array.isArray(j.data.pool)) ? j.data.pool : [];
        return { compact: compactDate, iso: isoOf(compactDate), pool: pool, tc: finite(j.data && j.data.tc) };
      });
    } catch (e) {
      return Promise.resolve(null);
    }
    if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* 忽略 */ } }, TIMEOUT_MS);
    return task.then(function (v) {
      if (timer) clearTimeout(timer);
      return v;
    }, function () {
      if (timer) clearTimeout(timer);
      return null;
    });
  }

  /** 并发探测候选日，取日期最大且 pool.length>0 的那一天；全部失败返回 null。 */
  function resolveLatestTradeDate(candidates) {
    var tasks = candidates.map(fetchZtPool);
    return Promise.all(tasks).then(function (rs) {
      var hits = rs.filter(function (x) { return x && x.pool && x.pool.length > 0; });
      hits.sort(function (a, b) { return b.compact.localeCompare(a.compact); });
      return hits.length ? hits[0] : null;
    }, function () { return null; });
  }

  /**
   * 东财涨停池 → data/snapshot.json 同形结构。
   * 保留全部 85 只（不额外过滤 ST / 北交所），保证个股明细与汇总行情家数一致。
   */
  function toSnapshotJson(pool, dateISO) {
    var stocks = [];
    var exact = {};
    var openCount = 0;
    (pool || []).forEach(function (x) {
      if (!x) return;
      var code = String(x.c || '').replace(/\D/g, '');
      if (!/^\d{6}$/.test(code)) return;
      var fbt = finite(x.fbt), lbt = finite(x.lbt), zbc = finite(x.zbc) || 0;
      var lbc = finite(x.lbc);
      var boards = lbc != null ? Math.max(1, Math.round(lbc)) : 1;
      var p = finite(x.p), fund = finite(x.fund), ltsz = finite(x.ltsz), hs = finite(x.hs);
      var sec = String(x.hybk || '').trim() || '其他';
      // 一字板：首封=最后封、09:30 前封板且全天未开板；其余按换手板处理
      var oneWord = (fbt != null && lbt != null && fbt === lbt && fbt <= 93000 && zbc === 0);
      stocks.push({
        c: code,
        n: String(x.n || '').trim(),
        p: p != null ? round(p / 1000, 2) : null,
        pct: finite(x.zdp),
        b: boards,
        seal: fund != null ? round(fund / 10000, 2) : null,   // 元 → 万元
        lt: oneWord ? 1 : 2,
        open: zbc,
        first: hhmm(fbt),
        sec: sec,
        cx: [sec],                                            // 东财只给行业，不臆造概念
        sm: null, decay: null,                                // 无午盘封单
        cap: ltsz != null ? round(ltsz / 1e8, 2) : null,      // 流通市值（亿）
        to: hs != null ? round(hs, 2) : null,                  // 换手率（%）
        vr: null,                                             // 量比：池内无此字段，缺项
        mf: null                                              // 主力净流入：池内无此字段，缺项
      });
      exact[boards] = (exact[boards] || 0) + 1;
      if (zbc >= 3) openCount++;
    });
    var exactBoards = Object.keys(exact).map(Number).sort(function (a, b) { return a - b; })
      .map(function (n) { return { board_num: n, stock_count: exact[n] }; });
    return {
      date: dateISO,
      generatedAt: new Date().toISOString(),
      sources: ['东方财富 push2ex 实时涨停池（浏览器直连）'],
      note: '由东财涨停池实时映射；量比/主力净流入/龙虎榜/午盘封单缺失，对应因子按缺项处理。',
      lhbDate: dateISO,
      // 与静态快照一致的「估算口径」统计（池内开板≥3次 / 未开板比例），
      // 仅用于 overview 展示；全市场炸板率 / 封板率一律取 d.market 实测口径。
      stats: {
        open_stock_count: openCount,
        seal_rate: stocks.length ? round((stocks.length - openCount) / stocks.length, 2) : null,
        exact_boards: exactBoards
      },
      lhb: [],
      hot: [],
      stocks: stocks
    };
  }

  /** 主入口：返回与 YGData.getDaily() 其余分支同形的 daily data；失败返回 null。 */
  function load() {
    if (cache.data && (Date.now() - cache.at) < CACHE_MS) return Promise.resolve(cache.data);
    var todayISO = beijingTodayISO();
    var startOffset = isSessionComplete() ? 0 : 1;   // 收盘前跳过今日盘中残缺池
    var candidates = [];
    for (var i = startOffset; i < startOffset + LOOKBACK_DAYS; i++) {
      candidates.push(compactOf(shiftISO(todayISO, -i)));
    }

    return resolveLatestTradeDate(candidates).then(function (hit) {
      if (!hit) { cache.at = 0; cache.data = null; return null; }
      var builder = global.YGData && global.YGData.buildFromSnapshot;
      if (typeof builder !== 'function') return null;
      var j = toSnapshotJson(hit.pool, hit.iso);
      var preMarket = hit.iso !== todayISO;
      var data;
      try {
        data = builder(j, {
          source: 'em-live',
          sourceLabel: '东财实时涨停池',
          reason: '（东财实时涨停池 ' + hit.iso + ' 收盘：行业 / 连板 / 封单 / 首封 / 开板次数 / 换手 / 流通市值）',
          meta: { youzi: 'na', seal: 'ths', sector: 'em', quote: 'em', degraded: false },
          notice: '个股明细：东方财富实时涨停池 ' + hit.iso + ' 收盘（最近有数据的交易日，共 ' + j.stocks.length +
            ' 只涨停）' + (preMarket ? ' · 当前盘前，展示最近收盘数据，收盘后刷新。' : '。'),
          preMarket: preMarket,
          queriedDate: todayISO,
          livePoolDate: hit.iso,
          statsSource: 'em-live'
        });
      } catch (e) {
        return null;
      }
      if (!data || !data.stocks || !data.stocks.length) return null;
      cache.at = Date.now();
      cache.data = data;
      cache.date = hit.iso;
      cache.queriedDate = todayISO;
      return data;
    }, function () { return null; });
  }

  function getLast() { return cache.data; }
  function getLastDate() { return cache.date; }

  global.YGLivePool = { fetch: load, getLast: getLast, getLastDate: getLastDate };
})(typeof window !== 'undefined' ? window : this);
