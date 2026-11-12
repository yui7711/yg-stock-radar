/* =========================================================================
 * live-pool.js — 个股明细「盘中实时 / 收盘回溯」：浏览器直连东方财富涨停池
 * -------------------------------------------------------------------------
 * v20261112a：解决 data/snapshot.json 停留在旧交易日导致个股明细过期的问题。
 * v20261112b：引入显式 mode，并把「除复盘报告外所有栏目」切到盘中实时：
 *
 *   fetch({ mode: 'live',  date?: 'YYYYMMDD' })  默认，首页 + 6 个栏目
 *     · 优先取北京时间当天的 getTopicZTPool，即使盘中池残缺也使用；
 *       标注「盘中实时 · 未收盘，数据会变动」；
 *     · 仅当天池为空（尚未开盘 / 非交易日 / 接口无数据）才回溯最近已收盘
 *       交易日，并标注「当日收盘数据尚未生成，展示最近已收盘交易日 …」；
 *     · ≥15:00 后当日池即为收盘数据。
 *   fetch({ mode: 'close', date?: 'YYYYMMDD' })  报告生成 / 历史复盘
 *     · 15:00 前跳过今天的盘中残缺池，回溯最近已收盘交易日（v20261112a 行为）；
 *     · ≥15:00 后今日池视为收盘数据。
 *
 * 时区统一走 window.YGSession（new Date(Date.now()+8h) 配 getUTC*()），
 * 修掉 v20261112a 中 getTimezoneOffset() 造成的「非 UTC 浏览器 15:00 后仍
 * 跳过当天」缺陷；本文件不再自己算北京时间。
 *
 * 池数据经 toSnapshotJson() 映射为 data/snapshot.json 同形结构，再交给
 * YGData.buildFromSnapshot() 复用既有打分 / 梯队 / 板块函数，下游零改动。
 * 量比 / 主力净流入 / 龙虎榜 / 午盘封单等池内没有的字段一律 null + 缺项，
 * 绝不编造、绝不从 snapshot.stats 估算顶替。
 *
 * 对外接口：
 *   window.YGLivePool.fetch(opts) -> Promise<dailyData|null>
 *   window.YGLivePool.getLast() / getLastDate() / getState()
 * ========================================================================= */
(function (global) {
  'use strict';

  var UT_POOL = '7eea3edcaed734bea9cbfc24409ed989';
  var POOL_BASE = 'https://push2ex.eastmoney.com/getTopicZTPool?ut=' + UT_POOL +
    '&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=';
  var TIMEOUT_MS = 4500;
  var LOOKBACK_DAYS = 15;     // v20261112b：长假后 5 个自然日可能全空，扩到 15 天
  var CACHE_MS = 60000;

  var caches = { live: { at: 0, data: null }, close: { at: 0, data: null } };
  var lastData = null;
  var lastState = null;

  function S() { return global.YGSession || null; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** 回退实现与 YGSession 完全一致，保证 session.js 未加载时也不会算错时区。 */
  function beijingNow() {
    var s = S();
    return s && s.beijingNow ? s.beijingNow() : new Date(Date.now() + 8 * 3600000);
  }
  function todayISO() {
    var b = beijingNow();
    return b.getUTCFullYear() + '-' + pad2(b.getUTCMonth() + 1) + '-' + pad2(b.getUTCDate());
  }
  function isSessionComplete() {
    var s = S();
    if (s && s.isSessionComplete) return s.isSessionComplete();
    var b = beijingNow();
    return (b.getUTCHours() * 60 + b.getUTCMinutes()) >= 15 * 60;
  }
  function compactOf(iso) { return iso.replace(/-/g, ''); }
  function isoOf(compact) { return compact.slice(0, 4) + '-' + compact.slice(4, 6) + '-' + compact.slice(6, 8); }
  function shiftISO(iso, delta) {
    var s = S();
    if (s && s.shiftISO) return s.shiftISO(iso, delta);
    var y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
    var dt = new Date(Date.UTC(y, m - 1, d + delta));
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }
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

  /** 东财池 qdate 是「查询时刻」而非交易日，日期一律以请求参数为准。 */
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
      var oneWord = (fbt != null && lbt != null && fbt === lbt && fbt <= 93000 && zbc === 0);
      stocks.push({
        c: code,
        n: String(x.n || '').trim(),
        p: p != null ? round(p / 1000, 2) : null,
        pct: finite(x.zdp),
        b: boards,
        seal: fund != null ? round(fund / 10000, 2) : null,
        lt: oneWord ? 1 : 2,
        open: zbc,
        first: hhmm(fbt),
        sec: sec,
        cx: [sec],
        sm: null, decay: null,
        cap: ltsz != null ? round(ltsz / 1e8, 2) : null,
        to: hs != null ? round(hs, 2) : null,
        vr: null,
        mf: null
      });
      exact[boards] = (exact[boards] || 0) + 1;
      if (zbc >= 3) openCount++;
    });
    var exactBoards = Object.keys(exact).map(Number).sort(function (a, b) { return a - b; })
      .map(function (n) { return { board_num: n, stock_count: exact[n] }; });
    return {
      date: dateISO,
      generatedAt: new Date().toISOString(),
      sources: ['东方财富 push2ex 涨停池（浏览器直连）'],
      note: '由东财涨停池映射；量比 / 主力净流入 / 龙虎榜 / 午盘封单缺失，对应因子按缺项处理。',
      lhbDate: dateISO,
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

  /**
   * 主入口。opts: { mode:'live'|'close', date?:'YYYYMMDD'|'YYYY-MM-DD' }
   * 兼容旧调用 fetch() 与 fetch('live')。
   */
  function load(opts) {
    if (typeof opts === 'string') opts = { mode: opts };
    opts = opts || {};
    var mode = opts.mode === 'close' ? 'close' : 'live';
    var cache = caches[mode];
    if (!opts.date && cache.data && (Date.now() - cache.at) < CACHE_MS) return Promise.resolve(cache.data);

    var s = S();
    var today = todayISO();
    var todayCompact = compactOf(today);
    var complete = isSessionComplete();
    var explicit = !!(typeof opts.date === 'string' && opts.date.trim());
    var explicitCompact = explicit ? String(opts.date).replace(/-/g, '').slice(0, 8) : '';
    var startOffset;
    if (explicit) startOffset = -1;                       // 显式日期：只查该日
    else if (mode === 'live') startOffset = 0;             // live：优先今天（盘中残缺也用）
    else startOffset = complete ? 0 : 1;                  // close：收盘前跳过今日

    var candidates = [];
    if (explicit) candidates.push(explicitCompact);
    else {
      for (var i = startOffset; i < startOffset + LOOKBACK_DAYS; i++) {
        candidates.push(compactOf(shiftISO(today, -i)));
      }
    }

    return resolveLatestTradeDate(candidates).then(function (hit) {
      if (!hit) { cache.at = 0; cache.data = null; return null; }
      var builder = global.YGData && global.YGData.buildFromSnapshot;
      if (typeof builder !== 'function') return null;
      var j = toSnapshotJson(hit.pool, hit.iso);
      var isToday = (hit.compact === todayCompact);
      var intraday = !!(mode === 'live' && isToday && !complete);
      var closedToday = !!(isToday && complete);
      var fallback = !!(mode === 'live' && !isToday);
      var session = intraday ? 'intraday' : (fallback ? 'fallback' : (closedToday ? 'closed' : 'close'));
      var sessionLabel = s && s.phaseLabel ? s.phaseLabel() : '';
      var bjNow = beijingNow();
      var asOfBJ = s ? (s.todayISO() + ' ' + s.hhmm())
        : (today + ' ' + pad2(bjNow.getUTCHours()) + ':' + pad2(bjNow.getUTCMinutes()));
      var sessionWord = intraday ? '盘中实时' : (closedToday ? '当日收盘' : '最近已收盘交易日');
      var reason = '（东财涨停池 ' + hit.iso + ' ' + sessionWord +
        '：行业 / 连板 / 封单 / 首封 / 开板次数 / 换手 / 流通市值）';
      var preMarket = !isToday;   // 盘中数据绝不标「最近收盘 / 盘前」
      var data;
      var seed = {
        date: j.date, source: 'em-live', sourceLabel: '东财实时涨停池',
        intraday: intraday, liveFallback: fallback, session: session,
        sessionLabel: sessionLabel, asOfBJ: asOfBJ, mode: mode
      };
      try {
        var label = s && s.dataTimeLabel ? s.dataTimeLabel(seed) : sessionWord + ' ' + hit.iso;
        data = builder(j, {
          source: 'em-live',
          sourceLabel: '东财实时涨停池',
          reason: reason,
          meta: { youzi: 'na', seal: 'ths', sector: 'em', quote: 'em', degraded: false },
          notice: '个股明细：' + label + '（东财实时涨停池 ' + hit.iso + '，共 ' + j.stocks.length + ' 只涨停）' +
            (intraday ? ' · 盘中数据会随行情变动，收盘后自动刷新。'
              : (fallback ? ' · 当日实时池为空，已回溯到最近已收盘交易日。' : '')),
          preMarket: preMarket,
          queriedDate: today,
          livePoolDate: hit.iso,
          statsSource: 'em-live'
        });
      } catch (e) {
        return null;
      }
      if (!data || !data.stocks || !data.stocks.length) return null;

      data.mode = mode;
      data.intraday = intraday;
      data.liveFallback = fallback;
      data.session = session;
      data.sessionLabel = sessionLabel;
      data.asOfBJ = asOfBJ;
      data.degraded = false;
      data.dataTimeLabel = s && s.dataTimeLabel ? s.dataTimeLabel(data) : sessionWord + ' ' + hit.iso;
      data.notice = '个股明细：' + data.dataTimeLabel + '（东财实时涨停池 ' + hit.iso + '，共 ' + j.stocks.length + ' 只涨停）' +
        (intraday ? ' · 盘中数据会随行情变动，收盘后自动刷新。'
          : (fallback ? ' · 当日实时池为空，已回溯到最近已收盘交易日。' : ''));

      cache.at = Date.now();
      cache.data = data;
      lastData = data;
      lastState = { mode: mode, date: hit.iso, n: j.stocks.length, session: session };
      return data;
    }, function () { return null; });
  }

  function getLast() { return lastData; }
  function getLastDate() { return lastState ? lastState.date : null; }
  function getState() { return lastState; }

  global.YGLivePool = { fetch: load, getLast: getLast, getLastDate: getLastDate, getState: getState };
})(typeof window !== 'undefined' ? window : this);
