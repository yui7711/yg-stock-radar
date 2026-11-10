/* =========================================================================
 * toolbox.js — 判定工具箱（独立模块）
 * -------------------------------------------------------------------------
 * 移植自 _ref/hb_tools.js（参考站判定工具箱全部源码，唯一权威来源）。
 *   · TABS / T_FIELDS / thermoScore / thermoStage
 *   · ML_FIELDS / mlRatioScore / mlJjlScore / 主线强度评分
 *   · DV_ITEMS / 分歧性质
 *   · DR_GOOD / DR_BAD / 龙头体检
 *   · LC_Q / locate / LC_ADVICE / 周期定位
 * 以上所有「字段、单位、选项文案、阈值、分值、结论文案、tips」均一字不改照搬。
 *
 * 对外接口：window.YGToolbox.render(rootEl, snapshot)
 *   · 每次调用重建 rootEl 内容；内部 5 个工具 tab 切换由事件委托处理（不重复绑定）。
 *   · 事件用 AbortController 绑定一次（重复 render 会 abort 旧监听）。
 *   · 所有 DOM 查询限定在 rootEl 内，不使用固定 ID、不依赖主站类名。
 *
 * 数据接入（本站 state.data 为单日收盘快照）：
 *   · 4 个字段自动预填并标注「来自今日快照 {date}」；
 *   · 快照不含的字段一律留空并标注「快照不含，需手动填写」；
 *   · 其余 4 个工具输入一律留空/不勾选并提示「需自行判断」；
 *   · 工具绝不使用参考站的 def 默认值代替，结论区对空值给出显式披露。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* =======================================================================
   * 一、常量与算法 —— 逐字照搬 _ref/hb_tools.js
   * ======================================================================= */

  var TABS = [
    { id: 'thermo', name: '🌡️ 情绪温度计', title: '情绪温度测算', desc: '输入当日九项核心数据，系统自动换算为 0–100 的情绪温度，并给出阶段定位、建议仓位与操作要点。' },
    { id: 'mainline', name: '🎯 主线强度', title: '主线强度评分', desc: '对目标板块的六个维度打分，判定它是主线、支线还是一日游。' },
    { id: 'diverge', name: '⚖️ 分歧性质', title: '良性 / 恶性分歧判定', desc: '逐项判定分歧的十二个维度，得出「良性 / 中性 / 恶性」结论与对应操作。' },
    { id: 'dragon', name: '🐉 龙头体检', title: '龙头体检表', desc: '勾选候选龙头符合的特征与命中的见顶信号，判定真龙成色与风险等级。' },
    { id: 'locate', name: '🧭 周期定位', title: '周期阶段定位器', desc: '回答六个问题，快速定位当前所处的情绪周期阶段。' }
  ];

  var T_FIELDS = [
    { k: 'prem', n: '昨日涨停今日溢价', d: '昨日涨停股今天的平均涨跌幅（%）', u: '%', def: 1.0 },
    { k: 'zt', n: '涨停家数', d: '今日收盘涨停个股总数', u: '家', def: 55 },
    { k: 'high', n: '最高连板高度', d: '市场最高几板', u: '板', def: 4 },
    { k: 'lb', n: '连板家数', d: '2板及以上个股总数', u: '家', def: 15 },
    { k: 'zbl', n: '炸板率', d: '炸板数 ÷（涨停+炸板）', u: '%', def: 20 },
    { k: 'jjl', n: '连板晋级率', d: '昨日连板股今日成功晋级的比例', u: '%', def: 45 },
    { k: 'damian', n: '大面股数量', d: '昨涨停今跌超9%的个股数', u: '家', def: 1 },
    { k: 'upr', n: '上涨家数占比', d: '上涨家数 ÷ 总家数', u: '%', def: 60 },
    { k: 'vol', n: '量能变化', d: '成交额相对5日均量的变化', u: '%', def: 10 }
  ];

  function thermoScore(v) {
    var s = 0, d = [];
    // 1 昨日涨停溢价 15
    var a = v.prem > 3 ? 15 : v.prem >= 1.5 ? 12 : v.prem >= 0 ? 9 : v.prem >= -1 ? 6 : v.prem >= -3 ? 3 : 0;
    s += a; d.push(['昨日涨停溢价', a, 15]);
    // 2 涨停家数 15
    a = v.zt > 100 ? 15 : v.zt >= 70 ? 13 : v.zt >= 50 ? 10 : v.zt >= 35 ? 7 : v.zt >= 25 ? 4 : 2;
    s += a; d.push(['涨停家数', a, 15]);
    // 3 最高连板 15
    a = v.high >= 8 ? 15 : v.high === 7 ? 13 : v.high === 6 ? 11 : v.high === 5 ? 9 : v.high === 4 ? 7 : v.high === 3 ? 5 : 2;
    s += a; d.push(['最高连板高度', a, 15]);
    // 4 连板家数 10
    a = v.lb > 30 ? 10 : v.lb >= 20 ? 8 : v.lb >= 12 ? 6 : v.lb >= 6 ? 4 : v.lb >= 3 ? 2 : 0;
    s += a; d.push(['连板家数', a, 10]);
    // 5 炸板率 10
    a = v.zbl < 15 ? 10 : v.zbl < 25 ? 8 : v.zbl < 35 ? 6 : v.zbl < 45 ? 3 : 0;
    s += a; d.push(['炸板率（反向）', a, 10]);
    // 6 晋级率 10
    a = v.jjl > 55 ? 10 : v.jjl >= 45 ? 8 : v.jjl >= 35 ? 6 : v.jjl >= 25 ? 4 : v.jjl >= 15 ? 2 : 0;
    s += a; d.push(['连板晋级率', a, 10]);
    // 7 大面股 10
    a = v.damian <= 1 ? 10 : v.damian <= 3 ? 7 : v.damian <= 6 ? 4 : v.damian <= 10 ? 2 : 0;
    s += a; d.push(['大面股（反向）', a, 10]);
    // 8 上涨占比 10
    a = v.upr > 70 ? 10 : v.upr >= 60 ? 8 : v.upr >= 50 ? 6 : v.upr >= 40 ? 4 : v.upr >= 30 ? 2 : 0;
    s += a; d.push(['上涨家数占比', a, 10]);
    // 9 量能 5
    a = v.vol > 20 ? 5 : v.vol >= 5 ? 4 : v.vol >= -5 ? 3 : v.vol >= -20 ? 2 : 1;
    s += a; d.push(['量能变化', a, 5]);
    return { total: s, detail: d };
  }

  function thermoStage(t, dir) {
    if (dir === 'down') {
      if (t >= 68) return { n: '分歧期', c: '#f0483e', pos: '20–40%', act: '先减仓至 40% 以下，再用「良性/恶性分歧判定表」定性。良性可留龙头底仓，恶性立即清仓。', tips: ['中位股批量跌停是最领先的退潮信号', '不接第一根大阴，等反包封住再考虑', '「再看看」是退潮期最贵的三个字'] };
      if (t >= 35) return { n: '退潮期', c: '#f0483e', pos: '0–20%', act: '清掉旧主线全部仓位（龙头、中位、补涨、跟风一律不留）。极小仓试错新方向的低位首板/2板。', tips: ['严禁抄底断板龙头', '严禁补仓摊薄成本', '把反抽当反转是二次亏损的主因'] };
      return { n: '崩塌期', c: '#22c55e', pos: '0%', act: '绝对空仓。唯一工作是观察记录：谁在抗跌、量能何时见地量、何时出现反核。', tips: ['等跌停家数减半 + 地量 + 反核，三选二再考虑进场', '崩塌末期恐慌割肉往往割在地板上'] };
    }
    if (dir === 'flat') {
      if (t <= 20) return { n: '冰点期', c: '#22c55e', pos: '0–10%', act: '空仓为主。可极小仓试错反核/地天板/超跌首板，目的是保持盘感与寻找新方向种子。', tips: ['冰点可以持续很久，"底下还有底"', '利空钝化是抛压出尽的标志', '记录哪些票在崩塌末期逆势抗跌'] };
      if (t >= 68) return { n: '顶部博弈区（极度亢奋）', c: '#f0483e', pos: '30–50%', act: '加速减仓、设置硬止损（跌破5日线减半）。不再新开任何高位仓位。', tips: ['缩量加速是顶部信号不是买入信号', '补涨潮全面爆发 = 见顶倒计时', '高潮期唯一正确的动作是逐步兑现'] };
      return { n: '震荡 / 横盘段', c: '#e8b64c', pos: '20–40%', act: '降低预期，做宽度不做高度。以首板、2板快进快出为主，不重仓、不追高。', tips: ['横盘段最容易磨损本金', '减少交易频率，等待方向明确'] };
    }
    // up
    if (t <= 20) return { n: '冰点期', c: '#22c55e', pos: '0–10%', act: '空仓为主，极小仓试错反核/地天板/超跌首板。', tips: ['冰点是播种期不是收割期', '重点观察谁在逆势走强'] };
    if (t <= 35) return { n: '修复期', c: '#22c55e', pos: '10–30%', act: '小仓试错。做宽度不做高度：打首板、2板；参与反核、反包。严禁追 3 板以上高位。', tips: ['试错错了必须当天/次日认错', '不能把试错变成套牢', '修复期随时可能二次探底'] };
    if (t <= 50) return { n: '启动期', c: '#38d9d0', pos: '30–50%', act: '加仓窗口。核心动作：打 2 板、3 板（成龙点），确认主线后向龙头集中。', tips: ['启动期最重要的动作是"坐住"', '敢上龙头，不买杂毛', '仍有 30% 概率是假启动，不满仓'] };
    if (t <= 68) return { n: '确认期（黄金段）', c: '#e8b64c', pos: '60–80%', act: '核心仓。持有龙头不动，分歧转一致时加仓，做主线内最强前排。不做杂毛、不做非主线。', tips: ['主升期最大的错误是卖飞龙头', '每一次回调都是上车机会而非下车理由', '让利润奔跑'] };
    return { n: '高潮期', c: '#f0483e', pos: '50–70%', act: '持股为主、逐步减仓、不再新开高位。转换到补涨股与低位首板做套利，每创新高减 1/3。', tips: ['不追高位缩量板（最危险的买点）', '不加杠杆', '分批兑现而不是加仓'] };
  }

  var ML_FIELDS = [
    { k: 'days', n: '持续性', type: 'sel', opts: [['连续 ≥5 日', 25], ['3–4 日', 18], ['2 日', 10], ['1 日', 3]] },
    { k: 'ratio', n: '板块涨停占全市场比例', type: 'num', u: '%', def: 20 },
    { k: 'echelon', n: '梯队完整度', type: 'sel', opts: [['完整（高标+中位+低位+首板）', 20], ['缺高标', 12], ['只有首板', 4]] },
    { k: 'zj', n: '中军强度', type: 'sel', opts: [['有中军且放量上涨', 15], ['有中军但滞涨', 7], ['无中军', 0]] },
    { k: 'cat', n: '催化级别', type: 'sel', opts: [['国家级政策 / 产业革命', 10], ['行业级事件', 6], ['单条消息', 2]] },
    { k: 'jjl', n: '板块内连板晋级率', type: 'num', u: '%', def: 40 }
  ];
  function mlRatioScore(r) { return r > 35 ? 20 : r >= 25 ? 15 : r >= 15 ? 10 : r >= 8 ? 5 : 2; }
  function mlJjlScore(r) { return r > 45 ? 10 : r >= 30 ? 6 : r >= 15 ? 3 : 0; }

  var DV_ITEMS = [
    ['发生板位', '2–4板相对低位', '5板', '≥6板高位'],
    ['分歧次数', '首次分歧', '第二次', '第三次以上'],
    ['量能倍数（vs 5日均量）', '1.5–2.5倍', '2.5–3倍', '>3倍天量'],
    ['换手率', '15%–35%', '10–15% 或 35–45%', '<10% 或 >45%'],
    ['分时形态', '不破均价线、深V走高', '盘中破均价线但收回', '破均价线后无反抽'],
    ['封板结果', '分歧后回封、封单大', '尾盘勉强封板', '炸板不回封'],
    ['板块效应', '有新票顶上补位', '无补位但也没跌停', '集体开板、跟风全跌'],
    ['中军状态', '红盘不破5日线', '横盘震荡', '大阴破位'],
    ['中位股状态', '未批量跌停、仍有晋级', '个别断板', '批量跌停（3家以上）'],
    ['次日表现', '高开+2%以上快速上板', '平开震荡', '低开 / 一字跌停'],
    ['情绪温度方向', '仍在上行通道', '走平', '已见顶回落'],
    ['龙虎榜', '知名游资接力、无拉萨', '无显著信号', '拉萨接盘、主力净卖']
  ];

  var DR_GOOD = [
    '身位最高（板块/市场最高板）', '板块内上板最早', '封单最大', '能带动板块（跟风涨停≥3家）',
    '题材纯正（非蹭概念）', '已达 3 板以上（通过成龙点）', '换手率 15%–35% 健康区间',
    '分时强势（不破均价线）', '逻辑可延展（有持续催化）', '有中军配合',
    '有梯队支撑（下方有补位）', '龙虎榜健康（游资接力、无一家独大）',
    '流通盘适中（30–150亿）', '有辨识度标签', '经历过分歧并成功转一致',
    '非庄股特征（分时自然）', '市场热议焦点（人气高）'
  ];
  var DR_BAD = [
    '天量烂板（>3倍量、反复开板）', '高位爆量不封（长上影大阴）', '缩量加速后突然放量',
    '首次跌破 5 日线', '龙虎榜拉萨军团接盘 / 主力净卖', '板块内补涨股不再跟进',
    '同身位出现卡位者', '中位股批量跌停', '中军大阴破位',
    '尾盘勉强封板（封单<1万手）', '出现天地板', '竞价高开后直线下杀'
  ];

  var LC_Q = [
    { k: 'high', n: '当前市场最高连板是几板？', opts: ['≤2 板', '3 板', '4–5 板', '6–7 板', '≥8 板'] },
    { k: 'dragon', n: '龙头（最高标）当前状态？', opts: ['无明确龙头', '刚上3板，还在走', '主升中，持续涨停', '天量烂板/爆量不封', '已断板，未反包', '连续跌停（A字杀）'] },
    { k: 'zt', n: '今日涨停家数？', opts: ['<25 家', '25–40 家', '40–60 家', '60–85 家', '>85 家'] },
    { k: 'prem', n: '昨日涨停股今日表现（溢价）？', opts: ['亏钱（-3%以下）', '小亏（-3%~0）', '小赚（0~+1.5%）', '大赚（+1.5%~+3%）', '暴赚（>+3%）'] },
    { k: 'damian', n: '今日大面股（昨涨停今跌超9%）数量？', opts: ['0–1 家', '2–3 家', '4–6 家', '7–10 家', '>10 家'] },
    { k: 'sector', n: '主线板块状态？', opts: ['无主线，题材一日游', '有新方向连续2日共振', '主线确立，梯队完整', '主线高潮，补涨潮爆发', '主线退潮，涨停数腰斩', '主线已死，资金离场'] }
  ];

  function locate(a) {
    var sc = { ice: 0, fix: 0, start: 0, conf: 0, peak: 0, div: 0, ebb: 0, crash: 0 };
    var g = a.high;
    if (g <= 1) { sc.ice += 3; sc.crash += 2; sc.fix += 1; }
    else if (g === 2) { sc.fix += 3; sc.start += 1; }
    else if (g === 3) { sc.start += 3; sc.conf += 1; }
    else if (g === 4) { sc.conf += 3; sc.peak += 1; }
    else { sc.peak += 3; sc.div += 2; }
    var d = a.dragon;
    if (d === 0) { sc.ice += 3; sc.crash += 1; }
    else if (d === 1) { sc.start += 3; sc.fix += 1; }
    else if (d === 2) { sc.conf += 3; sc.peak += 2; }
    else if (d === 3) { sc.div += 4; }
    else if (d === 4) { sc.ebb += 4; }
    else { sc.crash += 4; sc.ebb += 1; }
    var z = a.zt;
    if (z === 0) { sc.ice += 2; sc.crash += 2; }
    else if (z === 1) { sc.fix += 2; }
    else if (z === 2) { sc.start += 2; }
    else if (z === 3) { sc.conf += 2; }
    else { sc.peak += 2; }
    var p = a.prem;
    if (p === 0) { sc.crash += 3; sc.ebb += 2; }
    else if (p === 1) { sc.ice += 2; sc.fix += 2; }
    else if (p === 2) { sc.start += 2; sc.fix += 1; }
    else if (p === 3) { sc.conf += 2; }
    else { sc.peak += 3; }
    var dm = a.damian;
    if (dm === 0) { sc.peak += 2; sc.conf += 1; }
    else if (dm === 1) { sc.start += 1; sc.conf += 1; }
    else if (dm === 2) { sc.div += 2; sc.fix += 1; }
    else if (dm === 3) { sc.ebb += 3; }
    else { sc.crash += 3; sc.ebb += 1; }
    var s = a.sector;
    if (s === 0) { sc.ice += 2; sc.fix += 1; }
    else if (s === 1) { sc.start += 3; }
    else if (s === 2) { sc.conf += 3; }
    else if (s === 3) { sc.peak += 3; }
    else if (s === 4) { sc.ebb += 3; sc.div += 1; }
    else { sc.crash += 3; }
    var names = { ice: '冰点期', fix: '修复期', start: '启动期', conf: '确认期', peak: '高潮期', div: '分歧期', ebb: '退潮期', crash: '崩塌期' };
    var best = Object.keys(sc).sort(function (x, y) { return sc[y] - sc[x]; })[0];
    return { name: names[best], key: best, sc: sc, names: names };
  }
  var LC_ADVICE = {
    ice: { pos: '0–10%', act: '空仓为主。极小仓试错反核/地天板，重点是寻找下一轮主线的种子。', tips: ['利空钝化 = 抛压出尽', '冰点可以持续很久，不猜底'] },
    fix: { pos: '10–30%', act: '小仓试错，做宽度不做高度。打首板、2板，参与反核与反包。严禁追 3 板以上。', tips: ['试错错了当天或次日认错', '修复期随时二次探底'] },
    start: { pos: '30–50%', act: '加仓窗口。打 2 板、3 板（成龙点），向已确认的主线集中。', tips: ['敢上龙头，不买杂毛', '启动期要"坐住"'] },
    conf: { pos: '60–80%', act: '核心仓。持有龙头不动，分歧转一致加仓，做主线最强前排。', tips: ['最大错误是卖飞龙头', '让利润奔跑'] },
    peak: { pos: '50–70%', act: '持股为主、分批减仓、不再新开高位。转做补涨套利，每创新高减 1/3。', tips: ['不追缩量加速板', '补涨潮爆发 = 见顶倒计时'] },
    div: { pos: '20–40%', act: '先减仓至 40% 以下，再判良性/恶性。良性留龙头底仓，恶性立即清仓。', tips: ['中位股批量跌停是最领先信号', '不接第一根大阴'] },
    ebb: { pos: '0–20%', act: '清掉旧主线全部仓位，极小仓试错新方向的低位首板/2板。', tips: ['严禁抄底断板龙头', '把反抽当反转是二次亏损主因'] },
    crash: { pos: '0%', act: '绝对空仓。观察记录：谁在抗跌、量能何时见地量、何时出现反核。', tips: ['等三选二信号再进场', '崩塌末期恐慌割肉往往在地板'] }
  };

  /* =======================================================================
   * 二、数据边界说明与预填（本站特有，参考站无此逻辑）
   * ======================================================================= */

  var BOUNDARY = '本站仅有单日收盘快照；标注为『快照不含』的字段需你手动填写，工具不会用默认值代替；计算结果仅供方法研究，不构成投资建议。';
  var PH_TEXT = '— 请选择（需自行判断）—';
  var ANNO_JUDGE = '需自行判断';
  var ANNO_MISS = '快照不含，需手动填写';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function numOrNull(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /**
   * 从本站 state.data（单日收盘快照）计算 4 个可自动预填的字段。
   * snapshot 为 null / 字段缺失时返回全空，页面退化为全部手填且不抛异常。
   */
  function computePrefill(snapshot) {
    var res = { date: '', zt: '', high: '', lb: '', zbl: '', hasSnapshot: false };
    if (!snapshot || typeof snapshot !== 'object') return res;

    var ov = (snapshot.overview && typeof snapshot.overview === 'object') ? snapshot.overview : {};
    var st = (snapshot.stats && typeof snapshot.stats === 'object') ? snapshot.stats : {};
    var stocksLen = (snapshot.stocks && typeof snapshot.stocks.length === 'number') ? snapshot.stocks.length : null;

    res.date = (typeof snapshot.date === 'string' && snapshot.date) ? snapshot.date
      : (typeof ov.date === 'string' ? ov.date : '');

    // 涨停家数 = overview.limitUp（回退 stocks.length）
    var limitUp = numOrNull(ov.limitUp);
    if (limitUp == null) limitUp = numOrNull(stocksLen);
    // 最高连板高度 = overview.maxBoards；连板家数 = overview.lianban
    var high = numOrNull(ov.maxBoards);
    var lb = numOrNull(ov.lianban);
    // 炸板数：优先 overview.zhaban，回退 stats.open_stock_count
    var zhaban = numOrNull(ov.zhaban);
    if (zhaban == null) zhaban = numOrNull(st.open_stock_count);

    res.zt = (limitUp == null) ? '' : String(limitUp);
    res.high = (high == null) ? '' : String(high);
    res.lb = (lb == null) ? '' : String(lb);
    // 炸板率 = Math.round(zhaban / (limitUp + zhaban) * 100)，分母为 0 时留空
    var denom = (limitUp == null || zhaban == null) ? 0 : (limitUp + zhaban);
    res.zbl = (denom > 0) ? String(Math.round(zhaban / denom * 100)) : '';
    res.hasSnapshot = !!(res.date || res.zt || res.high || res.lb || res.zbl);
    return res;
  }

  /* =======================================================================
   * 三、面板 HTML 生成（结构照搬 renderX，类名统一 tb- 前缀）
   * ======================================================================= */

  function annoHtml(text, kind) {
    return '<span class="tb-anno tb-anno-' + kind + '">' + escapeHtml(text) + '</span>';
  }

  /** 数字输入字段：label + 来源标注 + hint + input + 单位 */
  function fldNumHtml(o) {
    return '<div class="tb-fld"><label>' + o.name + annoHtml(o.anno, o.kind) +
      '<span class="tb-hint">' + (o.hint == null ? '' : o.hint) + '</span></label>' +
      '<div class="tb-ctrl"><input type="number" step="0.1" ' + o.attr +
      ' value="' + escapeHtml(o.value) + '"><span class="tb-unit">' + (o.unit || '') + '</span></div></div>';
  }

  /** 下拉字段：label + 来源标注 + select */
  function fldSelHtml(o) {
    return '<div class="tb-fld"><label>' + o.name + annoHtml(o.anno, o.kind) +
      (o.hint ? '<span class="tb-hint">' + o.hint + '</span>' : '') + '</label>' +
      '<select ' + o.attr + '>' + o.opts + '</select></div>';
  }

  var SNAP_KEYS = { zt: true, high: true, lb: true, zbl: true };

  function renderThermoBody(P) {
    var vals = {
      prem: '', zt: P.zt, high: P.high, lb: P.lb, zbl: P.zbl,
      jjl: '', damian: '', upr: '', vol: ''
    };
    var h = '<div class="tb-tool-title">情绪温度测算</div>' +
      '<div class="tb-tool-desc">输入当日九项核心数据（收盘后测算），系统自动换算为 0–100 的情绪温度，并给出阶段定位、建议仓位与操作要点。</div>';
    h += '<div class="tb-f2">';
    T_FIELDS.forEach(function (f) {
      var v = vals[f.k] || '';
      var anno, kind;
      if (SNAP_KEYS[f.k] && v !== '') {
        anno = '来自今日快照' + (P.date ? ' ' + P.date : '');
        kind = 'auto';
      } else {
        anno = ANNO_MISS;
        kind = 'miss';
      }
      h += fldNumHtml({
        name: f.n, hint: f.d, unit: f.u, value: v, anno: anno, kind: kind,
        attr: 'data-tb-key="thermo.' + f.k + '" data-tb-f="' + f.k + '"'
      });
    });
    h += '</div>';
    // 情绪方向（ΔT3）：参考站默认「走平」，本站快照不含，标注需自行判断
    h += '<div class="tb-fld"><label>情绪方向（ΔT3：今日温度相对前三日均值的变化）' +
      annoHtml(ANNO_JUDGE, 'judge') + '</label>' +
      '<select data-tb-key="thermo.dir" data-tb-dir="dir">' +
      '<option value="up">上升（上行段）</option>' +
      '<option value="flat" selected>走平（震荡/转折待定）</option>' +
      '<option value="down">下降（下行段）</option></select></div>';
    h += '<div class="tb-judge">情绪方向（ΔT3）本站快照不含，默认沿用参考站「走平」，请按需调整；上方标「快照不含，需手动填写」的字段需手动填写，工具不会用默认值代替。</div>';
    h += '<button type="button" class="tb-btn" data-tb-run="thermo">开始测算</button>';
    h += '<div class="tb-result" data-tb-result></div>';
    return h;
  }

  function renderMainlineBody() {
    var h = '<div class="tb-tool-title">主线强度评分</div>' +
      '<div class="tb-tool-desc">对目标板块打分：≥70 = 主线；50–70 = 准主线/强支线；30–50 = 支线；&lt;30 = 一日游/杂毛轮动。</div>';
    h += '<div class="tb-judge">本工具 6 项输入本站快照均不含，需自行判断；下拉默认「请选择」留空、数字框留空，工具不会用默认值代替。</div>';
    ML_FIELDS.forEach(function (f) {
      var attr = 'data-tb-key="mainline.' + f.k + '" data-tb-f="' + f.k + '"';
      if (f.type === 'sel') {
        // 参考站 fldSel 的选项文案与分值一字不改；首位追加空占位实现「留空」
        var opts = '<option value="" selected>' + PH_TEXT + '</option>' +
          f.opts.map(function (o) {
            return '<option value="' + o[1] + '">' + o[0] + '（+' + o[1] + '分）</option>';
          }).join('');
        h += fldSelHtml({ name: f.n, hint: '', anno: ANNO_JUDGE, kind: 'judge', attr: attr, opts: opts });
      } else {
        h += fldNumHtml({ name: f.n, hint: '', unit: f.u, value: '', anno: ANNO_JUDGE, kind: 'judge', attr: attr });
      }
    });
    h += '<button type="button" class="tb-btn" data-tb-run="mainline">计算强度</button>';
    h += '<div class="tb-result" data-tb-result></div>';
    return h;
  }

  function renderDivergeBody() {
    var h = '<div class="tb-tool-title">良性 / 恶性分歧判定</div>' +
      '<div class="tb-tool-desc">逐项判定分歧的十二个维度（左边=良性 +1，中间=中性 0，右边=恶性 −1）。得分 ≥+4 → 良性；≤−3 → 恶性；其余为中性观望。</div>';
    h += '<div class="tb-judge">本工具 12 项本站快照均不含，需自行判断；每项默认「请选择」留空，工具不会用默认值代替（留空按 0 计入）。</div>';
    DV_ITEMS.forEach(function (it, i) {
      // 参考站 3 个选项文案一字不改；首位追加空占位实现「留空」
      var opts = '<option value="" selected>' + PH_TEXT + '</option>' +
        '<option value="1">✓ ' + it[1] + '</option>' +
        '<option value="0">— ' + it[2] + '</option>' +
        '<option value="-1">✕ ' + it[3] + '</option>';
      h += fldSelHtml({
        name: (i + 1) + '. ' + it[0], hint: '', anno: ANNO_JUDGE, kind: 'judge',
        attr: 'data-tb-key="diverge.' + i + '" data-tb-dv="' + i + '"', opts: opts
      });
    });
    h += '<button type="button" class="tb-btn" data-tb-run="diverge">判定分歧性质</button>';
    h += '<div class="tb-result" data-tb-result></div>';
    return h;
  }

  function renderDragonBody() {
    var h = '<div class="tb-tool-title">龙头体检表</div>' +
      '<div class="tb-tool-desc">勾选候选龙头<b>符合</b>的特征（共 17 项），并勾选<b>已命中</b>的见顶信号（共 12 项）。</div>';
    h += '<div class="tb-judge">本工具 29 项本站快照均不含，需自行判断；所有项默认不勾选，工具不会用默认值代替。</div>';
    h += '<h5 class="tb-sub2" style="color:var(--cyan)">一、龙头成色（符合项）</h5><div class="tb-chk-grid">' +
      DR_GOOD.map(function (x, i) {
        return '<label class="tb-chk"><input type="checkbox" data-tb-key="dragon.g' + i + '" data-tb-dg="' + i + '"><span>' + x + '</span></label>';
      }).join('') + '</div>';
    h += '<h5 class="tb-sub2" style="color:var(--up);margin-top:18px">二、见顶信号（命中项）</h5><div class="tb-chk-grid">' +
      DR_BAD.map(function (x, i) {
        return '<label class="tb-chk"><input type="checkbox" data-tb-key="dragon.b' + i + '" data-tb-db="' + i + '"><span>' + x + '</span></label>';
      }).join('') + '</div>';
    h += '<button type="button" class="tb-btn" style="margin-top:14px" data-tb-run="dragon">生成体检报告</button>';
    h += '<div class="tb-result" data-tb-result></div>';
    return h;
  }

  function renderLocateBody() {
    var h = '<div class="tb-tool-title">周期阶段定位器</div>' +
      '<div class="tb-tool-desc">回答六个问题，快速定位当前所处的情绪周期阶段（适用于没有完整数据时的快速判断）。</div>';
    h += '<div class="tb-judge">本工具 6 问本站快照均不含，需自行判断；每题默认「请选择」留空，工具不会用默认值代替（留空按第一档计入）。</div>';
    LC_Q.forEach(function (q, i) {
      var opts = '<option value="" selected>' + PH_TEXT + '</option>' +
        q.opts.map(function (o, j) { return '<option value="' + j + '">' + o + '</option>'; }).join('');
      h += fldSelHtml({
        name: (i + 1) + '. ' + q.n, hint: '', anno: ANNO_JUDGE, kind: 'judge',
        attr: 'data-tb-key="locate.' + q.k + '" data-tb-lc="' + q.k + '"', opts: opts
      });
    });
    h += '<button type="button" class="tb-btn" data-tb-run="locate">定位阶段</button>';
    h += '<div class="tb-result" data-tb-result></div>';
    return h;
  }

  var PANELS = {
    thermo: renderThermoBody,
    mainline: renderMainlineBody,
    diverge: renderDivergeBody,
    dragon: renderDragonBody,
    locate: renderLocateBody
  };

  /* =======================================================================
   * 四、计算与结果展示（结论文案 / tips 逐字照搬 renderX 的 onclick）
   * ======================================================================= */

  function V(body, attr, key) {
    var el = body.querySelector('[' + attr + '="' + key + '"]');
    return el ? el.value : '';
  }

  function showResult(state, html, blankCount, total) {
    var res = state.rootEl.querySelector('[data-tb-result]');
    if (!res) return;
    var note = '';
    if (blankCount > 0) {
      note = '<div class="tb-blank">⚠️ 当前 ' + blankCount + '/' + total +
        ' 项输入未填写/未选择（标注「快照不含」或「需自行判断」）。工具不会用默认值代替，留空项按 0 参与计算，结论可能偏高或偏低；计算结果仅供方法研究，不构成投资建议，请补全后重算。</div>';
    }
    res.innerHTML = note + html;
    res.classList.add('tb-on');
  }

  function runThermo(state) {
    var body = state.rootEl.querySelector('[data-tb-body]');
    if (!body) return;
    var v = {}, blanks = 0;
    T_FIELDS.forEach(function (f) {
      var raw = V(body, 'data-tb-f', f.k);
      if (raw === '') blanks++;
      v[f.k] = parseFloat(raw) || 0;
    });
    var dir = V(body, 'data-tb-dir', 'dir') || 'flat';
    var r = thermoScore(v);
    var st = thermoStage(r.total, dir);
    var detail = r.detail.map(function (x) {
      return '<div class="tb-score-row"><span class="tb-sr-name">' + x[0] + '</span><span class="tb-sr-bar"><i style="width:' + (x[1] / x[2] * 100) + '%"></i></span><span class="tb-sr-val">' + x[1] + '/' + x[2] + '</span></div>';
    }).join('');
    var html =
      '<div class="tb-res-head"><span class="tb-res-big" style="color:' + st.c + '">' + r.total + '</span>' +
      '<span class="tb-res-stage" style="color:' + st.c + '">' + st.n + '</span>' +
      '<span class="tb-tag tb-t-gy">建议仓位 ' + st.pos + '</span></div>' +
      '<div class="tb-res-bar"><i style="width:' + r.total + '%;background:linear-gradient(90deg,#22c55e,#e8b64c,#f0483e)"></i></div>' +
      '<div class="tb-res-scale"><span>0 冰点</span><span>35 启动</span><span>68 高潮</span><span>100 亢奋</span></div>' +
      '<div class="tb-res-sec"><h6>评分明细</h6>' + detail + '</div>' +
      '<div class="tb-res-sec"><h6>核心动作</h6><div class="tb-ri tb-y"><span class="tb-rk">操作</span><span>' + st.act + '</span></div></div>' +
      '<div class="tb-res-sec"><h6>关键提醒</h6><ul>' + st.tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
    showResult(state, html, blanks, T_FIELDS.length);
  }

  function runMainline(state) {
    var body = state.rootEl.querySelector('[data-tb-body]');
    if (!body) return;
    var g = function (k) { return parseFloat(V(body, 'data-tb-f', k)) || 0; };
    var blanks = 0;
    ML_FIELDS.forEach(function (f) { if (V(body, 'data-tb-f', f.k) === '') blanks++; });
    var s = g('days') + g('echelon') + g('zj') + g('cat') + mlRatioScore(g('ratio')) + mlJjlScore(g('jjl'));
    var tag, col, act;
    if (s >= 70) { tag = '主线'; col = '#f0483e'; act = '可作为主线操作：重仓龙头、做最强前排、持有主升。仓位可到 60–80%。'; }
    else if (s >= 50) { tag = '准主线 / 强支线'; col = '#e8b64c'; act = '按强支线操作：仓位不超过主线的一半，只做最高板或最强前排，快进快出。'; }
    else if (s >= 30) { tag = '支线'; col = '#38d9d0'; act = '按支线操作：仓位 ≤20%，只做龙头不做跟风，不连板就走。观察是否具备升级为主线的条件。'; }
    else { tag = '一日游 / 杂毛轮动'; col = '#22c55e'; act = '不参与。等待出现「高度 + 梯队 + 持续」三件套后再考虑。'; }
    var rows = [
      ['持续性', g('days'), 25], ['板块涨停占比', mlRatioScore(g('ratio')), 20], ['梯队完整度', g('echelon'), 20],
      ['中军强度', g('zj'), 15], ['催化级别', g('cat'), 10], ['板块晋级率', mlJjlScore(g('jjl')), 10]
    ].map(function (x) {
      return '<div class="tb-score-row"><span class="tb-sr-name">' + x[0] + '</span><span class="tb-sr-bar"><i style="width:' + (x[1] / x[2] * 100) + '%"></i></span><span class="tb-sr-val">' + x[1] + '/' + x[2] + '</span></div>';
    }).join('');
    var html = '<div class="tb-res-head"><span class="tb-res-big" style="color:' + col + '">' + s + '</span><span class="tb-res-stage" style="color:' + col + '">' + tag + '</span></div>' +
      '<div class="tb-res-bar"><i style="width:' + s + '%;background:linear-gradient(90deg,#38d9d0,#e8b64c,#f0483e)"></i></div>' +
      '<div class="tb-res-scale"><span>0</span><span>30 支线</span><span>50 准主线</span><span>70 主线</span><span>100</span></div>' +
      '<div class="tb-res-sec"><h6>评分明细</h6>' + rows + '</div>' +
      '<div class="tb-res-sec"><h6>操作建议</h6><div class="tb-ri tb-y"><span class="tb-rk">建议</span><span>' + act + '</span></div></div>' +
      '<div class="tb-res-sec"><h6>主线六有校验</h6><ul><li>有高度（板块内≥5板）</li><li>有梯队（高中低位链条完整）</li><li>有中军（且放量上攻）</li><li>有持续（连续3日涨停≥5家）</li><li>有龙头（公认龙一且能带动板块）</li><li>有逻辑（题材清晰可延展）</li></ul></div>';
    showResult(state, html, blanks, ML_FIELDS.length);
  }

  function runDiverge(state) {
    var body = state.rootEl.querySelector('[data-tb-body]');
    if (!body) return;
    var s = 0, y = 0, n = 0, blanks = 0;
    DV_ITEMS.forEach(function (_, i) {
      var raw = V(body, 'data-tb-dv', String(i));
      var val = parseInt(raw, 10);
      if (raw === '' || isNaN(val)) { blanks++; val = 0; }
      s += val; if (val > 0) y++; if (val < 0) n++;
    });
    var tag, col, act;
    if (s >= 4) { tag = '良性分歧（可参与）'; col = '#22c55e'; act = '可在分歧低点低吸龙头，或在次日「分歧转一致」时买入。良性分歧是最佳买点的素材，可保留龙头底仓并考虑加仓。'; }
    else if (s <= -3) { tag = '恶性分歧（必须回避）'; col = '#f0483e'; act = '立即清仓走人，不接任何高位、不抄底、不赌反包。恶性分歧后往往开启退潮，应切换至空仓或极小仓试错新方向。'; }
    else { tag = '中性 / 待定（观望）'; col = '#e8b64c'; act = '先减仓至 40% 以下，等待次日开盘验证：高开 +2% 以上并快速上板 = 转一致（可买）；低开 −2% 以下 = 分歧失败（立即走）。'; }
    var html = '<div class="tb-res-head"><span class="tb-res-big" style="color:' + col + '">' + (s > 0 ? '+' : '') + s + '</span>' +
      '<span class="tb-res-stage" style="color:' + col + '">' + tag + '</span>' +
      '<span class="tb-tag tb-t-gy">良性项 ' + y + ' · 恶性项 ' + n + '</span></div>' +
      '<div class="tb-res-bar"><i style="width:' + Math.max(0, Math.min(100, (s + 12) / 24 * 100)) + '%;background:' + col + '"></i></div>' +
      '<div class="tb-res-scale"><span>−12 恶性</span><span>0 中性</span><span>+12 良性</span></div>' +
      '<div class="tb-res-sec"><h6>操作建议</h6><div class="tb-ri ' + (s >= 4 ? 'tb-g' : s <= -3 ? 'tb-r' : 'tb-y') + '"><span class="tb-rk">动作</span><span>' + act + '</span></div></div>' +
      '<div class="tb-res-sec"><h6>三条铁律校验</h6><ul>' +
      '<li><b>首分最安全：</b>这是本轮第几次分歧？（首分成功率 &gt;60%，三分 &lt;25%）</li>' +
      '<li><b>位置决定性质：</b>同样爆量烂板，3 板良性，7 板恶性</li>' +
      '<li><b>必须有接盘方：</b>分歧后无人接（次日低开）即为恶性，无论几板</li></ul></div>';
    showResult(state, html, blanks, DV_ITEMS.length);
  }

  function runDragon(state) {
    var body = state.rootEl.querySelector('[data-tb-body]');
    if (!body) return;
    var g = 0, b = 0;
    DR_GOOD.forEach(function (_, i) {
      var el = body.querySelector('[data-tb-dg="' + i + '"]');
      if (el && el.checked) g++;
    });
    DR_BAD.forEach(function (_, i) {
      var el = body.querySelector('[data-tb-db="' + i + '"]');
      if (el && el.checked) b++;
    });
    var tag, col, act;
    if (g >= 12 && b <= 1) { tag = '真龙 · 强势期'; col = '#f0483e'; act = '可重仓参与（30–40%）。核心买点是「分歧转一致」与「成龙点（3板）」。持有为主，不轻易下车。'; }
    else if (g >= 12) { tag = '真龙 · 但已见顶信号'; col = '#e8b64c'; act = '减少仓位至 10–20%，设置硬止损（破 5 日线清仓）。不再加仓，等待反包确认或破位离场。'; }
    else if (g >= 8) { tag = '强候选 · 尚需确认'; col = '#38d9d0'; act = '可小仓参与（15–25%），等「3 板成龙点」或「分歧转一致」确认后再加仓。注意观察是否能带动板块。'; }
    else { tag = '成色不足 / 疑似伪龙'; col = '#22c55e'; act = '不参与或极小仓试错。缺乏龙头特征意味着缺乏接盘方，风险极高。'; }
    var warn = b === 0 ? '无见顶信号' : b <= 2 ? '轻度预警（关注）' : b <= 4 ? '中度预警（减仓至 1/3）' : '重度预警（立即清仓）';
    var wcol = b === 0 ? '#22c55e' : b <= 2 ? '#e8b64c' : b <= 4 ? '#f59e0b' : '#f0483e';
    var html = '<div class="tb-res-head"><span class="tb-res-big" style="color:' + col + '">' + g + '<span style="font-size:16px;color:var(--tx3)">/17</span></span>' +
      '<span class="tb-res-stage" style="color:' + col + '">' + tag + '</span></div>' +
      '<div class="tb-res-bar"><i style="width:' + (g / 17 * 100) + '%;background:' + col + '"></i></div>' +
      '<div class="tb-res-scale"><span>0</span><span>8 候选</span><span>12 真龙</span><span>17</span></div>' +
      '<div class="tb-res-sec"><h6>见顶风险评估</h6>' +
      '<div class="tb-ri ' + (b >= 5 ? 'tb-r' : b >= 3 ? 'tb-y' : 'tb-g') + '"><span class="tb-rk">命中 ' + b + ' 项</span><span><b style="color:' + wcol + '">' + warn + '</b> —— ' +
      (b >= 5 ? '命中 ≥5 个见顶信号，无条件清仓。' : b >= 3 ? '命中 ≥3 个见顶信号，减仓 1/3 并设置硬止损。' : b >= 1 ? '开始关注，准备减仓方案。' : '暂无见顶迹象，可继续持有。') + '</span></div></div>' +
      '<div class="tb-res-sec"><h6>操作建议</h6><div class="tb-ri tb-y"><span class="tb-rk">动作</span><span>' + act + '</span></div></div>' +
      '<div class="tb-res-sec"><h6>龙头六大买点（按确定性排序）</h6><ul>' +
      '<li><b>① 分歧转一致</b>（确定性 &gt;70%）—— 最佳买点</li>' +
      '<li><b>② 成龙点（3 板）</b>（65%）—— 带动板块 ≥3 家涨停</li>' +
      '<li><b>③ 卡位成功日</b>（60%）</li>' +
      '<li><b>④ 弱转强</b>（55%）</li>' +
      '<li><b>⑤ 反包确认</b>（50%）</li>' +
      '<li><b>⑥ 首阴低吸</b>（40%）—— 仓位 ≤10%</li></ul></div>';
    showResult(state, html, 0, 0);
  }

  function runLocate(state) {
    var body = state.rootEl.querySelector('[data-tb-body]');
    if (!body) return;
    var a = {}, blanks = 0;
    LC_Q.forEach(function (q) {
      var raw = V(body, 'data-tb-lc', q.k);
      var val = parseInt(raw, 10);
      if (raw === '' || isNaN(val)) { blanks++; val = 0; }
      a[q.k] = val;
    });
    var r = locate(a);
    var ad = LC_ADVICE[r.key];
    var bars = Object.keys(r.sc).sort(function (x, y) { return r.sc[y] - r.sc[x]; }).map(function (k) {
      return '<div class="tb-score-row"><span class="tb-sr-name">' + r.names[k] + '</span><span class="tb-sr-bar"><i style="width:' + (r.sc[k] / 20 * 100) + '%"></i></span><span class="tb-sr-val">' + r.sc[k] + '</span></div>';
    }).join('');
    var html = '<div class="tb-res-head"><span class="tb-res-stage" style="font-size:24px;color:var(--gold)">' + r.name + '</span>' +
      '<span class="tb-tag tb-t-gd">建议仓位 ' + ad.pos + '</span></div>' +
      '<div class="tb-res-sec"><h6>阶段匹配度</h6>' + bars + '</div>' +
      '<div class="tb-res-sec"><h6>核心动作</h6><div class="tb-ri tb-y"><span class="tb-rk">操作</span><span>' + ad.act + '</span></div></div>' +
      '<div class="tb-res-sec"><h6>关键提醒</h6><ul>' + ad.tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
    showResult(state, html, blanks, LC_Q.length);
  }

  var RUNNERS = {
    thermo: runThermo, mainline: runMainline, diverge: runDiverge,
    dragon: runDragon, locate: runLocate
  };

  /* =======================================================================
   * 五、状态 / 事件委托 / render
   * ======================================================================= */

  var STATE = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var FALLBACK = []; // WeakMap 不可用时的 rootEl -> state 线性表

  function getState(rootEl) {
    if (STATE) return STATE.get(rootEl);
    for (var i = 0; i < FALLBACK.length; i++) {
      if (FALLBACK[i].rootEl === rootEl) return FALLBACK[i];
    }
    return null;
  }
  function setState(rootEl, s) {
    if (STATE) { STATE.set(rootEl, s); return; }
    for (var i = 0; i < FALLBACK.length; i++) {
      if (FALLBACK[i].rootEl === rootEl) { FALLBACK[i] = s; return; }
    }
    FALLBACK.push(s);
  }

  function captureValues(state) {
    var body = state.rootEl.querySelector('[data-tb-body]');
    if (!body) return;
    var map = {};
    var els = body.querySelectorAll('[data-tb-key]');
    Array.prototype.forEach.call(els, function (el) {
      map[el.getAttribute('data-tb-key')] = { value: el.value, checked: !!el.checked };
    });
    var res = body.querySelector('[data-tb-result]');
    state.cache[state.activeTab] = {
      fields: map,
      result: res ? res.innerHTML : '',
      on: res ? res.classList.contains('tb-on') : false
    };
  }

  function restoreValues(state) {
    var body = state.rootEl.querySelector('[data-tb-body]');
    if (!body) return;
    var c = state.cache[state.activeTab];
    if (!c) return;
    var els = body.querySelectorAll('[data-tb-key]');
    Array.prototype.forEach.call(els, function (el) {
      var saved = c.fields[el.getAttribute('data-tb-key')];
      if (!saved) return;
      if (el.type === 'checkbox') el.checked = saved.checked;
      else el.value = saved.value;
    });
    var res = body.querySelector('[data-tb-result]');
    if (res && c.result) {
      res.innerHTML = c.result;
      if (c.on) res.classList.add('tb-on');
    }
  }

  function renderBody(state) {
    var body = state.rootEl.querySelector('[data-tb-body]');
    if (!body) return;
    var fn = PANELS[state.activeTab] || PANELS.thermo;
    body.innerHTML = fn(state.prefill);
    restoreValues(state);
  }

  function switchTool(state, id) {
    if (!PANELS[id]) return;
    captureValues(state);
    state.activeTab = id;
    var tabs = state.rootEl.querySelectorAll('[data-tb-tab]');
    Array.prototype.forEach.call(tabs, function (b) {
      if (b.getAttribute('data-tb-tab') === id) b.classList.add('tb-on');
      else b.classList.remove('tb-on');
    });
    renderBody(state);
  }

  /**
   * 重建 rootEl 内容并绑定一次性委托事件。
   * @param {Element} rootEl 主站交给本模块的容器（如 #view）
   * @param {Object|null} snapshot 本站 state.data（单日收盘快照）；null 时全部手填
   */
  function render(rootEl, snapshot) {
    if (!rootEl || typeof rootEl.querySelector !== 'function') return;

    var prev = getState(rootEl);
    if (prev && prev.controller) {
      try { prev.controller.abort(); } catch (e) { /* 忽略：旧环境无 abort */ }
    } else if (prev && prev.onClick) {
      try { rootEl.removeEventListener('click', prev.onClick); } catch (e) { /* 忽略 */ }
    }

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var state = {
      rootEl: rootEl,
      snapshot: snapshot || null,
      prefill: computePrefill(snapshot),
      activeTab: 'thermo',
      cache: {},
      controller: controller,
      onClick: null
    };
    setState(rootEl, state);

    var tabHtml = TABS.map(function (t) {
      return '<button type="button" class="tb-tab' + (t.id === 'thermo' ? ' tb-on' : '') +
        '" data-tb-tab="' + t.id + '" role="tab">' + t.name + '</button>';
    }).join('');

    rootEl.innerHTML =
      '<div class="tb-wrap">' +
        '<div class="tb-boundary">' + BOUNDARY + '</div>' +
        '<div class="tb-tabs" role="tablist">' + tabHtml + '</div>' +
        '<div class="tb-body" data-tb-body></div>' +
      '</div>';

    renderBody(state);

    var onClick = function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var tabBtn = target.closest('[data-tb-tab]');
      if (tabBtn && rootEl.contains(tabBtn)) {
        switchTool(state, tabBtn.getAttribute('data-tb-tab'));
        return;
      }
      var runBtn = target.closest('[data-tb-run]');
      if (runBtn && rootEl.contains(runBtn)) {
        var tool = runBtn.getAttribute('data-tb-run');
        if (RUNNERS[tool]) RUNNERS[tool](state);
      }
    };

    if (controller) {
      rootEl.addEventListener('click', onClick, { signal: controller.signal });
    } else {
      // AbortController 不可用时的兜底：显式移除旧监听，保证不重复绑定
      rootEl.addEventListener('click', onClick);
      state.onClick = onClick;
      state.controller = null;
    }
  }

  global.YGToolbox = { render: render };
})(typeof window !== 'undefined' ? window : this);
