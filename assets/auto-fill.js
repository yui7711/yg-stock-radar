/* =========================================================================
 * auto-fill.js — 判定工具箱自动填值 / 龙头自动判定
 * -------------------------------------------------------------------------
 * 对外接口：
 *   window.YGAutoFill.build(snapshot)        -> 5 个工具全部字段自动值 + evidence
 *   window.YGAutoFill.dragon(snapshot, code) -> 龙头 17/12 项自动判定（code 可选）
 *
 * 数据来源优先级：snapshot.market（当日收盘实时行情，market-today.js 产出）
 *                > snapshot（本站单日收盘快照 / 归一化后的 state.data）
 * 标注三档（严格按规格）：
 *   真值  「来自今日收盘行情 YYYYMMDD · 依据：…」   kind=auto
 *   推导  「推导值：公式…」                          kind=derive
 *   代理  「代理口径：…」                            kind=degrade
 *   缺数据「缺数据（未计入结论）：…」                kind=miss
 * 回退快照一律写「来自收盘快照 YYYYMMDD」并标 degrade，绝不把两个日期的数字混读。
 *
 * 【口径禁用清单 / 三套来源同名不同义】
 *   overview.zhaban / overview.sealRate / snapshot.stats.open_stock_count /
 *   snapshot.stats.seal_rate 一律不用于炸板率 zbl、封板率 sealRate：
 *     静态快照 9 / 0.83（池内开板≥3次估算）、实时 19 / 0.551、demo 32 / 0.66。
 *   zbl 唯一来源 = ZBPool.tc / (ZTPool.tc + ZBPool.tc) * 100 → 16.96。
 *   真实封板率 = ZT.tc / (ZT.tc + ZB.tc) → 0.8304，标 kind='market'。
 *
 * 今日(20261110)实测基准：
 *   prem 4.91 | zt 93 | high 7 | lb 20 | zbl 16.96 | jjl 55.56
 *   damian 0 | upr 76.2 | vol -16.4 | dir up
 * ========================================================================= */
(function (global) {
  'use strict';

  function num(v, dflt) {
    if (v == null || v === '') return (dflt == null) ? null : dflt;
    var n = Number(v);
    return isFinite(n) ? n : ((dflt == null) ? null : dflt);
  }
  function pick() {
    for (var i = 0; i < arguments.length; i++) if (arguments[i] != null && arguments[i] !== '') return arguments[i];
    return null;
  }
  function round(v, digits) {
    var p = Math.pow(10, digits == null ? 0 : digits);
    return Math.round(v * p) / p;
  }
  function fmt(v) {
    if (v == null || v === '') return '—';
    return typeof v === 'number' ? String(round(v, 2)) : String(v);
  }
  function compact(s) { return String(s || '').replace(/-/g, '').slice(0, 8); }
  function normTime(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { var s = String(Math.floor(v)); while (s.length < 6) s = '0' + s; return s.slice(0, 2) + ':' + s.slice(2, 4); }
    var t = String(v);
    if (/^\d{1,2}:\d{2}$/.test(t)) return t.length === 4 ? '0' + t : t;
    if (/^\d{5,6}$/.test(t)) { var s2 = ('000000' + t).slice(-6); return s2.slice(0, 2) + ':' + s2.slice(2, 4); }
    return t.slice(0, 5);
  }
  function firstVal(o) {
    for (var i = 1; i < arguments.length; i++) { var v = o[arguments[i]]; if (v != null && v !== '') return v; }
    return null;
  }
  function normStock(o) {
    if (!o || typeof o !== 'object') return null;
    var cx = firstVal(o, 'concepts', 'cx', 'tags');
    if (!Array.isArray(cx)) cx = cx ? [String(cx)] : [];
    return {
      code: String(firstVal(o, 'code', 'c') || ''),
      name: String(firstVal(o, 'name', 'n') || ''),
      price: num(firstVal(o, 'price', 'p')),
      changePct: num(firstVal(o, 'changePct', 'pct', 'zdp')),
      boards: num(firstVal(o, 'boards', 'b', 'lbc'), 1),
      seal: num(firstVal(o, 'seal', 'maxSeal')),
      cap: num(firstVal(o, 'cap', 'floatMv')),
      turnover: num(firstVal(o, 'turnover', 'to', 'hs')),
      volumeRatio: num(firstVal(o, 'volumeRatio', 'vr')),
      netIn: num(firstVal(o, 'netIn', 'mainNetIn', 'mf')),
      limitType: num(firstVal(o, 'limitType', 'lt')),
      firstTime: normTime(firstVal(o, 'firstTime', 'first', 'fbt')),
      openTimes: num(firstVal(o, 'openTimes', 'open', 'zbc'), 0),
      sm: num(firstVal(o, 'sm')), decay: num(firstVal(o, 'decay')),
      sector: String(firstVal(o, 'sector', 'sec', 'hybk') || ''),
      concepts: cx.map(String), probability: num(firstVal(o, 'probability')),
      scores: o.scores || null, meta: o.meta || {},
      /* 东财池专属（仅 market 路径有值） */
      p: num(firstVal(o, 'p')), fund: num(firstVal(o, 'fund')),
      sealLots: num(firstVal(o, 'sealLots')),
      fbt: num(firstVal(o, 'fbt')), lbt: num(firstVal(o, 'lbt')),
      lastTime: normTime(firstVal(o, 'lastTime')),
      ltsz: num(firstVal(o, 'ltsz')), amount: num(firstVal(o, 'amount')),
      zttj: o.zttj || null, zf: num(firstVal(o, 'zf')),
      fromMarket: !!o.fromMarket
    };
  }
  /** 东财涨停池项 → 统一字段（当日实时优先） */
  function marketStock(x) {
    if (!x) return null;
    return {
      code: x.code || '', name: x.name || '',
      price: x.price != null ? x.price : (x.p != null ? x.p / 1000 : null),
      // 东财池标准字段是 lbc；部分降级/缓存池只带 boards，二者都兼容。
      changePct: num(x.zdp), boards: num(x.lbc, num(x.boards, 1)),
      seal: x.fund != null ? x.fund / 10000 : null,   // 封单额元 → 万元
      cap: x.cap, turnover: num(x.hs),
      volumeRatio: null, netIn: null, limitType: null,
      firstTime: x.firstTime || '', openTimes: num(x.zbc, 0),
      sm: null, decay: null, sector: x.hybk || x.sector || '',
      concepts: x.hybk ? [x.hybk] : [], probability: null,
      scores: null, meta: {}, p: num(x.p), fund: num(x.fund),
      sealLots: num(x.sealLots), fbt: num(x.fbt), lbt: num(x.lbt),
      lastTime: x.lastTime || '', ltsz: num(x.ltsz), amount: num(x.amount),
      zttj: x.zttj || null, zf: num(x.zf), fromMarket: true
    };
  }

  var GOOD_NAMES = [
    '身位最高（板块/市场最高板）', '板块内上板最早', '封单最大', '能带动板块（跟风涨停≥3家）',
    '题材纯正（非蹭概念）', '已达 3 板以上（通过成龙点）', '换手率 15%–35% 健康区间',
    '分时强势（不破均价线）', '逻辑可延展（有持续催化）', '有中军配合',
    '有梯队支撑（下方有补位）', '龙虎榜健康（游资接力、无一家独大）',
    '流通盘适中（30–150亿）', '有辨识度标签', '经历过分歧并成功转一致',
    '非庄股特征（分时自然）', '市场热议焦点（人气高）'
  ];
  var BAD_NAMES = [
    '天量烂板（>3倍量、反复开板）', '高位爆量不封（长上影大阴）', '缩量加速后突然放量',
    '首次跌破 5 日线', '龙虎榜拉萨军团接盘 / 主力净卖', '板块内补涨股不再跟进',
    '同身位出现卡位者', '中位股批量跌停', '中军大阴破位',
    '尾盘勉强封板（封单<1万手）', '出现天地板', '竞价高开后直线下杀'
  ];

  /* ---------------------------------------------------------------------
   * metrics：共享行情量（只用 market 真值，禁用快照聚合口径）
   * ------------------------------------------------------------------- */
  function metrics(snapshot) {
    var snap = (snapshot && typeof snapshot === 'object') ? snapshot : {};
    var m = (snap.market && typeof snap.market === 'object') ? snap.market : null;
    var ov = (snap.overview && typeof snap.overview === 'object') ? snap.overview : {};
    var st = (snap.stats && typeof snap.stats === 'object') ? snap.stats : {};
    var stocks = (m && Array.isArray(m.ztPool) && m.ztPool.length)
      ? m.ztPool.map(marketStock).filter(Boolean)
      : (Array.isArray(snap.stocks) ? snap.stocks.map(normStock).filter(Boolean) : []);
    var sectors = (m && Array.isArray(m.sectorCounts) && m.sectorCounts.length)
      ? m.sectorCounts : (Array.isArray(snap.sectors) ? snap.sectors : []);
    var ladder = Array.isArray(snap.ladder) ? snap.ladder : [];
    /* 龙虎榜：优先 fuyao 实时 T-1 榜单（market.lhbList），回退快照 lhb。
       market.lhbDate 是榜单真实交易日，界面一律标「上一交易日龙虎榜(T-1)」。 */
    var lhb = (m && Array.isArray(m.lhbList) && m.lhbList.length)
      ? m.lhbList : (Array.isArray(snap.lhb) ? snap.lhb : []);
    var lhbDate = (m && m.lhbDate) || SD || '';
    var hot = (m && Array.isArray(m.hotList) && m.hotList.length)
      ? m.hotList : (Array.isArray(snap.hot) ? snap.hot : []);
    var top = Array.isArray(snap.top) ? snap.top : [];
    var ladderItem1 = (m && Array.isArray(m.ladderItem1)) ? m.ladderItem1 : [];
    var promoSource = (m && m.promoRateSource) || null;
    var promoEm = num(m && m.promoRateEm);
    var zbPool = (m && Array.isArray(m.zbPool)) ? m.zbPool : [];
    var dtPool = (m && Array.isArray(m.dtPool)) ? m.dtPool : [];
    var quotes = (m && m.quotes && typeof m.quotes === 'object') ? m.quotes : {};
    var history = (m && Array.isArray(m.history)) ? m.history : [];
    var ztHistory = (m && Array.isArray(m.ztHistory)) ? m.ztHistory : [];

    var QD = compact(m && m.date) || '';                 // 20261110（标注前缀用紧凑格式）
    var QDISO = String((m && m.dateISO) || (m && m.date) || '');  // 2026-11-10（evidence 展示用 ISO）
    var SD = compact(ov.date || snap.date) || '';        // 20261109
    var SDISO = String(ov.date || snap.date || '');      // 2026-11-09
    var date = QD || SD;

    function truth(why) { return '来自今日收盘行情 ' + (QDISO || QD || '（日期未知）') + ' · 依据：' + why + '（数据日期 ' + (QDISO || '未知') + '）'; }
    function derive(why) { return '推导值：' + why + '（数据日期 ' + (QDISO || SDISO || '未知') + '）'; }
    function proxy(why) { return '代理口径：' + why; }
    function snapTruth(why) { return '来自收盘快照 ' + (SD || '（日期未知）') + ' · 依据：' + why + '（数据日期 ' + (SDISO || '未知') + '）'; }
    function missing(why) { return '缺数据（未计入结论）：' + why; }

    var maxBoardsSnap = stocks.length ? Math.max.apply(null, stocks.map(function (s) { return s.boards || 1; })) : null;
    var lianbanSnap = stocks.filter(function (s) { return (s.boards || 1) >= 2; }).length;

    /* 9 项真值/推导值 —— 绝不从 overview.zhaban / stats.open_stock_count 取 */
    var zt = num(pick(m && m.ztCount, (QD ? null : ov.limitUp), (QD ? null : (stocks.length ? stocks.length : null))));
    var high = num(pick(m && m.maxBoards, (QD ? null : ov.maxBoards), (QD ? null : maxBoardsSnap)));
    var lb = num(pick(m && m.lianbanCount, (QD ? null : ov.lianban), (QD ? null : lianbanSnap)));
    var zb = num(m && m.zbCount);          // 仅 market 实测；禁用清单字段不进入
    var dt = num(m && m.dtCount);          // 仅 market 实测；0 是实测值不是降级缺省
    var zbl = num(m && m.zbRate);          // 16.96，唯一来源
    var sealRate = num(m && m.sealRate);   // 0.8304，真实封板率
    var sealRateKind = (m && m.sealRateKind) || (sealRate != null ? 'market' : null);
    var sealRateWhy = sealRate != null
      ? derive('真实封板率 = ZT.tc ' + fmt(m && m.ztCount) + ' / (ZT.tc + ZB.tc ' + fmt(zb) + ') = ' + fmt(sealRate))
      : null;
    if (sealRate == null) {
      // 仅当日行情完全缺失才回退快照估算口径，并显式标 estimate
      sealRate = num(pick(st.seal_rate, ov.sealRate));
      sealRateKind = sealRate != null ? 'estimate' : null;
      sealRateWhy = sealRate != null
        ? proxy('估算口径，仅供参考；来自收盘快照 ' + (SDISO || '日期未知') +
          ' 的 stats.seal_rate=' + fmt(sealRate) + '（池内未开板≥3次比例），非真实封板率、非当日')
        : missing('无当日行情亦无快照估算值');
    }

    /* prem：昨涨停今溢价；缺失时用真实封板率换算，estimate 口径要显式标注 */
    var prem = num(m && m.prem);
    var premWhy = prem != null
      ? truth('上一交易日(' + (m && m.prevDate ? m.prevDate : 'T-1') + ')涨停池代码去重后今日批量行情 f3 算术平均，有效样本 ' +
        Object.keys(quotes).length + ' 只 → ' + fmt(prem) + '%')
      : null;
    var premKind = prem != null ? 'derive' : null;
    if (prem == null && sealRate != null) {
      prem = round((sealRate - 0.5) * 10, 2);
      premKind = 'degrade';
      premWhy = proxy('本项原口径为「昨日涨停股今日平均涨跌幅」，当前用封板率 ' + fmt(sealRate) +
        ' 换算的赚钱效应 (sealRate−0.5)×10 代理' +
        (sealRateKind === 'estimate' ? '；且封板率为快照估算口径（' + SDISO + '，非当日），仅供参考' : ''));
    }
    if (prem == null) { prem = 0; premKind = 'miss'; premWhy = missing('无上一交易日行情、亦无封板率，本项按 0 计入'); }

    /* promoRate：连板晋级率（ladder.item[1] seal_nextday 为权威口径，东财交集仅回退） */
    var promo = num(m && m.promoRate);
    var promoWhy;
    if (promo != null && promoSource === 'fuyao-ladder') {
      promoWhy = derive('连板晋级率 = 连板天梯 ladder.item[1]（' + (m && m.ladderDate ? m.ladderDate : '上一交易日') +
        ' 连板池）中 seal_nextday===true 记录数 / 有明确 boolean 的记录总数 × 100 = ' + fmt(promo) +
        '%（权威口径；东财交集回退值 ' + fmt(promoEm) + '% 因上游 lbc 修订未采用）');
    } else if (promo != null) {
      promoWhy = derive('连板晋级率 = |昨(T-1)涨停池 lbc≥2 ∩ 今涨停池| / |昨 lbc≥2| × 100 = ' + fmt(promo) +
        '%（东财交集回退口径，ladder 不可用）');
    } else promoWhy = null;
    var promoKind = promo != null ? 'derive' : null;
    if (promo == null && zt) {
      promo = round(lb / zt * 100, 2);
      promoKind = 'degrade';
      promoWhy = proxy('原口径为「昨连板今晋级比例」，当前用「当日连板家数 ' + fmt(lb) + ' ÷ 涨停家数 ' + fmt(zt) + '」代理');
    }
    if (promo == null) { promo = 0; promoKind = 'miss'; promoWhy = missing('无连板梯队数据，本项按 0 计入'); }

    /* damian：大面股 */
    var damian = num(m && m.damian);
    var damianWhy = damian != null
      ? derive('大面股 = 上一交易日涨停池代码今日 f3 ≤ −9% 的家数 = ' + fmt(damian))
      : null;
    var damianKind = damian != null ? 'derive' : null;
    if (damian == null && dt != null) {
      damian = dt; damianKind = 'degrade';
      damianWhy = proxy('原口径为「昨涨停今跌超 9% 家数」，当前用「当日跌停池 tc=' + fmt(dt) + '」代理');
    }
    if (damian == null) { damian = 0; damianKind = 'miss'; damianWhy = missing('无上一交易日溢价分布、亦无跌停池，本项按 0 计入'); }

    /* upr：上涨家数占比（沪深两市口径，不含北交所） */
    var upr = num(m && m.upRatio);
    var uprWhy = upr != null
      ? derive('上涨家数占比 = Σf104 / (Σf104+Σf105+Σf106) × 100 = ' +
        fmt(m && m.upCount) + '/' + fmt((m && m.upCount || 0) + (m && m.downCount || 0) + (m && m.flatCount || 0)) +
        ' = ' + fmt(upr) + '%；沪深两市口径，不含北交所')
      : null;
    var uprKind = upr != null ? 'derive' : null;
    if (upr == null && zt != null) {
      var den = zt + (zb || 0) + (dt || 0);
      upr = den > 0 ? round(zt / den * 100, 2) : 0;
      uprKind = 'degrade';
      uprWhy = proxy('原口径为「沪深两市上涨家数占比」，当前用「涨停 ' + fmt(zt) + ' ÷ (涨停+炸板+跌停=' + fmt(den) + ')」市场宽度代理；快照 ' + (SD || '日期未知'));
    }
    if (upr == null) { upr = 0; uprKind = 'miss'; uprWhy = missing('无市场广度数据，本项按 0 计入'); }

    /* vol：量能变化（沪深两市口径） */
    var vol = num(m && m.volChange);
    var volWhy = vol != null
      ? derive('量能变化 = (今日两市 f6 合计 ' + fmt(m && m.amountToday) + ' − 前 5 交易日两市 f57 均值 ' +
        fmt(m && m.amountMa5) + ') / 均值 × 100 = ' + fmt(vol) + '%；沪深两市口径，不含北交所')
      : null;
    var volKind = vol != null ? 'derive' : null;
    var vrList = stocks.map(function (s) { return s.volumeRatio; }).filter(function (v) { return v != null; });
    var avgVr = vrList.length ? vrList.reduce(function (a, b) { return a + b; }, 0) / vrList.length : null;
    if (vol == null && avgVr != null) {
      vol = round((avgVr - 1) * 20, 2); volKind = 'degrade';
      volWhy = proxy('原口径为「两市成交额相对 5 日均量变化」，当前用涨停股平均量比 ' + fmt(avgVr) + ' 换算 (avgVr−1)×20 代理');
    }
    if (vol == null) { vol = 0; volKind = 'miss'; volWhy = missing('无成交额序列、亦无量比，本项按 0 计入'); }

    /* zbl：炸板率（唯一来源；回退必须标 degrade「估算口径，仅供参考」） */
    var zblWhy, zblKind;
    if (zbl != null) {
      zblKind = 'derive';
      zblWhy = derive('炸板率 = ZBPool.tc ' + fmt(zb) + ' / (ZTPool.tc ' + fmt(zt) + ' + ZBPool.tc ' + fmt(zb) + ') × 100 = ' +
        fmt(zbl) + '%（唯一来源，未使用 overview.zhaban / stats.open_stock_count 估算口径）');
    } else {
      var openEst = num(st.open_stock_count);
      var zhabanEst = num(ov.zhaban);
      if (zt != null && openEst != null && (zt + openEst) > 0) {
        zbl = round(openEst / (zt + openEst) * 100, 2);
        zbl = (zhabanEst != null && (zt + zhabanEst) > 0) ? round(zhabanEst / (zt + zhabanEst) * 100, 2) : zbl;
        zblKind = 'degrade';
        zblWhy = proxy('当日行情不可用，仅用收盘快照 ' + (SDISO || '日期未知') + ' 的 open_stock_count/overview.zhaban 估算口径，仅供参考；' +
          '该值是「涨停池内开板≥3次个股数」而非独立炸板家数，不可与实时值比较，非当日数据');
      } else { zbl = 0; zblKind = 'miss'; zblWhy = missing('无炸板池、亦无快照估算值，本项按 0 计入'); }
    }

    /* dir：ΔT3 口径降级 —— 用涨停家数 3 日方向代理 */
    var dir = 'flat', dirWhy, dirKind = 'degrade';
    var h = ztHistory.filter(function (x) { return num(x.tc) != null; }).slice(0, 3);
    if (zt != null && h.length >= 2) {
      var mean = h.reduce(function (a, x) { return a + num(x.tc); }, 0) / h.length;
      var delta = mean > 0 ? (zt - mean) / mean * 100 : 0;
      dir = delta > 10 ? 'up' : (delta < -10 ? 'down' : 'flat');
      dirWhy = proxy('ΔT3口径降级：以涨停家数 3 日方向代理。Δ = (今日 ' + fmt(zt) +
        ' − mean(T-1,T-2,T-3 涨停数 ' + h.map(function (x) { return x.tc; }).join('/') + ')=' + fmt(mean) +
        ') / mean × 100 = ' + fmt(delta) + '%；Δ>+10%→上升、<−10%→下降、其余走平');
    } else if (sealRate != null) {
      dir = (sealRate >= 0.75 && (zbl == null || zbl <= 25)) ? 'up'
        : ((sealRate < 0.6) || (zbl != null && zbl > 40)) ? 'down' : 'flat';
      dirWhy = proxy('ΔT3口径降级：无 3 日涨停序列，改用封板率 ' + fmt(sealRate) +
        ' + 炸板率 ' + fmt(zbl) + '% 代理判定（' +
        (sealRateKind === 'estimate' ? '封板率为快照估算口径，仅供参考' : '封板率为当日实测') + '）');
    } else { dirKind = 'miss'; dirWhy = missing('无 3 日涨停序列、亦无封板率，按「走平」计入'); }

    /* 板块 B 与梯队 */
    var maxSector = sectors.length ? sectors.slice().sort(function (a, b) {
      return (num(b.limitCount, 0) || 0) - (num(a.limitCount, 0) || 0);
    })[0] : null;
    var maxSectorCount = num(maxSector && maxSector.limitCount);
    var maxSectorName = (maxSector && maxSector.sector) || '';
    var maxSectorHeat = num(maxSector && maxSector.heat);
    var eb = Array.isArray(st.exact_boards) ? st.exact_boards : [];
    var boardLevels = eb.map(function (x) { return num(x.board_num != null ? x.board_num : x.boards); })
      .filter(function (v) { return v != null && v >= 2; });
    if (!boardLevels.length && ladder.length) boardLevels = ladder.map(function (l) { return num(l.boards); }).filter(function (v) { return v != null; });

    return {
      snap: snap, m: m, ov: ov, st: st, stocks: stocks, sectors: sectors, ladder: ladder,
      lhb: lhb, lhbDate: lhbDate, hot: hot, top: top, quotes: quotes, history: history, ztHistory: ztHistory,
      ladderItem1: ladderItem1, promoSource: promoSource, promoEm: promoEm,
      zbPool: zbPool, dtPool: dtPool, QD: QD, QDISO: QDISO, SD: SD, SDISO: SDISO, date: date,
      truth: truth, derive: derive, proxy: proxy, snapTruth: snapTruth, missing: missing,
      zt: zt, high: high, lb: lb, zb: zb, dt: dt, zbl: zbl, zblWhy: zblWhy, zblKind: zblKind,
      sealRate: sealRate, sealRateKind: sealRateKind, sealRateWhy: sealRateWhy,
      prem: prem, premWhy: premWhy, premKind: premKind,
      promo: promo, promoWhy: promoWhy, promoKind: promoKind,
      damian: damian, damianWhy: damianWhy, damianKind: damianKind,
      upr: upr, uprWhy: uprWhy, uprKind: uprKind,
      vol: vol, volWhy: volWhy, volKind: volKind,
      dir: dir, dirWhy: dirWhy, dirKind: dirKind,
      maxBoardsSnap: maxBoardsSnap, lianbanSnap: lianbanSnap, avgVr: avgVr,
      maxSectorCount: maxSectorCount, maxSectorName: maxSectorName, maxSectorHeat: maxSectorHeat,
      boardLevels: boardLevels
    };
  }

  function kindFromWhy(why) {
    if (why == null) return 'miss';
    if (why.indexOf('来自今日收盘行情') === 0) return 'auto';
    if (why.indexOf('来自收盘快照') === 0) return 'degrade';
    if (why.indexOf('推导值') === 0) return 'derive';
    if (why.indexOf('代理口径') === 0) return 'degrade';
    if (why.indexOf('缺数据') === 0) return 'miss';
    return 'degrade';
  }

  /* ---------------------------------------------------------------------
   * build：5 个工具全部字段自动值 + 每项取数依据
   * ------------------------------------------------------------------- */
  function build(snapshot) {
    var M = metrics(snapshot);
    var values = {}, evidence = {}, kinds = {}, annos = {};
    function set(key, value, why, kind) {
      values[key] = String(value);
      evidence[key] = why || '';
      kinds[key] = kind || kindFromWhy(why);
      var k = kinds[key];
      annos[key] = k === 'auto' ? ('来自今日收盘行情 ' + (M.QDISO || M.QD || ''))
        : k === 'derive' ? '推导值'
          : k === 'degrade' ? (M.QD ? '代理口径' : ('收盘快照 ' + (M.SDISO || '')))
            : '缺数据（未计入结论）';
    }

    /* ---------- 情绪温度计 9 项 + 方向 ---------- */
    set('thermo.prem', M.prem, M.premWhy, M.premKind);
    set('thermo.zt', M.zt == null ? 0 : M.zt,
      M.m && M.m.ztCount != null ? M.truth('东财涨停池 getTopicZTPool date=' + M.QD + ' 的 data.tc = ' + fmt(M.zt))
        : M.snapTruth('snapshot.overview.limitUp（回退 stocks.length），数据日期 ' + (M.SDISO || '未知')),
      (M.zt == null ? 'miss' : (M.m && M.m.ztCount != null ? 'auto' : 'degrade')));
    set('thermo.high', M.high == null ? 0 : M.high,
      M.m && M.m.maxBoards != null ? M.truth('东财涨停池 pool[].lbc 最大值 = ' + fmt(M.high))
        : M.snapTruth('snapshot.overview.maxBoards / stocks[].boards 最大值，数据日期 ' + (M.SDISO || '未知')),
      (M.high == null ? 'miss' : (M.m && M.m.maxBoards != null ? 'auto' : 'degrade')));
    set('thermo.lb', M.lb == null ? 0 : M.lb,
      M.m && M.m.lianbanCount != null ? M.truth('东财涨停池 pool[] 中 lbc≥2 的家数 = ' + fmt(M.lb))
        : M.snapTruth('snapshot.overview.lianban / stats.exact_boards，数据日期 ' + (M.SDISO || '未知')),
      (M.lb == null ? 'miss' : (M.m && M.m.lianbanCount != null ? 'auto' : 'degrade')));
    set('thermo.zbl', M.zbl, M.zblWhy, M.zblKind);
    set('thermo.jjl', M.promo, M.promoWhy, M.promoKind);
    set('thermo.damian', M.damian, M.damianWhy, M.damianKind);
    set('thermo.upr', M.upr, M.uprWhy, M.uprKind);
    set('thermo.vol', M.vol, M.volWhy, M.volKind);
    set('thermo.dir', M.dir, M.dirWhy, M.dirKind);

    /* ---------- 主线强度 6 项 ---------- */
    var B = M.maxSectorName;
    var bPool = M.stocks.filter(function (s) { return s.sector === B; });
    /* days：逐日东财涨停池统计 B 连续有涨停天数 */
    var consecutive = 0;
    var series = M.history.slice();                       // T-1..T-5
    var todayHas = (M.maxSectorCount || 0) > 0;
    if (todayHas) consecutive = 1;
    for (var ci = 0; ci < series.length; ci++) {
      var sc = (series[ci].sectorCounts || []).filter(function (x) { return x.sector === B; })[0];
      if (sc && num(sc.limitCount, 0) > 0) consecutive++; else break;
    }
    var daysVal = consecutive >= 5 ? 25 : consecutive >= 3 ? 18 : consecutive === 2 ? 10 : 3;
    set('mainline.days', daysVal,
      M.derive('板块 B=' + (B || '—') + ' 连续有涨停天数 d = ' + consecutive +
        '（逐日取东财涨停池 date=T,T-1.. 按 hybk 分组计数）；d≥5→选1(25分) / 3–4→选2(18) / 2→选3(10) / 1→选4(3)'));
    var ratio = (M.maxSectorCount != null && M.zt) ? round(M.maxSectorCount / M.zt * 100, 2) : 0;
    set('mainline.ratio', ratio,
      M.derive('板块涨停占比 = count(今日 ZT.pool.hybk==B) ' + fmt(M.maxSectorCount) +
        ' / ZT.tc ' + fmt(M.zt) + ' × 100 = ' + fmt(ratio) + '%'),
      M.maxSectorCount == null ? 'miss' : 'derive');
    var bLbc = bPool.map(function (s) { return s.boards || 1; });
    var has5 = bLbc.some(function (v) { return v >= 5; });
    var has234 = bLbc.some(function (v) { return v === 2 || v === 3 || v === 4; });
    var has1 = bLbc.some(function (v) { return v === 1; });
    var echelonVal = (has5 && has234 && has1) ? 20 : ((bLbc.some(function (v) { return v === 1 || v === 2; }) && !has5) ? 12 : 4);
    set('mainline.echelon', echelonVal,
      M.derive('板块 B 内 lbc 分布=' + (bLbc.length ? bLbc.slice(0, 12).join('/') : '—') +
        '；有≥5板且有2/3/4板且有1板→选1(20)；有1/2板但无≥5板→选2(12)；仅 lbc=1→选3(4)'),
      bLbc.length ? 'derive' : 'miss');
    var midPool = bPool.filter(function (s) { return s.ltsz != null && s.ltsz >= 100 * 1e8; })
      .sort(function (a, b) { return (b.ltsz || 0) - (a.ltsz || 0); });
    var zjVal, zjWhy;
    if (!midPool.length) { zjVal = 0; zjWhy = M.derive('板块 B 内无 ltsz≥100亿 的中军 → 选3(0分)'); }
    else {
      var zq = M.quotes[midPool[0].code] || {};
      var zf3 = num(zq.changePct);
      zjVal = (zf3 != null && zf3 > 0) ? 15 : ((zf3 != null && zf3 >= 0) ? 7 : 0);
      zjWhy = M.proxy('中军=B 内 ltsz 最大者 ' + midPool[0].name + '（' + fmt(round(midPool[0].ltsz / 1e8, 1)) +
        '亿），需查个股 5 日均额；当前用今日 f3=' + fmt(zf3) + '% + 量比代理：f3>0→选1(15)、f3≥0→选2(7)、f3<0→选3(0)');
    }
    set('mainline.zj', zjVal, zjWhy);
    var catVal, catWhy;
    var kw = (B || '');
    if (/政策|国家级|规划|重磅|产业革命/.test(kw)) catVal = 10;
    else if (/行业|会议|涨价|事件|电力|金属|光伏|算力|机器人|半导体/.test(kw)) catVal = 6;
    else catVal = 2;
    catWhy = M.proxy('语义代理：原口径为板块 B 的 limit_up_reason 关键词（政策/国家级/规划/重磅/产业革命→选1；行业/会议/涨价/事件→选2；其余→选3）。' +
      '东财池不含 limit_up_reason，当前用行业名「' + (kw || '—') + '」关键词匹配');
    set('mainline.cat', catVal, catWhy, 'degrade');
    var yesterdayB = 0;
    if (M.history.length) {
      var ysc = (M.history[0].sectorCounts || []).filter(function (x) { return x.sector === B; })[0];
      yesterdayB = ysc ? num(ysc.limitCount, 0) : 0;
    }
    var jjlB = M.promo;
    set('mainline.jjl', jjlB,
      M.proxy('原口径为 ladder.item[1] 中 ticker∈B 昨日名单 seal_nextday===true 比例×100；' +
        '当前用全市场晋级率 ' + fmt(M.promo) + '% 代理（昨 B 涨停 ' + fmt(yesterdayB) + ' 家、今 B 涨停 ' + fmt(M.maxSectorCount) + ' 家）'),
      'degrade');

    /* ---------- 分歧性质 12 项 ---------- */
    var D = pickTargetForMetrics(M);
    var dv = [];
    function dvPush(idx, why, kind) {
      var i = dv.length;
      dv.push(idx);
      set('diverge.' + i, [1, 0, -1][idx], why, kind);
    }
    var lbc = num(D && D.boards, 1);
    var zbc = num(D && D.openTimes, 0);
    var zdp = num(D && D.changePct);
    var fbt = D ? D.fbt : null;
    var lbt = D ? D.lbt : null;
    var inZb = !!(D && M.zbPool.some(function (x) { return x.code === D.code; }));
    var lbtHH = (lbt != null) ? normTime(lbt) : '';
    var qD = M.quotes[D && D.code] || {};
    var qDf3 = num(qD.changePct);
    var maxLbc = num(M.high, M.maxBoardsSnap) || 1;

    dvPush(lbc <= 4 ? 0 : (lbc === 5 ? 1 : 2),
      M.truth('龙头 lbc=' + fmt(lbc) + '；≤4→良性(+1) / ==5→中性(0) / ≥6→恶性(−1)'), 'auto');
    dvPush((zbc === 0 && lbc <= 4) ? 0 : (zbc === 1 ? 1 : 2),
      M.proxy('原口径为「本轮第几次分歧」，当前用龙头 zbc=' + fmt(zbc) + '+lbc=' + fmt(lbc) +
        ' 代理：zbc==0且lbc≤4→首次分歧(良性) / zbc==1→第二次(中性) / zbc≥2或lbc≥6→三次以上(恶性)'), 'degrade');
    var vr = num(D && D.volumeRatio, num(qD.volumeRatio));
    var volRatio = vr;
    dvPush(volRatio == null ? 1 : (volRatio > 3 ? 2 : (volRatio >= 2.5 ? 1 : 0)),
      M.proxy('原口径为「个股 f6 / 前 5 日均额」，需个股 K 线；当前用量比 ' + fmt(volRatio) +
        ' 代理：1.5–2.5→良性 / 2.5–3→中性 / >3→恶性'), volRatio == null ? 'miss' : 'degrade');
    var hs = num(D && D.turnover, num(qD.turnover));
    dvPush(hs == null ? 1 : ((hs >= 15 && hs <= 35) ? 0 : (((hs >= 10 && hs < 15) || (hs > 35 && hs <= 45)) ? 1 : 2)),
      M.truth('龙头换手 hs=' + fmt(hs) + '%；15–35→良性 / 10–15或35–45→中性 / <10或>45→恶性'),
      hs == null ? 'miss' : 'auto');
    dvPush((zbc === 0 && (zdp == null || zdp > 8)) ? 0 : (zbc === 1 ? 1 : 2),
      M.proxy('分时数据不可得→收盘代理：zbc=' + fmt(zbc) + '、zdp=' + fmt(zdp) +
        '%；zbc==0且zdp≈涨停→封住不破均价(良性) / zbc==1→破后收回(中性) / zbc≥2或收阴→破后无反抽(恶性)'), 'degrade');
    dvPush(inZb ? 2 : ((lbtHH && lbtHH >= '14:30') ? 1 : (zbc === 0 ? 0 : 1)),
      M.truth('封板结果：zbc=' + fmt(zbc) + '、末封 lbt=' + (lbtHH || '—') +
        '、是否出现在炸板池=' + inZb + '；zbc==0且早封→良性 / lbt≥14:30→中性 / 在 ZB.pool→恶性'), 'auto');
    var bToday = num(M.maxSectorCount, 0);
    var bYesterday = 0;
    if (M.history.length) {
      var ys = (M.history[0].sectorCounts || []).filter(function (x) { return x.sector === B; })[0];
      bYesterday = ys ? num(ys.limitCount, 0) : 0;
    }
    dvPush((bToday >= bYesterday + 1 && !M.dt) ? 0 : (bToday === bYesterday ? 1 : 2),
      M.truth('板块 B=' + (B || '—') + ' 今日涨停 ' + fmt(bToday) + ' vs 昨日 ' + fmt(bYesterday) +
        '、DT.tc=' + fmt(M.dt) + '；≥昨+1→有补位(良性) / ==昨→中性 / <昨或DT>0→恶性'), 'auto');
    var midQ = midPool.length ? (M.quotes[midPool[0].code] || {}) : {};
    var midF3 = num(midQ.changePct);
    dvPush(midF3 == null ? 1 : (midF3 > 0 ? 0 : (Math.abs(midF3) < 2 ? 1 : 2)),
      M.proxy('原口径为「中军 f3 + close vs MA5」，需个股 5 日均线；当前用中军今日 f3=' + fmt(midF3) +
        '% 代理：f3>0→良性 / |f3|<2→中性 / f3<0→恶性'), midF3 == null ? 'miss' : 'degrade');
    var midStocks = M.stocks.filter(function (s) { return (s.boards || 1) >= 2 && (s.boards || 1) < maxLbc; });
    var badMid = midStocks.filter(function (s) {
      var q = M.quotes[s.code] || {};
      var v = q.changePct != null ? q.changePct : s.changePct;
      return v != null && v <= -9;
    }).length;
    dvPush((badMid === 0 && M.promo > 0) ? 0 : (badMid <= 2 ? 1 : 2),
      M.truth('中位股(2≤lbc<高标 ' + fmt(maxLbc) + ') 今日 f3≤−9 家数 n=' + badMid +
        '、晋级数 ' + fmt(M.promo) + '%；n==0且晋级>0→良性 / n=1~2→中性 / n≥3→恶性'), 'auto');
    dvPush(M.prem > 2 ? 0 : (M.prem >= 0 ? 1 : 2),
      M.proxy('次日表现不可观测→T-1 溢价代理：用「昨日涨停今日溢价 prem=' + fmt(M.prem) +
        '%」代 T 次日高开表现；prem>2→良性 / 0≤prem≤2→中性 / prem<0→恶性'), 'degrade');
    dvPush(M.dir === 'up' ? 0 : (M.dir === 'flat' ? 1 : 2),
      M.proxy('用 ΔT3 方向判定（已降级为涨停家数 3 日方向）：dir=' + M.dir + '；up→良性 / flat→中性 / down→恶性'), 'degrade');
    var lhbRec = lhbRecord(M.lhb, D);
    var lhbNet = lhbRec ? num(firstVal(lhbRec, 'net_value', 'net')) : null;
    var lhbHot = lhbRec ? num(firstVal(lhbRec, 'hot_money_net_value', 'hotMoney')) : null;
    var lhbOrg = lhbRec ? num(firstVal(lhbRec, 'org_net_value', 'org')) : null;
    var lhbIdx = 1;
    if (lhbRec) {
      if (lhbNet != null && lhbNet > 0 && lhbHot != null && lhbHot > 0) lhbIdx = 0;
      else if ((lhbNet != null && lhbNet < 0) || (lhbOrg != null && lhbOrg < 0)) lhbIdx = 2;
    }
    /* DV#12 必须标代理口径；LHB 一律标「上一交易日龙虎榜(T-1)」并写明榜单日期 */
    dvPush(lhbIdx,
      M.proxy('上一交易日龙虎榜(T-1)' + (M.lhbDate ? '（榜单 ' + M.lhbDate + '）' : '') + '：' +
        (lhbRec
          ? ('net_value=' + fmt(lhbNet) + '、hot_money_net_value=' + fmt(lhbHot) +
            '、org_net_value=' + fmt(lhbOrg) + '；净买且游资净买→良性 / 无显著→中性 / 净卖→恶性。' +
            '榜单为 T-1 口径，用作 T 日分歧判定的代理指标')
          : ('该标的不在榜单、席位明细不可得 → 缺数据（未计入结论），按中性计入，不硬判命中或不命中'))),
      'degrade');

    /* ---------- 周期定位 6 问 ---------- */
    function lcSet(k, idx, why, kind) { set('locate.' + k, idx, why, kind || 'derive'); }
    var hi = num(M.high, 0);
    lcSet('high', hi <= 2 ? 0 : hi === 3 ? 1 : (hi <= 5 ? 2 : hi <= 7 ? 3 : 4),
      M.truth('最高连板=' + fmt(hi) + '；≤2→0 / ==3→1 / 4–5→2 / 6–7→3 / ≥8→4'), 'auto');
    var dIdx = 0;
    if (lbc <= 2 || !M.stocks.length) dIdx = 0;
    else if (lbc === 3) dIdx = 1;
    else if (lbc >= 4 && zbc === 0) dIdx = 2;
    else if (lbc >= 4 && (zbc >= 1 || inZb)) dIdx = 3;
    else if (D && D.changePct == null) dIdx = 4;
    else if (M.dt && M.dt > 0) dIdx = 5;
    lcSet('dragon', dIdx,
      M.truth('龙头 lbc=' + fmt(lbc) + '、zbc=' + fmt(zbc) + '、在炸板池=' + inZb +
        '；≤2或无连板→0 / ==3→1 / ≥4且zbc=0→2 / ≥4且(zbc≥1或在ZB池)→3 / 昨≥3今未涨停→4 / 跌停→5'), 'auto');
    var z = num(M.zt, 0);
    lcSet('zt', z < 25 ? 0 : z <= 40 ? 1 : z <= 60 ? 2 : z <= 85 ? 3 : 4,
      M.truth('涨停家数=' + fmt(z) + '；<25→0 / 25–40→1 / 40–60→2 / 60–85→3 / >85→4'), 'auto');
    lcSet('prem', M.prem < -3 ? 0 : M.prem < 0 ? 1 : M.prem < 1.5 ? 2 : M.prem <= 3 ? 3 : 4,
      M.derive('昨日涨停今日溢价 prem=' + fmt(M.prem) + '%；<−3→0 / −3~0→1 / 0~1.5→2 / 1.5~3→3 / >3→4'), 'derive');
    var dm = num(M.damian, 0);
    lcSet('damian', dm <= 1 ? 0 : dm <= 3 ? 1 : dm <= 6 ? 2 : dm <= 10 ? 3 : 4,
      M.derive('大面股数量=' + fmt(dm) + '；0–1→0 / 2–3→1 / 4–6→2 / 7–10→3 / >10→4'), 'derive');
    var sIdx = 0;
    var firstBoardRatio = M.zt ? M.stocks.filter(function (s) { return (s.boards || 1) === 1; }).length / M.zt : 0;
    var bHistory = M.history.map(function (x) {
      var c = (x.sectorCounts || []).filter(function (y) { return y.sector === B; })[0];
      return c ? num(c.limitCount, 0) : 0;
    });
    var bMax5 = Math.max.apply(null, [bToday].concat(bHistory));
    if (bToday === 0) sIdx = 5;
    else if (bToday <= bYesterday / 2) sIdx = 4;
    else if (firstBoardRatio > 0.7 && bToday >= bMax5) sIdx = 3;
    else if (has5 && has234 && has1) sIdx = 2;
    else if (bHistory.length > 1 && bToday > bHistory[0] && bHistory[0] > bHistory[1]) sIdx = 1;
    else sIdx = 0;
    lcSet('sector', sIdx,
      M.derive('板块 B=' + (B || '—') + ' 今涨停 ' + fmt(bToday) + '、昨 ' + fmt(bYesterday) +
        '、近5日最大 ' + fmt(bMax5) + '、首板占比 ' + fmt(round(firstBoardRatio * 100, 1)) + '%、梯队高板=' + has5 +
        '；无板块涨停≥3→0 / 连续2日增→1 / 梯队完整且B内lbc≥5→2 / 首板>70%且创5日新高→3 / ≤昨/2→4 / ==0→5'), 'derive');

    var sig = [M.date, M.zt, M.high, M.lb, M.zbl, M.prem, M.promo,
      M.damian, M.upr, M.vol, M.dir, M.maxSectorName, M.maxSectorCount].join('|');
    var summary = M.QD
      ? ('已按当日收盘行情 ' + M.QD + '（东方财富涨停/炸板/跌停池、沪深指数广度、日K、历史涨停池、批量个股行情）自动填值与判定；' +
        '真值标「来自今日收盘行情 ' + M.QD + '」、推导标「推导值」、代理标「代理口径」，每项写明取数依据与数据日期；' +
        '未使用快照 stats.open_stock_count / seal_rate 估算口径。用户可手动覆盖。')
      : ('当日实时行情不可用，已按本站收盘快照 ' + (M.SDISO || '—') +
        ' 自动填值，所有字段标注「来自收盘快照 ' + (M.SDISO || '') + ' / 代理口径」；需多日序列的维度显式降级，用户可手动覆盖。');

    return {
      thermo: {
        prem: values['thermo.prem'], zt: values['thermo.zt'], high: values['thermo.high'],
        lb: values['thermo.lb'], zbl: values['thermo.zbl'], jjl: values['thermo.jjl'],
        damian: values['thermo.damian'], upr: values['thermo.upr'], vol: values['thermo.vol'],
        dir: values['thermo.dir']
      },
      mainline: {
        days: values['mainline.days'], ratio: values['mainline.ratio'],
        echelon: values['mainline.echelon'], zj: values['mainline.zj'],
        cat: values['mainline.cat'], jjl: values['mainline.jjl']
      },
      diverge: dv.slice(),
      locate: {
        high: Number(values['locate.high']), dragon: Number(values['locate.dragon']),
        zt: Number(values['locate.zt']), prem: Number(values['locate.prem']),
        damian: Number(values['locate.damian']), sector: Number(values['locate.sector'])
      },
      evidence: evidence,
      /* 以下为 toolbox.js 消费用的扁平映射，不破坏上面的契约 */
      values: values, kinds: kinds, annos: annos,
      marketDate: M.QD, snapshotDate: M.SD, sig: sig, summary: summary
    };
  }

  /** 默认龙头：market.ztPool 中 boards 最大者，并列取 fund 最大；无 market 回退 snapshot 最高标 */
  function pickTargetForMetrics(M) { return pickTarget(M.stocks, null); }
  function pickTarget(stocks, code) {
    if (!stocks.length) return null;
    if (code) {
      var hit = stocks.filter(function (s) { return s.code === String(code); })[0];
      if (hit) return hit;
    }
    var max = Math.max.apply(null, stocks.map(function (s) { return s.boards || 1; }));
    var pool = stocks.filter(function (s) { return (s.boards || 1) === max; });
    pool.sort(function (a, b) { return (b.fund || b.seal || 0) - (a.fund || a.seal || 0); });
    return pool[0];
  }
  function lhbRecord(lhb, t) {
    if (!lhb || !lhb.length || !t) return null;
    return lhb.filter(function (x) {
      if (!x) return false;
      var n = String(x.name || x.n || '');
      var c = String(x.code || x.c || x.ticker || x.thscode || '');
      return (t.name && n === t.name) || (t.code && c.indexOf(t.code) >= 0);
    })[0] || null;
  }

  /* ---------------------------------------------------------------------
   * dragon：按当日真实字段逐项判定 DR_GOOD 17 / DR_BAD 12
   * hit: true 命中 / false 未命中 / null 缺数据未计入（unknown=true）
   * ------------------------------------------------------------------- */
  function dragon(snapshot, code) {
    var snap = (snapshot && typeof snapshot === 'object') ? snapshot : {};
    var M = metrics(snap);
    var stocks = M.stocks;
    var target = pickTarget(stocks, code);
    var empty = {
      target: null, good: [], bad: [], goodHits: 0, badHits: 0,
      missingGood: 0, missingBad: 0, isDragon: false, isTop: false,
      candidates: [], verdict: '缺数据（未计入结论）：snapshot.stocks 与 snapshot.market.ztPool 均为空，无法选取判定对象；龙头与见顶均未判定。'
    };
    if (!target) return empty;

    var good = [], bad = [];
    function G(name, hit, why) { good.push({ name: name, hit: hit, why: why, unknown: hit === null }); }
    function B(name, hit, why) { bad.push({ name: name, hit: hit, why: why, unknown: hit === null }); }

    var QD = M.QD || M.SD || '（日期未知）';
    var QDISO = M.QDISO || M.SDISO || '未知';
    function T(why) { return '来自今日收盘行情 ' + (QDISO || QD) + ' · 依据：' + why + '（数据日期 ' + QDISO + '）'; }
    function P(why) { return '代理口径：' + why; }
    function X(why) { return '缺数据（未计入结论）：' + why; }
    /* LHB 相关判定一律以 P('上一交易日龙虎榜(T-1)…') 标注，同时满足「代理口径」与「T-1」披露 */

    var D = target;
    var lbc = num(D.boards, 1);
    var zbc = num(D.openTimes, 0);
    var zdp = num(D.changePct);
    var hs = num(D.turnover);
    var fund = num(D.fund);
    var p = num(D.p);
    var ltsz = num(D.ltsz, (D.cap != null ? D.cap * 1e8 : null));
    var capYi = ltsz != null ? ltsz / 1e8 : num(D.cap);
    var sealLots = num(D.sealLots, (fund != null && p != null && p > 0 ? 10 * fund / p : null));
    var fbt = num(D.fbt);
    var lbt = num(D.lbt);
    var lbtHH = D.lastTime || normTime(lbt);
    var hybk = D.sector || '';
    var maxLbc = M.maxBoardsSnap != null ? M.maxBoardsSnap : num(M.high, 1);
    var maxFund = Math.max.apply(null, stocks.map(function (s) { return num(s.fund, num(s.seal, 0)) || 0; }));
    var samePool = stocks.filter(function (s) { return s.sector === hybk; });
    var sameFbt = samePool.map(function (s) { return num(s.fbt); }).filter(function (v) { return v != null; });
    var minFbt = sameFbt.length ? Math.min.apply(null, sameFbt) : null;
    var zttjCt = num(D.zttj && D.zttj.ct);
    var zf = num(D.zf);
    var qD = M.quotes[D.code] || {};
    var qDf3 = num(qD.changePct, zdp);
    var qDf6 = num(qD.amount, num(D.amount));
    var inZb = M.zbPool.some(function (x) { return x.code === D.code; });
    var inDt = M.dtPool.some(function (x) { return x.code === D.code; });
    var prevD = (M.history.length ? M.history[0].pool : []).filter(function (x) { return x.code === D.code; })[0] || null;
    var lhbRec = lhbRecord(M.lhb, D);
    var lhbNet = lhbRec ? num(firstVal(lhbRec, 'net_value', 'net')) : null;
    var lhbOrg = lhbRec ? num(firstVal(lhbRec, 'org_net_value', 'org')) : null;
    var lhbHot = lhbRec ? num(firstVal(lhbRec, 'hot_money_net_value', 'hotMoney')) : null;
    var hotRank = null;
    (M.hot || []).some(function (x, i) {
      if (!x) return false;
      var c = String(x.ticker || x.code || x.c || '');
      if (c && c === D.code) { hotRank = num(x.rank, i + 1); return true; }
      return false;
    });
    // 注意：本函数作用域内已有判定助手 function B(name, hit, why)，
    // 这里不能再声明同名 var B（会覆盖函数导致 B(...) 抛 "B is not a function"）。
    var sectorB = M.maxSectorName;
    var bToday = num(M.maxSectorCount, 0);
    var bYesterday = 0;
    if (M.history.length) {
      var ys = (M.history[0].sectorCounts || []).filter(function (x) { return x.sector === sectorB; })[0];
      bYesterday = ys ? num(ys.limitCount, 0) : 0;
    }
    var midPool = samePool.filter(function (s) { return s.ltsz != null && s.ltsz >= 100 * 1e8; })
      .sort(function (a, b) { return (b.ltsz || 0) - (a.ltsz || 0); });
    var midF3 = midPool.length ? num((M.quotes[midPool[0].code] || {}).changePct) : null;

    /* ---------- 龙头成色 17 项 ---------- */
    G(GOOD_NAMES[0], lbc === maxLbc, T('D.lbc=' + fmt(lbc) + ' == max(池.lbc)=' + fmt(maxLbc)));
    G(GOOD_NAMES[1], (minFbt != null && fbt != null) ? fbt === minFbt : null,
      (minFbt != null && fbt != null) ? T('D.fbt=' + fmt(fbt) + ' == min(同 hybk=' + (hybk || '—') + ' 的 fbt)=' + fmt(minFbt))
        : X('无 fbt 首封时间字段'));
    G(GOOD_NAMES[2], (fund != null && maxFund != null) ? fund === maxFund : null,
      (fund != null && maxFund != null) ? T('D.fund=' + fmt(fund) + ' 元 == max(池.fund)=' + fmt(maxFund) + ' 元（直接比 fund，不受 p 单位影响）')
        : X('无 fund 封单额字段'));
    G(GOOD_NAMES[3], samePool.length >= 4, T('同 hybk=' + (hybk || '—') + ' 涨停数=' + samePool.length + '，阈值 ≥4'));
    var reason = (D.concepts || []).join('+');
    G(GOOD_NAMES[4], !!(reason && hybk && (reason.indexOf(hybk) >= 0 || D.concepts.length >= 2)),
      P('语义代理：原口径为 limit_up_reason 与 hybk 一致；东财池不含 limit_up_reason，当前用 concepts/hybk「' +
        (reason || hybk || '—') + '」匹配'));
    G(GOOD_NAMES[5], lbc >= 3, T('D.lbc=' + fmt(lbc) + '，阈值 ≥3 板（成龙点）'));
    G(GOOD_NAMES[6], hs == null ? null : (hs >= 15 && hs <= 35),
      hs == null ? X('无 hs 换手率') : T('D.hs=' + fmt(hs) + '%，健康区间 15%–35%'));
    G(GOOD_NAMES[7], zbc === 0 && (lbt == null || fbt == null || (lbt - fbt) < 360000),
      P('降级：原口径为分时强势不破均价线（需逐笔分时）；当前用 D.zbc=' + fmt(zbc) +
        ' 且 lbt−fbt=' + (lbt != null && fbt != null ? fmt(lbt - fbt) : '—') + '(HHMMSS) 较小代理'));
    G(GOOD_NAMES[8], (D.concepts || []).length >= 2 || (reason && reason.indexOf('+') >= 0),
      P('语义代理：原口径为 limit_up_reason 按「+」切分概念数≥2；东财池无该字段，当前用 concepts 数=' +
        (D.concepts || []).length + ' / hybk 关键词代理'));
    G(GOOD_NAMES[9], midPool.length >= 1 && midF3 != null && midF3 > 0,
      midPool.length ? T('同 hybk 存在 ltsz≥100亿 中军 ' + midPool.length + ' 只（最大 ' +
        (midPool[0] && midPool[0].name) + '），今日 f3=' + fmt(midF3) + '% > 0')
        : T('同 hybk 无 ltsz≥100亿 的中军'));
    var lowerLbc = samePool.filter(function (s) { return (s.boards || 1) < lbc; }).length;
    G(GOOD_NAMES[10], lowerLbc >= 2, T('同 hybk 内 lbc<D.lbc(' + fmt(lbc) + ') 的涨停股 ' + lowerLbc + ' 只，阈值 ≥2（梯队支撑）'));
    /* DR_GOOD#12（龙虎榜健康）必须标代理口径 + 「上一交易日龙虎榜(T-1)」+ 榜单日期 */
    G(GOOD_NAMES[11], lhbRec ? ((lhbNet != null && lhbNet > 0) && (lhbOrg != null && lhbOrg >= 0)) : null,
      P('上一交易日龙虎榜(T-1)' + (M.lhbDate ? '（榜单 ' + M.lhbDate + '）' : '') + '：' +
        (lhbRec
          ? ('net_value=' + fmt(lhbNet) + ' > 0 且 org_net_value=' + fmt(lhbOrg) + ' ≥ 0；' +
            '榜单为 T-1 且席位明细不可得，游资接力维度按代理口径判定')
          : ('该标的不在榜单、席位明细不可得 → 缺数据（未计入结论），不硬判命中或不命中'))));
    G(GOOD_NAMES[12], capYi == null ? null : (capYi >= 30 && capYi <= 150),
      capYi == null ? X('无 ltsz / cap 流通市值') : T('D.ltsz/1e8=' + fmt(round(capYi, 2)) + ' 亿，区间 30–150 亿'));
    G(GOOD_NAMES[13], (zttjCt != null && zttjCt >= 3) || (hotRank != null && hotRank <= 10),
      P('语义代理：原口径含热股榜 rank≤10；当前用东财 zttj.ct=' + fmt(zttjCt) +
        '（≥3 计命中）/ fuyao 热股榜 rank=' + fmt(hotRank) + '（≤10 计命中）判定'));
    G(GOOD_NAMES[14], !!(prevD && num(prevD.zbc, 0) >= 1 && zbc === 0 && num(prevD.lbc, 0) < lbc),
      P('降级：原口径需前日分时分歧记录；当前用上一交易日池 zbc=' + (prevD ? fmt(prevD.zbc) : '—') +
        ' ≥1 且今日 zbc=' + fmt(zbc) + '==0 且 lbc 递增（昨 ' + (prevD ? fmt(prevD.lbc) : '—') + ' → 今 ' + fmt(lbc) + '）代理'));
    /* DR_GOOD#16 必须标代理口径（缺数据时也要标，且不硬判） */
    G(GOOD_NAMES[15], hs == null || M.avgVr == null ? null : (hs >= 5 && hs <= 45 && M.avgVr >= 0.5 && M.avgVr <= 3),
      P('降级：原口径为分时自然（非庄股），需逐笔分时；当前用 D.hs=' + fmt(hs) +
        '%（5–45%）且池内平均量比 ' + fmt(round(M.avgVr, 2)) + '（0.5–3）代理' +
        ((hs == null || M.avgVr == null) ? '；本项 hs / 量比不足 → 缺数据（未计入结论），不硬判命中或不命中' : '')));
    G(GOOD_NAMES[16], (hotRank != null && hotRank <= 10),
      P('语义代理：原口径为热股榜 rank≤10 或 heat 前 10；当前用 fuyao 热股榜(period=day) rank=' +
        fmt(hotRank) + ' 判定' + (hotRank == null ? '；榜单不可用 → 缺数据（未计入结论）' : '，无榜单命中则未命中')));

    /* ---------- 见顶信号 12 项 ---------- */
    var qDf6Ma5 = null;   // 个股 5 日均额（需个股 K 线，本模块不额外拉）
    B(BAD_NAMES[0], zbc >= 2 && qDf6Ma5 == null ? null : (zbc >= 2 && qDf6Ma5 != null && qDf6 / qDf6Ma5 > 3),
      qDf6Ma5 == null
        ? P('降级：需个股 5 日均额判 f6/5日均额>3；当前只有 D.zbc=' + fmt(zbc) + ' 与今日 f6=' + fmt(qDf6) +
          '，5日均额不可得，按「缺数据，未计入」处理')
        : T('D.zbc=' + fmt(zbc) + '≥2 且 f6/5日均额=' + fmt(qDf6 / qDf6Ma5) + '>3'));
    B(BAD_NAMES[1], inZb && lbc >= 4, T('D 出现在今日 ZB.pool=' + inZb + ' 且 lbc=' + fmt(lbc) + '≥4'));
    B(BAD_NAMES[2], prevD == null ? null : (num(prevD.amount, 0) < qDf6 / 2 && lbc >= 4),
      prevD == null ? X('无上一交易日个股成交额')
        : T('前日 f6=' + fmt(prevD.amount) + ' < 今日 f6 ' + fmt(qDf6) + '/2 且 lbc=' + fmt(lbc) + '≥4'));
    B(BAD_NAMES[3], null, X('需个股 5 日均线 MA5 与 close，单日收盘快照/东财池不含，不硬判'));
    /* DR_BAD#5 必须标代理口径 + 「上一交易日龙虎榜(T-1)」+ 榜单日期 */
    B(BAD_NAMES[4], lhbRec ? ((lhbNet != null && lhbNet < 0) || String(firstVal(lhbRec, 'seat_name', 'seats') || '').indexOf('拉萨') >= 0) : null,
      P('上一交易日龙虎榜(T-1)' + (M.lhbDate ? '（榜单 ' + M.lhbDate + '）' : '') + '：' +
        (lhbRec
          ? ('net_value=' + fmt(lhbNet) + '、org_net_value=' + fmt(lhbOrg) +
            '；席位明细不可得，仅按净额判定（拉萨维度缺数据未计入）；榜单为 T-1 口径，作代理指标')
          : ('该标的不在榜单、席位明细不可得 → 缺数据（未计入结论），不硬判命中或不命中'))));
    B(BAD_NAMES[5], bToday < bYesterday, T('板块 B=' + (sectorB || '—') + ' 今日涨停 ' + fmt(bToday) + ' < 昨日 ' + fmt(bYesterday)));
    var rival = stocks.filter(function (s) {
      return s.code !== D.code && (s.boards || 1) === lbc && num(s.fbt) != null && fbt != null && num(s.fbt) < fbt;
    });
    B(BAD_NAMES[6], rival.length >= 1, T('存在另一只 lbc==D.lbc(' + fmt(lbc) + ') 且 fbt<D.fbt(' + fmt(fbt) + ') 的卡位者 ' + rival.length + ' 只'));
    var midBad = stocks.filter(function (s) {
      if ((s.boards || 1) < 2) return false;
      var q = M.quotes[s.code] || {};
      var v = q.changePct != null ? q.changePct : s.changePct;
      return v != null && v <= -9;
    }).length;
    B(BAD_NAMES[7], midBad >= 3, T('连板股中今日 f3≤−9 家数=' + midBad + '，阈值 ≥3'));
    B(BAD_NAMES[8], midF3 == null ? null : (midF3 < -5),
      midF3 == null ? X('无中军今日 f3 / MA5')
        : P('降级：原口径需中军 close vs MA5；当前用中军 f3=' + fmt(midF3) + '% < −5 代理'));
    // 尾盘勉强封板：封单手数 = 10*fund/p，判定 10*fund/p < 10000 等价 fund < 1000*p
    var late = !!(lbtHH && lbtHH >= '14:30');
    var smallSeal = (fund != null && p != null && p > 0) ? (fund < 1000 * p) : null;
    B(BAD_NAMES[9], smallSeal == null ? null : (late && smallSeal),
      (fund == null || p == null) ? X('无 fund / p，无法换算封单手数')
        : T('末封 lbt=' + (lbtHH || '—') + '≥14:30=' + late + '；封单手数 = 10*fund/p = ' +
          fmt(sealLots) + ' 手，等价 fund(' + fmt(fund) + ') < 1000*p(' + fmt(1000 * p) + ') → ' + smallSeal +
          '（东财 p 为价格×1000，价格元=p/1000）'));
    B(BAD_NAMES[10], inDt || (zdp != null && zf != null && zdp <= -9 && zf >= 18),
      T('D 在 DT.pool=' + inDt + ' 或 zdp=' + fmt(zdp) + '≤−9 且 zf=' + fmt(zf) + '≥18（天地板代理）'));
    B(BAD_NAMES[11], (zdp == null || zf == null || zbc == null) ? null : (zdp < 0 && zf > 10 && zbc >= 1),
      (zdp == null || zf == null || zbc == null) ? X('无 zdp / zf 振幅字段')
        : P('降级：竞价分时取不到→收盘代理 zdp=' + fmt(zdp) + '<0 且 zf=' + fmt(zf) + '>10 且 zbc=' + fmt(zbc) + '≥1'));

    var goodHits = good.filter(function (x) { return x.hit === true; }).length;
    var badHits = bad.filter(function (x) { return x.hit === true; }).length;
    var missingGood = good.filter(function (x) { return x.hit === null; }).length;
    var missingBad = bad.filter(function (x) { return x.hit === null; }).length;
    var isDragon = goodHits >= 12;
    var isTop = badHits >= 3;
    var candidates = stocks.filter(function (s) { return (s.boards || 1) >= 2; })
      .sort(function (a, b) { return (b.boards - a.boards) || ((b.fund || b.seal || 0) - (a.fund || a.seal || 0)); })
      .map(function (s) { return { code: s.code, name: s.name, boards: s.boards, seal: s.seal, sector: s.sector }; });
    var verdict = '是否真龙头：' + (isDragon ? '是' : '否') + '（龙头成色命中 ' + goodHits + '/17）；' +
      '是否见顶：' + (isTop ? '是' : '否') + '（见顶信号命中 ' + badHits + '/12）；' +
      '缺数据未计入：成色 ' + missingGood + ' 项、见顶 ' + missingBad + ' 项。' +
      '判定对象 ' + D.name + '（' + D.code + '，' + fmt(lbc) + '板，数据日期 ' + QDISO + '）按当日收盘行情真实字段自动判定，' +
      '标注「缺数据」的维度不计入结论；上一交易日龙虎榜项已标 T-1。';

    return {
      target: {
        code: D.code, name: D.name, boards: lbc, seal: D.seal, cap: capYi,
        turnover: hs, volumeRatio: num(D.volumeRatio, num(qD.volumeRatio)),
        netIn: num(D.netIn, num(qD.mainNet)), firstTime: D.firstTime, openTimes: zbc,
        sector: hybk, concepts: (D.concepts || []).slice(), price: D.price,
        changePct: zdp, probability: D.probability
      },
      good: good, bad: bad,
      goodHits: goodHits, badHits: badHits,
      missingGood: missingGood, missingBad: missingBad,
      isDragon: isDragon, isTop: isTop,
      candidates: candidates, verdict: verdict
    };
  }

  global.YGAutoFill = { build: build, dragon: dragon };
})(typeof window !== 'undefined' ? window : this);
