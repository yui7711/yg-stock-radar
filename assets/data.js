/* =========================================================================
 * data.js — 数据适配层（妖股雷达）
 * -------------------------------------------------------------------------
 * 数据源：同花顺金融数据 API（官方 https://fuyao.aicubes.cn）
 *   鉴权：请求头 X-api-key: <API Key>
 *   统一响应信封：{ code, message, request_id, data }
 *
 * 使用到的端点（均为 GET）：
 *   /api/a-share/special-data/limit-up-pool        涨停/连板股票池
 *   /api/a-share/special-data/limit-up-statistics  涨停强度与晋级统计
 *   /api/a-share/special-data/limit-down-pool      跌停股票池
 *
 * 未取到真实数据时自动回退到内置演示数据（虚构样本，非投资建议）。
 *
 * ⚠️ 安全提示：API Key 属于敏感凭证。本文件默认内置了一把 Key 以便开箱即用，
 *    仅适合本机/个人使用。若要对外部署，请改为经由你自己的后端代理转发，
 *    不要把 Key 暴露在浏览器端；可在「设置」页清空内置 Key。
 * ========================================================================= */
(function (global) {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, d = 0) => { const p = Math.pow(10, d); return Math.round(v * p) / p; };
  const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const todayISO = () => {
    const d = new Date(Date.now() + 8 * 3600 * 1000); // Asia/Shanghai
    return d.toISOString().slice(0, 10);
  };

  // =========================================================================
  // 演示数据（离线/接口不可用时回退，虚构样本）
  // =========================================================================
  const RAW = [
    { code: '603218', name: '日月股份', price: 18.42, changePct: 10.02, boards: 8, turnover: 6.8, seal: 31200, sector: '风电', concepts: ['风电', '海风', '高端装备'], reason: '海风装机超预期+大兆瓦铸件稀缺。', mainFlow: 28600, cap: 168, limitType: 2, firstTime: '09:31' },
    { code: '002829', name: '星网锐捷', price: 24.17, changePct: 10.0, boards: 7, turnover: 9.1, seal: 25400, sector: '算力', concepts: ['算力', '交换机', 'AI服务器'], reason: '国产算力交换机订单爆发。', mainFlow: 24100, cap: 142, limitType: 2, firstTime: '09:35' },
    { code: '300620', name: '光库科技', price: 56.33, changePct: 20.0, boards: 6, turnover: 12.4, seal: 18800, sector: '半导体', concepts: ['光模块', 'CPO'], reason: '1.6T光模块送样通过。', mainFlow: 19800, cap: 121, limitType: 3, firstTime: '10:02' },
    { code: '605588', name: '熙菱信息', price: 13.88, changePct: 10.01, boards: 6, turnover: 14.2, seal: 9600, sector: '信创', concepts: ['信创', '数据安全'], reason: '党政信创招标提速。', mainFlow: 8200, cap: 38, limitType: 2, firstTime: '09:41' },
    { code: '002792', name: '通宇通讯', price: 21.05, changePct: 10.0, boards: 5, turnover: 11.3, seal: 14200, sector: '通信', concepts: ['卫星互联网', '5.5G'], reason: '低轨卫星互联网组网加速。', mainFlow: 12600, cap: 86, limitType: 2, firstTime: '09:38' },
    { code: '603893', name: '瑞芯微', price: 88.6, changePct: 10.0, boards: 5, turnover: 5.6, seal: 22300, sector: '半导体', concepts: ['SoC', 'AIoT'], reason: '端侧AI芯片放量。', mainFlow: 21700, cap: 372, limitType: 1, firstTime: '09:25' },
    { code: '300394', name: '天孚通信', price: 132.4, changePct: 20.0, boards: 4, turnover: 8.9, seal: 17600, sector: '半导体', concepts: ['光模块', 'CPO'], reason: '海外云厂资本开支上修。', mainFlow: 18900, cap: 528, limitType: 3, firstTime: '09:46' },
    { code: '002085', name: '万丰奥威', price: 16.77, changePct: 10.0, boards: 4, turnover: 13.7, seal: 11200, sector: '低空经济', concepts: ['eVTOL', '低空经济'], reason: '适航审定进展+地方政策。', mainFlow: 13400, cap: 356, limitType: 2, firstTime: '09:52' },
    { code: '603667', name: '五洲新春', price: 19.34, changePct: 10.0, boards: 4, turnover: 10.2, seal: 8800, sector: '机器人', concepts: ['人形机器人', '丝杠'], reason: '机器人量产预期。', mainFlow: 9600, cap: 71, limitType: 2, firstTime: '10:08' },
    { code: '300607', name: '拓斯达', price: 22.18, changePct: 20.0, boards: 3, turnover: 16.5, seal: 6400, sector: '机器人', concepts: ['工业机器人', '具身智能'], reason: '国产替代+具身智能。', mainFlow: 7100, cap: 94, limitType: 2, firstTime: '10:15' },
    { code: '002403', name: '爱仕达', price: 11.26, changePct: 10.0, boards: 3, turnover: 18.3, seal: 4200, sector: '机器人', concepts: ['机器人', '小家电'], reason: '跨界机器人概念。', mainFlow: 3800, cap: 38, limitType: 2, firstTime: '10:22' },
    { code: '605333', name: '沪光股份', price: 27.92, changePct: 10.0, boards: 3, turnover: 7.8, seal: 9100, sector: '新能源车', concepts: ['汽车线束', '华为汽车'], reason: '华为系车型放量。', mainFlow: 8800, cap: 122, limitType: 2, firstTime: '09:44' },
    { code: '603178', name: '圣龙股份', price: 24.05, changePct: 10.0, boards: 3, turnover: 12.1, seal: 7600, sector: '新能源车', concepts: ['油泵', '热管理'], reason: '混动渗透率提升。', mainFlow: 6900, cap: 57, limitType: 2, firstTime: '09:57' },
    { code: '002615', name: '哈尔斯', price: 9.84, changePct: 10.0, boards: 3, turnover: 19.7, seal: 3100, sector: '消费', concepts: ['保温杯', '跨境电商'], reason: '外销高景气+小市值。', mainFlow: 2900, cap: 41, limitType: 2, firstTime: '10:19' },
    { code: '301236', name: '软通动力', price: 48.12, changePct: 19.99, boards: 2, turnover: 9.4, seal: 13200, sector: '信创', concepts: ['鸿蒙', '信创'], reason: '鸿蒙生态扩张。', mainFlow: 14800, cap: 458, limitType: 3, firstTime: '09:48' },
    { code: '002230', name: '科大讯飞', price: 52.77, changePct: 10.0, boards: 2, turnover: 6.2, seal: 19800, sector: '人工智能', concepts: ['大模型', 'AI教育'], reason: '大模型落地加速。', mainFlow: 22100, cap: 1218, limitType: 1, firstTime: '09:25' },
    { code: '300624', name: '万兴科技', price: 76.45, changePct: 20.0, boards: 2, turnover: 13.6, seal: 6700, sector: '人工智能', concepts: ['AIGC', '创意软件'], reason: 'AI应用出海高增。', mainFlow: 7300, cap: 161, limitType: 3, firstTime: '10:05' },
    { code: '603019', name: '中科曙光', price: 49.88, changePct: 10.0, boards: 2, turnover: 5.1, seal: 20100, sector: '算力', concepts: ['国产算力', '液冷'], reason: '国产算力底座。', mainFlow: 21400, cap: 731, limitType: 1, firstTime: '09:25' },
    { code: '300502', name: '新易盛', price: 108.3, changePct: 20.0, boards: 2, turnover: 8.3, seal: 15400, sector: '半导体', concepts: ['光模块', '800G'], reason: '800G份额提升。', mainFlow: 16900, cap: 766, limitType: 3, firstTime: '09:50' },
    { code: '002463', name: '沪电股份', price: 34.16, changePct: 10.0, boards: 2, turnover: 6.7, seal: 17600, sector: '半导体', concepts: ['PCB', 'AI服务器'], reason: 'AI服务器PCB高增。', mainFlow: 18200, cap: 652, limitType: 2, firstTime: '09:36' },
    { code: '002896', name: '中大力德', price: 38.74, changePct: 10.0, boards: 2, turnover: 11.9, seal: 5800, sector: '机器人', concepts: ['减速器', '人形机器人'], reason: '减速器国产替代。', mainFlow: 6100, cap: 59, limitType: 2, firstTime: '09:55' },
    { code: '300476', name: '胜宏科技', price: 41.29, changePct: 20.0, boards: 2, turnover: 9.7, seal: 10200, sector: '半导体', concepts: ['PCB', 'HDI'], reason: 'AI算力PCB饱满。', mainFlow: 11300, cap: 357, limitType: 3, firstTime: '09:47' },
    { code: '603728', name: '鸣志电器', price: 58.93, changePct: 10.0, boards: 2, turnover: 7.4, seal: 12100, sector: '机器人', concepts: ['步进电机', '空心杯'], reason: '空心杯电机稀缺。', mainFlow: 12800, cap: 248, limitType: 2, firstTime: '09:40' },
    { code: '002881', name: '美格智能', price: 27.65, changePct: 10.0, boards: 2, turnover: 12.8, seal: 4900, sector: '通信', concepts: ['边缘AI', '模组'], reason: '边缘AI模组放量。', mainFlow: 5200, cap: 72, limitType: 2, firstTime: '10:12' },
    { code: '002241', name: '歌尔股份', price: 26.84, changePct: 10.0, boards: 2, turnover: 8.6, seal: 16700, sector: '消费电子', concepts: ['MR', '声学'], reason: 'MR出货上修。', mainFlow: 17400, cap: 918, limitType: 2, firstTime: '09:39' },
    { code: '300735', name: '光弘科技', price: 29.47, changePct: 20.0, boards: 2, turnover: 13.2, seal: 5600, sector: '消费电子', concepts: ['代工', '华为'], reason: '华为链代工饱满。', mainFlow: 5900, cap: 226, limitType: 3, firstTime: '10:09' },
    { code: '002594', name: '比亚迪', price: 268.9, changePct: 10.0, boards: 2, turnover: 4.2, seal: 32600, sector: '新能源车', concepts: ['整车', '智能化'], reason: '智能化新车周期。', mainFlow: 33800, cap: 7820, limitType: 1, firstTime: '09:25' },
    { code: '300033', name: '同花顺', price: 142.6, changePct: 20.0, boards: 2, turnover: 9.1, seal: 11900, sector: '人工智能', concepts: ['金融AI', '大模型'], reason: '金融AI应用落地。', mainFlow: 12400, cap: 766, limitType: 3, firstTime: '09:51' }
  ];

  // =========================================================================
  // API 配置
  // =========================================================================
  const DEFAULT_API = {
    base: 'https://fuyao.aicubes.cn',
    // 内置 Key：仅本机个人使用；对外部署请改用后端代理，或在此清空。
    key: 'sk-fuyao-ZzXGDrEg8LVWl_4cb_T6KAuZO08Z5_z7',
    enabled: true
  };
  const CFG_KEY = 'yg_api_cfg_v2';

  const API = Object.assign({}, DEFAULT_API);

  function loadCfg() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(CFG_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c && typeof c === 'object') Object.assign(API, c);
    } catch (e) { /* ignore */ }
  }
  function persistCfg() {
    try { global.localStorage && global.localStorage.setItem(CFG_KEY, JSON.stringify({ base: API.base, key: API.key, enabled: API.enabled })); } catch (e) { /* ignore */ }
  }
  function setApi(cfg) {
    API.base = (cfg && cfg.base != null) ? String(cfg.base).trim() : API.base;
    API.key = (cfg && cfg.key != null) ? String(cfg.key).trim() : API.key;
    if (cfg && cfg.enabled != null) API.enabled = !!cfg.enabled;
    else API.enabled = !!API.base;
    persistCfg();
  }
  const getApi = () => ({ base: API.base, key: API.key, enabled: API.enabled });

  // ---------- 底层请求 ----------
  async function apiGet(path, params) {
    const qs = params ? new URLSearchParams(params).toString() : '';
    const url = API.base.replace(/\/$/, '') + path + (qs ? '?' + qs : '');
    const res = await fetch(url, { headers: { 'X-api-key': API.key } });
    let json = null;
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!json) throw new Error('响应不是合法 JSON');
    if (json.code !== 0) {
      const HINT = {
        1001: '缺少必填参数', 1002: '参数格式错误（枚举/日期/逗号越界）', 1003: '参数取值越界或超出时间窗',
        1004: '参数冲突（如半开区间）', 2001: 'API Key 缺失或无效', 2003: '该 Key 无权访问此能力',
        3001: '标的不存在', 3002: '数据未就绪（当日暂无）', 3004: '标的类型不支持',
        4001: '触发限流（请降低频率/并发）', 5001: '服务内部错误', 5002: '上游超时', 5003: '上游不可用'
      };
      throw new Error((HINT[json.code] || json.message || '接口错误') + '（code ' + json.code + '）');
    }
    return json.data;
  }

  // ---------- 字段映射：同花顺 -> 应用统一结构 ----------
  const splitConcepts = (reason) =>
    (reason || '').split(/[+＋、／\/｜|·,，;；]+/).map((s) => s.trim()).filter(Boolean);

  function mapPoolItem(it) {
    const reason = it.limit_up_reason || '';
    const concepts = splitConcepts(reason);
    const t = it.limit_up_time || '';
    const m = toMin(t);
    return {
      code: it.ticker,
      thscode: it.thscode,
      name: it.name,
      price: it.last_price,
      changePct: it.price_change_ratio_pct,
      boards: it.continue_day_cnt || 1,
      continueText: it.continue_day_text || '',
      seal: (it.seal_money || 0) / 10000,        // 元 -> 万元
      maxSeal: (it.max_seal_money || 0) / 10000,  // 元 -> 万元
      sector: concepts[0] || '其他',
      concepts: concepts.length ? concepts : ['其他'],
      tags: concepts.length ? concepts : ['其他'],
      reason: reason || '暂无题材说明',
      mainFlow: null,   // 涨停池未提供资金流
      cap: null,        // 涨停池未提供市值
      turnover: null,   // 涨停池未提供换手率
      limitType: (m != null && m <= 570) ? 1 : 2, // 09:30 前封板视为一字/秒板
      firstTime: t,
      isST: !!it.is_st,
      isNew: !!it.is_new
    };
  }

  // ---------- 概念热度（板块效应）----------
  function computeConceptHeat(stocks) {
    const map = {};
    stocks.forEach((s) => {
      (s.concepts || [s.sector]).forEach((c) => {
        if (!map[c]) map[c] = { sector: c, limitCount: 0, boards: 0, names: [] };
        map[c].limitCount += 1;
        map[c].boards += (s.boards || 1);
        map[c].names.push(s.name);
      });
    });
    Object.values(map).forEach((m) => {
      m.heat = clamp(Math.round(20 + (m.limitCount - 1) * 16 + (m.boards - m.limitCount) * 4), 0, 100);
    });
    return Object.values(map).sort((a, b) => (b.limitCount - a.limitCount) || (b.boards - a.boards));
  }

  // =========================================================================
  // 妖股概率因子模型 —— 豆包算法（推演自豆包应用 yaoModel.js，前端与后端一致）
  // 8 因子加权，满分 100：连板25 / 流通市值15 / 换手率15 / 量比10 / 板块效应10 / 游资10 / 主力净流入10 / 封单强度5
  // 字段缺失时对应因子按 0 计（与豆包逻辑一致）。真实同花顺涨停池缺 流通市值/换手率/量比/成交额/主力净流入，
  //   其中 流通市值/换手率/量比/成交额/主力净流入 经东方财富 push2（f117/f168/f50/f48/f62）代理补齐（见 fetchReal 的 fetchEMQuotes）；
  //   主力净流入 用「龙虎榜净额」代理；至此豆包 8 因子在真实态下全部可用。
  // =========================================================================
  const YAO_FAMOUS_YOUZI = [
    '国泰君安.*南京太平南路', '国盛证券.*宁波桑田路', '中国银河.*绍兴', '开源证券.*西安太华路',
    '中信证券.*上海溧阳路', '华泰证券.*深圳益田路.*荣超', '华鑫证券.*上海分公司', '东方财富.*拉萨团结路',
    '东方财富.*拉萨东环路', '中信建投.*北京中关村大街', '方正证券.*台州解放路', '中金公司.*上海黄浦',
    '国泰君安.*上海江苏路', '光大证券.*深圳金田路', '海通证券.*上海建国西路'
  ];
  function yaoIsFamousYouzi(seatName) {
    if (!seatName) return false;
    if (seatName.indexOf('机构专用') >= 0) return 'jigou';
    for (const kw of YAO_FAMOUS_YOUZI) { if (new RegExp(kw).test(seatName)) return 'famous'; }
    return 'normal';
  }
  function yaoLianbanScore(l) {
    if (l >= 7) return 23; if (l >= 4) return 25; if (l === 3) return 23; if (l === 2) return 20; if (l === 1) return 10; return 0;
  }
  function yaoFloatMvScore(mv) {
    if (!mv || mv <= 0) return 0;
    if (mv <= 20) return 15; if (mv <= 40) return 13; if (mv <= 60) return 10; if (mv <= 100) return 6; if (mv <= 200) return 3; return 0;
  }
  function yaoTurnoverScore(t) {
    if (!t || t < 3) return 0; if (t > 45) return 0;
    if (t >= 8 && t <= 15) return 15; if (t >= 5 && t < 8) return 10;
    if (t > 15 && t <= 20) return 12; if (t > 20 && t <= 30) return 8; if (t > 30 && t <= 45) return 4; return 0;
  }
  function yaoVolumeScore(vr, amt) {
    if (!vr || vr < 1) return 0;
    if (vr >= 2 && amt >= 1) return 10; if (vr >= 1.5) return 7; if (vr >= 1) return 4; return 0;
  }
  function yaoSectorScore(sector, cnt) {
    if (!sector) return 0; if (cnt >= 5) return 10; if (cnt >= 1) return 6; return 0;
  }
  function yaoYouziScore(info) {
    if (!info) return 0;
    if (info.hasFamousYouzi) return 10; if (info.hasJigou) return 3; if (info.hasNormalYouzi) return 5; return 0;
  }
  function yaoMainFundScore(netIn, ratio) {
    if (!netIn || netIn <= 0) return 0;
    if (netIn >= 2) return 10; if (netIn >= 1) return 8; if (netIn >= 0.5) return 6; if (netIn >= 0.2) return 4; return 2;
  }
  function yaoSealScore(sealFund, floatMv) {
    if (!sealFund || !floatMv || floatMv <= 0) return 0;
    const r = sealFund / (floatMv * 100000000);
    if (r >= 0.005) return 5; if (r >= 0.001) return 3; return 1;
  }
  function yaoRating(score) {
    if (score >= 85) return 'S'; if (score >= 70) return 'A'; if (score >= 55) return 'B'; if (score >= 40) return 'C'; return 'D';
  }
  function yaoVerdict(stock) {
    const s = stock || {};
    const score = s.score || 0;
    const mainNet = s.mainNet || s.netIn || 0;
    const netIn5 = s.netIn5 || 0;
    const lianban = s.lianban || 1;
    const youzi = s.youzi || false;
    const hasJigou = s.hasJigou || false;
    let signals = 0;
    if (mainNet > 0) signals++; if (netIn5 > 0) signals++; if (lianban >= 2) signals++; if (youzi) signals++; if (hasJigou) signals++;
    if (score >= 70 && (signals >= 2 || score >= 80)) return { label: '重点关注', cls: 'strong', score };
    if (score >= 60 && signals >= 1) return { label: '值得关注', cls: 'watch', score };
    if (score >= 45) return { label: '观望', cls: 'hold', score };
    return { label: '回避', cls: 'avoid', score };
  }
  // 计算单只股票的 8 因子评分，返回总分、评级与各因子（含满分上限，供雷达归一化）
  function yaoCalculate(o) {
    const factors = [
      { key: 'fLianban', label: '连板高度', value: yaoLianbanScore(o.lianban), max: 25 },
      { key: 'fFloatMv', label: '流通市值', value: yaoFloatMvScore(o.floatMv), max: 15 },
      { key: 'fTurnover', label: '换手率', value: yaoTurnoverScore(o.turnover), max: 15 },
      { key: 'fVolume', label: '量比', value: yaoVolumeScore(o.volumeRatio, o.amount), max: 10 },
      { key: 'fSector', label: '板块效应', value: yaoSectorScore(o.sector, o.sectorZtCount), max: 10 },
      { key: 'fYouzi', label: '游资', value: yaoYouziScore(o.longhuInfo), max: 10 },
      { key: 'fMainFund', label: '主力净流入', value: yaoMainFundScore(o.netIn, o.netInRatio), max: 10 },
      { key: 'fSeal', label: '封单强度', value: yaoSealScore(o.sealFund, o.floatMv), max: 5 }
    ];
    const total = factors.reduce((a, f) => a + f.value, 0);
    return { factors, score: Math.round(total * 10) / 10, rating: yaoRating(total) };
  }

  // 取个股所属最热概念的涨停家数（板块效应因子输入）
  function sectorZtCountFor(s, conceptHeat) {
    const cs = (s.concepts && s.concepts.length) ? s.concepts : [s.sector];
    let mx = 0;
    cs.forEach((c) => { const h = (conceptHeat || []).find((x) => x.sector === c); if (h) mx = Math.max(mx, h.limitCount); });
    return mx;
  }

  // ---------- 妖股概率评分（豆包 8 因子模型）----------
  // ctx: { sectorZtCount, longhuInfo }；流通市值/换手率/主力净流入 等字段由调用方已在股票对象上备好
  function scoreStock(s, ctx) {
    ctx = ctx || {};
    const lianban = s.boards || 1;
    const floatMv = (s.cap != null) ? s.cap : null;
    const turnover = (s.turnover != null) ? s.turnover : null;
    const volumeRatio = (s.volumeRatio != null) ? s.volumeRatio : undefined;
    const amount = (s.amount != null) ? s.amount : undefined;
    const sector = s.sector || '其他';
    const sectorZtCount = (ctx.sectorZtCount != null) ? ctx.sectorZtCount : 0;
    const longhuInfo = ctx.longhuInfo || { hasFamousYouzi: false, hasJigou: false, hasNormalYouzi: false };
    // 主力净流入（亿）：演示态 mainFlow（万元）→ /10000；
    // 真实态优先 EM f62 实时主力净流入（mainNetIn，亿），无则回退龙虎榜净额（netIn，亿，盘后才发布）
    const netIn = (s.mainFlow != null) ? s.mainFlow / 10000
      : (s.mainNetIn != null ? s.mainNetIn
        : (s.netIn != null ? s.netIn : 0));
    const netInRatio = (s.netInRatio != null) ? s.netInRatio : 0;
    const sealFund = (s.seal || 0) * 10000; // 万元 → 元
    const res = yaoCalculate({ lianban, floatMv, turnover, volumeRatio, amount, sector, sectorZtCount, longhuInfo, netIn, netInRatio, sealFund });
    const youzi = !!longhuInfo.hasFamousYouzi || !!longhuInfo.hasNormalYouzi;
    return {
      probability: res.score,
      rating: res.rating,
      verdict: yaoVerdict({ score: res.score, mainNet: netIn, netIn5: s.netIn5 || 0, lianban, youzi, hasJigou: !!longhuInfo.hasJigou }),
      factors: res.factors
    };
  }

  // ---------- 派生视图 ----------
  function buildOverview(stocks, extra) {
    extra = extra || {};
    const lianban = stocks.filter((s) => s.boards >= 2).length;
    const maxBoards = stocks.reduce((m, s) => Math.max(m, s.boards || 1), 0);
    return {
      date: extra.date || todayISO(),
      limitUp: stocks.length,
      limitDown: extra.limitDown != null ? extra.limitDown : 0,
      lianban: extra.lianban != null ? extra.lianban : lianban,
      zhaban: extra.zhaban != null ? extra.zhaban : 0,
      maxBoards,
      hotSectors: extra.hotSectors != null ? extra.hotSectors : computeConceptHeat(stocks).length,
      sealRate: extra.sealRate != null ? extra.sealRate : null
    };
  }

  function buildLadder(stocks) {
    const groups = {};
    stocks.forEach((s) => {
      if ((s.boards || 1) < 2) return;
      (groups[s.boards] = groups[s.boards] || []).push(s);
    });
    return Object.keys(groups).map(Number).sort((a, b) => b - a)
      .map((b) => ({ boards: b, stocks: groups[b].sort((x, y) => y.probability - x.probability) }));
  }
  // 妖股榜：优先只取「连板」（boards>=2），不足时再用首板补足
  const topMonsters = (stocks, n = 5) => {
    const lb = stocks.filter((s) => (s.boards || 1) >= 2);
    const pool = lb.length >= n ? lb : stocks;
    return pool.slice().sort((a, b) => b.probability - a.probability).slice(0, n);
  };

  // =========================================================================
  // 东方财富行情代理（补齐真实同花顺模式缺失的 流通市值 / 换手率 / 量比 / 成交额）
  // 同花顺涨停池不含这些字段 → 真实模式下流通市值/换手率/量比/封单强度分母恒为0。
  // 东方财富 push2 公开接口可直接取：f117=流通市值(元)、f168=换手率(%)、f50=量比、f46=成交额(元)（CORS=*）。
  // 优先级：① 本地代理 /api/em/quote（同源、可缓存、批处理）；② 直连 push2；③ 失败返回空（因子按0计）。
  // =========================================================================
  function thscodeToSecid(ts) {
    const m = /^(\d{6})\.(SH|SZ|BJ)$/i.exec(ts || '');
    if (!m) return null;
    const market = m[2].toUpperCase() === 'SH' ? '1' : '0';
    return market + '.' + m[1];
  }
  // 腾讯行情兜底（qt.gtimg.cn，GBK 编码）：东财 push2 被限流/不可达时补齐因子字段。
  // 字段索引（2026-10 实测 sz002535/sh600519）：1名称 3现价 31涨跌 32涨跌% 36成交量(手)
  //   37成交额(万) 38换手率 43振幅 44流通市值(亿) 45总市值 46PB 47涨停价 48跌停价 49量比
  function mktPrefix(code6) {
    const c = String(code6);
    if (/^(6|9|5)/.test(c)) return 'sh';
    if (/^(4|8)/.test(c)) return 'bj';
    return 'sz';
  }
  async function tencentFull(codes6) {
    const list = (codes6 || []).filter((c) => /^\d{6}$/.test(String(c)));
    if (!list.length) return {};
    const q = list.map((c) => mktPrefix(c) + c).join(',');
    const r = await fetch('https://qt.gtimg.cn/q=' + q, { headers: { 'Referer': 'https://gu.qq.com/' } });
    const txt = new TextDecoder('gbk').decode(await r.arrayBuffer());
    const map = {};
    const re = /v_(?:sh|sz|bj)(\d{6})="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt))) {
      const f = m[2].split('~');
      if (f.length < 50) continue;
      const num = (i, div) => (f[i] == null || f[i] === '' || isNaN(Number(f[i]))) ? null : Number(f[i]) / (div || 1);
      map[m[1]] = {
        name: f[1] || '',
        price: num(3),
        changePct: num(32),
        vol: num(6),              // 今日总成交量（手）
        outVol: num(7),           // 外盘（主动买，手）
        inVol: num(8),            // 内盘（主动卖，手）
        amount: num(37, 10000),   // 万 -> 亿
        turnover: num(38),        // %
        floatMv: num(44),         // 亿
        volumeRatio: num(49)
      };
    }
    return map;
  }
  // 用腾讯数据填补 out 中缺失的因子字段（只填空缺，不覆盖东财已取到的值）
  async function fillMissingByTencent(codesTs, out) {
    const need = codesTs.filter((ts) => {
      const o = out[ts];
      return !o || (o.floatMv == null && o.turnover == null && o.volumeRatio == null);
    });
    if (!need.length) return;
    const tmap = await tencentFull(need.map((ts) => String(ts).split('.')[0]));
    need.forEach((ts) => {
      const t = tmap[String(ts).split('.')[0]];
      if (!t) return;
      const base = Object.assign({ thscode: ts, floatMv: null, turnover: null, volumeRatio: null, amount: null, mainNetIn: null }, out[ts] || {});
      ['floatMv', 'turnover', 'volumeRatio', 'amount'].forEach((k) => { if (base[k] == null && t[k] != null) base[k] = t[k]; });
      out[ts] = base;
    });
  }

  // ---- 公式兜底（不依赖额外数据源，用已取数据推算）----
  // ① 量比 = (今日总手 ÷ 已开市分钟) ÷ (近5日日均总手 ÷ 240)
  //    近5日总手取自腾讯日K（web.ifzq.gtimg.cn）；开市分钟按 A 股时段（9:30-11:30 / 13:00-15:00）计算。
  function beijingNowStr() {
    const d = new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function marketOpenMinutes() {
    const s = beijingNowStr().split(' ')[1];
    const [hh, mm] = s.split(':').map(Number);
    const t = hh * 60 + mm;
    if (t <= 570) return 0;                    // 9:30 前
    if (t <= 690) return t - 570;              // 9:30-11:30
    if (t <= 780) return 120;                  // 午休
    if (t <= 900) return 120 + (t - 780);      // 13:00-15:00
    return 240;                                // 收盘后
  }
  async function tencentVolumeRatioByKline(code6) {
    const r = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${mktPrefix(code6)}${code6},day,,,10,qfq`);
    const j = await r.json();
    const d = (j && j.data && j.data[`${mktPrefix(code6)}${code6}`]) || {};
    const rows = d.qfqday || d.day || [];
    if (rows.length < 2) return null;
    const today = beijingNowStr().split(' ')[0];
    const past = rows.filter((x) => x[0] < today).slice(-5);
    if (past.length < 3) return null; // 上市不足/停牌 → 放弃
    const avg5 = past.reduce((a, x) => a + (Number(x[5]) || 0), 0) / past.length; // 近5日日均总手
    if (!avg5) return null;
    const mins = marketOpenMinutes();
    if (!mins) return null; // 未开盘无从计算
    const todayVol = past.length && rows[rows.length - 1][0] === today
      ? Number(rows[rows.length - 1][5]) : null;
    if (!todayVol) return null;
    return Math.round(((todayVol / mins) / (avg5 / 240)) * 100) / 100;
  }
  // ② 主力净流入(亿) ≈ (外盘 - 内盘) × 100 × 现价 ÷ 1e8
  //    外盘=主动买盘、内盘=主动卖盘（腾讯实时行情字段 7/8）。涨停封板时主动卖单被买一吸收，
  //    内盘会偏大 → 该近似偏保守（偏低），仅在东财 f62 不可达时作为兜底参考。
  function netInApprox(t) {
    if (!t || t.outVol == null || t.inVol == null || !t.price) return null;
    return Math.round((t.outVol - t.inVol) * 100 * t.price / 1e8 * 100) / 100;
  }
  async function fillFormulasByTencent(codesTs, out) {
    const codeMap = {};
    codesTs.forEach((ts) => { codeMap[String(ts).split('.')[0]] = ts; });
    const tmap = await tencentFull(Object.keys(codeMap));
    const klineNeed = [];
    for (const [c, ts] of Object.entries(codeMap)) {
      const o = out[ts]; if (!o) continue;
      const t = tmap[c];
      if (!t) continue;
      // 主力净流入缺失 → 内外盘差近似
      if (o.mainNetIn == null) { const v = netInApprox(t); if (v != null) o.mainNetIn = v; }
      // 量比缺失且腾讯实时也没给 → 日K公式计算
      if ((o.volumeRatio == null || o.volumeRatio <= 0) && !t.volumeRatio) klineNeed.push(c);
    }
    await Promise.all(klineNeed.map(async (c) => {
      try {
        const vr = await tencentVolumeRatioByKline(c);
        if (vr != null) {
          const ts = codeMap[c];
          if (ts && out[ts] && out[ts].volumeRatio == null) out[ts].volumeRatio = vr;
        }
      } catch (e) { /* 单只失败忽略 */ }
    }));
  }

  async function fetchEMQuotes(thscodes) {
    const codes = (thscodes || []).filter(Boolean);
    if (!codes.length) return {};
    const toMap = (arr) => {
      const m = {};
      (arr || []).forEach((x) => {
        if (x && x.thscode) m[x.thscode] = {
          thscode: x.thscode,
          floatMv: x.floatMv, turnover: x.turnover,
          volumeRatio: (x.volumeRatio != null && !isNaN(Number(x.volumeRatio))) ? Number(x.volumeRatio) : null,
          amount: (x.amount != null && !isNaN(Number(x.amount))) ? Number(x.amount) : null,
          mainNetIn: (x.mainNetIn != null && !isNaN(Number(x.mainNetIn))) ? Number(x.mainNetIn) : null
        };
      });
      return m;
    };
    // 1) 本地代理（经 server.js 同源托管时可用）；拿到后仍过一遍公式兜底补齐缺失字段
    try {
      const r = await fetch('/api/em/quote?codes=' + encodeURIComponent(codes.join(',')));
      if (r.ok) {
        const m = toMap(await r.json());
        try { await fillFormulasByTencent(codes, m); } catch (e) { /* 忽略 */ }
        return m;
      }
    } catch (e) { /* 无代理（file:// 打开）→ 直连 */ }
    // 2) 直连 push2（CORS=*）批量端点：f12代码 f117流通市值(元) f168换手率(%) f50量比 f6成交额(元) f62主力净流入(元)。
    //    旧版逐股 stock/get 会打出 ~50 个并发请求，易被东财限流导致整批失败（表现为 8 因子中 5 个全 0）；
    //    改为每 50 只一批的 ulist 批量请求，且不再依赖不可用的自定义 Referer（浏览器会忽略该受限头）。
    const out = {};
    const secidByCode = {};
    const secids = [];
    codes.forEach((ts) => {
      const secid = thscodeToSecid(ts);
      if (!secid) return;
      secidByCode[secid] = ts;
      secids.push(secid);
    });
    const num = (v, div) => (v == null || v === '-' || isNaN(Number(v))) ? null : Number(v) / (div || 1);
    for (let i = 0; i < secids.length; i += 50) {
      const chunk = secids.slice(i, i + 50);
      try {
        const u = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(chunk.join(','))}&fields=f12,f117,f168,f50,f6,f62`;
        const r = await fetch(u, { headers: { 'Referer': 'https://quote.eastmoney.com/' } });
        const j = await r.json();
        ((j && j.data && j.data.diff) || []).forEach((row) => {
          if (row.f12 == null) return;
          const secid = (String(row.f12).startsWith('6') ? '1.' : '0.') + row.f12;
          const ts = secidByCode[secid];
          if (!ts) return;
          out[ts] = {
            thscode: ts,
            floatMv: num(row.f117, 1e8),
            turnover: num(row.f168),
            volumeRatio: num(row.f50),
            amount: num(row.f6, 1e8),    // 元 -> 亿
            mainNetIn: num(row.f62, 1e8) // 元 -> 亿
          };
        });
      } catch (e) { /* 本批失败 → 腾讯兜底 */ }
    }
    // 3) 腾讯行情兜底：东财限流/不可达时补齐 流通市值/换手率/量比/成交额
    try { await fillMissingByTencent(codes, out); } catch (e) { /* 忽略，字段保持 null 因子按 0 计 */ }
    // 4) 公式兜底：主力净流入（内外盘差近似）、量比（腾讯日K 5日均量法）
    try { await fillFormulasByTencent(codes, out); } catch (e) { /* 忽略 */ }
    return out;
  }

  // 自选股实时行情：支持任意 A 股代码（不限于涨停池），走东财 ulist 批量端点
  // f12代码 f14名称 f2最新价 f3涨跌幅 f6成交额(元) f8换手率 f10量比 f62主力净额(元)
  async function fetchWatchQuotes(codes) {
    const list = (codes || []).filter((c) => /^\d{6}$/.test(String(c)));
    if (!list.length) return {};
    const secids = list.map((c) => (String(c).startsWith('6') ? '1.' : '0.') + c);
    const out = {};
    const num = (v, div) => (v == null || v === '-' || isNaN(Number(v))) ? null : Number(v) / (div || 1);
    try {
      const u = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids.join(','))}&fields=f12,f14,f2,f3,f6,f8,f10,f62`;
      const r = await fetch(u, { headers: { 'Referer': 'https://quote.eastmoney.com/' } });
      const j = await r.json();
      ((j && j.data && j.data.diff) || []).forEach((row) => {
        const code = String(row.f12 || '');
        if (!code) return;
        out[code] = {
          name: row.f14 || code,
          price: num(row.f2),
          changePct: num(row.f3),
          amount: num(row.f6, 1e8),        // 元 -> 亿
          turnover: num(row.f8),
          volumeRatio: num(row.f10),
          mainNetIn: num(row.f62, 1e8)     // 元 -> 亿
        };
      });
    } catch (e) { /* 失败返回空，由调用方兜底提示 */ }
    // 腾讯行情兜底：东财不可达时补齐 名称/现价/涨跌幅/成交额/换手率/量比
    const missing = list.filter((c) => !out[c]);
    if (missing.length) {
      try {
        const tmap = await tencentFull(missing);
        missing.forEach((c) => {
          const t = tmap[c];
          if (!t) return;
          out[c] = {
            name: t.name || c,
            price: t.price,
            changePct: t.changePct,
            amount: t.amount,
            turnover: t.turnover,
            volumeRatio: t.volumeRatio,
            mainNetIn: netInApprox(t)
          };
        });
      } catch (e) { /* 保持空，由调用方兜底提示 */ }
    }
    // 公式兜底：东财已返回但主力净流入缺失的 → 内外盘差近似；量比缺失 → 日K 5日均量法
    try {
      const have = list.filter((c) => out[c] && out[c].mainNetIn == null);
      if (have.length) {
        const tmap = await tencentFull(have);
        have.forEach((c) => { const v = netInApprox(tmap[c]); if (v != null) out[c].mainNetIn = v; });
      }
      const vrNeed = list.filter((c) => out[c] && (out[c].volumeRatio == null || out[c].volumeRatio <= 0));
      await Promise.all(vrNeed.map(async (c) => {
        try {
          const vr = await tencentVolumeRatioByKline(c);
          if (vr != null) out[c].volumeRatio = vr;
        } catch (e) { /* 忽略 */ }
      }));
    } catch (e) { /* 忽略 */ }
    return out;
  }

  // =========================================================================
  // 真实接口拉取
  // =========================================================================
  async function fetchReal() {
    // 涨停池（按连板数降序，确保高位板优先取到）
    const pool = await apiGet('/api/a-share/special-data/limit-up-pool', {
      page: 1, size: 200, sort_field: 'continue_day_cnt', sort_dir: 'desc'
    });
    let items = (pool.item || []).slice();
    const pg = pool.pagination || {};
    if (pg.total > 200) {
      const p2 = await apiGet('/api/a-share/special-data/limit-up-pool', {
        page: 2, size: 200, sort_field: 'continue_day_cnt', sort_dir: 'desc'
      });
      items = items.concat(p2.item || []);
    }
    // 数据源在晚间刷新/维护窗口可能「成功但返回空池」：重试一次，仍为空则抛错走演示回退，
    // 避免被误渲染成「没有符合条件的标的」（空池 ≠ 无连板股）。
    if (!items.length) {
      await new Promise((r) => setTimeout(r, 1500));
      const retry = await apiGet('/api/a-share/special-data/limit-up-pool', {
        page: 1, size: 200, sort_field: 'continue_day_cnt', sort_dir: 'desc'
      });
      items = (retry.item || []).slice();
      if (!items.length) throw new Error('涨停池返回空（数据源可能正在刷新/维护），请稍后点击右上角刷新重试');
    }

    // 统计 + 跌停池 + 龙虎榜（并行；龙虎榜用于游资/机构因子与主力净流入代理）
    let stats = null, downTotal = 0, lhb = null;
    const tasks = [
      apiGet('/api/a-share/special-data/limit-up-statistics', {}).then((d) => { stats = d; }).catch(() => {}),
      apiGet('/api/a-share/special-data/limit-down-pool', { page: 1, size: 1 }).then((d) => { downTotal = (d.pagination && d.pagination.total) || 0; }).catch(() => {}),
      apiGet('/api/a-share/special-data/dragon-tiger-list', { board_type: 'all' }).then((d) => { lhb = d; }).catch(() => {})
    ];
    await Promise.all(tasks);

    const stocksRaw = items.map(mapPoolItem).filter((s) => !s.isST);
    const conceptHeat = computeConceptHeat(stocksRaw);
    // 龙虎榜信号映射：上榜→游资参与；机构净买额存在→机构参与；龙虎榜净额(元)代理主力净流入(亿)
    const longhuMap = {};
    const lhbItems = (lhb && (lhb.stock_items || lhb.item)) || [];
    lhbItems.forEach((it) => {
      const key = it.thscode || it.ticker;
      if (!key) return;
      const info = longhuMap[key] || { hasFamousYouzi: false, hasJigou: false, hasNormalYouzi: false };
      info.hasNormalYouzi = true;
      if (it.org_net_value != null && it.org_net_value !== 0) info.hasJigou = true;
      longhuMap[key] = info;
      if (it.net_value != null) {
        const t = stocksRaw.find((x) => x.thscode === key || x.code === it.ticker);
        if (t) t.netIn = it.net_value / 100000000;
      }
    });

    // 东方财富流通市值/换手率/量比/成交额/主力净流入（补齐豆包8因子真实态缺口：
    // 流通市值15分、换手率15分、量比10分、封单强度分母、主力净流入10分）
    try {
      const emCodes = stocksRaw.map((s) => s.thscode).filter(Boolean);
      const emMap = await fetchEMQuotes(emCodes);
      stocksRaw.forEach((s) => {
        const e = emMap[s.thscode];
        if (e) {
          if (e.floatMv != null) s.cap = e.floatMv;           // 流通市值（亿）
          if (e.turnover != null) s.turnover = e.turnover;     // 换手率（%）
          if (e.volumeRatio != null) s.volumeRatio = e.volumeRatio; // 量比
          if (e.amount != null) s.amount = e.amount;           // 成交额（亿）
          // 实时主力净流入（亿，f62）：龙虎榜要盘后才发布，盘中用它补「主力净流入」因子
          if (e.mainNetIn != null) s.mainNetIn = e.mainNetIn;
        }
      });
    } catch (e) { /* 失败则保持相关字段为 null，对应因子按0计，与豆包逻辑一致 */ }

    const stocks = stocksRaw.map((s) => {
      const ctx = {
        sectorZtCount: sectorZtCountFor(s, conceptHeat),
        longhuInfo: longhuMap[s.thscode] || { hasFamousYouzi: false, hasJigou: false, hasNormalYouzi: false }
      };
      return Object.assign({}, s, { scores: scoreStock(s, ctx) });
    }).map((s) => Object.assign(s, { probability: s.scores.probability }));

    let lianbanCount = stocks.filter((s) => s.boards >= 2).length;
    if (stats && Array.isArray(stats.exact_boards)) {
      const n = stats.exact_boards.filter((b) => b.board_num >= 2).reduce((a, b) => a + (b.stock_count || 0), 0);
      if (n > 0) lianbanCount = n;
    }

    const sectors = computeConceptHeat(stocks);
    const overview = buildOverview(stocks, {
      date: (stats && stats.trade_date) || todayISO(),
      limitDown: downTotal,
      lianban: lianbanCount,
      zhaban: stats ? (stats.open_stock_count || 0) : 0,
      hotSectors: sectors.length,
      sealRate: stats ? stats.seal_rate : null
    });

    // 热股榜 / 飙升榜（并行，失败不影响主流程；龙虎榜已在上文获取）
    let hot = null, sky = null;
    const extra = await Promise.all([
      apiGet('/api/a-share/special-data/hot-stock-list', { period: 'day', limit: 60 }).catch(() => null),
      apiGet('/api/a-share/special-data/skyrocket-list', { period: 'day', limit: 60 }).catch(() => null)
    ]);
    hot = extra[0]; sky = extra[1];

    return {
      date: overview.date,
      overview,
      stocks,
      ladder: buildLadder(stocks),
      sectors,
      top: topMonsters(stocks, 5),
      lhb: lhb ? (lhb.stock_items || []) : [],
      lhbDate: lhb ? (lhb.trade_date || '') : '',
      hot: hot ? (hot.item || []) : [],
      sky: sky ? (sky.item || []) : [],
      stats,
      statsSource: stats ? 'api' : 'demo',
      source: 'api'
    };
  }

  // ---------- 龙虎榜（按榜单类型：all / org / hot_money）----------
  async function getLhb(boardType) {
    loadCfg();
    if (!API.enabled || !API.base) return { items: [], dept: [], date: '', source: 'demo' };
    try {
      const d = await apiGet('/api/a-share/special-data/dragon-tiger-list', { board_type: boardType || 'all' });
      return { items: d.stock_items || [], dept: d.hot_money_items || [], date: d.trade_date || '', source: 'api' };
    } catch (e) {
      return { items: [], dept: [], date: '', source: 'demo', notice: e.message };
    }
  }

  // ---------- 历史热股榜（按自然日）----------
  async function getHotHistory(date) {
    loadCfg();
    if (!API.enabled || !API.base) return { date: date || todayISO(), items: [], source: 'demo' };
    try {
      const d = await apiGet('/api/a-share/special-data/hot-stock-list-history', { date });
      const arr = d.item || d.items || d.list || [];
      return { date: d.date || date, items: arr, source: 'api' };
    } catch (e) {
      return { date: date || todayISO(), items: [], source: 'demo', notice: e.message };
    }
  }

  // =========================================================================
  // 个股下钻 / 历史类端点（文档新增能力）
  // =========================================================================

  // 连板天梯矩阵（近 30 交易日，按 date -> 板位 -> 股票列表）
  async function getLadderMatrix() {
    loadCfg();
    if (!API.enabled || !API.base) return demoLadderMatrix();
    try {
      const d = await apiGet('/api/a-share/special-data/limit-up-ladder', {});
      return { window: d.window || {}, items: d.item || [], source: 'api' };
    } catch (e) { return { items: [], source: 'demo', notice: e.message }; }
  }

  // 个股异动原因（批量 thscodes，逗号分隔；单股传单个 thscode 字符串）
  async function getAnomaly(thscodes) {
    loadCfg();
    if (!API.enabled || !API.base || !thscodes) return demoAnomaly(thscodes);
    try {
      const list = Array.isArray(thscodes) ? thscodes.join(',') : thscodes;
      const d = await apiGet('/api/a-share/special-data/anomaly-analysis-stock', { thscodes: list });
      return { items: d.item || [], source: 'api' };
    } catch (e) { return { items: [], source: 'demo', notice: e.message }; }
  }

  // 个股机构交易详情（龙虎榜席位）：thscode 必填，date 可选 YYYY-MM-DD
  async function getInstitution(thscode, date) {
    loadCfg();
    if (!API.enabled || !API.base || !thscode) return demoInstitution(thscode);
    try {
      const params = { thscode: thscode };
      if (date) params.date = date;
      const d = await apiGet('/api/a-share/special-data/dragon-tiger-stock-institution', params);
      return { thscode: d.thscode, trade_date: d.trade_date, item: d.item || [], source: 'api' };
    } catch (e) { return { item: [], source: 'demo', notice: e.message }; }
  }

  // 历史 K 线：统一字段名。演示数据用 open/high/low/close；
  // 真实接口 prices/historical 返回 open_price/high_price/low_price/close_price。
  function normalizeKlineBar(b) {
    if (!b) return b;
    const open = b.open != null ? b.open : b.open_price;
    const high = b.high != null ? b.high : b.high_price;
    const low = b.low != null ? b.low : b.low_price;
    const close = b.close != null ? b.close : b.close_price;
    return { date_ms: b.date_ms, open, high, low, close, volume: b.volume };
  }

  // 历史 K 线（单股日线，前复权）：startMs/endMs 为毫秒时间戳
  async function getKline(thscode, startMs, endMs) {
    loadCfg();
    if (!API.enabled || !API.base || !thscode) return demoKline(thscode, startMs, endMs);
    try {
      const d = await apiGet('/api/a-share/prices/historical', {
        thscode: thscode, interval: '1d', start: startMs, end: endMs, adjust: 'forward'
      });
      return { item: (d.item || []).map(normalizeKlineBar), source: 'api' };
    } catch (e) { return { item: [], source: 'demo', notice: e.message }; }
  }

  // 个股热度排名走势（近一年自然日窗口）：start/end 为 YYYY-MM-DD
  async function getRankTrend(thscode, startDate, endDate) {
    loadCfg();
    if (!API.enabled || !API.base || !thscode) return demoRank(thscode, startDate, endDate);
    try {
      const d = await apiGet('/api/a-share/special-data/hot-stock-rank-trend', {
        thscode: thscode, start_date: startDate, end_date: endDate
      });
      return { item: d.item || [], source: 'api' };
    } catch (e) { return { item: [], source: 'demo', notice: e.message }; }
  }

  // ---------- 演示数据派生（龙虎榜/热股/飙升）----------
  function demoLhb(stocks) {
    const top = stocks.filter((s) => s.boards >= 2).slice(0, 12);
    const items = top.map((s, i) => ({
      thscode: s.thscode, ticker: s.code, name: s.name,
      change: (s.changePct || 10) / 100,
      concept_list: (s.concepts || []).map((c) => ({ name: c })),
      net_value: (s.seal || 10000) * 10000 * (0.4 + Math.random() * 0.8),
      net_rate: 0.03 + Math.random() * 0.08,
      hot_rank: i + 1,
      buy_value: (s.seal || 10000) * 10000 * (1.2 + Math.random()),
      sell_value: (s.seal || 10000) * 10000 * (0.6 + Math.random() * 0.6),
      range_days: s.boards,
      org_net_value: (s.seal || 10000) * 10000 * (Math.random() - 0.3),
      hot_money_net_value: (s.seal || 10000) * 10000 * (Math.random() - 0.2)
    }));
    return { items, dept: [], date: todayISO(), source: 'demo' };
  }
  function demoHot(stocks) {
    const items = stocks.slice(0, 20).map((s, i) => ({
      thscode: s.thscode, ticker: s.code, name: s.name,
      rank: i + 1, heat: String(Math.round(3000000 - i * 80000 + Math.random() * 20000)),
      rank_change: Math.floor(Math.random() * 6) - 3, rank_trend: 'flat'
    }));
    return { item: items, source: 'demo' };
  }
  function demoHistory() {
    const names = ['东方通信', '顺控发展', '中通客车', '圣龙股份', '捷荣技术', '天龙集团', '银宝山新', '亚世光电', '清源股份', '长白山'];
    const items = names.map((n, i) => ({ name: n, rank: i + 1, ticker: '', thscode: '' }));
    return { date: todayISO(), items, source: 'demo' };
  }

  // ---------- 演示态合成数据（让下钻模块在无真实数据时也有完整展示）----------
  function deriveThscode(code) {
    const c = String(code || '').trim();
    if (/^[69]/.test(c)) return c + '.SH';
    if (/^[48]/.test(c) || /^920/.test(c)) return c + '.BJ';
    return c + '.SZ';
  }
  function hashStr(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function demoKline(thscode, startMs, endMs) {
    const n = 120;
    const item = [];
    let price = 8 + (hashStr(thscode) % 20);
    const step = Math.max(1, (endMs - startMs) / n);
    for (let i = 0; i < n; i++) {
      const open = price;
      const change = 0.012 + Math.sin(i / 5) * 0.03 + (Math.random() - 0.5) * 0.03; // 整体上行（妖股）
      const close = Math.max(1, open * (1 + change));
      const high = Math.max(open, close) * (1 + Math.random() * 0.02);
      const low = Math.min(open, close) * (1 - Math.random() * 0.02);
      item.push({ date_ms: startMs + i * step, open: round(open, 2), high: round(high, 2), low: round(low, 2), close: round(close, 2), volume: Math.round(50000 + Math.random() * 200000) });
      price = close;
    }
    return { item, source: 'demo' };
  }
  function demoAnomaly(thscode) {
    return { items: [{ tag_name: '涨停·连板', stock_name: '', analysis_content: '（演示数据）该股处于连板晋级阶段，题材资金集中，盘中多次放量换手，封单稳定。', keyword_list: ['连板', '题材热度'], thscode }], source: 'demo' };
  }
  function demoInstitution(thscode) {
    const net = Math.round((8000 + Math.random() * 20000)) * 10000;
    return {
      thscode, trade_date: todayISO(), source: 'demo',
      item: [{ range_days: 1, start_date: '', end_date: '', org_net_value: net, org_net_rate: 0.04 + Math.random() * 0.05, org_buy_num: 3, org_sell_num: 1, buy_departments: [{ name: '机构专用' }, { name: '机构专用' }, { name: '机构专用' }], sell_departments: [] }]
    };
  }
  function demoRank(thscode, startDate, endDate) {
    const item = []; const n = 30; let rank = 90;
    const end = Date.now();
    for (let i = 0; i < n; i++) {
      rank = Math.max(3, rank - Math.round(Math.random() * 4));
      const d = new Date(end - (n - 1 - i) * 86400000);
      const p = (x) => String(x).padStart(2, '0');
      item.push({ date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, date_ms: d.getTime(), rank });
    }
    return { item, source: 'demo' };
  }
  function demoLadderMatrix() {
    const stocks = buildStocks();
    const levels = ['two_board', 'three_board', 'four_board', 'five_board', 'six_board', 'seven_over'];
    const items = []; const n = 12;
    const base = new Date(Date.now() + 8 * 3600000);
    for (let i = 0; i < n; i++) {
      const d = new Date(base - i * 86400000);
      const date = d.toISOString().slice(0, 10);
      const boards = {};
      levels.forEach((k, li) => {
        const cnt = Math.max(0, 4 - li + Math.floor(Math.random() * 3));
        boards[k] = [];
        for (let j = 0; j < cnt; j++) { const s = stocks[Math.floor(Math.random() * stocks.length)]; boards[k].push({ name: s.name, seal_nextday: Math.random() > 0.4 }); }
      });
      items.push({ date, boards });
    }
    return { window: {}, items, source: 'demo' };
  }


  function demoStats() {
    // 演示态封板/晋级统计（虚构样本，与演示涨停池规模匹配）
    return {
      trade_date: todayISO(),
      seal_rate: 0.66,
      open_stock_count: 32,
      limit_up_stock_count: 64,
      touched_limit_up_stock_count: 96,
      page_boards: [
        { board_level: 'one', stock_count: 38, promotion_rate: null },
        { board_level: 'two', stock_count: 16, promotion_rate: 0.28 },
        { board_level: 'three', stock_count: 6, promotion_rate: 0.15 },
        { board_level: 'four', stock_count: 2, promotion_rate: 0.1 },
        { board_level: 'five_plus', stock_count: 2, promotion_rate: 0.8 }
      ],
      exact_boards: [
        { board_num: 2, stock_count: 16 },
        { board_num: 3, stock_count: 6 },
        { board_num: 4, stock_count: 2 },
        { board_num: 5, stock_count: 1 },
        { board_num: 6, stock_count: 1 }
      ],
      source: 'demo'
    };
  }

  // 涨停强度与晋级统计（limit-up-statistics）：封板率 / 炸板 / 连板晋级
  async function getLimitUpStatistics(date) {
    loadCfg();
    if (!API.enabled || !API.base) return demoStats();
    const params = {};
    if (date) params.date = date;
    try {
      const d = await apiGet('/api/a-share/special-data/limit-up-statistics', params);
      return Object.assign({ source: 'api' }, d);
    } catch (e) {
      return Object.assign({ source: 'demo', notice: e.message }, demoStats());
    }
  }

  function getDemo() {
    const stocks = buildStocks();
    const sectors = computeConceptHeat(stocks);
    const lhb = demoLhb(stocks);
    const hot = demoHot(stocks);
    return {
      date: todayISO(),
      overview: buildOverview(stocks, { hotSectors: sectors.length }),
      stocks,
      ladder: buildLadder(stocks),
      sectors,
      top: topMonsters(stocks, 5),
      lhb: lhb.items,
      lhbDate: lhb.date,
      hot: hot.item,
      sky: hot.item.slice(0, 15).map((x, i) => Object.assign({}, x, { rank_change: 20 - i * 2, rank_trend: 'up' })),
      stats: demoStats(),
      statsSource: 'demo',
      source: 'demo'
    };
  }

  function buildStocks() {
    const raw = RAW.map((s) => Object.assign({}, s, { maxSeal: s.maxSeal || round((s.seal || 0) * 1.5, 0) }));
    const heat = computeConceptHeat(raw.map((s) => Object.assign({}, s, { concepts: s.concepts || [s.sector] })));
    return raw.map((s) => {
      const sc = scoreStock(s, {
        sectorZtCount: sectorZtCountFor(s, heat),
        longhuInfo: { hasFamousYouzi: false, hasJigou: false, hasNormalYouzi: false }
      });
      return Object.assign({}, s, { thscode: deriveThscode(s.code), scores: sc, probability: sc.probability, tags: s.concepts || [s.sector] });
    });
  }

  // ---------- 对外主入口 ----------
  async function getDaily(date) {
    loadCfg();
    if (!API.enabled || !API.base) {
      return getDemo();
    }
    try {
      const d = await fetchReal();
      return d;
    } catch (e) {
      const demo = getDemo();
      demo.source = 'demo';
      demo.notice = '真实接口拉取失败，已回退演示数据：' + e.message;
      return demo;
    }
  }

  global.YGData = {
    getDaily,
    getWatchQuotes: fetchWatchQuotes,
    getLhb,
    getHotHistory,
    getLadderMatrix,
    getLimitUpStatistics,
    getAnomaly,
    getInstitution,
    getKline,
    getRankTrend,
    setApi,
    getApi,
    scoreStock,
    yaoCalculate,
    yaoRating,
    yaoVerdict,
    fetchEMQuotes,
    thscodeToSecid,
    sectorZtCountFor,
    computeConceptHeat,
    buildLadder,
    topMonsters,
    _mapPoolItem: mapPoolItem
  };
})(typeof window !== 'undefined' ? window : globalThis);
