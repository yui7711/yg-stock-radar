/* =============================================================================
 * views-deep.js —— 妖股雷达「按 26 章判定手册原文规则」深化筛选引擎
 * -----------------------------------------------------------------------------
 * 对外接口（严格实现，供主站接线 / QA 复用）：
 *   window.YGViewsDeep.render(rootEl, viewKey, d)  在 rootEl 内渲染该栏目深化卡片
 *   window.YGViewsDeep.screen(d)                   返回结构化筛选结果
 *
 * 权威依据：assets/manual-data.js 暴露的 window.YGManualChapters（26 章 / 75 节）。
 *   运行时若存在则读取其章节中文名；条款原文片段内置于下方 RULES（纯文本精简引用），
 *   每条结论都带 rule（章节名·条款名）、quote（原文片段）、why（用到的来源字段）。
 *
 * 硬约束：所有数值来自 d 的来源字段；null/缺失显示「— 缺数据」，绝不编造、绝不用默认值
 *   伪装实测值；缺失评分维度标「缺」并从分母剔除；类名统一 vd- 前缀；DOM 操作仅限
 *   rootEl.innerHTML；render() 先清空、幂等、无定时器、无 window/document 级监听。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ===========================================================================
   * 0. 基础工具
   * ======================================================================== */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // 有效数值（0 有效；null / undefined / '' / NaN 视为缺失）。绝不把缺失当 0。
  function V(x) {
    if (x == null || x === '' || typeof x === 'boolean') return null;
    var n = Number(x);
    return isFinite(n) ? n : null;
  }
  function has(x) { return V(x) != null; }
  // 缺失显示「— 缺数据」；有值显示数值 + 单位。
  function fx(v, unit, digits) {
    if (v == null) return '<span class="vd-miss">— <i>缺数据</i></span>';
    var s = (digits != null) ? Number(v).toFixed(digits) : String(v);
    return esc(s) + (unit ? '<span class="vd-u">' + esc(unit) + '</span>' : '');
  }
  function n2(v) { return v == null ? '—' : Number(v).toFixed(2); }
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  function minStr(v) {
    if (v == null) return '—';
    var h = Math.floor(v / 60), m = v % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function uniq(a) { var o = {}, r = []; (a || []).forEach(function (x) { if (x && !o[x]) { o[x] = 1; r.push(x); } }); return r; }
  function sum(a) { var s = 0; (a || []).forEach(function (x) { s += (V(x) || 0); }); return s; }
  function maxOf(a) { var m = null; (a || []).forEach(function (x) { var v = V(x); if (v != null && (m == null || v > m)) m = v; }); return m; }
  function tag(t, cls) { return '<span class="vd-tag ' + (cls || '') + '">' + esc(t) + '</span>'; }
  function cell(html, cls) { return { h: html, cls: cls || '' }; }

  /* ===========================================================================
   * 1. 手册条款库（26 章 id → 中文名；条款 key → {ch, sec, name, q原文片段}）
   *    q 为手册原文精简引用（纯文本，去 HTML 标签），用于「手册依据」逐条可核对。
   * ======================================================================== */
  var CHAP = {
    overview: '总纲 · 情绪周期第一性原理', 'market-cycle': '市场情绪周期 · 八阶段详解',
    refine: '周期体系精修 · 跨体系对照与实战校准', turning: '八大拐点 · 判定信号库',
    thermo: '情绪温度计 · 量化模型', divergence: '分歧的本质 · 良性 vs 恶性',
    'sector-cycle': '板块（题材）情绪周期', mainline: '主线判定 · 支线判定',
    echelon: '连板梯队判定', switch: '主线切换：旧主线 → 新主线',
    dragon: '龙头的分类与判定', zhongjun: '中军的分类与判定',
    midstock: '中位股的分类与判定', frontline: '前排辨识度个股的判定',
    follower: '跟风股的判定', buzhang: '补涨股的判定',
    methods: '操作手法库 · 十种基本手法', position: '仓位管理矩阵',
    'op-dragon': '龙头股操作：方法与时机', 'op-zhongjun': '中军股操作：方法与时机',
    'op-frontline': '前排辨识度个股操作：方法与时机', 'op-buzhang': '补涨股操作：方法与时机',
    risk: '风控体系与每日复盘', cases: '实战案例复盘 · 真实历史行情',
    'cases-b': '案例三 · 失败模式解剖（反面教材）', quickref: '速查手册 · 决策流程'
  };
  function chapName(id) {
    var mc = global.YGManualChapters;
    if (mc && mc.length) {
      for (var i = 0; i < mc.length; i++) { if (mc[i] && mc[i].id === id && mc[i].title) return mc[i].title; }
    }
    return CHAP[id] || id;
  }
  function R(ch, sec, name, q) { return { ch: ch, sec: sec, name: name, q: q }; }
  var RULES = {
    /* overview / market-cycle / refine / thermo / divergence */
    ov_core: R('overview', 'ov-1', '核心定律 · 龙头不死律 / 补涨终结律 / 中军不死律',
      '龙头不死，周期不止；龙头一倒，周期结束。当主线内最边缘、最不纯正的票都涨停了（补涨到位），说明主线已无增量资金，顶部临近。中军不破位，主线就不算死亡。'),
    ov_cyclemap: R('overview', 'ov-3', '周期循环全景图（八阶段温度/特征）',
      '①冰点 0–20：连板≤2、涨停<25、跌停遍地；②修复 20–35：高度回3板；③启动 35–50：板块共振、连板≥8；④确认 50–68：高度≥4、梯队成形；⑤高潮 68–90：高度≥6、涨停>85、补涨潮；⑥分歧：天量烂板、炸板率抬升；⑦退潮 55→35：高标断板A杀；⑧崩塌 35→15：批量核按钮、涨停<25、跌停>30。'),
    mc_stages: R('market-cycle', 'mc-1', '情绪周期八阶段详解',
      '周期定位看涨停生态（涨停家数 / 最高板 / 连板家数 / 炸板率 / 跌停家数 / 昨日涨停溢价），不看上证指数；高度逐级塌陷即为退潮。'),
    qr_three: R('quickref', 'qr-1', '速查一 · 三句话定周期',
      '现在能不能做 → 看最高连板高度：≤2板不做；3板小仓试错；4–5板可做并加仓；6板可持有不再加仓；≥7板只持有/分批兑现。赚不赚钱 → 看昨日涨停今日溢价。要不要跑 → 看大面股数量。'),
    qr_fourstep: R('quickref', 'qr-1', '速查二 · 四步定位个股角色',
      'Step1 它是板块/市场最高板吗？是→龙头；Step2 它是大市值、走趋势、成交巨大吗？是→中军；Step3 它有≥2项辨识度标签吗？是→前排辨识度股；Step4 它是低位首板/2板、龙头已≥4板、题材正宗吗？是→补涨股；否→跟风股/杂毛（不参与）。'),
    qr_roleop: R('quickref', 'qr-1', '速查三 · 分角色操作口诀（确认期上限口径）',
      '龙头：分歧转一致、3板成龙点，断板不反包/破5日线/天量卖，30–40%；中军：缩量回踩均线，破10日线卖，15–20%；前排：越早越好只做前二，不连板即走，15–25%；补涨：要正、龙头≥4板、低位首/2板，达天花板即走，10–20%；跟风：默认不买，0–5%。'),
    qr_decision: R('quickref', 'qr-3', '四步决策流程',
      'STEP1 定周期（温度+最高板+溢价+大面股→八阶段）｜STEP2 定主线（≥70主线满档 / 50–70准主线减半 / <50不参与）｜STEP3 定角色（四步定位法）｜STEP4 定仓位与退出（周期×品种矩阵+机械止损）。'),
    qr_veto: R('quickref', 'qr-3', '决策流程的三个否决点（任一命中即停止）',
      '否决点一：周期处于退潮期或崩塌期→停止，空仓观察；否决点二：最高分<50→停止，不参与支线与一日游；否决点三：目标票是跟风股/杂毛/高位中位股→停止，宁可空仓也不做低质量标的。'),
    qr_threshold: R('quickref', 'qr-4', '关键阈值速查卡',
      '涨停家数 <25冰点/25–40修复/40–60启动/60–85确认/85–130高潮；最高连板 ≤2冰点/3修复/3–4启动/4–5确认/6–8高潮；连板家数 <5冰点/5–8修复/8–14启动/14–22确认/22–40高潮；炸板率 <15%强/15–25%健康/25–35%转弱/>35%危险/>45%崩塌；主线强度分 <30一日游/30–50支线/50–70准主线/≥70主线。'),
    qr_sop: R('quickref', 'qr-2', '每日 SOP · 盘后复盘 30 分钟',
      '①记录九项数据并算情绪温度；②描绘今日梯队图；③给排名前3的板块打主线强度分；④更新新方向候选池；⑤给龙头做体检（命中几个见顶信号）；⑥复盘自己的交易；⑦写下明日计划。'),
    qr_scenario: R('quickref', 'qr-5', '十种常见盘面情景的应对',
      '龙头天量烂板→见顶预警立即减仓至40%以下；中位股批量跌停→最领先退潮信号立即减仓；补涨股全面爆发→主线中后段分批减仓；新方向突然涨停潮→用主线7条清单核验，缺一不可；市场无主线题材乱涨→乱战期降仓至20–40%。'),
    thermo_model: R('thermo', 'th-1', '情绪温度计 · 九维量化模型',
      '情绪温度由涨停家数、连板家数、最高板、炸板率、昨日涨停溢价、跌停家数、大面股、晋级率、量能九维度加权合成；缺失维度不得猜测补值。'),
    dv_judge: R('divergence', 'dv-1', '分歧的本质 · 良性 vs 恶性',
      '良性分歧：低位、量能2倍以内、板块仍有补位、中军不破位、次日高开快速上板；恶性分歧：高位爆量、中位股批量跌停、尾盘假回封、次日低开闷杀。'),
    /* sector-cycle / mainline / echelon / switch */
    sc_stages: R('sector-cycle', 'sc-1', '板块情绪周期六阶段判定表',
      '①萌芽 1–3家/首板/无梯队（观察不参与）｜②发酵 4–8家/2–3板/出现龙头（介入窗口）｜③扩散 8–15家/4–5板/梯队完整4321（主升段）｜④高潮 15–30家/6–8板+/补涨潮（减仓段）｜⑤分歧 高位震荡/烂板（定性段）｜⑥退潮 递减至<3（离场段）。'),
    sc_10dim: R('sector-cycle', 'sc-2', '主线 vs 支线 vs 一日游 · 十维鉴别表',
      '主线：涨停≥10家、最高板≥5、梯队完整4321、有中军放量上攻、封单大不开板；支线：涨停3–8家、3–4板、部分链条；一日游：涨停<5家、最高板≤2、只有首板无连板、封单小易开板。'),
    sc_oneday: R('sector-cycle', 'sc-2', '一日游的五个典型盘面特征（见即回避）',
      '①午后/尾盘才涨停（真强题材龙头10:30前封板）；②涨停的都是杂毛；③封单极小且反复开板（不足1万手、开板3次以上）；④无中军配合；⑤旧闻新炒或预期兑现。'),
    ml_score: R('mainline', 'ml-1', '主线强度量化评分卡（100 分）',
      '对一个板块打分，≥70分=主线，50–70=准主线/强支线，30–50=支线，<30=一日游/杂毛轮动。评分维度：持续性25 / 板块涨停占比20 / 梯队完整度20 / 中军强度15 / 催化级别10 / 赚钱效应10。建议每日收盘后对排名前3板块各打一次分。'),
    ml_six: R('mainline', 'ml-1', '主线的六条硬性特征（六有）',
      '①有高度：板块内出现≥5板高标；②有梯队：高标+中位+低位+首板完整链条，相邻板级差≤2；③有中军：1–2只中大市值票走趋势且成交活跃；④有持续：连续3日以上板块涨停≥5家；⑤有龙头：龙一能带动板块；⑥有逻辑。六有齐全才是主线。'),
    ml_retreat: R('mainline', 'ml-2', '主线退潮的六个确认信号（见三即确认）',
      '①龙头断板且次日不反包；②板块涨停家数从峰值回落50%以上；③板块指数跌破5日线；④中军大阴破位（跌破10日线）；⑤补涨股不再涨停；⑥板块内3只以上中位股跌停。'),
    ml_sub: R('mainline', 'ml-3', '支线判定与操作三纪律',
      '支线：持续2–4日、涨停3–8家、最高板3–4板、强度评分30–50分。纪律一仓位减半（不超过主线一半）；纪律二只做龙头不做跟风；纪律三快进快出不连板就走。'),
    ec_health: R('echelon', 'ec-1', '梯队健康度的量化指标',
      '健康的梯队呈金字塔形：高标少、中位适中、低位多、首板最多。相邻板级差≤2板健康，>3板（断层）危险；首板→2板晋级率>25%健康、<15%警戒；同板级高标1–2只，>3只为卡位战内耗。'),
    ec_pos: R('echelon', 'ec-2', '卡位 / 补位 / 补涨 的区分',
      '卡位：同板级中看谁先上板、谁封单大、谁次日溢价高；补位：高标断板后次高板接替成新龙头；补涨：低位首板/2板，同题材，龙头已在高位（≥4板）。卡位成功标志：上板时间更早、封单更大、分时更强、能带动板块。'),
    sw_modes: R('switch', 'sw-1', '主线切换三种模式',
      '①硬切换：旧龙头跌停同日新方向批量首板5家以上，当天即可切；②软切换：旧主线高潮时新方向已有首板/2板悄悄走强，提前跟踪；③共生切换：双主线并行做跷跷板，单条线仓位减半。'),
    sw_checklist: R('switch', 'sw-2', '切换的判定清单',
      '旧主线死亡确认（满足3条即确认）：龙头断板且次日不反包 / 板块涨停从峰值回落>50% / 板块指数破5日线 / 中军大阴破位 / 补涨股不再涨停 / 3只以上中位股跌停 / 溢价连续2日为负。新主线成立确认（必须全部满足）：连续≥3日涨停共振 / ≥3板高标且正宗 / 涨停≥5家逐日递增 / 有梯队 / 有中军放量 / 有持续催化 / 涨停家数>旧主线。'),
    sw_final: R('switch', 'sw-2', '切换完成的最终确认（三选二）',
      '①新方向最高板>旧主线退潮时的高度；②新方向涨停家数连续2日>旧主线涨停家数；③旧主线龙头进入A字杀资金彻底放弃。满足其二即可认定主线切换完成。'),
    sw_ops: R('switch', 'sw-3', '切换期的分阶段操作 / U 型仓位曲线',
      '阶段A旧高潮50–70%逐步减仓；B旧分歧20–40%；C旧退潮10–30%试错新方向2板/3板；D新确认60–80%全面转向。切换期仓位≤30%，确认后再加。'),
    /* turning */
    tp_map: R('turning', 'tp-1', '八大拐点一览表',
      '①出清(崩塌→冰点)跌停家数大幅减少；②试错(冰点→修复)最高板回3板并封住+反核/地天；③启动(修复→启动)昨日涨停溢价首次转正+板块连续2日共振；④确认(启动→确认)分歧转一致+梯队成形；⑤加速(确认→高潮)龙头缩量一字+补涨潮；⑥见顶(高潮→分歧)龙头天量烂板/炸板+中位股批量跌停；⑦退潮(分歧→退潮)龙头断板且次日不反包+大面股≥5连续2日；⑧崩塌(退潮→崩塌)跌停家数>30+高标连续A字杀。'),
    tp_escape: R('turning', 'tp-3', '逃顶三原则（下行拐点总纲）',
      '原则一减仓优先于判断：见顶信号先减到40%以下；原则二中位股是领先指标：中位股批量跌停永远早于龙头见顶1–2天；原则三不接第一根大阴：等反包成功封住再考虑。'),
    tp_down: R('turning', 'tp-3', '见顶/退潮/崩塌拐点预警信号',
      '见顶：龙头天量烂板(2.5–4倍)、高位爆量不封、炸板率跳升10个百分点至30%+、中位股批量跌停、中军翻绿破5日线、出现天地板。退潮：龙头断板、连板高度塌陷、大面股≥5、溢价转负、反包失败。崩塌：高标连续A字杀、跌停家数>20并增加、炸板率>45%。'),
    /* dragon / zhongjun / midstock / frontline / follower / buzhang */
    dr_taxonomy: R('dragon', 'dr-1', '龙头的分类与真龙 vs 伪龙',
      '市场总龙头=全市场最高板+人气最高；板块龙头=主线内最高板且能带动板块。真龙：能带动板块（同题材跟风涨停≥3家）、题材纯正、换手充分15%–35%；伪龙/独龙：孤板无人跟风、蹭概念、一家独大、A字杀。'),
    dr_lifecycle: R('dragon', 'dr-2', '「3 板定理」——成龙的黄金判据',
      '能上3板并且带动同题材≥3家涨停的个股，即为龙头候选。1板是消息、2板是气质、3板是资金共识。3板是确定性提升最陡峭、风险收益比最好的介入点。'),
    dr_17: R('dragon', 'dr-3', '龙头判定 Checklist（17 项）',
      '符合≥12项=真龙；8–11项=强候选；<8项=存疑不宜重仓。17项：身位最高/上板最早/封单最大/能带动板块/题材纯正/3板以上/换手充分/分时强势/逻辑可延展/有中军配合/有梯队支撑/龙虎榜健康/流通盘适中/有辨识度/经历过分歧/非庄股特征/市场热议。'),
    dr_top12: R('dragon', 'dr-3', '龙头见顶的十二个信号（见三即减仓，见五即清仓）',
      '①天量烂板 ②高位爆量不封 ③缩量加速后突然放量 ④首次跌破5日线 ⑤龙虎榜拉萨军团接盘主力净卖出 ⑥板块内补涨股不再跟进 ⑦同身位出现卡位者 ⑧中位股批量跌停 ⑨中军大阴破位 ⑩尾盘勉强封板封单极小 ⑪出现天地板 ⑫竞价高开后直线下杀。'),
    dr_turnover: R('dragon', 'dr-4', '龙头各阶段换手率与量能密码',
      '启动1–3板换手10%–25%温和放量；主升4–6板15%–35%持续放量；加速6板+缩量<15%危险；见顶>40%天量3倍以上极危险。低位放量是好事，高位放量是坏事；缩量板在中间是强势，在顶部是危险。'),
    zj_types: R('zhongjun', 'zj-1', '中军的分类与角色分工',
      '板块中军=主线内市值较大、成交活跃、走趋势的核心票，流通市值100–800亿，成交额板块居前（10–50亿），走势为趋势型（非连板）。中军稳板块、承载资金、领先板块情绪1–2天。'),
    zj_signals: R('zhongjun', 'zj-2', '中军的四大信号作用 / 三个死亡信号',
      '中军不死，主线不灭；中军大阴破位（跌破10日线）=主线进入末期立即减仓；中军放量滞涨=大资金派发；中军补跌=主线彻底死亡无条件清仓。'),
    ms_risk: R('midstock', 'ms-1', '「退潮先杀中位」中位股风险定律',
      '中位股=相对市场最高板低2–3板的个股（3–5板）。退潮期中位股最先、最惨被杀：无唯一性、两头受压、获利盘沉重。看到中位股批量跌停（3只以上）就是最领先的退潮信号，立即减仓。'),
    ms_ban: R('midstock', 'ms-2', '中位股的绝对禁区（任一命中即回避）',
      '市场处于分歧/退潮/崩塌期、龙头已断板或天量烂板、板块梯队断层、一字中位或跟风涨停中位、当日已有2只以上中位股跌停、换手率<10%或>40%——任一命中回避。'),
    fl_identity: R('frontline', 'fl-1', '辨识度判定标准（七种辨识类型）',
      '满足1项=有辨识度（普通前排）；满足2项=强辨识度（核心前排）；满足≥3项=极高辨识度（市场焦点，通常龙一或龙二）。七类：空间/身位/形态/题材/记忆/量能/时间辨识。'),
    fl_tiers: R('frontline', 'fl-2', '前排个股的四层结构',
      '第一层龙一（空间+身位+题材辨识≥3项，核心仓重仓）；第二层龙二/龙三（2项，可做但仓位<龙一）；第三层前排跟风（1项，小仓套利快进快出）；第四层后排杂毛（无任何辨识度，不参与）。'),
    fw_features: R('follower', 'fw-1', '跟风股的八个判定特征（命中≥4项即为跟风股）',
      '上板时间晚(同题材第4名以后/午后)、封单小易开板(不足龙头1/5)、题材沾边不纯正、无连板能力、依赖龙头、无辨识度、分时软弱、量能异常。命中≥4项即跟风股。'),
    fw_rules: R('follower', 'fw-1', '跟风股的操作原则',
      '原则一默认不参与（风险收益比最差，长期必亏）；原则二只在极度亢奋期用极小仓≤5%做首板套利；原则三快进快出不连板必走；原则四退潮期第一时间清仓。'),
    bz_essence: R('buzhang', 'bz-1', '补涨的本质与出现时机',
      '补涨=龙头涨到高位后，资金因恐高挖掘的低位同属性个股，本质是比价效应。补涨潮出现在主线中后段而非初段；连最边缘的票都涨停（补涨到位）=无增量资金=见顶。'),
    bz_criteria: R('buzhang', 'bz-2', '补涨股的判定标准（8 项）',
      '位置低(首板/2板，绝不能高位)、同属性、龙头已在高位(≥4板)、逻辑清晰、上板时间早、封单较强、有量能配合、板块仍强势(龙头死了就没有补涨)。补涨股 vs 跟风股：低位/有独立逻辑/主动拉升/早盘上板/可连板2–4板/高度天花板=龙头−2~3板/可参与。'),
    bz_ceiling: R('buzhang', 'bz-2', '补涨股的高度天花板法则',
      '补涨股的高度天花板≈龙头高度−2~3板。例如龙头8板，补涨股合理高度5–6板；龙头5板，补涨股最多2–3板。当补涨股接近天花板（龙头高度−2板）时，无条件减仓不再持有。'),
    bz_wave: R('buzhang', 'bz-3', '「补涨到位」的五个识别信号',
      '①涨停名单出现莫名其妙的票(业务不沾边靠名字/地域联想)；②补涨股次日溢价转负；③板块涨停创新高但龙头滞涨；④补涨股数量超过首板源头供给；⑤媒体出现「XX概念全名单」。'),
    /* methods / position / op-* / risk */
    methods_hand: R('methods', 'mt-1', '操作手法库 · 十种基本手法',
      '打板 / 半路 / 低吸 / 排板 / 回封 / 翘板 / 做T / 反包 / 二波 / 空仓。龙头分歧转一致用半路或打板，中军缩量回踩均线用低吸（不追高不打板），跟风股默认不买。'),
    ps_matrix: R('position', 'ps-1', '周期 × 品种 仓位矩阵 / 六条铁律',
      '确认期：龙头30–40%、中军15–20%、前排15–25%、补涨10–15%、总仓60–80%；高潮期总仓50–70%；分歧期20–40%；退潮期0–20%；崩塌期0%。铁律：周期决定总仓位、单票上限40%、退潮本金保全第一、加仓只在确认后、分批、亏损后降仓。'),
    ps_stop: R('position', 'ps-2', '分品种止损止盈标准',
      '龙头：断板次日不反包 或 破5日线 或 亏损达−8%；中军：破10日线 或 −7%；前排辨识度：不连板 或 −6%；中位股：不连板立即走 或 −5%；补涨股：不连板 或 龙头见顶 或 −5%；跟风股：不连板必走 或 −4%。'),
    op_dragon: R('op-dragon', 'od-1', '龙头股操作：分歧转一致 / 3 板成龙点',
      '3板成龙点打板（带动同题材≥3家涨停）；4板以上分歧转一致（爆量烂板次日高开+2%快速上板）为全体系最佳买点，半路或打板，仓位30–40%；6板以上缩量加速是禁买区，只持有或分批兑现，不新开。'),
    op_zhongjun: R('op-zhongjun', 'oz-1', '中军股操作：低吸不追高 / 沿均线做',
      '缩量回踩5/10日线企稳→低吸；或主线刚确认中军放量突破→半路。不追高、不打板。收盘跌破10日线离场，放量下跌=出货。仓位15–20%。'),
    op_frontline: R('op-frontline', 'of-1', '前排辨识度个股操作：越早越好只做前二',
      '只做板块内早盘最先上板、封单最大的前二；打板确认，不连板即走、龙头死即走，仓位15–25%，快进快出。'),
    op_buzhang: R('op-buzhang', 'ob-1', '补涨股操作：只低吸不追高 / 龙头死即走',
      '龙头≥4板时挖同题材正宗未涨标的，只做正宗补涨不做玄学补涨；只低吸不追高。不连板即走、龙头断板补涨立刻走、达天花板(龙头−2板)即走。每天第一件事看龙头还在不在。'),
    rk_three: R('risk', 'rk-1', '三层风控体系 / 七条铁律',
      '个股风控：单笔最大亏损≤总资金2%（止损位=买入价×0.92~0.95），单票持仓≤40%；组合风控：单日回撤≥3%不再开新仓、单周≥8%仓位减半、单月≥15%强制空仓3天；状态风控：连亏2笔减半、连亏3笔强制空仓1天。七条铁律含绝不补仓、绝不扛单、退潮绝不满仓、绝不重仓单票(>40%)、绝不用杠杆。'),
    rk_review: R('risk', 'rk-2', '每日复盘清单（10 项）',
      '①记录情绪温度及ΔT3；②记录涨停/跌停/连板/最高板/炸板率/晋级率/大面股/溢价；③判断当前阶段及距拐点距离；④描绘梯队图；⑤主线强度打分；⑥更新候选池；⑦龙头体检(命中见顶信号几个)；⑧复盘交易违反哪条纪律；⑨制定明日计划(买什么/条件/仓位/止损/卖出)；⑩检查仓位是否符合仓位矩阵。'),
    rk_loss: R('risk', 'rk-3', '十大亏损模式与破解',
      '退潮期抄底高位股、补仓摊薄成本、把反抽当反转、追跟风股/杂毛、高潮期追缩量加速板、把一日游当主线、该卖不卖、频繁换股、情绪化报复交易、重仓单票/用杠杆。'),
    refine_calib: R('refine', 'rf-1', '周期体系精修 · 阈值动态校准',
      '本体系各项阈值（涨停家数、连板高度、炸板率等）为经验参考基准，须按当前市场容量动态校准：取近20日中位数为常态、80分位为高潮、20分位为冰点，避免机械套用固定数值。'),
    cases_lesson: R('cases', 'ca-1', '实战案例复盘 · 主线主升段',
      '主线主升期（确认→高潮）持有龙头不动、分歧转一致加仓，是收益最大、容错率最高的阶段；卖飞龙头是该阶段最大错误。'),
    casesb_fail: R('cases-b', 'cb-1', '案例三 · 失败模式解剖（反面教材）',
      '退潮期抄底高位股、把反抽当反转、追跟风杂毛、高潮期追缩量加速板、重仓单一票，是最典型的账户回撤来源；纪律的价值在于消除情绪。')
  };

  /* rule 引用器：返回 {rule, quote, ch, sec}，并登记到 evidence / chapterIds */
  function makeRef() {
    var ev = {}, chset = {};
    function ref(key) {
      var r = RULES[key] || RULES.qr_decision;
      ev[key] = 1; chset[r.ch] = 1;
      return { rule: chapName(r.ch) + '（' + r.ch + '）· ' + r.name, quote: r.q, ch: r.ch, sec: r.sec, key: key };
    }
    function attach(o, key) { var r = ref(key); o.rule = r.rule; o.quote = r.quote; o.ruleKey = key; o.ch = r.ch; o.sec = r.sec; return o; }
    function evidence() {
      return Object.keys(ev).map(function (k) {
        var r = RULES[k] || RULES.qr_decision;
        return { key: k, ch: r.ch, sec: r.sec, chapter: chapName(r.ch), name: r.name, quote: r.q, rule: chapName(r.ch) + ' · ' + r.name };
      });
    }
    return { ref: ref, attach: attach, evidence: evidence, chapterIds: function () { return Object.keys(chset); } };
  }

  /* ===========================================================================
   * 2. 数据读取层
   *  - 汇总类结论（涨停/炸板/跌停家数、最高板、连板家数、板块涨停数、板位分布、
   *    当日最高标）一律优先用 d.market（app.js refreshAll 挂载的当日收盘行情）与
   *    d.market.ztPool（东财当日涨停池），不再用旧快照 d.stocks 汇总；
   *  - 个股级筛选仍用 d.stocks（个股明细快照，日期可能不同），每条 pick 标注个股数据日期；
   *  - 炸板率只用 market.zbRate，封板率自算 ztCount/(ztCount+zbCount)，绝不用 st.seal_rate；
   *    快照 open_stock_count / seal_rate 是「估算口径」，仅在 market 缺失时回退并标注；
   *  - 缺失一律 null，不猜测补值。
   * ======================================================================== */
  function readData(d) {
    d = d || {};
    var stocks = (d.stocks || []).filter(function (s) { return s && s.name; });
    var ov = d.overview || {};
    var st = d.stats || {};
    var mk = (d.market && typeof d.market === 'object') ? d.market : null;

    var snapDate = d.date || ov.date || '—';                 // 个股明细快照日期
    var marketDate = mk && mk.date ? mk.date : null;         // 当日汇总行情日期
    var aggDate = marketDate || snapDate;                    // 汇总口径日期
    /* v20261112b：market.date 是 compact 'YYYYMMDD'、d.date 是 ISO 'YYYY-MM-DD'，
       直接比字符串会把同一天误判为「日期不同，已分口径」。先统一去分隔符再比。 */
    var dateMixed = !!(marketDate
      && String(marketDate).replace(/-/g, '').slice(0, 8) !== String(snapDate).replace(/-/g, '').slice(0, 8));

    // 汇总池：d.market.ztPool（东财当日涨停池）优先，统一成内部股票形状
    var ztPool = (mk && Array.isArray(mk.ztPool)) ? mk.ztPool.filter(function (x) { return x && x.name; }) : [];
    var usePool = ztPool.length > 0;
    var aggStocks = usePool ? ztPool.map(function (x) {
      // 兼容两种 ztPool 别名：规格口径(seal/openTimes/turnover) 与 market-today.js 实测口径(fund 元/zbc/hs/lbc/hybk)；
      // fund 为「元」需 /1e4 归一到「万」，与 d.stocks 的 seal 单位一致；全部取自 d 的字段，不补默认值
      var sec = x.sector || x.hybk || '其他';
      var sealWan = V(x.seal) != null ? V(x.seal) : (V(x.fund) != null ? V(x.fund) / 1e4 : null);
      return {
        code: x.code, name: x.name,
        boards: V(x.boards) != null ? V(x.boards) : (V(x.lbc) != null ? V(x.lbc) : 1),
        sector: sec, concepts: [sec],
        firstTime: x.firstTime || '',
        seal: sealWan,
        openTimes: V(x.openTimes) != null ? V(x.openTimes) : V(x.zbc),
        turnover: V(x.turnover) != null ? V(x.turnover) : V(x.hs),
        changePct: V(x.zdp), _pool: true
      };
    }) : stocks;

    // 汇总数值：优先 d.market
    var limitUp = V(mk && mk.ztCount) != null ? V(mk.ztCount) : (V(ov.limitUp) != null ? V(ov.limitUp) : stocks.length);
    var maxBoards = V(mk && mk.maxBoards) != null ? V(mk.maxBoards) : V(ov.maxBoards);
    var lianban = V(mk && mk.lianbanCount) != null ? V(mk.lianbanCount) : V(ov.lianban);
    var zbCount = V(mk && mk.zbCount);
    var dtCount = V(mk && mk.dtCount);
    var zhaban = zbCount != null ? zbCount : V(ov.zhaban);

    // 炸板率 / 封板率：只用当日实测；回退快照须标 estimate
    var zbRate = null, zbRateKind = null, sealRate = null, sealRateKind = null;
    if (mk && V(mk.zbRate) != null) {
      zbRate = V(mk.zbRate); zbRateKind = 'market';
    } else if (mk && V(mk.ztCount) != null && zbCount != null && (V(mk.ztCount) + zbCount) > 0) {
      zbRate = Math.round(zbCount / (V(mk.ztCount) + zbCount) * 1000) / 10; zbRateKind = 'market';
    }
    // 封板率自算，绝不用 st.seal_rate
    if (mk && V(mk.ztCount) != null && zbCount != null && (V(mk.ztCount) + zbCount) > 0) {
      sealRate = V(mk.ztCount) / (V(mk.ztCount) + zbCount); sealRateKind = 'market';
    } else if (zbRate != null && zbRateKind === 'market') {
      sealRate = 1 - zbRate / 100; sealRateKind = 'market';
    }
    // 仅当 d.market 不存在或 market.zbRate 为 null 时才回退快照估算口径
    if (zbRate == null) {
      var openN = V(st.open_stock_count);
      var snapLU = V(ov.limitUp) != null ? V(ov.limitUp) : stocks.length;
      if (openN != null && (snapLU + openN) > 0) {
        zbRate = openN / (snapLU + openN) * 100; zbRateKind = 'estimate';
      }
      if (V(st.seal_rate) != null) { sealRate = V(st.seal_rate); sealRateKind = 'estimate'; }
    }

    // 其它当日实测（用于拐点 / 周期 / 六维，缺失才标缺）
    var prem = V(mk && mk.prem);            // 昨日涨停今日溢价 %
    var promoRate = V(mk && mk.promoRate);  // 连板晋级率 %
    var damian = V(mk && mk.damian);        // 大面股家数
    var upRatio = V(mk && mk.upRatio);
    var volChange = V(mk && mk.volChange);
    var amountToday = V(mk && mk.amountToday);
    var amountMa5 = V(mk && mk.amountMa5);
    var indices = (mk && Array.isArray(mk.indices)) ? mk.indices : [];

    // 板位分布：优先用当日 ztPool 重算
    var exact = [];
    if (usePool) {
      var bg = {};
      aggStocks.forEach(function (s) { var b = V(s.boards) != null ? V(s.boards) : 1; bg[b] = (bg[b] || 0) + 1; });
      exact = Object.keys(bg).map(function (b) { return { b: Number(b), n: bg[b] }; }).sort(function (a, b) { return b.b - a.b; });
    } else {
      exact = (st.exact_boards || []).map(function (b) { return { b: V(b.board_num), n: V(b.stock_count) }; })
        .filter(function (x) { return x.b != null && x.n != null; }).sort(function (a, b) { return b.b - a.b; });
    }

    // 板块列表：优先 market.sectorCounts（当日板块涨停数，由 ztPool 统计）；
    // 合并 d.sectors（快照板块）条目，保证个股筛选仍能按快照板块匹配（避免命名/日期差异选不出票）
    var sectorMap = {};
    if (mk && Array.isArray(mk.sectorCounts) && mk.sectorCounts.length) {
      mk.sectorCounts.forEach(function (x) {
        var k = x.sector || '其他'; sectorMap[k] = { sector: k, limitCount: V(x.limitCount), heat: null, names: [], from: 'market' };
      });
      (d.sectors || []).forEach(function (x) {
        var k = x.sector || '其他';
        if (!sectorMap[k]) sectorMap[k] = { sector: k, limitCount: V(x.limitCount), heat: V(x.heat), names: x.names || [], from: 'snapshot' };
      });
    } else {
      (d.sectors || []).forEach(function (x) {
        var k = x.sector || '其他'; sectorMap[k] = { sector: k, limitCount: V(x.limitCount), heat: V(x.heat), names: x.names || [], from: 'snapshot' };
      });
    }
    var sectors = Object.keys(sectorMap).map(function (k) { return sectorMap[k]; })
      .sort(function (a, b) { return (b.limitCount || 0) - (a.limitCount || 0); });

    // 数据质量：实测 / 估算口径 / 缺数据 三类
    var srcM = marketDate ? ('d.market 当日 ' + marketDate) : 'd.market';
    var measured = [
      '涨停家数 ztCount=' + (limitUp == null ? '—' : limitUp) + '（' + (V(mk && mk.ztCount) != null ? srcM : '快照 ' + snapDate) + '）',
      '炸板家数 zbCount=' + (zbCount == null ? '—' : zbCount) + '、炸板率 ' + (zbRate == null ? '缺' : zbRate.toFixed(1) + '%') + '（' + (zbRateKind === 'market' ? srcM : '快照估算 ' + snapDate) + '）',
      '封板率 ' + (sealRate == null ? '缺' : (sealRate * 100).toFixed(1) + '%') + '（' + (sealRateKind === 'market' ? 'ztCount/(ztCount+zbCount) 自算' : '快照估算') + '）',
      '最高板 maxBoards=' + (maxBoards == null ? '缺' : maxBoards) + '、连板家数 lianbanCount=' + (lianban == null ? '缺' : lianban) + '（' + (usePool ? 'd.market.ztPool 当日' : '快照') + '）',
      '板位分布 ' + (exact.length ? exact.map(function (e) { return e.b + '板×' + e.n; }).join('/') : '缺') + '（' + (usePool ? 'ztPool 重算' : 'stats.exact_boards') + '）'
    ];
    if (dtCount != null) measured.push('跌停家数 dtCount=' + dtCount + '（' + srcM + '）');
    if (prem != null) measured.push('昨日涨停今日溢价 prem=' + prem + '%（' + srcM + '）');
    if (promoRate != null) measured.push('连板晋级率 promoRate=' + promoRate + '%（' + srcM + '）');
    if (damian != null) measured.push('大面股 damian=' + damian + ' 家（' + srcM + '）');
    if (upRatio != null) measured.push('上涨家数占比 upRatio=' + upRatio + '%（' + srcM + '）');
    if (volChange != null) measured.push('量能变化 volChange=' + volChange + '%（' + srcM + '）');
    if (indices.length) measured.push('指数 indices=' + indices.length + ' 条（' + srcM + '）');
    if (mk && Array.isArray(mk.sectorCounts) && mk.sectorCounts.length) measured.push('板块涨停数 sectorCounts=' + mk.sectorCounts.length + ' 个板块（d.market.ztPool 当日）');
    measured.push('个股字段 boards/seal/cap/turnover/volumeRatio/netIn/firstTime/openTimes/limitType/sm/decay（d.stocks 快照 ' + snapDate + '，用于个股级筛选）');

    var estimate = [
      'open_stock_count=' + (V(st.open_stock_count) == null ? '—' : V(st.open_stock_count)) + '：快照估算口径，含义为「涨停池内开板≥3 次的个股数」，非全市场炸板家数',
      'seal_rate=' + (V(st.seal_rate) == null ? '—' : V(st.seal_rate)) + '：快照估算口径，含义为「未开板≥3 次比例」，非封板率',
      'stats.exact_boards / overview.limitDown（兜底默认 0）：快照口径，不作为当日实测值'
    ];
    if (zbRateKind === 'estimate') estimate.push('⚠ 当前炸板率/封板率使用快照估算口径，仅供参考、非当日实测（快照 ' + snapDate + '）');

    var missing = [];
    if (dtCount == null) missing.push('跌停家数（d.market.dtCount 缺）');
    if (prem == null) missing.push('昨日涨停今日溢价（d.market.prem 缺）');
    if (promoRate == null) missing.push('连板晋级率（d.market.promoRate 缺）');
    if (damian == null) missing.push('大面股数量（d.market.damian 缺）');
    missing.push('5 日均量基准 / 振幅 / 分时均价线 / 5日线·10日线（无 K 线与分时数据）');
    missing.push('龙虎榜席位明细（知名游资 / 拉萨军团 / 机构）、题材纯正度 / 辨识度标签 / 市场热议（无标注）');
    missing.push('催化级别 / 消息面 / 板块历史峰值与连续天数（无历史数据）');
    missing.push('指数环境评分（手册无明确打分表，indices 仅作展示，不计入六维分母）');
    missing.push('午盘封单 sm / 封单衰减 decay：仅当个股字段非空时可用，否则标缺');
    if (dateMixed) missing.push('⚠ 日期提示：当日汇总行情 ' + marketDate + ' 与个股明细快照 ' + snapDate + ' 不同；汇总类结论用当日，个股级筛选用快照（pick 已标注个股数据日期）');

    return {
      d: d, stocks: stocks, aggStocks: aggStocks, usePool: usePool, market: mk,
      ov: ov, st: st, sectors: sectors, exact: exact,
      limitUp: limitUp, zbCount: zbCount, dtCount: dtCount,
      zbRate: zbRate, zbRateKind: zbRateKind, sealRate: sealRate, sealRateKind: sealRateKind,
      maxBoards: maxBoards, lianban: lianban, zhaban: zhaban,
      prem: prem, promoRate: promoRate, damian: damian, upRatio: upRatio,
      volChange: volChange, amountToday: amountToday, amountMa5: amountMa5, indices: indices,
      hotSectors: sectors.length,
      snapDate: snapDate, marketDate: marketDate, aggDate: aggDate, dateMixed: dateMixed,
      date: aggDate, source: d.source || '—',
      measured: measured, estimate: estimate, missing: missing
    };
  }
  // 炸板率/封板率口径标签（随 kind 变化，避免把估算值说成实测）
  function rateLabel(kind) {
    return kind === 'market' ? '（d.market 当日实测）'
      : kind === 'estimate' ? '（快照估算口径，仅供参考；非当日）'
        : '（缺数据）';
  }
  // 个股在某板块内
  function inSector(s, sector) {
    if (!s) return false;
    if (s.sector === sector) return true;
    return (s.concepts || []).indexOf(sector) >= 0;
  }
  function sectorStocks(X, sector) { return X.stocks.filter(function (s) { return inSector(s, sector); }); }
  // 角色定位/体检用的板块内个股：优先个股筛选池（快照全因子），无匹配回退当日汇总池
  function locateStocks(X, sector) {
    var a = sectorStocks(X, sector);
    if (a.length) return a;
    return (X.aggStocks || []).filter(function (s) { return inSector(s, sector); });
  }
  // 允许 s == null：locateRoles 里 roleObj(...) 的实参对象会先于 roleObj 内部的
  // if (!s) return null 求值，个股为空时若这里不保护会直接抛 TypeError。
  function bOf(s) { return s && V(s.boards) != null ? V(s.boards) : null; }
  function firstMin(s) { return s ? toMin(s.firstTime) : null; }

  /* ===========================================================================
   * 3. 周期定位（v_dash / 复盘共用）—— quickref 阈值卡 + overview 八阶段
   * ======================================================================== */
  var STAGES = [
    { n: '①冰点期', lo: 0, cap: 2, total: '0–10%', key: 'ice' },
    { n: '②修复期', lo: 20, cap: 3, total: '10–30%', key: 'fix' },
    { n: '③启动期', lo: 35, cap: 4, total: '30–50%', key: 'start' },
    { n: '④确认期', lo: 50, cap: 5, total: '60–80%', key: 'confirm' },
    { n: '⑤高潮期', lo: 68, cap: 6, total: '50–70%', key: 'climax' },
    { n: '⑥分歧期', lo: 55, cap: 3, total: '20–40%', key: 'diverge' },
    { n: '⑦退潮期', lo: 35, cap: 2, total: '0–20%', key: 'ebb' },
    { n: '⑧崩塌期', lo: 15, cap: 0, total: '0%', key: 'crash' }
  ];
  function cycleVerdict(X, R) {
    var votes = [], sig = [];
    function push(name, val, band, rule, src) { sig.push({ name: name, val: val, band: band, rule: rule, src: src || '' }); }
    var mb = X.maxBoards, lu = X.limitUp, lb = X.lianban, zb = X.zbRate;
    var zl = rateLabel(X.zbRateKind);
    // 最高连板高度（当日 d.market.ztPool）→ quickref 三句话定周期 / 阈值卡（≤2冰点 3修复 3–4启动 4–5确认 6–8高潮）
    var stageByMB = mb == null ? null : mb <= 2 ? '①冰点期' : mb === 3 ? '②修复期' : mb <= 4 ? '③启动期' : mb <= 5 ? '④确认期' : mb <= 8 ? '⑤高潮期' : '⑥分歧期';
    push('最高连板高度', mb == null ? '—' : mb + ' 板', stageByMB || '缺数据', R.ref('qr_three').rule, X.usePool ? 'd.market.ztPool 当日' : '快照');
    if (stageByMB) votes.push(stageByMB);
    // 涨停家数（当日 d.market.ztCount）
    var stageByLU = lu == null ? null : lu < 25 ? '①冰点期' : lu < 40 ? '②修复期' : lu < 60 ? '③启动期' : lu < 85 ? '④确认期' : '⑤高潮期';
    push('涨停家数', lu == null ? '—' : lu + ' 家', stageByLU || '缺数据', R.ref('qr_threshold').rule, 'd.market.ztCount 当日');
    if (stageByLU) votes.push(stageByLU);
    // 连板家数（当日 d.market.lianbanCount）
    var stageByLB = lb == null ? null : lb < 5 ? '①冰点期' : lb < 8 ? '②修复期' : lb < 14 ? '③启动期' : lb < 22 ? '④确认期' : '⑤高潮期';
    push('连板家数', lb == null ? '—' : lb + ' 家', stageByLB || '缺数据', R.ref('qr_threshold').rule, 'd.market.lianbanCount 当日');
    if (stageByLB) votes.push(stageByLB);
    // 炸板率：只用修正后的 X.zbRate，随 kind 标注来源（绝不用 open_stock_count 推导冒充实测）
    var stageByZB = zb == null ? null : zb > 45 ? '⑧崩塌期' : zb > 35 ? '⑦退潮期' : zb > 25 ? '⑥分歧期' : zb >= 15 ? '④确认期' : '⑤高潮期';
    push('全市场炸板率', zb == null ? '—' : zb.toFixed(1) + '%', stageByZB || '缺数据', R.ref('qr_threshold').rule, zl);
    if (stageByZB && zb > 25) votes.push(stageByZB); // 仅在转弱/危险时作为下行票
    // 昨日涨停今日溢价（d.market.prem 实测，缺才标缺）
    if (X.prem != null) {
      var stP = X.prem < -3 ? '⑧崩塌期' : X.prem < 0 ? '②修复期' : X.prem < 1.5 ? '③启动期' : X.prem <= 3 ? '④确认期' : '⑤高潮期';
      push('昨日涨停今日溢价', X.prem + '%', stP, R.ref('qr_threshold').rule, 'd.market.prem 当日');
      R.ref('thermo_model'); // 溢价定档依据情绪温度计九维模型（与缺数据分支一致保持引用）
      votes.push(stP);
    } else push('昨日涨停今日溢价', '缺数据', '缺数据，未计入结论', R.ref('thermo_model').rule, 'd.market.prem 缺');
    // 跌停家数 / 大面股（d.market 实测，缺才标缺；超阈值按「减仓优先」加下行票）
    if (X.dtCount != null) {
      var stD = X.dtCount < 5 ? '正常' : X.dtCount <= 10 ? '转弱' : X.dtCount <= 15 ? '退潮初期' : X.dtCount <= 30 ? '退潮' : '崩塌';
      push('跌停家数', X.dtCount + ' 家', stD, R.ref('qr_threshold').rule, 'd.market.dtCount 当日');
      if (X.dtCount > 15) votes.push(X.dtCount > 30 ? '⑧崩塌期' : '⑦退潮期');
    } else push('跌停家数', '缺数据', '缺数据，未计入结论', R.ref('qr_three').rule, 'd.market.dtCount 缺');
    if (X.damian != null) {
      var stM = X.damian <= 1 ? '安全' : X.damian <= 3 ? '关注' : X.damian <= 6 ? '减仓' : '清仓';
      push('大面股数量', X.damian + ' 家', stM, R.ref('qr_three').rule, 'd.market.damian 当日');
      if (X.damian >= 4) votes.push(X.damian >= 7 ? '⑦退潮期' : '⑥分歧期');
    } else push('大面股数量', '缺数据', '缺数据，未计入结论', R.ref('qr_three').rule, 'd.market.damian 缺');
    // 计票：一致取多数；分歧/退潮等下行票存在时按「减仓优先于判断」取最保守（序号最大）票
    var order = {}; STAGES.forEach(function (s, i) { order[s.n] = i; });
    var down = votes.filter(function (v) { return /分歧|退潮|崩塌/.test(v); });
    var stage;
    if (down.length) stage = down.sort(function (a, b) { return order[b] - order[a]; })[0];
    else if (votes.length) {
      var cnt = {}; votes.forEach(function (v) { cnt[v] = (cnt[v] || 0) + 1; });
      stage = Object.keys(cnt).sort(function (a, b) { return (cnt[b] - cnt[a]) || (order[b] - order[a]); })[0];
    } else stage = '—（关键数据缺失，无法定位）';
    var stageObj = null;
    STAGES.forEach(function (s) { if (s.n === stage) stageObj = s; });
    var o = {
      stage: stage, stageCap: stageObj ? stageObj.cap : null, total: stageObj ? stageObj.total : '—',
      signals: sig, votes: votes, rule: '', quote: '', why: '',
      riskOff: /退潮|崩塌|冰点/.test(stage)
    };
    R.attach(o, 'mc_stages');
    o.why = '汇总用 d.market 当日字段：maxBoards=' + (mb == null ? '缺' : mb) + '、ztCount=' + (lu == null ? '缺' : lu)
      + '、lianbanCount=' + (lb == null ? '缺' : lb) + '、炸板率=' + (zb == null ? '缺' : zb.toFixed(1) + '%') + zl
      + '、prem=' + (X.prem == null ? '缺' : X.prem + '%') + '、dtCount=' + (X.dtCount == null ? '缺' : X.dtCount)
      + '、damian=' + (X.damian == null ? '缺' : X.damian) + '，对照阈值卡计票；'
      + '缺数据项标「缺数据，未计入结论」；下行票按「减仓优先于判断」取最保守。个股明细日期 ' + X.snapDate + ' 与当日汇总日期 ' + X.aggDate + ' 已区分。';
    return o;
  }

  /* ===========================================================================
   * 4. 主线/支线六维打分（任务给定权重；缺失维度标「缺」从分母剔除）
   *    权重：涨停广度20 / 连板高度与梯队20 / 炸板率与封板质量20 / 晋级率15 /
   *          量能与主线切换15 / 指数环境10；分档阈值严格用手册 mainline ml-1。
   * ======================================================================== */
  function boardScoreFor(X, sector) {
    // 板块梯队/板位分布属汇总结论：优先用当日 ztPool（aggStocks），无匹配才回退个股筛选池
    var ss = (X.aggStocks || []).filter(function (s) { return inSector(s, sector); });
    if (!ss.length) ss = sectorStocks(X, sector);
    var ent = null;
    X.sectors.forEach(function (x) { if (x.sector === sector) ent = x; });
    var limitCount = ent && ent.limitCount != null ? ent.limitCount : ss.length;
    var boards = ss.map(bOf).filter(function (x) { return x != null; });
    var mb = maxOf(boards);
    var hasHigh = boards.some(function (b) { return b >= 3; });
    var hasMid = boards.some(function (b) { return b === 2; });
    var hasLow = boards.some(function (b) { return b === 1; });
    var highN = boards.filter(function (b) { return b >= 3; }).length;
    var midN = boards.filter(function (b) { return b === 2; }).length;
    var gapOk = (mb != null && mb <= 5); // 相邻板级差粗判（缺逐板位历史，保守）
    return {
      ss: ss, limitCount: limitCount, mb: mb, hasHigh: hasHigh, hasMid: hasMid, hasLow: hasLow,
      highN: highN, midN: midN, gapOk: gapOk,
      boardsDist: X.exact.map(function (e) { return e.b + '板×' + e.n; }).join(' / ') || '缺数据'
    };
  }
  function secRank(X, R) {
    var dimsDef = [
      { key: 'breadth', name: '涨停广度', max: 20, rule: 'sc_10dim' },
      { key: 'ladder', name: '连板高度与梯队', max: 20, rule: 'ec_health' },
      { key: 'seal', name: '炸板率与封板质量', max: 20, rule: 'qr_threshold' },
      { key: 'promote', name: '晋级率', max: 15, rule: 'ec_health' },
      { key: 'volume', name: '量能与主线切换', max: 15, rule: 'sw_modes' },
      { key: 'index', name: '指数环境', max: 10, rule: 'ov_core' }
    ];
    var list = X.sectors.slice().sort(function (a, b) { return (b.limitCount || 0) - (a.limitCount || 0); }).slice(0, 8);
    return list.map(function (sec) {
      var B = boardScoreFor(X, sec.sector);
      var dims = [], denom = 0, gotSum = 0, missN = 0;
      // ① 涨停广度
      var ratio = (X.limitUp > 0) ? B.limitCount / X.limitUp * 100 : null;
      var g1 = ratio == null ? 0 : ratio > 35 ? 20 : ratio >= 25 ? 16 : ratio >= 15 ? 12 : ratio >= 8 ? 7 : 3;
      if (ratio == null) { dims.push(missDim(dimsDef[0], '缺板块占比数据')); missN++; }
      else { dims.push(okDim(dimsDef[0], g1, '板块涨停 ' + B.limitCount + ' 家 / 全市场 ' + X.limitUp + ' 家 = ' + ratio.toFixed(1) + '%')); denom += 20; gotSum += g1; }
      // ② 连板高度与梯队
      var ladder = (B.hasHigh && B.hasMid && B.hasLow) ? 12 : (B.hasMid && B.hasLow) ? 7 : B.hasLow ? 3 : 0;
      var hg = B.mb == null ? 0 : B.mb >= 5 ? 8 : B.mb === 4 ? 6 : B.mb === 3 ? 4 : B.mb === 2 ? 2 : 0;
      var g2 = ladder + hg;
      if (!B.ss.length) { dims.push(missDim(dimsDef[1], '板块内无个股')); missN++; }
      else {
        dims.push(okDim(dimsDef[1], g2, '板块内 ' + B.hasHigh + '/' + B.hasMid + '/' + B.hasLow + '(高/中/低)、最高板 ' + (B.mb == null ? '缺' : B.mb) + ' 板 → 梯队 ' + ladder + '/12 + 高度 ' + hg + '/8'));
        denom += 20; gotSum += g2;
      }
      // ③ 炸板率与封板质量（只用修正后的 X.zbRate，随 kind 标注来源；板块级炸板率缺 → 全市场代理）
      var badOpen = B.ss.filter(function (s) { return (V(s.openTimes) || 0) >= 3; }).length;
      var g3 = X.zbRate == null ? 0 : X.zbRate > 45 ? 0 : X.zbRate > 35 ? 5 : X.zbRate > 25 ? 10 : X.zbRate >= 15 ? 16 : 20;
      g3 = Math.max(0, g3 - badOpen * 2);
      if (X.zbRate == null) { dims.push(missDim(dimsDef[2], '缺炸板率数据（d.market.zbRate 与快照估算均缺）')); missN++; }
      else {
        dims.push(attach({ name: dimsDef[2].name, max: 20, got: g3, status: 'proxy' }, 'sc_oneday'));
        dims[dims.length - 1].detail = '全市场炸板率 ' + X.zbRate.toFixed(1) + '%' + rateLabel(X.zbRateKind)
          + ' + 板块内开板≥3次 ' + badOpen + ' 只扣分；板块级炸板率缺数据，用全市场代理';
        dims[dims.length - 1].why = '来源：' + (X.zbRateKind === 'market' ? 'd.market.zbRate 当日实测' : '快照 open_stock_count 估算口径（仅供参考、非当日）')
          + ' + 个股 openTimes；板块级历史缺，标注代理口径';
        R.ref('sc_oneday'); R.ref('qr_threshold');
        denom += 20; gotSum += g3;
      }
      // ④ 晋级率：d.market.promoRate 有实测值则按手册阈值卡计分；无则标缺剔除分母
      if (X.promoRate != null) {
        var g4 = X.promoRate > 55 ? 15 : X.promoRate >= 45 ? 12 : X.promoRate >= 25 ? 8 : X.promoRate >= 15 ? 4 : 0;
        dims.push(okDim(dimsDef[3], g4, 'd.market.promoRate=' + X.promoRate + '%（上一交易日连板股今日晋级比例）' + rateLabel('market')
          + '；按手册 qr-4 晋级率档位 >55强势/45–55健康/25–45一般/15–25差/<15极差 映射 15 分'));
        R.ref('qr_threshold'); denom += 15; gotSum += g4;
      } else {
        dims.push(missDim(dimsDef[3], '缺连板晋级率（d.market.promoRate 缺），按手册口径标「缺数据，未计入结论」并从分母剔除'));
        missN++;
      }
      // ⑤ 量能与主线切换（个股 volumeRatio/netIn + 当日 volChange；切换需历史基线 → 仅量能计分并标注）
      var vr = maxOf(B.ss.map(function (s) { return V(s.volumeRatio); }).filter(function (x) { return x != null; }));
      var net = sum(B.ss.map(function (s) { return V(s.netIn); }).filter(function (x) { return x != null; }));
      var g5 = 0;
      if (vr != null) g5 += vr >= 1.5 ? 8 : vr >= 1 ? 5 : 2;
      if (net > 0) g5 += 4; else if (net < 0) g5 -= 3;
      if (X.volChange != null) g5 += X.volChange > 0 ? 3 : -2; // 当日两市量能变化（代理）
      g5 = Math.max(0, Math.min(15, g5));
      if (vr == null && !B.ss.some(function (s) { return has(s.netIn); }) && X.volChange == null) { dims.push(missDim(dimsDef[4], '缺量比 / 资金 / 量能数据')); missN++; }
      else {
        var d5 = attach({ name: dimsDef[4].name, max: 15, got: g5, status: 'proxy' }, 'sw_ops');
        d5.detail = '板块内最大量比 ' + (vr == null ? '缺' : vr.toFixed(2)) + '、主力净流入合计 ' + (has(net) ? net.toFixed(2) + ' 亿' : '缺')
          + '、当日两市量能变化 volChange=' + (X.volChange == null ? '缺' : X.volChange + '%') + rateLabel(X.volChange == null ? null : 'market')
          + '；「主线切换」需历史基线，缺数据，本维仅按量能计分（可能低估）';
        d5.why = '来源字段 volumeRatio / netIn（个股快照）/ d.market.volChange（当日）；切换信号缺历史数据未计入';
        dims.push(d5); R.ref('sw_ops'); denom += 15; gotSum += g5;
      }
      // ⑥ 指数环境：手册无明确打分表 → 标缺，剔除分母（indices 仅作展示，不自创权重）
      dims.push(missDim(dimsDef[5], '手册无「指数环境」明确打分表，d.market.indices 仅作展示，按口径标「缺数据，未计入结论」并从分母剔除'));
      missN++;
      var score = denom > 0 ? Math.round(gotSum / denom * 100) : null;
      var level = score == null ? '—' : score >= 70 ? '主线' : score >= 50 ? '准主线' : score >= 30 ? '支线' : '不达标（一日游/杂毛轮动）';
      var o = {
        sector: sec.sector, limitCount: B.limitCount, maxBoards: B.mb,
        high: B.hasHigh, mid: B.hasMid, low: B.hasLow, boardsDist: B.boardsDist,
        dims: dims, denom: denom, gotSum: gotSum, missN: missN, score: score, level: level,
        why: '六维打分：可用维度满分合计 ' + denom + '，实得 ' + gotSum + '，归一化 ' + (score == null ? '—' : score) + '/100；'
          + '缺 ' + missN + ' 维已从分母剔除（不得猜测补值）。分档阈值按手册 ml-1：≥70主线 / 50–70准主线 / 30–50支线 / <30不达标。',
        rule: '', quote: ''
      };
      R.attach(o, 'ml_score');
      R.ref('ml_six'); R.ref('sc_stages');
      return o;
    }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });

    function okDim(def, got, detail) {
      R.ref(def.rule);
      return { name: def.name, max: def.max, got: got, status: 'ok', detail: detail, rule: R.ref(def.rule).rule, quote: R.ref(def.rule).quote, why: '来源字段按手册阈值计算' };
    }
    function missDim(def, why) {
      R.ref(def.rule);
      return { name: def.name, max: def.max, got: null, status: 'missing', detail: '缺', why: why, rule: R.ref(def.rule).rule, quote: R.ref(def.rule).quote };
    }
    function attach(o, key) { var r = R.ref(key); o.rule = r.rule; o.quote = r.quote; o.ruleKey = key; return o; }
  }

  /* ===========================================================================
   * 5. 四步定位角色（quickref qr-1 速查二 + 任务计算化口径）
   * ======================================================================== */
  function locateRoles(X, mainlines, R) {
    var steps = [];
    // Step1：当日最高标一律用 d.market.ztPool（aggStocks），不再用旧快照 d.stocks 的最高板
    var topStock = (X.aggStocks || []).slice().sort(function (a, b) { return (bOf(b) || 0) - (bOf(a) || 0); })[0] || null;
    var topDir = topStock ? topStock.sector : null;
    var cands = mainlines.filter(function (m) { return m.limitCount >= 3; });
    // 梯队最完整：高/中/低齐全优先，其次 limitCount，其次 score
    function complete(m) { return (m.high ? 1 : 0) + (m.mid ? 1 : 0) + (m.low ? 1 : 0); }
    cands.sort(function (a, b) {
      return (complete(b) - complete(a)) || ((b.limitCount || 0) - (a.limitCount || 0)) || ((b.score || 0) - (a.score || 0));
    });
    var main = cands[0] || null;
    // 若最高板方向本身达标，优先采用（手册：从最高板方向出发）
    if (topDir) {
      var byDir = cands.filter(function (m) { return m.sector === topDir; })[0];
      if (byDir) main = byDir;
    }
    var mainSector = main ? main.sector : (topDir || (mainlines[0] ? mainlines[0].sector : null));
    steps.push({
      n: 'Step 1', t: '定主线板块', result: mainSector || '—',
      detail: '当日最高标 ' + (topStock ? topStock.name + ' ' + (bOf(topStock) || '—') + ' 板（' + topDir + '，' + (X.usePool ? 'd.market.ztPool ' + X.aggDate : '快照 ' + X.snapDate) + '）' : '缺数据')
        + '；候选为涨停≥3家的板块，取梯队最完整（高/中/低齐全）者'
        + (main ? ' → ' + main.sector + '（' + main.level + ' ' + main.score + ' 分、涨停 ' + main.limitCount + ' 家）' : ''),
      rule: '', quote: '', why: '来源字段 d.market.ztPool 的 boards.max → sector（当日汇总）；板块涨停数 sectorCounts / 板块内 boards 分布判梯队。个股明细日期 ' + X.snapDate + ' 与当日汇总日期 ' + X.aggDate + ' 已区分'
    });
    R.attach(steps[0], 'qr_fourstep'); R.ref('ml_six');

    var ss = locateStocks(X, mainSector);
    // Step2：板块内 boards 最大者为龙头
    var dragon = ss.slice().sort(function (a, b) {
      return ((bOf(b) || 0) - (bOf(a) || 0)) || ((V(b.seal) || 0) - (V(a.seal) || 0)) || ((firstMin(a) == null ? 9999 : firstMin(a)) - (firstMin(b) == null ? 9999 : firstMin(b)));
    })[0] || null;
    steps.push({
      n: 'Step 2', t: '板块内最高板 → 龙头', result: dragon ? dragon.name + '（' + (bOf(dragon) || '—') + ' 板）' : '—',
      detail: '主线板块【' + mainSector + '】内 boards 最大者；并列时取封单最大、首封最早',
      rule: '', quote: '', why: '来源字段 boards / seal / firstTime'
    });
    R.attach(steps[1], 'dr_taxonomy');

    // Step3：板块内 2–3 板且流通市值最大者为中军
    var zjPool = ss.filter(function (s) { var b = bOf(s); return b != null && b >= 2 && b <= 3 && !(dragon && s.code === dragon.code); });
    var zhongjun = zjPool.slice().sort(function (a, b) { return (V(b.cap) || 0) - (V(a.cap) || 0); })[0] || null;
    if (!zhongjun) { // 若无 2–3 板，退化为板块内 cap 最大且非龙头者，并标注
      var capPool = ss.filter(function (s) { return !(dragon && s.code === dragon.code) && has(s.cap); });
      zhongjun = capPool.sort(function (a, b) { return (V(b.cap) || 0) - (V(a.cap) || 0); })[0] || null;
    }
    steps.push({
      n: 'Step 3', t: '2–3 板中流通市值最大 → 中军', result: zhongjun ? zhongjun.name + '（cap ' + (has(zhongjun.cap) ? zhongjun.cap.toFixed(1) + ' 亿' : '缺') + '）' : '—',
      detail: zjPool.length ? '板块内 2–3 板共 ' + zjPool.length + ' 只，取 cap 最大' : '板块内无 2–3 板，退化为板块内 cap 最大且非龙头者（口径已放宽，标注）',
      rule: '', quote: '', why: '来源字段 boards(2–3) / cap（流通市值，亿）'
    });
    R.attach(steps[2], 'zj_types');

    // Step4：低位首板/2板、首封时间最早者为前排/补涨；余者判跟风
    var lowPool = ss.filter(function (s) {
      var b = bOf(s); return b != null && b <= 2 && !(dragon && s.code === dragon.code) && !(zhongjun && s.code === zhongjun.code);
    }).sort(function (a, b) {
      return ((firstMin(a) == null ? 9999 : firstMin(a)) - (firstMin(b) == null ? 9999 : firstMin(b))) || ((V(a.seal) || 0) - (V(b.seal) || 0));
    });
    var frontline = lowPool[0] || null;
    var dragonBoards = dragon ? (bOf(dragon) || 0) : 0;
    // 补涨：龙头≥4板前提下的低位正宗首/2板（取首封较早且与龙头同题材）
    var buzhang = (dragonBoards >= 4) ? (lowPool.filter(function (s) { return inSector(s, mainSector); })[0] || frontline) : null;
    // 跟风：命中手册八特征≥4项者（用来源字段可判部分）
    function followerHits(s) {
      var h = [], mins = ss.map(firstMin).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
      var fm = firstMin(s);
      if (fm != null && mins.indexOf(fm) > 2) h.push('上板时间晚(第4名后)');
      if (dragon && V(s.seal) != null && V(dragon.seal) && V(s.seal) < V(dragon.seal) / 5) h.push('封单不足龙头1/5');
      if ((V(s.openTimes) || 0) >= 2) h.push('封单小易开板');
      if ((s.concepts || []).length <= 1) h.push('题材沾边不纯正');
      if ((bOf(s) || 1) <= 2) h.push('无连板能力/低位');
      if (V(s.turnover) != null && (V(s.turnover) < 1 || V(s.turnover) > 40)) h.push('量能异常');
      return h;
    }
    var followers = lowPool.filter(function (s) { return followerHits(s).length >= 4; });
    var follower = followers[0] || null;
    steps.push({
      n: 'Step 4', t: '低位首/2板、首封最早 → 前排/补涨；余者 → 跟风（不参与）',
      result: (frontline ? '前排 ' + frontline.name + '（' + (frontline.firstTime || '—') + '）' : '—')
        + (buzhang ? '；补涨 ' + buzhang.name : '；补涨 —（龙头 ' + dragonBoards + ' 板 <4，前提不成立）'),
      detail: '低位池（boards≤2）' + lowPool.length + ' 只，按 firstTime 升序取最早者为前排；补涨需龙头≥4板且同题材正宗；'
        + '命中跟风八特征≥4项者判跟风（' + followers.length + ' 只，默认不参与）',
      rule: '', quote: '', why: '来源字段 boards / firstTime / seal / openTimes / concepts / turnover；辨识度标签缺数据未计入'
    });
    R.attach(steps[3], 'qr_fourstep'); R.ref('fw_features'); R.ref('bz_criteria'); R.ref('fl_tiers');

    function roleObj(s, key, extra) {
      if (!s) return null;
      var o = { stock: s, code: s.code, name: s.name, boards: bOf(s), cap: V(s.cap), firstTime: s.firstTime || '—', sector: mainSector, rule: '', quote: '', why: '' };
      if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      R.attach(o, key);
      return o;
    }
    var roles = {
      dragon: roleObj(dragon, 'dr_lifecycle', { why: '来源字段：板块内 boards 最大(' + (bOf(dragon) || '—') + '板)、seal=' + (has(dragon && dragon.seal) ? dragon.seal : '缺') + '、firstTime=' + (dragon ? dragon.firstTime || '缺' : '缺') }),
      zhongjun: roleObj(zhongjun, 'zj_signals', { why: '来源字段：boards=' + (zhongjun ? bOf(zhongjun) : '缺') + '、cap=' + (zhongjun && has(zhongjun.cap) ? zhongjun.cap.toFixed(1) + '亿' : '缺') + '（板块内 2–3 板最大市值）' }),
      frontline: roleObj(frontline, 'fl_identity', { why: '来源字段：boards=' + (frontline ? bOf(frontline) : '缺') + '、firstTime=' + (frontline ? frontline.firstTime || '缺' : '缺') + '（低位池首封最早）；辨识度标签缺数据' }),
      follower: roleObj(follower, 'fw_rules', { why: '来源字段判命中跟风八特征：' + (follower ? followerHits(follower).join('、') : '无') + '；默认不参与' }),
      buzhang: roleObj(buzhang, 'bz_criteria', { why: '龙头 ' + dragonBoards + ' 板' + (dragonBoards >= 4 ? '≥4板前提成立' : '<4板，补涨前提不成立') + '；来源字段 boards=' + (buzhang ? bOf(buzhang) : '缺') + '、firstTime=' + (buzhang ? buzhang.firstTime || '缺' : '缺') })
    };
    return { steps: steps, mainSector: mainSector, roles: roles, main: main, topStock: topStock, dragonBoards: dragonBoards };
  }

  /* ===========================================================================
   * 6. 龙头成色 17 项 + 见顶 12 项（dragon dr-3，逐项用来源字段自动判定）
   * ======================================================================== */
  function dragonCheck(X, L, R) {
    var d = L.roles.dragon && L.roles.dragon.stock;
    var items17 = [], items12 = [];
    function it(list, name, hit, why, rule) {
      var o = { name: name, hit: hit, why: why };
      R.attach(o, rule); list.push(o);
    }
    if (!d) {
      return { stock: null, items17: [], items12: [], hit17: 0, judged17: 0, miss17: 17, verdict17: '缺数据（无龙头）', hit12: 0, judged12: 0, miss12: 12, verdict12: '缺数据（无龙头）', rule: '', quote: '', why: '主线板块内无个股，无法体检' };
    }
    var mb = bOf(d) || 0, ss = locateStocks(X, L.mainSector);
    var same = ss.filter(function (s) { return (bOf(s) || 0) === mb; });
    var mins = ss.map(firstMin).filter(function (x) { return x != null; });
    var fm = firstMin(d);
    var sec = L.main;
    var sectorLimit = sec ? sec.limitCount : ss.length;
    // 17 项
    it(items17, '身位最高', mb === (X.maxBoards || mb), 'boards=' + mb + '，全市场最高板=' + (X.maxBoards == null ? '缺' : X.maxBoards), 'dr_17');
    it(items17, '上板最早', fm != null && mins.length ? fm <= Math.min.apply(null, mins) : null, 'firstTime=' + (d.firstTime || '缺') + '，板块内最早=' + (mins.length ? minStr(Math.min.apply(null, mins)) : '缺'), 'dr_17');
    var maxSeal = maxOf(ss.map(function (s) { return V(s.seal); }));
    it(items17, '封单最大', has(d.seal) && maxSeal != null ? V(d.seal) >= maxSeal : null, 'seal=' + (has(d.seal) ? d.seal + '万' : '缺') + '，板块内最大=' + (maxSeal == null ? '缺' : maxSeal + '万'), 'dr_17');
    it(items17, '能带动板块', sectorLimit >= 3, '板块涨停 ' + sectorLimit + ' 家（≥3 家）', 'dr_taxonomy');
    it(items17, '题材纯正', null, '缺数据：快照无题材纯正度标注（concepts=' + (d.concepts || []).join('/') + ' 仅供参考）', 'dr_17');
    it(items17, '3 板以上', mb >= 3, 'boards=' + mb, 'dr_lifecycle');
    it(items17, '换手充分(15–35%)', has(d.turnover) ? (V(d.turnover) >= 15 && V(d.turnover) <= 35) : null, 'turnover=' + (has(d.turnover) ? d.turnover + '%' : '缺'), 'dr_turnover');
    it(items17, '分时强势', null, '缺数据：无分时/均价线数据', 'dr_17');
    it(items17, '逻辑可延展', null, '缺数据：无催化/消息面持续度数据', 'dr_17');
    it(items17, '有中军配合', !!(L.roles.zhongjun && has(L.roles.zhongjun.cap)), '中军=' + (L.roles.zhongjun ? L.roles.zhongjun.name + ' cap ' + (has(L.roles.zhongjun.cap) ? L.roles.zhongjun.cap.toFixed(1) : '缺') : '无'), 'zj_signals');
    it(items17, '有梯队支撑', !!(sec && sec.mid && sec.low), '板块内 2板=' + (sec ? sec.mid : false) + '、首板=' + (sec ? sec.low : false), 'ec_health');
    it(items17, '龙虎榜健康', null, '缺数据：lhb 仅有净额/机构字段，无席位明细（知名游资/拉萨/一家独大）', 'dr_17');
    it(items17, '流通盘适中(30–150亿)', has(d.cap) ? (V(d.cap) >= 30 && V(d.cap) <= 150) : null, 'cap=' + (has(d.cap) ? d.cap + '亿' : '缺'), 'dr_17');
    it(items17, '有辨识度', null, '缺数据：无辨识度标签/人气数据（可用最高板、首封早、封单大间接代理，但不猜测）', 'fl_identity');
    it(items17, '经历过分歧', (V(d.openTimes) || 0) > 0 ? true : null, 'openTimes=' + (V(d.openTimes) == null ? '缺' : d.openTimes) + '（仅能证「曾开板」，是否成功转一致缺历史）', 'dr_17');
    it(items17, '非庄股特征', null, '缺数据：无分时形态/对倒判定数据', 'dr_17');
    it(items17, '市场热议', null, '缺数据：无人气/论坛热度数据（d.hot 为空）', 'dr_17');
    // 12 项见顶信号
    it(items12, '①天量烂板', has(d.volumeRatio) ? (V(d.volumeRatio) >= 3 && (V(d.openTimes) || 0) >= 2) : null, '量比=' + (has(d.volumeRatio) ? d.volumeRatio : '缺') + '（代理5日均量倍数）、openTimes=' + (V(d.openTimes) == null ? '缺' : d.openTimes) + '；5日均量基准缺，标注代理', 'dr_top12');
    it(items12, '②高位爆量不封', mb >= 5 ? ((V(d.openTimes) || 0) > 0) : null, 'boards=' + mb + '、openTimes=' + (V(d.openTimes) == null ? '缺' : d.openTimes) + '；收长上影缺分时数据', 'dr_top12');
    it(items12, '③缩量加速后突然放量', null, '缺数据：需连续多日量能序列', 'dr_top12');
    it(items12, '④首次跌破5日线', null, '缺数据：无 K 线/均线数据', 'dr_top12');
    it(items12, '⑤拉萨军团接盘/主力净卖出', has(d.netIn) ? V(d.netIn) < 0 : null, 'netIn=' + (has(d.netIn) ? d.netIn + '亿' : '缺') + '（仅资金代理，席位明细缺）', 'dr_top12');
    it(items12, '⑥补涨股不再跟进', null, '缺数据：需历史补涨序列', 'dr_top12');
    it(items12, '⑦同身位出现卡位者', same.length > 1, '同板块 ' + mb + ' 板共 ' + same.length + ' 只', 'ec_pos');
    it(items12, '⑧中位股批量跌停', null, '缺数据：跌停家数/中位股跌停未提供', 'ms_risk');
    it(items12, '⑨中军大阴破位', null, '缺数据：无 K 线/中军破位数据', 'zj_signals');
    var lateSeal = fm != null && fm >= 14 * 60 + 30 && has(d.seal) && V(d.seal) < 1000;
    it(items12, '⑩尾盘勉强封板封单极小', lateSeal, 'firstTime=' + (d.firstTime || '缺') + '、seal=' + (has(d.seal) ? d.seal + '万' : '缺') + '（1万手阈值需单位换算，标注代理）', 'dr_top12');
    it(items12, '⑪出现天地板', null, '缺数据：涨停股 changePct 均为正，无振幅/最低价数据', 'dr_top12');
    it(items12, '⑫竞价高开后直线下杀', null, '缺数据：无竞价/分时数据', 'dr_top12');
    function tally(list) {
      var hit = list.filter(function (x) { return x.hit === true; }).length;
      var judged = list.filter(function (x) { return x.hit !== null; }).length;
      return { hit: hit, judged: judged, miss: list.length - judged };
    }
    var t17 = tally(items17), t12 = tally(items12);
    var v17 = t17.hit >= 12 ? '真龙' : t17.hit >= 8 ? '强候选' : t17.hit > 0 || t17.judged > 0 ? '存疑（不宜重仓）' : '缺数据';
    var v12 = t12.hit >= 5 ? '见五 → 清仓' : t12.hit >= 3 ? '见三 → 减仓' : '未达见顶阈值（可持有观察）';
    var o = {
      stock: d, items17: items17, items12: items12,
      hit17: t17.hit, judged17: t17.judged, miss17: t17.miss, verdict17: v17,
      hit12: t12.hit, judged12: t12.judged, miss12: t12.miss, verdict12: v12,
      rule: '', quote: '',
      why: '17 项命中 ' + t17.hit + '/已判 ' + t17.judged + '/缺 ' + t17.miss + '（缺数据项不计命中，保守口径）；'
        + '见顶 12 项命中 ' + t12.hit + '/已判 ' + t12.judged + '/缺 ' + t12.miss + '。全部用个股来源字段判定，缺失项明确标注。'
    };
    R.attach(o, 'dr_17'); R.ref('dr_top12');
    return o;
  }

  /* ===========================================================================
   * 7. 补涨五标准 + 天花板法则（任务五标准 + 手册 bz-2 八项 check）
   * ======================================================================== */
  function buzhangCheck(X, L, C, R) {
    var main = L.main, mb = L.dragonBoards;
    var bz = L.roles.buzhang && L.roles.buzhang.stock;
    var five = [], eight = [];
    function it(list, name, hit, why, rule) { var o = { name: name, hit: hit, why: why }; R.attach(o, rule); list.push(o); }
    var mainOk = !!(main && main.score != null && main.score >= 70);
    it(five, '周期位置：主线确立（≥70 分）', mainOk, '主线板块 ' + (main ? main.sector : '—') + ' 得分 ' + (main ? main.score : '缺') + '（≥70 才叫主线）', 'ml_score');
    it(five, '主线至少 3 板高标', mb >= 3, '龙头 ' + (L.roles.dragon ? L.roles.dragon.name : '—') + ' ' + mb + ' 板', 'sc_10dim');
    it(five, '板块 ≥10 家涨停', main ? main.limitCount >= 10 : null, '板块涨停 ' + (main ? main.limitCount : '缺') + ' 家（主线标准≥10）', 'sc_10dim');
    var safeKnown = !!(X.dtCount != null && X.damian != null && C);
    var safeHit = safeKnown ? (!C.riskOff && X.dtCount < 10 && X.damian <= 3) : null;
    it(five, '大盘安全（非退潮/崩塌/冰点，跌停<10、大面股≤3）', safeHit,
      'd.market.dtCount=' + (X.dtCount == null ? '缺' : X.dtCount) + '、damian=' + (X.damian == null ? '缺' : X.damian)
        + '、周期 ' + (C ? C.stage : '缺') + rateLabel('market') + (safeKnown ? '' : '；缺数据，未计入结论'), 'qr_veto');
    it(five, '补涨标的有辨识度', bz && firstMin(bz) != null ? firstMin(bz) <= 10 * 60 + 30 : null,
      (bz ? bz.name + ' firstTime=' + (bz.firstTime || '缺') : '无补涨标的') + '（用早盘上板代理辨识度，标签缺数据）', 'fl_identity');
    // 手册 8 项 check
    it(eight, '位置低（首板/2板，绝不能高位）', bz ? (bOf(bz) || 0) <= 2 : null, 'boards=' + (bz ? bOf(bz) : '缺'), 'bz_criteria');
    it(eight, '同属性（与龙头/主线关联）', bz ? inSector(bz, L.mainSector) : null, 'concepts=' + (bz ? (bz.concepts || []).join('/') : '缺'), 'bz_criteria');
    it(eight, '龙头已在高位（≥4板）', mb >= 4, '龙头 ' + mb + ' 板', 'bz_essence');
    it(eight, '逻辑清晰（正宗标的）', null, '缺数据：无题材纯正/逻辑标注', 'bz_criteria');
    it(eight, '上板时间早（早盘）', bz && firstMin(bz) != null ? firstMin(bz) <= 10 * 60 + 30 : null, 'firstTime=' + (bz ? bz.firstTime || '缺' : '缺'), 'bz_criteria');
    it(eight, '封单较强（相对流通盘）', bz && has(bz.seal) && has(bz.cap) ? (V(bz.seal) / Math.max(V(bz.cap), 1)) >= 50 : null, 'seal=' + (bz && has(bz.seal) ? bz.seal + '万' : '缺') + ' / cap=' + (bz && has(bz.cap) ? bz.cap + '亿' : '缺'), 'bz_criteria');
    it(eight, '有量能配合（≥1.5倍）', bz && has(bz.volumeRatio) ? V(bz.volumeRatio) >= 1.5 : null, '量比=' + (bz && has(bz.volumeRatio) ? bz.volumeRatio : '缺') + '（代理）', 'bz_criteria');
    it(eight, '板块仍强势（龙头仍涨停/高位强势）', !!(L.roles.dragon), '龙头 ' + (L.roles.dragon ? L.roles.dragon.name + ' 今日涨停' : '无') + '（当日截面）', 'bz_criteria');
    var ceiling = mb >= 2 ? mb - 2 : null;
    var o = {
      five: five, eight: eight, dragonBoards: mb, ceiling: ceiling,
      passed5: five.filter(function (x) { return x.hit === true; }).length,
      missing5: five.filter(function (x) { return x.hit === null; }).length,
      why: '五标准命中 ' + five.filter(function (x) { return x.hit === true; }).length + '/5（缺 ' + five.filter(function (x) { return x.hit === null; }).length + ' 项未判）；'
        + '天花板 = 龙头 ' + mb + ' 板 − 2 = ' + (ceiling == null ? '—（龙头<2板，无补涨空间）' : ceiling + ' 板') + '（手册 −2~3 板取严口径 −2）。',
      rule: '', quote: ''
    };
    R.attach(o, 'bz_ceiling'); R.ref('bz_criteria'); R.ref('bz_wave');
    return o;
  }

  /* ===========================================================================
   * 8. 拐点八大信号 + 逃顶信号 + 拐点唯一结论（turning tp-1 / tp-3）
   * ======================================================================== */
  function turningCheck(X, L, C, DC, R) {
    var mb = X.maxBoards, zb = X.zbRate, lu = X.limitUp, lb = X.lianban;
    var zl = rateLabel(X.zbRateKind);
    var dt = X.dtCount, prem = X.prem, promo = X.promoRate, dm = X.damian, vc = X.volChange;
    var mkL = function (v) { return rateLabel(v == null ? null : 'market'); };
    // 手册八大拐点：逐个用来源字段判预警信号命中；d.market 有实测值则自动判定，缺才标「缺数据，未计入结论」
    var defs = [
      { id: '①出清', from: '崩塌', to: '冰点', key: 'tp_map', sig: [
        ['跌停家数较高峰减少50%以上', null, '缺跌停家数历史（当日 d.market.dtCount=' + (dt == null ? '缺' : dt) + ' 家，仅展示不判定）'],
        ['涨停家数连续2日不再创新低', null, '缺历史序列'],
        ['成交额地量/缩量35%+', vc != null ? vc <= -35 : null, 'd.market.volChange=' + (vc == null ? '缺' : vc + '%') + mkL(vc) + '（当日两市成交额较5日均量变化，代理）']
      ] },
      { id: '②试错', from: '冰点', to: '修复', key: 'tp_map', sig: [
        ['最高板回到3板并封住', mb != null ? mb === 3 : null, 'maxBoards=' + (mb == null ? '缺' : mb) + '（' + (X.usePool ? 'd.market.ztPool 当日' : '快照') + '）'],
        ['出现反核/地天板', null, '缺分时/撬板数据'],
        ['某方向≥3家涨停的板块效应', X.sectors.some(function (s) { return (s.limitCount || 0) >= 3; }), 'sectorCounts 中存在 limitCount≥3 的板块']
      ] },
      { id: '③启动', from: '修复', to: '启动', key: 'tp_map', sig: [
        ['昨日涨停溢价首次转正', prem != null ? prem > 0 : null, 'd.market.prem=' + (prem == null ? '缺' : prem + '%') + mkL(prem) + '（「首次」需历史，按转正方向代理）'],
        ['某方向连续2日涨停≥5家', null, '缺历史序列'],
        ['炸板率降至30%以下、封板率70%+', zb != null ? zb < 30 : null, '炸板率=' + (zb == null ? '缺' : zb.toFixed(1) + '%') + zl],
        ['连板晋级率(首→2板)>25%', promo != null ? promo > 25 : null, 'd.market.promoRate=' + (promo == null ? '缺' : promo + '%') + mkL(promo) + '（上一交易日连板股今日晋级比例，口径代理）']
      ] },
      { id: '④确认', from: '启动', to: '确认', key: 'tp_map', sig: [
        ['分歧转一致(爆量烂板次日高开上板)', null, '缺次日验证/历史'],
        ['梯队成形(1家3板+2-3家2板+5家首板)', (X.exact.some(function (e) { return e.b >= 3; }) && X.exact.some(function (e) { return e.b === 2; }) && X.exact.some(function (e) { return e.b === 1; })), 'exact_boards（' + (X.usePool ? 'ztPool 当日' : '快照') + '）=' + X.exact.map(function (e) { return e.b + '板×' + e.n; }).join('/')],
        ['分歧当日无中位股批量跌停', null, '缺中位股跌停明细（当日全市场 dtCount=' + (dt == null ? '缺' : dt) + ' 家，仅展示不判定）']
      ] },
      { id: '⑤加速', from: '确认', to: '高潮', key: 'tp_map', sig: [
        ['龙头缩量一字/加速板', (L.roles.dragon && V(L.roles.dragon.stock.limitType) === 1) ? true : null, '龙头 limitType=' + (L.roles.dragon ? (L.roles.dragon.stock.limitType == null ? '缺' : L.roles.dragon.stock.limitType) + '(1=一字/秒板)' : '缺')],
        ['补涨潮全面爆发', null, '缺补涨序列/历史'],
        ['涨停家数突破85–100家', lu != null ? lu >= 85 : null, 'd.market.ztCount=' + (lu == null ? '缺' : lu)]
      ] },
      { id: '⑥见顶', from: '高潮', to: '分歧', key: 'tp_down', sig: [
        ['龙头天量烂板', (L.roles.dragon && has(L.roles.dragon.stock.volumeRatio)) ? (V(L.roles.dragon.stock.volumeRatio) >= 2.5 && (V(L.roles.dragon.stock.openTimes) || 0) >= 2) : null, '量比(代理)=' + (L.roles.dragon && has(L.roles.dragon.stock.volumeRatio) ? L.roles.dragon.stock.volumeRatio : '缺') + '、openTimes=' + (L.roles.dragon ? (V(L.roles.dragon.stock.openTimes) == null ? '缺' : L.roles.dragon.stock.openTimes) : '缺')],
        ['炸板率跳升10个百分点至30%+', zb != null ? zb >= 30 : null, '炸板率=' + (zb == null ? '缺' : zb.toFixed(1) + '%') + zl + '（缺前日对比，仅绝对值判定）'],
        ['中位股批量跌停', null, '缺中位股跌停明细（当日 dtCount=' + (dt == null ? '缺' : dt) + ' 家，仅展示不判定）'],
        ['出现天地板', null, '缺振幅/分时数据']
      ] },
      { id: '⑦退潮', from: '分歧', to: '退潮', key: 'tp_down', sig: [
        ['龙头断板', null, '缺昨日连板/今日断板对比数据'],
        ['连板高度塌陷(N→N-2以上)', null, '缺前日最高板历史'],
        ['大面股≥5家', dm != null ? dm >= 5 : null, 'd.market.damian=' + (dm == null ? '缺' : dm + ' 家') + mkL(dm)],
        ['昨日涨停溢价转负', prem != null ? prem < 0 : null, 'd.market.prem=' + (prem == null ? '缺' : prem + '%') + mkL(prem)]
      ] },
      { id: '⑧崩塌', from: '退潮', to: '崩塌', key: 'tp_down', sig: [
        ['跌停家数快速升至20家以上并增加', dt != null ? dt >= 20 : null, 'd.market.dtCount=' + (dt == null ? '缺' : dt + ' 家') + mkL(dt) + '（缺前日对比，按绝对值代理）'],
        ['高标连续A字杀', null, '缺连续跌停序列'],
        ['炸板率>45%', zb != null ? zb > 45 : null, '炸板率=' + (zb == null ? '缺' : zb.toFixed(1) + '%') + zl]
      ] }
    ];
    var turning = defs.map(function (d) {
      var signals = d.sig.map(function (s) {
        var o = { name: s[0], hit: s[1], why: s[2] };
        R.attach(o, d.key); return o;
      });
      var hitN = signals.filter(function (s) { return s.hit === true; }).length;
      var judged = signals.filter(function (s) { return s.hit !== null; }).length;
      var o = { id: d.id, from: d.from, to: d.to, signals: signals, hitN: hitN, judged: judged, miss: signals.length - judged, rule: '', quote: '' };
      var rr = R.ref(d.key); o.rule = rr.rule; o.quote = rr.quote; o.ruleKey = d.key;
      o.why = '命中 ' + hitN + '/' + judged + ' 已判信号，缺 ' + o.miss + ' 项（缺数据未纳入）';
      return o;
    });
    // 唯一结论：命中≥3 为强信号；强制校验「起点 from」与当前周期阶段一致，不一致剔除；取命中最多者
    var stageSimple = String(C.stage).replace(/^[①-⑧]/, '').replace('期', '');
    var cands = turning.filter(function (t) { return t.hitN >= 2; }).map(function (t) {
      var consistent = stageSimple && (t.from.indexOf(stageSimple) >= 0 || stageSimple.indexOf(t.from) >= 0);
      return { id: t.id, hitN: t.hitN, from: t.from, to: t.to, consistent: consistent };
    });
    var valid = cands.filter(function (c) { return c.consistent; });
    var pick = (valid.length ? valid : cands).sort(function (a, b) { return b.hitN - a.hitN; })[0] || null;
    var concl = {
      verdict: pick ? ('拐点唯一结论：' + pick.id + '（' + pick.from + '→' + pick.to + '）' + (pick.hitN >= 3 ? '，强信号' : '，弱信号待确认')) : '拐点唯一结论：八大拐点均未达命中≥2 的确认门槛 → 当前无拐点，周期延续',
      pick: pick, candidates: cands,
      why: '按参考站口径：命中≥3 为强信号，且强制校验「起点→终点」与当前阶段【' + C.stage + '】一致，不一致者剔除，只保留唯一结论；缺数据信号不计命中。',
      rule: '', quote: ''
    };
    R.attach(concl, 'tp_escape'); R.ref('tp_map');
    // 逃顶八信号（任务列的可计算逃顶清单；d.market 有实测值则自动判定，缺才标缺）
    var esc = [
      ['高标断板', null, '缺昨日连板/断板对比', 'tp_down'],
      ['中位批量跌停', null, '缺中位股跌停明细（当日 dtCount=' + (dt == null ? '缺' : dt) + ' 家，仅展示不判定）', 'ms_risk'],
      ['龙头爆量不封', (L.roles.dragon && has(L.roles.dragon.stock.volumeRatio)) ? (V(L.roles.dragon.stock.volumeRatio) >= 3 && (V(L.roles.dragon.stock.openTimes) || 0) > 0) : null, '量比(代理)+openTimes=' + (L.roles.dragon ? (L.roles.dragon.stock.volumeRatio == null ? '缺' : L.roles.dragon.stock.volumeRatio) : '缺'), 'dr_top12'],
      ['炸板率飙升', zb != null ? zb >= 35 : null, '炸板率=' + (zb == null ? '缺' : zb.toFixed(1) + '%') + zl + '（缺前日对比）', 'qr_threshold'],
      ['跌停家数增加', null, '当日 d.market.dtCount=' + (dt == null ? '缺' : dt + ' 家') + '，缺前日对比，未计入结论', 'tp_down'],
      ['主线切换', null, '需历史基线（见切换判定）', 'sw_checklist'],
      ['量能萎缩', vc != null ? vc < 0 : null, 'd.market.volChange=' + (vc == null ? '缺' : vc + '%') + mkL(vc) + '（当日两市成交额较5日均量变化）', 'dr_turnover'],
      ['龙头见顶信号≥3', DC && DC.hit12 != null ? DC.hit12 >= 3 : null, '龙头体检 12 项已判命中 ' + (DC ? DC.hit12 : '缺') + ' 项（见 v_turn 龙头体检）', 'dr_top12']
    ].map(function (s) { var o = { name: s[0], hit: s[1], why: s[2] }; R.attach(o, s[3]); return o; });
    return { turning: turning, conclusion: concl, escape: esc };
  }

  /* ===========================================================================
   * 9. 主线切换门槛（任务：≥2核心且无否决 或 ≥3信号含≥1核心 → 成立）
   *    手册 switch sw-2：旧死亡7条 / 新成立7条 / 三选二，逐条列明细
   * ======================================================================== */
  function switchCheck(X, L, mainlines, C, R) {
    var top = mainlines[0] || null;
    var mainSector = L.mainSector;
    var others = mainlines.filter(function (m) { return m.sector !== mainSector; });
    var newCand = others[0] || null;
    var conds = [];
    function cd(name, core, hit, why, rule) { var o = { name: name, core: core, hit: hit, why: why }; R.attach(o, rule); conds.push(o); }
    // 核心信号（可判部分）
    cd('旧主线龙头断板/高标塌陷（最硬）', true, null, '缺前日连板/断板对比数据（当日仅见最高板 ' + (X.maxBoards == null ? '缺' : X.maxBoards) + ' 板）', 'sw_checklist');
    cd('新方向出现≥3板高标且涨停≥5家', true, newCand ? (newCand.maxBoards >= 3 && newCand.limitCount >= 5) : null, '候选新方向 ' + (newCand ? newCand.sector + '：maxBoards=' + (newCand.maxBoards == null ? '缺' : newCand.maxBoards) + '、涨停 ' + newCand.limitCount + ' 家' : '无'), 'sw_checklist');
    cd('新方向涨停家数 > 旧主线', true, (top && newCand) ? newCand.limitCount > top.limitCount : null, '旧 ' + (top ? top.limitCount : '缺') + ' 家 vs 新 ' + (newCand ? newCand.limitCount : '缺') + ' 家（当日截面）', 'sw_final');
    cd('资金从旧主线流入新方向', true, null, '缺历史资金流基线（当日 netIn 仅为截面）', 'sw_ops');
    cd('旧主线涨停从峰值回落>50%', true, null, '缺历史峰值数据', 'ml_retreat');
    // 一般信号（d.market 有实测值则自动判定）
    cd('旧主线昨日涨停溢价转负（sw-2 死亡信号⑦）', false, X.prem != null ? X.prem < 0 : null,
      'd.market.prem=' + (X.prem == null ? '缺' : X.prem + '%') + rateLabel(X.prem == null ? null : 'market') + '（连续2日为负需历史，按单日方向代理）', 'sw_checklist');
    cd('新方向有梯队(2板+首板)', false, newCand ? (newCand.mid && newCand.low) : null, '候选新方向 2板=' + (newCand ? newCand.mid : false) + '、首板=' + (newCand ? newCand.low : false), 'sw_checklist');
    cd('新方向有中军放量启动', false, null, '缺中军/K线数据', 'sw_checklist');
    cd('旧主线中军大阴破位', false, null, '缺 K 线数据', 'ml_retreat');
    cd('旧主线补涨股不再涨停', false, null, '缺补涨历史序列', 'ml_retreat');
    // 否决项
    var vetoes = [];
    function vt(name, hit, why, rule) { var o = { name: name, hit: hit, why: why }; R.attach(o, rule); vetoes.push(o); }
    vt('旧主线龙头今日仍封板/最高板仍属旧主线', !!(L.roles.dragon), '龙头 ' + (L.roles.dragon ? L.roles.dragon.name : '无') + ' 今日涨停 → 旧主线未确认死亡', 'ov_core');
    vt('周期处于启动/确认/高潮（非退潮不谈切换）', !(C.riskOff), '当前阶段 ' + C.stage + (C.riskOff ? '（退潮/崩塌/冰点，允许谈切换）' : '（非退潮，按手册不轻易切换）'), 'sw_modes');
    vt('新方向涨停<3家（疑似一日游）', newCand ? newCand.limitCount < 3 : null, '候选新方向涨停 ' + (newCand ? newCand.limitCount : '缺') + ' 家', 'sc_oneday');
    var coreHit = conds.filter(function (c) { return c.core && c.hit === true; }).length;
    var coreMiss = conds.filter(function (c) { return c.core && c.hit === null; }).length;
    var totalHit = conds.filter(function (c) { return c.hit === true; }).length;
    var vetoOn = vetoes.filter(function (v) { return v.hit === true; }).length;
    var switchOn = ((coreHit >= 2 && vetoOn === 0) || (totalHit >= 3 && coreHit >= 1)) && vetoOn === 0;
    var o = {
      switchOn: switchOn, conditions: conds, vetoes: vetoes, coreHit: coreHit, coreMiss: coreMiss, totalHit: totalHit, vetoOn: vetoOn,
      oldSector: mainSector, newSector: newCand ? newCand.sector : '—',
      verdict: switchOn ? '切换成立（≥2核心且无否决 或 ≥3信号含≥1核心）' : '主线延续（核心信号不足或存在否决：手册「旧主线死亡≥3条且新主线成立全部满足」才提示切换，避免每天制造伪切换）',
      why: '核心命中 ' + coreHit + '（缺 ' + coreMiss + ' 项未判）/ 信号命中 ' + totalHit + ' / 否决 ' + vetoOn + '。'
        + '旧主线=' + mainSector + '，候选新方向=' + (newCand ? newCand.sector : '无') + '。缺历史基线的条件按「缺」标注，不猜测补值。',
      rule: '', quote: ''
    };
    R.attach(o, 'sw_checklist'); R.ref('sw_final'); R.ref('sw_modes');
    return o;
  }

  /* ===========================================================================
   * 10. 优中选优：硬性排除 → rank 排序 → 主线+支线 Top5
   * ======================================================================== */
  var ENTRY = {
    dragon: { name: '龙头首次分歧低吸', rule: 'op_dragon', detail: '3板成龙点打板 / 4板以上分歧转一致（爆量烂板次日高开+2%快速上板）低吸；≥6板缩量加速为禁买区只持有不新开' },
    zhongjun: { name: '中军5日线低吸', rule: 'op_zhongjun', detail: '缩量回踩5/10日线企稳低吸，不追高不打板；破10日线离场' },
    frontline: { name: '前排打板确认', rule: 'op_frontline', detail: '只做板块内早盘最先上板、封单最大的前二，打板确认，不连板即走' },
    buzhang: { name: '补涨只低吸不追高', rule: 'op_buzhang', detail: '只做正宗补涨不做玄学补涨，只低吸不追高；龙头断板/达天花板即走' },
    follower: { name: '跟风不参与', rule: 'fw_rules', detail: '默认不买；仅极亢奋期极小仓≤5%首板套利，不连板必走' }
  };
  var STOPLINE = {
    dragon: '龙头 −8% 或破5日线',
    zhongjun: '中军 −5%',
    frontline: '前排 −3% 或次日不板走',
    buzhang: '补涨 −5% 或破分时均线',
    follower: '不参与'
  };
  var STOPRULE = {
    dragon: '断板次日不反包 或 破5日线 或 亏损达 −8%',
    zhongjun: '破10日线 或 亏损达 −7%',
    frontline: '不连板 或 亏损达 −6%',
    buzhang: '不连板 或 龙头见顶 或 亏损达 −5%',
    follower: '不连板必走 或 亏损达 −4%'
  };
  var ROLE_CN = { dragon: '龙头', zhongjun: '中军', frontline: '前排', buzhang: '补涨', follower: '跟风' };
  var ROLE_W = { dragon: 30, zhongjun: 12, frontline: 12, buzhang: 18, follower: 0 };

  function hardExclude(X, L, C, R) {
    var ex = [];
    X.stocks.forEach(function (s) {
      var reasons = [];
      function add(name, rule, why) { var o = { name: name, why: why }; R.attach(o, rule); reasons.push(o); }
      var b = bOf(s), ot = V(s.openTimes), lt = V(s.limitType), to = V(s.turnover), sl = V(s.seal), cp = V(s.cap);
      var secMatch = null;
      // 无板块联动（找不到该股所属板块且涨停<3家）
      var inSec = X.sectors.filter(function (x) { return inSector(s, x.sector); })[0];
      var secCount = inSec ? inSec.limitCount : 0;
      if (b != null && b >= 5) add('高位≥5板不追', 'qr_three', 'boards=' + b + '（≥5板，手册：6板可持有不再加仓、≥7板不新开，任务取严≥5板排除）');
      if (ot != null && ot >= 3) add('开板≥3（弱封）', 'sc_oneday', 'openTimes=' + ot + '（手册：开板3次以上=接力资金不足）');
      if (sl != null && cp != null && cp > 0 && sl / cp < 10) add('弱封（封单相对流通盘过小）', 'dr_taxonomy', 'seal=' + sl + '万 / cap=' + cp + '亿 = ' + (sl / cp).toFixed(1) + ' <10（封板质量差）');
      if (lt === 1 && (ot == null || ot === 0) && (to == null || to < 3)) add('一字板买不到', 'dr_taxonomy', 'limitType=1（一字/秒板）、openTimes=' + (ot == null ? '缺' : ot) + '、turnover=' + (to == null ? '缺' : to + '%') + '；一字龙基本无买点，开板即风险');
      if (secCount < 3) add('无板块联动（板块涨停<3家）', 'dr_taxonomy', '所属板块涨停 ' + secCount + ' 家（<3，无板块效应=孤板/独龙）');
      if (C.riskOff) add('退潮/崩塌/冰点期不开新仓', 'qr_veto', '当前阶段 ' + C.stage + '，手册否决点一：停止不进入后续步骤');
      // 跟风判定（命中≥4项）
      var fh = [];
      var mins = sectorStocks(X, s.sector).map(firstMin).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
      var fm = firstMin(s);
      if (fm != null && mins.indexOf(fm) > 2) fh.push('上板晚');
      if (ot != null && ot >= 2) fh.push('易开板');
      if ((s.concepts || []).length <= 1) fh.push('题材沾边');
      if (b != null && b <= 2) fh.push('无连板能力');
      if (to != null && (to < 1 || to > 40)) fh.push('量能异常');
      var dragonSeal = L.roles.dragon && V(L.roles.dragon.stock.seal);
      if (sl != null && dragonSeal && sl < dragonSeal / 5) fh.push('封单不足龙头1/5');
      if (fh.length >= 4) add('跟风股不参与（命中八特征≥4项）', 'fw_features', fh.join('、') + '（命中 ' + fh.length + ' 项）');
      if (reasons.length) {
        var o = { stock: s, code: s.code, name: s.name, boards: b, reasons: reasons, rule: '', quote: '', why: reasons.map(function (r) { return r.name; }).join('；') };
        R.attach(o, 'qr_veto'); ex.push(o);
      }
    });
    return ex;
  }
  function buildPicks(X, L, mainlines, C, exclusions, R) {
    var exCodes = {}; exclusions.forEach(function (e) { exCodes[e.code] = 1; });
    var cand = [];
    // 四步定位已产出的角色优先（每只票唯一角色，避免「全首板板块里人人都是龙头」的误判）
    var roleByCode = {};
    ['dragon', 'zhongjun', 'frontline', 'buzhang', 'follower'].forEach(function (k) {
      if (L.roles[k] && L.roles[k].stock) roleByCode[L.roles[k].stock.code] = k;
    });
    // 候选池 = 主线+支线（评分≥30）板块内所有通过硬性排除的个股；再按手册排序精神打 rank
    mainlines.filter(function (m) { return m.score != null && m.score >= 30; }).forEach(function (m) {
      // 优先个股筛选池（快照全因子），命名/日期差异导致无匹配时回退当日汇总池
      var raw = sectorStocks(X, m.sector);
      if (!raw.length) raw = locateStocks(X, m.sector);
      var ss = raw.filter(function (s) { return !exCodes[s.code]; });
      if (!ss.length) return;
      var capSorted = ss.slice().sort(function (a, b) { return (V(b.cap) || 0) - (V(a.cap) || 0); });
      var capMaxCode = capSorted[0] ? capSorted[0].code : null;
      var maxB = maxOf(ss.map(bOf));
      ss.forEach(function (s) {
        var role;
        if (roleByCode[s.code]) role = roleByCode[s.code];
        else if (s.code === capMaxCode && (bOf(s) || 1) <= 3) role = 'zhongjun'; // 板块内 cap 最大（趋势形态缺数据，代理口径）
        else if (maxB != null && maxB >= 4 && (bOf(s) || 1) <= 2) role = 'buzhang';
        else role = 'frontline';
        if (role === 'follower') return; // 手册：跟风股默认不参与
        push(role, s, m);
      });
    });
    function push(role, s, m) {
      if (!s || exCodes[s.code]) return;
      if (!m || m.score == null || m.score < 30) return;
      cand.push({ role: role, stock: s, sec: m });
    }
    // 去重（同 code 保留 rank 潜力最高角色）
    var seen = {};
    cand = cand.filter(function (c) { if (seen[c.stock.code]) return false; seen[c.stock.code] = 1; return true; });
    // rank 打分（手册排序精神 + 参考站 rank：板块分×0.35 + 角色权重 + 确定性 + 资金 + 封板质量 + 早盘 − 高位惩罚）
    cand.forEach(function (c) {
      var s = c.stock;
      var rank = (c.sec.score || 0) * 0.35 + ROLE_W[c.role];
      var hits = [], violations = [];
      // 命中/触犯手册条款
      var b = bOf(s), fm = firstMin(s), sl = V(s.seal), cp = V(s.cap), net = V(s.netIn), vr = V(s.volumeRatio), ot = V(s.openTimes), to = V(s.turnover);
      if (c.role === 'dragon') { hits.push('dr-2 3板定理：板块内最高板 ' + (b == null ? '缺' : b) + ' 板'); rank += b != null ? Math.min(10, b * 2) : 0; }
      if (fm != null) { if (fm <= 10 * 60 + 30) { hits.push('bz-2/ec-2 早盘上板(卡位成功标志之一)'); rank += 6; } else { violations.push('sc-2 午后/尾盘板（临时起意，减分）'); rank -= 4; } }
      if (net != null) { if (net > 0) { hits.push('rk-1 主力净流入 ' + net.toFixed(2) + ' 亿（资金认可）'); rank += 5; } else { violations.push('资金净流出 ' + net.toFixed(2) + ' 亿'); rank -= 5; } }
      if (sl != null && cp != null && cp > 0) { if (sl / cp >= 50) { hits.push('bz-2 封单相对流通盘较强'); rank += 4; } else rank -= 2; }
      if (vr != null) { if (vr >= 1.5) { hits.push('dr-4 量能配合（量比 ' + vr.toFixed(2) + '）'); rank += 3; } }
      if (to != null && to >= 15 && to <= 35) { hits.push('dr-3 换手充分 15–35%'); rank += 3; }
      if (b != null && b >= 5) { violations.push('qr-1 高位≥5板（只减不加）'); rank -= 15; }
      if (ot != null && ot >= 2) { violations.push('dr-1 反复开板（封板质量差）'); rank -= 4; }
      var ent = ENTRY[c.role];
      var o = {
        rank: Math.round(rank), role: c.role, roleCn: ROLE_CN[c.role], stock: s,
        code: s.code, name: s.name, boards: b, sector: c.sec.sector, sectorScore: c.sec.score,
        hits: hits, violations: violations,
        entry: ent.name, entryDetail: ent.detail,
        stageTotal: C.total, singleCap: '单票≤40%（position 铁律二）；' + c.role + ' 矩阵上限见仓位矩阵',
        stopRule: STOPRULE[c.role], stopLine: STOPLINE[c.role],
        stockDate: X.snapDate, aggDate: X.aggDate, dateMixed: X.dateMixed,
        why: '个股数据日期 ' + X.snapDate + '（d.stocks 快照）；来源字段：boards=' + (b == null ? '缺' : b) + '、firstTime=' + (s.firstTime || '缺') + '、seal=' + (sl == null ? '缺' : sl + '万')
          + '、cap=' + (cp == null ? '缺' : cp + '亿') + '、netIn=' + (net == null ? '缺' : net + '亿') + '、量比=' + (vr == null ? '缺' : vr)
          + '、换手=' + (to == null ? '缺' : to + '%') + '、openTimes=' + (ot == null ? '缺' : ot) + '；板块分 ' + c.sec.score + '（' + c.sec.level + '，当日汇总 ' + X.aggDate + '）',
        rule: '', quote: ''
      };
      R.attach(o, ent.rule); R.ref('ps_matrix'); R.ref('ps_stop'); R.ref('qr_decision');
      c.pick = o;
    });
    var picks = cand.map(function (c) { return c.pick; }).sort(function (a, b) { return b.rank - a.rank; }).slice(0, 5);
    picks.forEach(function (p, i) { p.top = i + 1; });
    return picks;
  }

  /* ===========================================================================
   * 11. 复盘报告结构化（quickref qr-2 / risk rk-2 的 8 段）
   * ======================================================================== */
  function buildReport(X, L, mainlines, C, DC, BZ, TC, SW, picks, R) {
    var secs = [];
    function add(key, title, body, rule) { var o = { key: key, title: title, body: body }; R.attach(o, rule); secs.push(o); }
    var main = mainlines[0];
    add('overview', '一、数据概览',
      '当日汇总行情 ' + X.aggDate + '（d.market ' + (X.marketDate || '缺') + '，来源 ' + X.source + '）；'
      + '涨停 ' + X.limitUp + ' 家、最高板 ' + (X.maxBoards == null ? '缺数据' : X.maxBoards + ' 板')
      + '、连板 ' + (X.lianban == null ? '缺' : X.lianban + ' 家')
      + '、炸板率 ' + (X.zbRate == null ? '缺' : X.zbRate.toFixed(1) + '%') + rateLabel(X.zbRateKind)
      + '、封板率 ' + (X.sealRate == null ? '缺' : (X.sealRate * 100).toFixed(1) + '%') + rateLabel(X.sealRateKind)
      + '、跌停 ' + (X.dtCount == null ? '缺' : X.dtCount + ' 家')
      + '、昨日涨停溢价 ' + (X.prem == null ? '缺' : X.prem + '%')
      + '、连板晋级率 ' + (X.promoRate == null ? '缺' : X.promoRate + '%')
      + '、大面股 ' + (X.damian == null ? '缺' : X.damian + ' 家')
      + '、量能变化 ' + (X.volChange == null ? '缺' : X.volChange + '%')
      + '、板块数 ' + X.sectors.length + '。'
      + '个股明细来自 d.stocks 快照 ' + X.snapDate + '（' + X.stocks.length + ' 只）'
      + (X.dateMixed ? '，与当日汇总日期不同，个股级筛选结论均已标注「个股数据日期」' : '') + '。'
      + '缺数据维度：' + X.missing.length + ' 类（见「数据质量」卡片）。', 'rk_review');
    add('cycle', '二、周期定位',
      '按阈值卡计票 → ' + C.stage + '（板位上限 ' + (C.stageCap == null ? '缺' : C.stageCap + ' 板') + '、总仓 ' + C.total + '）。'
      + '信号：' + C.signals.map(function (s) { return s.name + '=' + s.val + '→' + s.band; }).join('；') + '。' + C.why, 'qr_sop');
    add('mainline', '三、主线归属',
      main ? ('板块打分 Top1：' + main.sector + ' ' + main.score + ' 分（' + main.level + '）；涨停 ' + main.limitCount + ' 家、最高板 ' + (main.maxBoards == null ? '缺' : main.maxBoards) + ' 板。'
        + '达标板块（≥30）：' + mainlines.filter(function (m) { return m.score != null && m.score >= 30; }).map(function (m) { return m.sector + '(' + m.score + ')'; }).join('、') + '。') : '无板块数据。', 'qr_decision');
    add('ladder', '四、梯队与角色',
      '当日板位分布：' + (X.exact.length ? X.exact.map(function (e) { return e.b + '板×' + e.n; }).join(' / ') : '缺数据')
      + '。四步定位 → 主线板块【' + L.mainSector + '】；' + L.steps.map(function (s) { return s.n + ' ' + s.result; }).join('；') + '。'
      + '龙头体检：17项命中 ' + DC.hit17 + '（' + DC.verdict17 + '）、见顶12项命中 ' + DC.hit12 + '（' + DC.verdict12 + '）。', 'qr_sop');
    add('turnswitch', '五、拐点与切换',
      TC.conclusion.verdict + '。' + SW.verdict + '（旧主线 ' + SW.oldSector + ' / 候选新方向 ' + SW.newSector + '，核心命中 ' + SW.coreHit + '、否决 ' + SW.vetoOn + '）。', 'tp_escape');
    add('strategy', '六、操作策略',
      picks.length ? ('优中选优 Top' + picks.length + '：' + picks.map(function (p) { return '#' + p.top + ' ' + p.name + '(' + p.roleCn + ',' + p.rank + '分)'; }).join('、')
        + '。买点分别按 ' + uniq(picks.map(function (p) { return p.entry; })).join(' / ') + '；总仓 ' + C.total + '、单票≤40%。'
        + '（以上个股数据日期均为 ' + X.snapDate + ' 快照，与当日汇总 ' + X.aggDate + ' 区分）') : '当前环境无合格标的（环境不允许时不硬做，空仓等待也是仓位管理）。', 'ps_matrix');
    add('tomorrow', '七、明日关注',
      '① 盯主线板块【' + L.mainSector + '】龙头 ' + (L.roles.dragon ? L.roles.dragon.name : '—') + ' 是否续板 / 分歧转一致；'
      + '② 候选新方向 ' + SW.newSector + ' 是否升级（需连续3日共振+≥3板高标+中军+梯队）；'
      + '③ 补涨天花板 ' + (BZ && BZ.ceiling != null ? BZ.ceiling + ' 板' : '缺数据/龙头<2板无补涨空间') + '（手册 −2 板，见补涨卡片）；'
      + '④ 触发条件示例（手册计划模板）：「高开+2% 且板块有3家以上涨停」才买，写入盘前计划不盘中临时起意。'
      + '当日溢价/晋级率已由 d.market 实测（见数据概览），明日走势需盘中验证。', 'rk_review');
    add('risk', '八、风控',
      '三层风控：单笔≤总资金2%、单票≤40%、单日回撤≥3%不开新仓；' + (C.riskOff ? '当前 ' + C.stage + '，按否决点一空仓观察；' : '')
      + '机械止损：' + uniq(picks.map(function (p) { return p.roleCn + ' ' + p.stopLine; })).join('；') + '。七条铁律：绝不补仓/扛单/退潮满仓/重仓单票/杠杆。', 'rk_three');
    // 补充引用校准 / 分歧 / 手法 / 支线 / 补涨操作 / 案例 / 风控条款，使复盘依据覆盖手册体系全貌
    R.ref('refine_calib'); R.ref('dv_judge'); R.ref('methods_hand'); R.ref('op_buzhang');
    R.ref('ml_sub'); R.ref('rk_loss'); R.ref('qr_veto'); R.ref('cases_lesson'); R.ref('casesb_fail');
    // 复盘回顾全体系：温度计九维模型与龙头操作（当日未选出龙头/溢价实测时，报告仍按手册体系给出口径）
    R.ref('thermo_model'); R.ref('op_dragon');
    var o = { sections: secs, rule: '', quote: '', why: '8 段全部由 d.market 当日汇总字段 + d.stocks 快照字段自动填充，缺失项标「缺数据，未计入结论」' };
    R.attach(o, 'qr_sop'); R.ref('rk_review');
    return o;
  }

  /* ===========================================================================
   * 12. screen(d)：结构化筛选结果（对外接口）
   * ======================================================================== */
  function screen(d) {
    var R = makeRef();
    var X = readData(d);
    var C = cycleVerdict(X, R);
    var mainlines = secRank(X, R);
    var L = locateRoles(X, mainlines, R);
    var DC = dragonCheck(X, L, R);
    var BZ = buzhangCheck(X, L, C, R);
    var T = turningCheck(X, L, C, DC, R);
    var SW = switchCheck(X, L, mainlines, C, R);
    var exclusions = hardExclude(X, L, C, R);
    var picks = buildPicks(X, L, mainlines, C, exclusions, R);
    var report = buildReport(X, L, mainlines, C, DC, BZ, T, SW, picks, R);
    return {
      date: X.date, source: X.source,
      snapDate: X.snapDate, marketDate: X.marketDate, aggDate: X.aggDate, dateMixed: X.dateMixed,
      zbRate: X.zbRate, zbRateKind: X.zbRateKind, sealRate: X.sealRate, sealRateKind: X.sealRateKind,
      prem: X.prem, promoRate: X.promoRate, damian: X.damian, dtCount: X.dtCount,
      upRatio: X.upRatio, volChange: X.volChange, usePool: X.usePool,
      dataQuality: { measured: X.measured, estimate: X.estimate, missing: X.missing },
      overview: X.ov, cycle: C, mainlines: mainlines,
      roles: L.roles, fourSteps: L.steps, mainSector: L.mainSector, topStock: L.topStock,
      dragonCheck: DC, buzhangCheck: BZ,
      turning: T.turning, turningConclusion: T.conclusion, escapeSignals: T.escape,
      switchVerdict: SW,
      exclusions: exclusions, picks: picks, report: report,
      evidence: R.evidence(), chapterIds: R.chapterIds()
    };
  }

  /* ===========================================================================
   * 13. 渲染组件（全部生成 HTML 字符串；唯一 DOM 操作为 rootEl.innerHTML）
   * ======================================================================== */
  function CARD(title, en, body) {
    return '<section class="vd-card"><div class="vd-card-h"><h3>' + title + '</h3>' + (en ? '<span class="vd-en">' + en + '</span>' : '') + '</div><div class="vd-card-b">' + body + '</div></section>';
  }
  function TBL(head, rows, cls) {
    if (!rows || !rows.length) return '<div class="vd-empty">— 缺数据，无可展示条目</div>';
    var h = '<div class="vd-scroll"><table class="vd-tbl ' + (cls || '') + '"><thead><tr>' + head.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>' + r.map(function (c) {
        if (c && typeof c === 'object') return '<td class="' + (c.cls || '') + '">' + (c.h == null ? '' : c.h) + '</td>';
        return '<td>' + (c == null ? '—' : c) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function ruleBox(o) {
    if (!o) return '';
    var r = o.rule || '', q = o.quote || '', w = o.why || '';
    return '<div class="vd-rule"><div class="vd-rule-h">📖 手册依据' + (o.sec ? ' <span class="vd-sec">' + esc(o.sec) + '</span>' : '') + '</div>'
      + (r ? '<div class="vd-rule-n">' + esc(r) + '</div>' : '')
      + (q ? '<div class="vd-rule-q">「' + esc(q) + '」</div>' : '')
      + (w ? '<div class="vd-why"><b>判定口径：</b>' + esc(w) + '</div>' : '')
      + '</div>';
  }
  function hitTag(h) { return h === true ? tag('命中', 'vd-ok') : h === false ? tag('未中', 'vd-no') : tag('缺数据', 'vd-na'); }
  function KV(pairs) {
    return '<div class="vd-kv">' + pairs.map(function (p) {
      return '<div class="vd-kv-i"><span>' + esc(p[0]) + '</span><b>' + (p[1] == null ? '<span class="vd-miss">— 缺数据</span>' : p[1]) + '</b></div>';
    }).join('') + '</div>';
  }
  function stageCls(s) { return /主线/.test(s) ? 'vd-ok' : /准主线/.test(s) ? 'vd-gold' : /支线/.test(s) ? 'vd-info' : 'vd-no'; }

  /* ===========================================================================
   * 14. 共享视图片段：四步定位表 / 优中选优 Top5 表 / 数据质量
   * ======================================================================== */
  function fourStepTable(S) {
    var rows = S.fourSteps.map(function (s) {
      return [tag(s.n, 'vd-step'), esc(s.t), '<b>' + esc(s.result) + '</b>', '<span class="vd-small">' + esc(s.detail) + '</span>', '<span class="vd-small">' + esc(s.why) + '</span>'];
    });
    return TBL(['步骤', '判定动作', '结果', '依据明细', '来源字段'], rows)
      + ruleBox(S.fourSteps[0]) + ruleBox(S.fourSteps[3]);
  }
  function roleCards(S) {
    var keys = ['dragon', 'zhongjun', 'frontline', 'buzhang', 'follower'];
    return '<div class="vd-roles">' + keys.map(function (k) {
      var r = S.roles[k];
      return '<div class="vd-role vd-role-' + k + '"><div class="vd-role-h">' + tag(ROLE_CN[k], 'vd-role-t') + '</div>'
        + (r ? '<div class="vd-role-n">' + esc(r.name) + '<small>' + esc(r.code) + '</small></div>'
          + '<div class="vd-role-m">' + (r.boards == null ? '板位缺' : r.boards + ' 板') + ' · ' + (r.firstTime || '首封缺') + ' · cap ' + (r.cap == null ? '缺' : r.cap.toFixed(1) + '亿') + '</div>'
          + '<div class="vd-role-w">' + esc(r.why) + '</div>' + ruleBox(r)
          : '<div class="vd-role-n vd-miss">— 缺数据 / 不成立</div><div class="vd-role-w">四步定位未产出该角色（或前提不成立）</div>')
        + '</div>';
    }).join('') + '</div>';
  }
  function picksTable(S) {
    if (!S.picks.length) return '<div class="vd-empty">当前无符合环境限制的标的（这是策略结论：环境不允许时不硬做，空仓等待也是仓位管理）。</div>';
    var rows = S.picks.map(function (p) {
      return [
        tag('#' + p.top + ' · ' + p.rank + '分', 'vd-rank'),
        '<b>' + esc(p.name) + '</b><br><span class="vd-small">' + esc(p.code) + ' · ' + (p.boards == null ? '板位缺' : p.boards + '板') + '</span>',
        '<span class="vd-small">个股数据日期<br><b>' + esc(p.stockDate || '—') + '</b>'
          + (p.dateMixed ? '<br><span class="vd-viol">≠ 当日汇总 ' + esc(p.aggDate || '—') + '</span>' : '<br>（与当日汇总同日）') + '</span>',
        tag(p.roleCn, 'vd-role-t') + '<br><span class="vd-small">' + esc(p.sector) + ' ' + (p.sectorScore == null ? '缺' : p.sectorScore + '分') + '</span>',
        '<span class="vd-small">' + esc(p.entry) + '</span>',
        '<span class="vd-small">' + esc(p.stageTotal) + '<br>' + esc(p.singleCap) + '</span>',
        '<span class="vd-small"><b>手册：</b>' + esc(p.stopRule) + '<br><b>执行线：</b>' + esc(p.stopLine) + '</span>',
        '<span class="vd-small vd-hits">' + (p.hits.length ? '✓ ' + p.hits.map(esc).join('；') : '无') + (p.violations.length ? '<br><span class="vd-viol">✕ ' + p.violations.map(esc).join('；') + '</span>' : '') + '</span>',
        '<span class="vd-small">' + esc(p.why) + '</span>'
      ];
    });
    return TBL(['优选', '标的', '个股数据日期', '角色/板块', '买点', '阶段总仓/单票上限', '止损止盈', '命中/触犯手册条款', '来源字段口径'], rows, 'vd-picks')
      + ruleBox(S.picks[0]);
  }
  function qualityBox(S) {
    var q = S.dataQuality || {};
    return '<div class="vd-quality">'
      + '<div class="vd-q-col"><div class="vd-q-h vd-ok">✓ 当日实测字段（d.market / ztPool）</div><ul>'
      + (q.measured || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
      + '<div class="vd-q-col"><div class="vd-q-h vd-gold">≈ 估算口径维度（仅供参考，非当日实测）</div><ul>'
      + (q.estimate || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
      + '<div class="vd-q-col"><div class="vd-q-h vd-na">⚠ 缺数据（不猜测补值 / 未计入结论）</div><ul>'
      + (q.missing || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>';
  }
  function evidenceBox(S) {
    return '<div class="vd-ev">' + S.evidence.map(function (e) {
      return '<div class="vd-ev-i"><span class="vd-ev-ch">' + esc(e.ch) + '</span><b>' + esc(e.name) + '</b><span class="vd-ev-q">' + esc(e.quote) + '</span></div>';
    }).join('') + '</div>';
  }

  /* ===========================================================================
   * 15. 七个栏目视图（每个 ≥2 张深化卡片）
   * ======================================================================== */
  var VIEWS = {};

  /* v_dash 周期判定 */
  VIEWS.v_dash = function (S) {
    var C = S.cycle;
    var cards = [];
    cards.push(CARD('① 周期定位 · 八阶段', 'CYCLE STAGE',
      KV([['当前阶段', '<b class="vd-big">' + esc(C.stage) + '</b>'], ['板位上限', C.stageCap == null ? null : C.stageCap + ' 板'],
      ['总仓上限', C.total], ['阶段否决（不开新仓）', C.riskOff ? tag('是 · 退潮/崩塌/冰点', 'vd-no') : tag('否', 'vd-ok')],
      ['定位计票', esc(C.votes.join('、') || '缺数据')]])
      + ruleBox(C)));
    cards.push(CARD('② 九项数据 / 阈值卡对照', 'DATA & THRESHOLD',
      TBL(['指标', '当日值', '阈值卡定档', '数据来源', '手册依据'], C.signals.map(function (s) {
        return [esc(s.name), esc(String(s.val)), esc(String(s.band)), '<span class="vd-small">' + esc(s.src || '—') + '</span>', '<span class="vd-small">' + esc(String(s.rule).split('·').pop()) + '</span>'];
      })) + ruleBox(S.cycle.signals[0]) + qualityBox(S)));
    cards.push(CARD('③ 三句话定周期 · 执行口径', 'THREE QUESTIONS',
      TBL(['问题', '看什么', '本日结论'], [
        ['现在能不能做？', '最高连板高度（d.market.ztPool 当日）', esc(C.stage) + ' → 按阶段仓位 ' + C.total + '、板位≤' + (C.stageCap == null ? '缺' : C.stageCap) + ' 板'],
        ['做了赚不赚钱？', '昨日涨停今日溢价（d.market.prem）', S.prem == null ? '缺数据，未计入结论（d.market.prem 未提供）' : (S.prem > 0 ? '溢价 ' + S.prem + '% 转正 → 打板赚钱、可扩张' : '溢价 ' + S.prem + '% 为负 → 打板亏钱、收缩')],
        ['要不要跑？', '大面股数量（d.market.damian）', S.damian == null ? '缺数据，未计入结论（d.market.damian 未提供）' : (S.damian <= 1 ? '大面股 ' + S.damian + ' 家 → 安全' : S.damian <= 3 ? '大面股 ' + S.damian + ' 家 → 关注' : S.damian <= 6 ? '大面股 ' + S.damian + ' 家 → 减仓' : '大面股 ' + S.damian + ' 家 → 清仓')]
      ]) + ruleBox(C)));
    cards.push(CARD('④ 数据质量与手册条款索引', 'DATA QUALITY / EVIDENCE',
      qualityBox(S) + '<div class="vd-sub">本次引用手册章节：' + S.chapterIds.map(function (c) { return tag(c, 'vd-ch'); }).join('') + '</div>' + evidenceBox(S)));
    return cards.join('');
  };

  /* v_topic 题材热点 */
  VIEWS.v_topic = function (S) {
    var cards = [];
    /* v20261112e：按六维归一化分降序排列，与本表标题「六维打分榜」一致（原先按涨停家数，易让人误以为排序不对） */
    var ml = S.mainlines.slice().sort(function (a, b) { return (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score); });
    var rows = ml.map(function (m, i) {
      var dimsTxt = m.dims.map(function (d) { return d.name + ':' + (d.got == null ? '<span class="vd-miss">缺</span>' : d.got + '/' + d.max) + (d.status === 'proxy' ? '(代理)' : d.status === 'missing' ? '(剔除)' : ''); }).join('<br>');
      return [tag('#' + (i + 1), 'vd-step'), '<b>' + esc(m.sector) + '</b>', fx(m.limitCount, ' 家'), fx(m.maxBoards, ' 板'),
      '<b class="vd-score">' + (m.score == null ? '—' : m.score) + '</b>', tag(m.level, stageCls(m.level)),
      '<span class="vd-small">' + dimsTxt + '</span>', '<span class="vd-small">可用满分 ' + m.denom + ' / 实得 ' + m.gotSum + ' / 缺 ' + m.missN + ' 维</span>'];
    });
    cards.push(CARD('① 板块六维打分榜（缺失维度标缺并从分母剔除）', 'SECTOR SCORECARD',
      TBL(['#', '板块', '涨停家数', '最高板', '归一化分', '分档', '六维明细', '分母口径'], rows, 'vd-score-tbl')
      + ruleBox(S.mainlines[0])));
    cards.push(CARD('② 主线 / 准主线 / 支线分档', 'MAINLINE TIERS',
      KV([['主线（≥70）', S.mainlines.filter(function (m) { return m.score >= 70; }).map(function (m) { return m.sector; }).join('、') || '无'],
      ['准主线（50–70）', S.mainlines.filter(function (m) { return m.score >= 50 && m.score < 70; }).map(function (m) { return m.sector; }).join('、') || '无'],
      ['支线（30–50）', S.mainlines.filter(function (m) { return m.score >= 30 && m.score < 50; }).map(function (m) { return m.sector; }).join('、') || '无'],
      ['不达标（<30）', S.mainlines.filter(function (m) { return m.score < 30; }).length + ' 个']])
      + ruleBox(S.mainlines[0])));
    var feat = ml.slice(0, 3).map(function (m) {
      return [esc(m.sector),
      m.maxBoards != null && m.maxBoards >= 5 ? tag('✓ 有高度(≥5板)', 'vd-ok') : tag('✕ 高度不足', 'vd-no'),
      (m.high && m.mid && m.low) ? tag('✓ 梯队完整', 'vd-ok') : tag('△ 梯队不全', 'vd-gold'),
      m.limitCount >= 10 ? tag('✓ 涨停≥10家', 'vd-ok') : tag('△ ' + m.limitCount + '家', 'vd-gold'),
      tag('缺数据', 'vd-na'), tag('缺数据', 'vd-na'), tag('缺数据', 'vd-na')];
    });
    cards.push(CARD('③ 主线「六有」硬性特征核验', 'SIX HARD FEATURES',
      TBL(['板块', '有高度', '有梯队', '有持续(当日涨停数)', '有中军', '有持续(连续天数)', '有逻辑/催化'], feat)
      + ruleBox(S.mainlines[0]) + '<div class="vd-note">注：有中军、连续天数、催化级别需历史/消息面数据，快照缺失，按手册口径标「缺数据」，不计入合格。</div>'));
    var scRows = ml.slice(0, 5).map(function (m) {
      var stage = m.limitCount >= 15 ? '④高潮期' : m.limitCount >= 8 ? '③扩散期' : m.limitCount >= 4 ? '②发酵期' : '①萌芽期';
      return [esc(m.sector), fx(m.limitCount, ' 家'), fx(m.maxBoards, ' 板'), stage,
      m.level === '主线' ? '主升段：持有龙头/最强前排' : m.level === '准主线' || m.level === '支线' ? '仓位减半，只做最高板/最强前排' : '观察，不参与（一日游）'];
    });
    cards.push(CARD('④ 板块周期六阶段定位', 'SECTOR CYCLE',
      TBL(['板块', '涨停数', '最高板', '板块周期阶段', '操作'], scRows) + ruleBox(S.mainlines[0])));
    var topM = ml[0] || { sector: '—', limitCount: 0, score: null };
    var jb = '<div class="vd-judge">' +
      '<div class="vd-j-eyebrow">题材热点排序（按六维归一化分降序）</div>' +
      '<div class="vd-j-title">当前最强题材 = 【' + esc(topM.sector) + '】　归一化分 ' + (topM.score == null ? '—' : topM.score) + ' · ' + (topM.limitCount || 0) + ' 家涨停</div>' +
      '<div class="vd-j-sub">排序正确：六维（持续性/涨停占比/梯队/中军/催化/赚钱效应）加权得分由当日真实数据<b>自动计算、降序排列，非人工</b>；第 1 名即当前最强题材候选。下方分档（主线/准主线/支线）与「主线·龙头·中军·补涨」页的综合评分排名口径一致。</div>' +
      '</div>';
    return jb + cards.join('');
  };

  /* v_turn 拐点识别 */
  VIEWS.v_turn = function (S) {
    var cards = [];
    var rows = S.turning.map(function (t) {
      return [tag(t.id, 'vd-step'), esc(t.from + ' → ' + t.to), fx(t.hitN, ' / ' + t.judged + ' 已判'),
      '<span class="vd-small">' + t.signals.map(function (s) { return (s.hit === true ? '✓' : s.hit === false ? '✕' : '—') + ' ' + esc(s.name); }).join('<br>') + '</span>',
      '<span class="vd-small">缺 ' + t.miss + ' 项（缺数据未纳入）</span>'];
    });
    cards.push(CARD('① 八大拐点逐条自动判定', 'EIGHT TURNING POINTS',
      TBL(['拐点', 'from → to', '命中/已判', '预警信号逐条（✓命中 ✕未中 —缺数据）', '数据完整性'], rows, 'vd-turn')
      + ruleBox(S.turning[0])));
    cards.push(CARD('② 拐点唯一结论', 'UNIQUE VERDICT',
      '<div class="vd-verdict ' + (S.turningConclusion.pick ? 'vd-vd-warn' : 'vd-vd-ok') + '">' + esc(S.turningConclusion.verdict) + '</div>'
      + '<div class="vd-small">候选：' + (S.turningConclusion.candidates.length ? S.turningConclusion.candidates.map(function (c) { return c.id + '(' + c.hitN + '命中' + (c.consistent ? ',阶段一致' : ',阶段不一致') + ')'; }).join('、') : '无') + '</div>'
      + ruleBox(S.turningConclusion)));
    cards.push(CARD('③ 逃顶八信号 / 龙头见顶 12 项体检', 'TOP SIGNALS',
      TBL(['逃顶信号', '判定', '来源字段/缺失说明'], S.escapeSignals.map(function (e) { return [esc(e.name), hitTag(e.hit), '<span class="vd-small">' + esc(e.why) + '</span>']; }))
      + '<div class="vd-sub">龙头体检：17 项命中 ' + S.dragonCheck.hit17 + '/已判 ' + S.dragonCheck.judged17 + ' → <b>' + esc(S.dragonCheck.verdict17)
      + '</b>；见顶 12 项命中 ' + S.dragonCheck.hit12 + '/已判 ' + S.dragonCheck.judged12 + ' → <b>' + esc(S.dragonCheck.verdict12) + '</b></div>'
      + TBL(['见顶信号', '判定', '来源字段口径'], S.dragonCheck.items12.map(function (it) { return [esc(it.name), hitTag(it.hit), '<span class="vd-small">' + esc(it.why) + '</span>']; }))
      + ruleBox(S.dragonCheck)));
    cards.push(CARD('④ 逃顶三原则（执行纪律）', 'ESCAPE DISCIPLINE',
      TBL(['原则', '手册口径', '当日适用'], [
        ['一 · 减仓优先于判断', '见顶信号先减到40%以下再定性', S.cycle.riskOff ? '当前 ' + esc(S.cycle.stage) + '，已属禁买，执行空仓/观察' : '见顶命中 ' + S.dragonCheck.hit12 + ' 项，' + esc(S.dragonCheck.verdict12)],
        ['二 · 中位股是领先指标', '中位股批量跌停早于龙头见顶1–2天', '缺数据：跌停家数未提供，需盘中人工盯'],
        ['三 · 不接第一根大阴', '等反包成功封住再考虑', '缺数据：无 K 线/反包序列']
      ]) + ruleBox(S.turningConclusion)));
    return cards.join('');
  };

  /* v_sw 主线切换 */
  VIEWS.v_sw = function (S) {
    var SW = S.switchVerdict, cards = [];
    cards.push(CARD('① 切换门槛 · 条件明细（核心信号 / 否决项）', 'SWITCH CONDITIONS',
      TBL(['条件', '类型', '判定', '来源字段/缺失说明'], SW.conditions.map(function (c) {
        return [esc(c.name), c.core ? tag('核心', 'vd-core') : tag('一般', 'vd-info'), hitTag(c.hit), '<span class="vd-small">' + esc(c.why) + '</span>'];
      })) + ruleBox(SW)));
    cards.push(CARD('② 否决项逐条', 'VETO ITEMS',
      TBL(['否决条件', '命中', '来源字段/缺失说明'], SW.vetoes.map(function (v) { return [esc(v.name), hitTag(v.hit), '<span class="vd-small">' + esc(v.why) + '</span>']; }))
      + ruleBox(SW)));
    cards.push(CARD('③ 切换门槛结论', 'SWITCH VERDICT',
      '<div class="vd-verdict ' + (SW.switchOn ? 'vd-vd-warn' : 'vd-vd-ok') + '">' + esc(SW.verdict) + '</div>'
      + KV([['旧主线', esc(SW.oldSector)], ['候选新方向', esc(SW.newSector)], ['核心命中', SW.coreHit + '（缺 ' + SW.coreMiss + ' 项未判）'],
      ['信号命中', String(SW.totalHit)], ['否决项命中', String(SW.vetoOn)],
      ['门槛', '≥2核心且无否决 或 ≥3信号含≥1核心 → 成立；否则主线延续']])
      + ruleBox(SW)));
    cards.push(CARD('④ 手册切换清单（旧死亡7条 / 新成立7条 / 三选二）', 'MANUAL CHECKLIST',
      TBL(['清单', '手册原文口径', '当日可判性'], [
        ['旧主线死亡（满足3条）', '龙头断板不反包 / 涨停回落>50% / 破5日线 / 中军破位 / 补涨熄火 / 中位股跌停 / 溢价连负', '多数需历史与跌停数据 → 缺数据，未判'],
        ['新主线成立（全部满足）', '连续≥3日共振 / ≥3板高标 / 涨停≥5家递增 / 有梯队 / 有中军 / 持续催化 / 家数>旧主线', '当日截面可判 ' + (SW.conditions.filter(function (c) { return c.hit !== null; }).length) + ' 条，历史项缺数据'],
        ['切换完成（三选二）', '新方向高度>旧退潮高度 / 涨停连续2日>旧 / 旧龙A字杀', '需历史序列 → 缺数据']
      ]) + ruleBox(SW) + '<div class="vd-note">手册 sw-2：旧主线死亡≥3条且新主线成立条件全部满足才提示切换，避免每天制造伪切换信号；切换期仓位≤30%（U 型曲线底部）。</div>'));
    return cards.join('');
  };

  /* v_sec 主线·龙头·中军·补涨（必须含四步定位 + 优中选优 Top5） */
  VIEWS.v_sec = function (S) {
    var cards = [];
    cards.push(CARD('① 四步定位个股角色（手册 quickref 速查二）', 'FOUR-STEP ROLE LOCATION',
      fourStepTable(S)));
    cards.push(CARD('② 角色定位结果（含手册依据 / 来源字段）', 'ROLE CARDS', roleCards(S)));
    cards.push(CARD('③ 龙头成色 17 项自动判定', 'DRAGON CHECKLIST 17',
      KV([['龙头', S.dragonCheck.stock ? esc(S.dragonCheck.stock.name) : null],
      ['命中/已判/缺', S.dragonCheck.hit17 + ' / ' + S.dragonCheck.judged17 + ' / ' + S.dragonCheck.miss17],
      ['结论', '<b>' + esc(S.dragonCheck.verdict17) + '</b>']])
      + TBL(['#', '17 项', '判定', '来源字段口径'], S.dragonCheck.items17.map(function (it, i) {
        return [String(i + 1), esc(it.name), hitTag(it.hit), '<span class="vd-small">' + esc(it.why) + '</span>'];
      })) + ruleBox(S.dragonCheck)));
    cards.push(CARD('④ 补涨五标准 + 天花板法则', 'BUZHANG RULES',
      TBL(['五标准', '判定', '来源字段/缺失说明'], S.buzhangCheck.five.map(function (f) { return [esc(f.name), hitTag(f.hit), '<span class="vd-small">' + esc(f.why) + '</span>']; }))
      + TBL(['手册 8 项 check', '判定', '来源字段/缺失说明'], S.buzhangCheck.eight.map(function (f) { return [esc(f.name), hitTag(f.hit), '<span class="vd-small">' + esc(f.why) + '</span>']; }))
      + KV([['龙头高度', S.buzhangCheck.dragonBoards + ' 板'], ['补涨高度天花板', S.buzhangCheck.ceiling == null ? '缺数据' : S.buzhangCheck.ceiling + ' 板（龙头−2）'], ['五标准命中', S.buzhangCheck.passed5 + '/5（缺 ' + S.buzhangCheck.missing5 + ' 项未判）']])
      + ruleBox(S.buzhangCheck)));
    cards.push(CARD('⑤ 优中选优 Top5 筛选结果表', 'TOP 5 PICKS', picksTable(S)));
    return cards.join('');
  };

  /* v_plan 操作策略（必须含四步定位 + 优中选优 Top5） */
  VIEWS.v_plan = function (S) {
    var cards = [];
    cards.push(CARD('① 环境层 / 策略层 / 个股层', 'STRATEGY CHAIN',
      KV([['当前阶段', esc(S.cycle.stage)], ['阶段总仓', S.cycle.total], ['板位上限', S.cycle.stageCap == null ? null : S.cycle.stageCap + ' 板'],
      ['阶段否决', S.cycle.riskOff ? tag('禁买（空仓观察）', 'vd-no') : tag('可开仓', 'vd-ok')],
      ['单票上限', '40%（position 铁律二）'], ['候选池', '主线+支线板块（评分≥30）']])
      + ruleBox(S.cycle)));
    cards.push(CARD('② 四步定位（角色 → 买点映射）', 'FOUR-STEP → ENTRY',
      fourStepTable(S)
      + TBL(['角色', '买点（手册 op-*）', '执行细节'], Object.keys(ENTRY).map(function (k) {
        var r = S.roles[k];
        return [tag(ROLE_CN[k], 'vd-role-t') + (r ? '<br><span class="vd-small">' + esc(r.name) + '</span>' : ''), esc(ENTRY[k].name), '<span class="vd-small">' + esc(ENTRY[k].detail) + '</span>'];
      })) + ruleBox(S.roles.dragon || S.fourSteps[0])));
    cards.push(CARD('③ 优中选优 Top5 筛选结果表', 'TOP 5 PICKS', picksTable(S)));
    cards.push(CARD('④ 硬性排除清单（附触犯的手册条款）', 'EXCLUSIONS',
      (S.exclusions.length ? TBL(['标的', '板位', '触犯条款（手册依据 + 来源字段）'], S.exclusions.slice(0, 20).map(function (e) {
        return ['<b>' + esc(e.name) + '</b><br><span class="vd-small">' + esc(e.code) + '</span>', e.boards == null ? '缺' : e.boards + ' 板',
        e.reasons.map(function (r) { return '• ' + esc(r.name) + '：' + esc(r.why); }).join('<br>')];
      })) : '<div class="vd-empty">无排除条目</div>')
      + '<div class="vd-note">共排除 ' + S.exclusions.length + ' 只；排除后仅从主线+支线（评分≥30）中选 Top5。</div>' + ruleBox(S.exclusions[0])));
    cards.push(CARD('⑤ 分角色仓位 / 止损止盈矩阵', 'POSITION & STOP',
      TBL(['角色', '确认期仓位', '手册止损止盈', '执行线'], [
        ['龙头', '30–40%', STOPRULE.dragon, STOPLINE.dragon],
        ['中军', '15–20%', STOPRULE.zhongjun, STOPLINE.zhongjun],
        ['前排', '15–25%', STOPRULE.frontline, STOPLINE.frontline],
        ['补涨', '10–15%', STOPRULE.buzhang, STOPLINE.buzhang],
        ['跟风', '0–5%', STOPRULE.follower, STOPLINE.follower]
      ]) + ruleBox(S.picks[0] || S.cycle)));
    return cards.join('');
  };

  /* v_rep 复盘报告 */
  VIEWS.v_rep = function (S) {
    var cards = [];
    S.report.sections.forEach(function (sec, i) {
      cards.push(CARD(sec.title, 'REPORT ' + (i + 1), '<div class="vd-rep-body">' + sec.body + '</div>' + ruleBox(sec)));
    });
    cards.push(CARD('⑨ 数据质量（缺数据一律标注，不编造）', 'DATA QUALITY', qualityBox(S)));
    cards.push(CARD('⑩ 手册条款索引（本次引用 ' + S.evidence.length + ' 条 / ' + S.chapterIds.length + ' 章）', 'MANUAL EVIDENCE',
      '<div class="vd-sub">章节 id：' + S.chapterIds.map(function (c) { return tag(c, 'vd-ch'); }).join('') + '</div>' + evidenceBox(S)));
    return cards.join('');
  };

  /* ===========================================================================
   * 16. render(rootEl, viewKey, d)：幂等、DOM 查询仅限 rootEl
   * ======================================================================== */
  function render(rootEl, viewKey, d) {
    if (!rootEl) return;
    rootEl.innerHTML = ''; // 幂等：先清空
    var S;
    try { S = screen(d); }
    catch (e) {
      rootEl.innerHTML = '<div class="vd-wrap"><div class="vd-card"><div class="vd-card-b"><div class="vd-empty">筛选引擎异常：' + esc(e && e.message ? e.message : e) + '</div></div></div></div>';
      return;
    }
    var fn = VIEWS[viewKey] || VIEWS.v_dash;
    var body;
    try { body = fn(S); }
    catch (e) { body = '<div class="vd-card"><div class="vd-card-b"><div class="vd-empty">栏目渲染异常：' + esc(e && e.message ? e.message : e) + '</div></div></div>'; }
    var head = '<div class="vd-head"><div class="vd-title">按 26 章判定手册 · 自动筛选与角色定位</div>'
      + '<div class="vd-meta">当日汇总 <b>' + esc(S.aggDate) + '</b>（d.market ' + esc(S.marketDate || '缺')
      + '） · 个股明细 <b>' + esc(S.snapDate) + '</b>（d.stocks 快照）'
      + (S.dateMixed ? ' <span class="vd-tag vd-no">日期不同：汇总/个股已分口径</span>' : ' · 同日')
      + ' · 来源 ' + esc(S.source) + ' · ' + tag(viewKey, 'vd-ch')
      + ' · 引用 ' + S.chapterIds.length + ' 章 / ' + S.evidence.length + ' 条</div>'
      + '<div class="vd-meta">炸板率 <b>' + (S.zbRate == null ? '缺' : S.zbRate.toFixed(1) + '%') + '</b>'
      + rateLabel(S.zbRateKind) + ' · 封板率 <b>' + (S.sealRate == null ? '缺' : (S.sealRate * 100).toFixed(1) + '%') + '</b>'
      + rateLabel(S.sealRateKind) + ' · 汇总池 ' + (S.usePool ? 'd.market.ztPool 当日' : '快照') + '</div>'
      + '<div class="vd-meta">主线板块 <b>' + esc(S.mainSector || '—') + '</b> · 周期 <b>' + esc(S.cycle.stage) + '</b> · 切换 <b>' + (S.switchVerdict.switchOn ? '成立' : '延续') + '</b> · 优中选优 <b>' + S.picks.length + '</b> 只 · 排除 <b>' + S.exclusions.length + '</b> 只</div></div>';
    rootEl.innerHTML = '<div class="vd-wrap">' + head + body + '</div>';
  }

  global.YGViewsDeep = { render: render, screen: screen };
})(typeof window !== 'undefined' ? window : this);
