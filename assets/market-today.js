/* =========================================================================
 * market-today.js — 当日收盘行情抓取（东方财富公开接口，浏览器直连，无外部依赖）
 * -------------------------------------------------------------------------
 * 对外接口：
 *   window.YGMarketToday.fetchToday(dateStr) -> Promise<market>
 *   window.YGMarketToday.get()               -> 最近一次结果或 null
 *
 * dateStr：'YYYYMMDD' / 'YYYY-MM-DD' / ''（空串取北京时间当天）。
 * market.date 统一为 'YYYYMMDD'（与 app.js 的 day 缓存键一致），
 * 另给 dateISO='YYYY-MM-DD' 与 qdate（东财实际返回日期）。
 *
 * 全部请求并发 + 每个独立 4.5s 超时 + Promise.allSettled 式隔离：
 * 任一接口失败只把对应字段置 null 并在 errors 记原因，绝不拖住首屏，
 * 也绝不因为某个接口挂掉让整个 market 变 null（始终 resolve 对象）。
 *
 * market 至少含：
 *   { date, ok, ztCount, zbCount, dtCount, zbRate, upCount, downCount,
 *     flatCount, upRatio, amountToday, amountMa5, volChange, prem,
 *     promoRate, damian, indices:[], errors:[], source:'eastmoney' }
 * 附加字段（供 auto-fill 判定）：dateISO, qdate, sealRate, sealRateKind,
 *   ztPool, zbPool, dtPool, quotes, history, ztHistory, errors, source
 *
 * 【口径禁用清单】绝不从 overview.zhaban / overview.sealRate /
 *   snapshot.stats.open_stock_count / snapshot.stats.seal_rate 推导炸板率或封板率：
 *   静态快照 open_stock_count=9 是「池内开板≥3次个股数」、seal_rate=0.83 是
 *   「池内未开板≥3次比例」，demo 态又是 32/0.66，三套来源同名不同义。
 *   zbl 永远只取 ZBPool.tc / (ZTPool.tc + ZBPool.tc) * 100。
 *
 * 真实校验（date=20261110，HTTP 200）：
 *   ZT.tc=93 / ZB.tc=19 / DT.tc=0 / maxLbc=7 / lbc>=2=20
 *   沪 f104=1656,f105=622,f106=78,f6=673951893240.3
 *   深 f104=2379,f105=479,f106=81,f6=830863077298.7
 *   昨(11-09)ZT.tc=54，今批量 f3 均值=4.91，交集晋级 5/9=55.56
 * ========================================================================= */
(function (global) {
  'use strict';

  var UT_POOL = '7eea3edcaed734bea9cbfc24409ed989';
  var UT_QUOTE = 'bd1d9ddb04089700cf9c27f6f7426281';
  var UT_KLINE = 'fa5fd1943c7b386f172d6893dbfba10b';
  var POOL_BASE = 'https://push2ex.eastmoney.com/getTopic';
  var QUOTE_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
  var KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
  /* v20261110h：板块角色（龙头/中军/补涨）需要的全市场活跃股池。
     按成交额取前 400 只（4 页 ×100），带 f100 所属行业、f21 流通市值、f62 主力净额，
     与涨停池 hybk 口径一致；无此数据时决策模块自动降级为「板块内涨停股代理」。 */
  var CLIST_URL = 'https://push2.eastmoney.com/api/qt/clist/get';
  var ROLE_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
  var ROLE_FIELDS = 'f12,f14,f2,f3,f6,f8,f10,f21,f62,f100';
  var ROLE_PAGES = 4;
  /* 同花顺 fuyao：晋级率 / 热股榜 / 龙虎榜（T-1）。与 assets/data.js 同源同 key，
     CORS 已实测（Access-Control-Allow-Origin 回显来源域）；失败不影响东财主链路。 */
  var FUYAO_BASE = 'https://fuyao.aicubes.cn';
  var FUYAO_KEY = 'sk-fuyao-ZzXGDrEg8LVWl_4cb_T6KAuZO08Z5_z7';
  var LADDER_URL = FUYAO_BASE + '/api/a-share/special-data/limit-up-ladder';
  var HOT_URL = FUYAO_BASE + '/api/a-share/special-data/hot-stock-list?period=day&limit=60';
  var LHB_URL = FUYAO_BASE + '/api/a-share/special-data/dragon-tiger-list?board_type=all';
  var TIMEOUT_MS = 4500;
  var PAGE_SIZE = 200;
  var INDEX_SECIDS = '1.000001,0.399001';   // 沪深两市口径，不含北交所/创业板重复计
  var INDEX_FIELDS = 'f6,f104,f105,f106,f12';
  var QUOTE_FIELDS = 'f2,f3,f6,f8,f10,f12,f14,f21,f62';

  var lastResult = null;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function beijingToday() {
    var d = new Date();
    var utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
    var bj = new Date(utcMs + 8 * 3600000);
    return bj.getUTCFullYear() + '-' + pad2(bj.getUTCMonth() + 1) + '-' + pad2(bj.getUTCDate());
  }
  function normDate(s) {
    var iso = beijingToday();
    if (typeof s === 'string' && s) {
      var t = s.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t;
      else if (/^\d{8}$/.test(t)) iso = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
    }
    return { iso: iso, compact: iso.replace(/-/g, '') };
  }
  function shiftCompact(compact, delta) {
    var y = Number(compact.slice(0, 4)), m = Number(compact.slice(4, 6)), d = Number(compact.slice(6, 8));
    var dt = new Date(Date.UTC(y, m - 1, d + delta));
    return String(dt.getUTCFullYear()) + pad2(dt.getUTCMonth() + 1) + pad2(dt.getUTCDate());
  }
  function isoToCompact(s) { return String(s).replace(/-/g, '').slice(0, 8); }
  function compactToIso(c) { return c.slice(0, 4) + '-' + c.slice(4, 6) + '-' + c.slice(6, 8); }

  function poolUrl(kind, compact) {
    return POOL_BASE + kind + 'Pool?ut=' + UT_POOL +
      '&dpt=wz.ztzt&Pageindex=0&pagesize=' + PAGE_SIZE +
      '&sort=fbt%3Aasc&date=' + compact;
  }
  function klineUrl(secid) {
    return KLINE_URL + '?secid=' + secid + '&ut=' + UT_KLINE +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57' +
      '&klt=101&fqt=1&end=20500101&lmt=8';
  }
  function indexUrl() {
    return QUOTE_URL + '?fltt=2&invt=2&ut=' + UT_QUOTE +
      '&fields=' + INDEX_FIELDS + '&secids=' + INDEX_SECIDS;
  }
  function quoteUrl(secids) {
    return QUOTE_URL + '?fltt=2&invt=2&ut=' + UT_QUOTE +
      '&fields=' + QUOTE_FIELDS + '&secids=' + secids.join(',');
  }
  /** v20261110h：全市场活跃股（按成交额降序分页），用于识别板块中军与资金面 */
  function roleUniverseUrl(pn) {
    return CLIST_URL + '?pn=' + pn + '&pz=100&po=1&np=1&fltt=2&invt=2&ut=' + UT_QUOTE +
      '&fid=f6&fs=' + encodeURIComponent(ROLE_FS) + '&fields=' + ROLE_FIELDS;
  }
  function mapRoleUniverse(j) {
    if (!j || !j.data) return [];
    var diff = j.data.diff;
    var arr = Array.isArray(diff) ? diff : (diff && typeof diff === 'object' ? Object.keys(diff).map(function (k) { return diff[k]; }) : []);
    return arr.map(function (x) {
      if (!x) return null;
      return {
        code: String(x.f12 || ''), name: x.f14 || '',
        price: finite(x.f2), changePct: finite(x.f3),
        amount: finite(x.f6), turnover: finite(x.f8), volumeRatio: finite(x.f10),
        floatMv: finite(x.f21), mainNet: finite(x.f62), industry: x.f100 || ''
      };
    }).filter(function (x) { return x && x.code; });
  }
  function poolSecids(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (x) {
      var id = (x.market === 1 ? '1.' : '0.') + x.code;
      if (/^[01]\.\d{6}$/.test(id) && !seen[id]) { seen[id] = 1; out.push(id); }
    });
    return out;
  }

  /** 单次请求：独立超时 + 全链路捕获；永不 reject，失败返回 null 并记录原因 */
  function request(url, label, errors) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    var task;
    try {
      var opts = { mode: 'cors', credentials: 'omit' };
      if (ctrl) opts.signal = ctrl.signal;
      task = fetch(url, opts).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || j.rc !== 0) throw new Error('rc=' + (j && j.rc));
        return j;
      });
    } catch (e) {
      errors.push(label + '：' + (e && e.message ? e.message : String(e)));
      return Promise.resolve(null);
    }
    if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* 忽略 */ } }, TIMEOUT_MS);
    return task.then(function (j) {
      if (timer) clearTimeout(timer);
      return j;
    }, function (e) {
      if (timer) clearTimeout(timer);
      errors.push(label + '：' + (e && e.message ? e.message : String(e)));
      return null;
    });
  }

  /** Promise.allSettled 式并发（老环境等价降级），保证任一失败不影响其它、不拖死整体 */
  function settleAll(tasks) {
    if (typeof Promise.allSettled === 'function') {
      return Promise.allSettled(tasks).then(function (rs) {
        return rs.map(function (r) { return r.status === 'fulfilled' ? r.value : null; });
      });
    }
    return Promise.all(tasks.map(function (p) {
      return p.then(function (v) { return v; }, function () { return null; });
    }));
  }

  /**
   * fuyao 请求：带 X-api-key、校验 code===0、独立 4.5s 超时、永不 reject。
   * 返回 data 部分；失败返回 null 并在 errors 记原因（不影响东财主链路）。
   */
  function requestFuyao(url, label, errors) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    var task;
    try {
      var opts = { mode: 'cors', credentials: 'omit', headers: { 'X-api-key': FUYAO_KEY } };
      if (ctrl) opts.signal = ctrl.signal;
      task = fetch(url, opts).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || j.code !== 0) throw new Error('code=' + (j && j.code) + ' ' + (j && j.message || ''));
        return j.data;
      });
    } catch (e) {
      errors.push(label + '：' + (e && e.message ? e.message : String(e)));
      return Promise.resolve(null);
    }
    if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* 忽略 */ } }, TIMEOUT_MS);
    return task.then(function (d) {
      if (timer) clearTimeout(timer);
      return d;
    }, function (e) {
      if (timer) clearTimeout(timer);
      errors.push(label + '：' + (e && e.message ? e.message : String(e)));
      return null;
    });
  }

  /** ladder item[i] 的 boards.* 记录摊平（seal_nextday 为 boolean/null） */
  function ladderRecords(item) {
    if (!item || !item.boards) return [];
    var out = [];
    Object.keys(item.boards).forEach(function (k) {
      var arr = item.boards[k];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (r) { if (r) out.push(r); });
    });
    return out;
  }

  function finite(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function poolOf(j) { return (j && j.data && Array.isArray(j.data.pool)) ? j.data : null; }
  function round(v, digits) {
    var p = Math.pow(10, digits == null ? 0 : digits);
    return Math.round(v * p) / p;
  }
  function fbtToTime(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    var s = String(Math.floor(v));
    while (s.length < 6) s = '0' + s;
    return s.slice(0, 2) + ':' + s.slice(2, 4) + ':' + s.slice(4, 6);
  }
  function fbtToHHMM(v) {
    var s = fbtToTime(v);
    return s ? s.slice(0, 5) : '';
  }

  /**
   * 东财涨停/炸板/跌停池项映射。
   * 注意：p 为价格×1000（11-09 保利联合 p=7230 ↔ 7.23 元），
   * 封单手数 = fund/(p/1000)/100 = 10*fund/p。
   */
  function mapPool(x) {
    if (!x) return null;
    var p = finite(x.p);
    var fund = finite(x.fund);
    return {
      code: String(x.c || ''),
      market: x.m,
      name: x.n || '',
      p: p,
      price: p != null ? p / 1000 : null,
      zdp: finite(x.zdp),
      amount: finite(x.amount),
      ltsz: finite(x.ltsz),                       // 流通市值（元）
      cap: finite(x.ltsz) != null ? x.ltsz / 1e8 : null, // 流通市值（亿）
      hs: finite(x.hs),
      lbc: finite(x.lbc) != null ? x.lbc : 1,
      boards: finite(x.lbc) != null ? x.lbc : 1,
      fbt: finite(x.fbt),
      firstTime: fbtToHHMM(x.fbt),
      lbt: finite(x.lbt),
      lastTime: fbtToHHMM(x.lbt),
      fund: fund,                                 // 封单额（元）
      sealLots: (fund != null && p != null && p > 0) ? 10 * fund / p : null, // 封单手数
      zbc: finite(x.zbc) != null ? x.zbc : 0,
      hybk: x.hybk || '',
      sector: x.hybk || '',
      zttj: x.zttj || null,
      zf: finite(x.zf)
    };
  }
  function mapPoolList(pool) {
    return (pool || []).map(mapPool).filter(function (x) { return !!x; });
  }
  function countSectors(list) {
    var map = {};
    list.forEach(function (x) { var k = x.hybk || x.sector || '其他'; map[k] = (map[k] || 0) + 1; });
    return Object.keys(map).map(function (k) { return { sector: k, limitCount: map[k] }; })
      .sort(function (a, b) { return b.limitCount - a.limitCount; });
  }

  /** klines: 'YYYY-MM-DD,open,close,high,low,volume,amount' → 取第 7 项 f57 为成交额 */
  function parseKlines(j) {
    if (!j || !j.data || !Array.isArray(j.data.klines)) return [];
    var out = [];
    j.data.klines.forEach(function (s) {
      var p = String(s).split(',');
      if (p.length < 7 || !/^\d{4}-\d{2}-\d{2}$/.test(p[0])) return;
      var amt = Number(p[6]);
      if (isFinite(amt)) out.push({ date: p[0], close: Number(p[2]), amount: amt });
    });
    return out;
  }

  /** 批量个股行情：一次可传 54+ 只；超长自动分片，各片独立超时。
      返回 { map: {code: quote}, samples: [f3...] }——samples 保留接口返回的每一行报价，
      用于 prem / damian 的算术平均（重复代码在接口响应里各占一行，均为真实报价）。 */
  function batchQuotes(secids, errors) {
    var chunks = [];
    for (var i = 0; i < secids.length; i += 60) chunks.push(secids.slice(i, i + 60));
    var tasks = chunks.map(function (chunk, idx) {
      return request(quoteUrl(chunk), '昨涨停股今日行情 第' + (idx + 1) + '批', errors);
    });
    return settleAll(tasks).then(function (js) {
      var out = {}, samples = [];
      js.forEach(function (j) {
        if (!j || !j.data) return;
        var diff = j.data.diff;
        var arr = Array.isArray(diff) ? diff : (diff && typeof diff === 'object' ? Object.keys(diff).map(function (k) { return diff[k]; }) : []);
        arr.forEach(function (x) {
          if (!x) return;
          var code = String(x.f12 || '');
          if (!code) return;
          var f3 = finite(x.f3);
          if (f3 != null) samples.push(f3);
          out[code] = {
            code: code, name: x.f14 || '', price: finite(x.f2), changePct: f3,
            amount: finite(x.f6), turnover: finite(x.f8), volumeRatio: finite(x.f10),
            floatMv: finite(x.f21), mainNet: finite(x.f62)
          };
        });
      });
      return { map: out, samples: samples };
    });
  }

  /** 主入口 */
  function fetchToday(dateStr) {
    var d = normDate(dateStr);
    var errors = [];
    var m = {
      date: d.compact, dateISO: d.iso, qdate: null, ok: false,
      ztCount: null, zbCount: null, dtCount: null, zbRate: null,
      upCount: null, downCount: null, flatCount: null, upRatio: null,
      amountToday: null, amountMa5: null, volChange: null,
      prem: null, promoRate: null, damian: null,
      sealRate: null, sealRateKind: null,
      indices: [], errors: errors, source: 'eastmoney',
      ztPool: [], zbPool: [], dtPool: [], quotes: {},
      history: [], ztHistory: [], maxBoards: null, lianbanCount: null,
      sectorCounts: [], prevDate: null, prevZtPool: [],
      /* fuyao 补充源（失败则保持 null，auto-fill 会回退东财/快照） */
      ladderItem1: [], ladderDate: null, promoRateSource: null, promoRateEm: null,
      hotList: [], lhbList: [], lhbDate: null,
      /* v20261110h：板块角色判定补充数据 */
      roleUniverse: [], poolQuotes: {}
    };

    /* ---- 阶段 1：当日三池 + 指数广度 + 沪深日K + fuyao 三源（9 个并发，任一失败独立隔离） ---- */
    var p1 = settleAll([
      request(poolUrl('ZT', d.compact), '涨停池 ' + d.compact, errors),
      request(poolUrl('ZB', d.compact), '炸板池 ' + d.compact, errors),
      request(poolUrl('DT', d.compact), '跌停池 ' + d.compact, errors),
      request(indexUrl(), '沪深指数广度/成交额', errors),
      request(klineUrl('1.000001'), '上证日K成交额', errors),
      request(klineUrl('0.399001'), '深证日K成交额', errors),
      requestFuyao(LADDER_URL, '连板天梯 ladder', errors),
      requestFuyao(HOT_URL, '热股榜 hot-stock-list', errors),
      requestFuyao(LHB_URL, '龙虎榜 dragon-tiger-list(T-1)', errors)
    ]);

    return p1.then(function (r1) {
      var zt = poolOf(r1[0]), zb = poolOf(r1[1]), dt = poolOf(r1[2]);
      var idxJ = r1[3];
      var klSH = parseKlines(r1[4]), klSZ = parseKlines(r1[5]);
      var ladderData = r1[6], hotData = r1[7], lhbData = r1[8];

      /* 涨停池 */
      if (zt) {
        m.qdate = zt.qdate || null;
        m.ztCount = finite(zt.tc) != null ? zt.tc : zt.pool.length;
        m.ztPool = mapPoolList(zt.pool);
        m.maxBoards = m.ztPool.length ? Math.max.apply(null, m.ztPool.map(function (x) { return x.lbc || 1; })) : null;
        m.lianbanCount = m.ztPool.filter(function (x) { return (x.lbc || 1) >= 2; }).length;
        m.sectorCounts = countSectors(m.ztPool);
      } else errors.push('涨停家数：涨停池无数据，置 null');

      /* fuyao 连板天梯：item[1] 为上一交易日连板池，seal_nextday 是否次日仍封板。
         这是晋级率的权威口径（已与东财交集逐只交叉验证），东财 lbc 会被上游修订，
         故 ladder 优先、东财交集仅作回退。 */
      if (ladderData && Array.isArray(ladderData.item) && ladderData.item.length > 1) {
        var lit = ladderData.item[1];
        var recs = ladderRecords(lit);
        m.ladderItem1 = recs;
        m.ladderDate = lit.date || null;
        var sealTrue = recs.filter(function (x) { return x.seal_nextday === true; }).length;
        var sealKnown = recs.filter(function (x) { return x.seal_nextday === true || x.seal_nextday === false; }).length;
        if (sealKnown > 0) {
          m.promoRate = round(sealTrue / sealKnown * 100, 2);   // 5/9 = 55.56
          m.promoRateSource = 'fuyao-ladder';
        } else errors.push('连板晋级率：ladder.item[1] seal_nextday 全为 null，回退东财交集口径');
      } else errors.push('连板晋级率：ladder 不可用，回退东财交集口径');

      /* 热股榜：DR_GOOD#17 市场热议焦点，取 rank <= 10 */
      if (hotData && Array.isArray(hotData.item)) {
        m.hotList = hotData.item.map(function (x) {
          return {
            code: String(x.ticker || x.thscode || '').replace(/\..*$/, ''),
            name: x.name || '', rank: finite(x.rank), heat: finite(Number(x.heat)),
            rankTrend: x.rank_trend || ''
          };
        }).filter(function (x) { return !!x.code; });
      } else errors.push('热股榜：不可用，DR_GOOD#17 将标缺数据');

      /* 龙虎榜：trade_date 为 T-1，界面必须标「上一交易日龙虎榜」 */
      if (lhbData) {
        m.lhbDate = lhbData.trade_date || null;
        var lhbItems = Array.isArray(lhbData.stock_items) ? lhbData.stock_items
          : (Array.isArray(lhbData.item) ? lhbData.item : []);
        m.lhbList = lhbItems.map(function (x) {
          var netV = finite(x.net_value), orgV = finite(x.org_net_value), hotV = finite(x.hot_money_net_value);
          return {
            code: String(x.ticker || x.thscode || '').replace(/\..*$/, ''),
            name: x.name || '',
            net: netV, org: orgV, hotMoney: hotV, hotRank: finite(x.hot_rank),
            change: finite(x.change),
            /* 保留接口原始字段名，供 auto-fill 的 firstVal 直接读取 */
            net_value: netV, org_net_value: orgV, hot_money_net_value: hotV
          };
        }).filter(function (x) { return !!x.code; });
      } else errors.push('龙虎榜：不可用，LHB 相关项将标缺数据');

      /* 炸板池（zbl 唯一来源） */
      if (zb) { m.zbCount = finite(zb.tc) != null ? zb.tc : zb.pool.length; m.zbPool = mapPoolList(zb.pool); }
      else errors.push('炸板家数：炸板池无数据，置 null');

      /* 跌停池 */
      if (dt) { m.dtCount = finite(dt.tc) != null ? dt.tc : dt.pool.length; m.dtPool = mapPoolList(dt.pool); }
      else errors.push('跌停家数：跌停池无数据，置 null');

      if (m.ztCount != null && m.zbCount != null && (m.ztCount + m.zbCount) > 0) {
        m.zbRate = round(m.zbCount / (m.ztCount + m.zbCount) * 100, 2);   // 19/112 = 16.96
        m.sealRate = round(m.ztCount / (m.ztCount + m.zbCount), 4);        // 93/112 = 0.8304
        m.sealRateKind = 'market';
      } else {
        errors.push('炸板率 / 封板率：涨停或炸板池缺失，置 null（禁止用 snapshot.stats 估算口径顶替）');
      }

      /* 指数广度：沪深两市口径，不含北交所 */
      if (idxJ && idxJ.data) {
        var diff = idxJ.data.diff;
        var arr = Array.isArray(diff) ? diff : (diff && typeof diff === 'object' ? Object.keys(diff).map(function (k) { return diff[k]; }) : []);
        var up = 0, down = 0, flat = 0, amt = 0, got = false, gotAmt = false;
        arr.forEach(function (x) {
          if (!x) return;
          m.indices.push({
            code: String(x.f12 || ''), name: x.f14 || '',
            up: finite(x.f104), down: finite(x.f105), flat: finite(x.f106), amount: finite(x.f6)
          });
          if (finite(x.f104) != null || finite(x.f105) != null) {
            up += finite(x.f104) || 0; down += finite(x.f105) || 0; flat += finite(x.f106) || 0; got = true;
          }
          if (finite(x.f6) != null) { amt += x.f6; gotAmt = true; }
        });
        if (got) {
          m.upCount = up; m.downCount = down; m.flatCount = flat;
          var tot = up + down + flat;
          m.upRatio = tot > 0 ? round(up / tot * 100, 2) : null;   // 4035/5295 = 76.2
        }
        if (gotAmt) m.amountToday = amt;                              // 673951893240 + 830863077298
      }
      if (m.upRatio == null) errors.push('上涨家数占比：沪深指数广度未取到，置 null');
      if (m.amountToday == null) errors.push('今日两市成交额：指数 f6 未取到，置 null');

      /* 5 日均量：今日之前 5 个交易日「沪 + 深」成交额均值 */
      var mapSZ = {};
      klSZ.forEach(function (x) { mapSZ[x.date] = x.amount; });
      var hist = klSH.filter(function (x) { return x.date < d.iso; }).slice(-5);
      if (hist.length) {
        var sum = 0, n = 0;
        hist.forEach(function (x) {
          var v = mapSZ[x.date];
          if (v != null) { sum += x.amount + v; n++; }
        });
        if (n) m.amountMa5 = sum / n;
      }
      if (m.amountToday != null && m.amountMa5 != null && m.amountMa5 > 0) {
        m.volChange = round((m.amountToday - m.amountMa5) / m.amountMa5 * 100, 1);   // -16.4
      } else if (m.amountToday != null) {
        errors.push('量能变化：5 日均量未取到，置 null');
      }

      /* 交易日序列：优先日K，回退自然日；取 T-1..T-5 共 5 个候选 */
      var tradeDates = klSH.map(function (x) { return x.date; })
        .filter(function (x) { return x < d.iso; }).slice(-5);
      var candidates = tradeDates.slice().reverse().map(isoToCompact);
      for (var k = 1; candidates.length < 5 && k <= 8; k++) {
        var c = shiftCompact(d.compact, -k);
        if (candidates.indexOf(c) < 0) candidates.push(c);
      }
      candidates = candidates.slice(0, 5);

      /* ---- 阶段 2：历史 5 日涨停池 + 跌停池（每日 2 个并发）
         用于 4 日行业涨停趋势、连板高度/跌停家数序列（八大拐点与主线切换判定需要）。---- */
      var p2 = settleAll(candidates.map(function (c) {
        return settleAll([
          request(poolUrl('ZT', c), '历史涨停池 ' + c, errors),
          request(poolUrl('DT', c), '历史跌停池 ' + c, errors),
          request(poolUrl('ZB', c), '历史炸板池 ' + c, errors)
        ]).then(function (rr) {
          var p = poolOf(rr[0]), dp = poolOf(rr[1]), zp = poolOf(rr[2]);
          if (!p || !p.pool || !p.pool.length) return null;
          var list = mapPoolList(p.pool);
          return {
            compact: c, date: compactToIso(c), qdate: p.qdate || null,
            ztCount: finite(p.tc) != null ? p.tc : p.pool.length,
            dtCount: dp ? (finite(dp.tc) != null ? dp.tc : (dp.pool || []).length) : null,
            zbCount: zp ? (finite(zp.tc) != null ? zp.tc : (zp.pool || []).length) : null,
            maxBoards: list.length ? Math.max.apply(null, list.map(function (x) { return x.lbc || 1; })) : null,
            lianban: list.filter(function (x) { return (x.lbc || 1) >= 2; }).length,
            pool: list, sectorCounts: countSectors(list)
          };
        });
      }));

      /* ---- 阶段 2b（v20261110h）：板块角色补充源，与历史池并发，互不阻塞 ----
         ① 全市场成交额前 400 只（4 页）：给「中军」提供真实大市值趋势票与 f62 主力净额；
         ② 当日涨停池批量行情：给「龙头 / 补涨」提供主力净额、量比、换手等资金面字段。 */
      var p3 = settleAll(
        [1, 2, 3, 4].map(function (pn) {
          return request(roleUniverseUrl(pn), '活跃股池 第' + pn + '页', errors);
        }).concat([batchQuotes(poolSecids(m.ztPool), errors)])
      );

      return Promise.all([p2, p3]).then(function (rs) {
        var histories = rs[0] || [], extras = rs[1] || [];
        var uni = [];
        extras.slice(0, ROLE_PAGES).forEach(function (j) { uni = uni.concat(mapRoleUniverse(j)); });
        var seenRole = {};
        m.roleUniverse = uni.filter(function (x) { if (seenRole[x.code]) return false; seenRole[x.code] = 1; return true; });
        if (!m.roleUniverse.length) errors.push('活跃股池：4 页均无数据，中军判定降级为涨停池代理');
        var pq = extras[ROLE_PAGES];
        m.poolQuotes = (pq && pq.map) ? pq.map : {};
        m.history = histories.filter(function (x) { return !!x; });
        m.ztHistory = m.history.map(function (x) { return { date: x.date, compact: x.compact, tc: x.ztCount }; });
        if (m.history.length) {
          m.prevDate = m.history[0].date;
          m.prevZtPool = m.history[0].pool;
        } else {
          errors.push('昨日涨停池：5 个候选交易日均无数据，prem / promoRate / damian 置 null');
        }

        /* 昨日涨停池代码 → 今日批量行情（阶段 3） */
        var secids = [];
        if (m.prevZtPool.length) {
          var seen = {};
          m.prevZtPool.forEach(function (x) {
            var id = (x.market === 1 ? '1.' : '0.') + x.code;
            if (/^[01]\.\d{6}$/.test(id) && !seen[id]) { seen[id] = 1; secids.push(id); }
          });
        }
        if (!secids.length) return m;
        return batchQuotes(secids, errors).then(function (batch) {
          m.quotes = batch.map;

          /* prem = 昨日涨停池各股今日 f3 均值（按代码去重、剔除无报价）。
             上游会修订历史池（本次 11-09 出现 2 个重复代码 → 52 个唯一代码），
             samples 取接口实际返回的每一行报价，保证与批量行情逐行一致。 */
          var arr = batch.samples;
          if (arr.length) {
            m.prem = round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length, 2); // ≈4.9
            m.damian = arr.filter(function (v) { return v <= -9; }).length;                   // 0
          } else errors.push('昨日涨停今日溢价 / 大面股：批量行情无有效涨跌幅，置 null');

          /* promoRate 回退口径：|昨 lbc>=2 ∩ 今涨停池| / |昨 lbc>=2| × 100。
             ladder 已给出权威值时只记录为 promoRateEm，不覆盖（东财 lbc 会被上游修订）。 */
          var todaySet = {};
          m.ztPool.forEach(function (x) { todaySet[x.code] = x.lbc || 1; });
          var cand = m.prevZtPool.filter(function (x) { return (x.lbc || 1) >= 2; });
          if (cand.length) {
            var promoted = cand.filter(function (x) { return todaySet[x.code] != null; }).length;
            m.promoRateEm = round(promoted / cand.length * 100, 2);
            if (m.promoRate == null) {
              m.promoRate = m.promoRateEm;
              m.promoRateSource = 'eastmoney-intersection';
            }
          } else if (m.promoRate == null) {
            errors.push('连板晋级率：ladder 与东财交集均不可用，置 null');
          }
          return m;
        });
      });
    }).then(function (market) {
      market = market || m;
      market.ok = (market.ztCount != null || market.upCount != null || market.amountToday != null);
      if (!market.ok) market.errors.push('全部核心行情均未取到，market.ok=false');
      lastResult = market;
      return market;
    }, function (e) {
      errors.push('未知异常：' + (e && e.message ? e.message : String(e)));
      m.ok = false;
      lastResult = m;
      return m;   // 始终 resolve 对象，绝不返回 null
    });
  }

  function get() { return lastResult; }

  global.YGMarketToday = { fetchToday: fetchToday, get: get };
})(typeof window !== 'undefined' ? window : this);
