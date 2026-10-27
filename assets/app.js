/* =========================================================================
 * app.js — 妖股雷达 交互逻辑（多模块版）
 * ========================================================================= */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const fmt = (n, d = 2) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pctTxt = (v) => (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + fmt(v, 2) + '%';
  const pctColor = (v) => (v >= 0 ? 'var(--up)' : 'var(--down)');
  const WKEY = 'yg_watchlist_v1';
  const AKEY = 'yg_autorefresh_v1';
  const ARATEKEY = 'yg_autorefresh_sec_v1';

  const ICON = { radar: '🎯', review: '📒', ladder: '🪜', scan: '🔍', tactics: '⚔️', lhb: '🐉', capital: '💰', history: '📜', xray: '🔬', watch: '⭐', settings: '⚙️' };
  const TABS = {
    radar: '妖股雷达', review: '每日复盘', ladder: '连板梯队', scan: '三合一扫描',
    tactics: '三大战法', lhb: '龙虎榜', capital: '主力资金', history: '历史妖股',
    xray: '妖股透视', watch: '自选', settings: '设置'
  };
  const ORDER = ['radar', 'review', 'ladder', 'scan', 'tactics', 'lhb', 'capital', 'history', 'xray', 'watch', 'settings'];

  const state = { tab: 'radar', data: null, watch: [], autoRefresh: false, refreshSec: 5, refreshTimer: null, lastUpdated: null, filter: { minBoards: 2, sector: '', maxCap: 2000 }, lhbBoard: 'all', lhbCache: {}, historyDate: '', historyItems: null, xrayCode: '', ladderMatrix: null, xrayToken: 0, xrayCache: {} };

  // ---------- 工具 ----------
  const yuanYi = (v) => (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + fmt(v / 1e8, 2) + '亿';
  const lhbChg = (c) => (c == null || isNaN(c)) ? '—' : (c >= 0 ? '+' : '') + (c * 100).toFixed(2) + '%';
  const heatTxt = (h) => { const n = Number(h); return isNaN(n) ? '—' : (n >= 1e4 ? fmt(n / 1e4, 1) + '万' : fmt(n, 0)); };
  // 股票卡片「数据时刻」标注：明确各机构级因子的时效，消除"是否沿用前一天"的疑惑
  function fmtDataMeta(s) {
    const m = (s && s.meta) || {};
    const lhb = m.lhbDate || (state.data && state.data.lhbDate) || '';
    const lhbTxt = m.youzi === 'lhb' ? ('游资：' + (lhb ? lhb.slice(5) : '') + ' 龙虎榜')
      : m.youzi === 'na' ? '游资：降级缺失' : '游资：未上榜';
    const sealTxt = m.seal === 'ths' ? '封单：实时' : '封单：降级缺失';
    const sectorTxt = m.sector === 'em' ? '题材：东财行业' : '题材：实时';
    const quoteTxt = m.degraded ? '行情：东财降级' : (m.quote === 'demo' ? '行情：演示' : '行情：实时');
    return lhbTxt + ' / ' + sealTxt + ' / ' + sectorTxt + ' / ' + quoteTxt;
  }

  // ---------- 自选股 ----------
  function loadWatch() { try { state.watch = JSON.parse(localStorage.getItem(WKEY) || '[]'); } catch (e) { state.watch = []; } }
  function saveWatch() { localStorage.setItem(WKEY, JSON.stringify(state.watch)); }
  const isWatch = (code) => state.watch.includes(code);
  function toggleWatch(code) { state.watch = isWatch(code) ? state.watch.filter((c) => c !== code) : state.watch.concat(code); saveWatch(); }
  const findStock = (code) => (state.data ? state.data.stocks.find((x) => x.code === code) : null);

  // ---------- 自动刷新 ----------
  function loadAutoRefresh() {
    try { state.autoRefresh = localStorage.getItem(AKEY) === '1'; } catch (e) { state.autoRefresh = false; }
    try { const s = parseInt(localStorage.getItem(ARATEKEY), 10); state.refreshSec = [5, 10, 30, 60].includes(s) ? s : 5; } catch (e) { state.refreshSec = 5; }
  }
  function saveAutoRefresh() { try { localStorage.setItem(AKEY, state.autoRefresh ? '1' : '0'); } catch (e) {} }
  function saveRefreshSec() { try { localStorage.setItem(ARATEKEY, String(state.refreshSec)); } catch (e) {} }
  function startAutoRefresh() { if (state.refreshTimer) clearInterval(state.refreshTimer); state.refreshTimer = setInterval(() => { if (state.tab !== 'settings') refreshAll({ silent: true }); }, state.refreshSec * 1000); }
  function stopAutoRefresh() { if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; } }

  // ---------- 数据 ----------
  async function loadData() { await refreshAll(); }
  async function refreshAll(opts = {}) {
    const btn = $('#refreshBtn');
    if (btn && !opts.silent) btn.classList.add('spinning');
    try {
      state.data = await window.YGData.getDaily();
      state.lhbCache.all = { items: state.data.lhb, dept: [], date: state.data.lhbDate, source: state.data.source };
      updateTopbar();
      if (state.tab !== 'settings') render();
    } catch (e) {
      updateTopbar();
    } finally {
      if (btn && !opts.silent) setTimeout(() => btn.classList.remove('spinning'), 400);
    }
  }

  // ---------- 雷达图 ----------
  function drawRadar(canvas, factors) {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(300, Math.max(240, canvas.parentElement.clientWidth - 40));
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const cx = size / 2, cy = size / 2 + 6, r = size / 2 - 40;
    const n = factors.length, ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    ctx.strokeStyle = '#e6e6ee'; ctx.lineWidth = 1;
    for (let g = 1; g <= 4; g++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const a = ang(i % n), rr = (r * g) / 4; const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = '#6b7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const a = ang(i);
      ctx.strokeStyle = '#e6e6ee'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); ctx.stroke();
      ctx.fillText(factors[i].label, cx + (r + 20) * Math.cos(a), cy + (r + 20) * Math.sin(a) + 3);
    }
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const f = factors[i % n], a = ang(i % n), rr = (r * f.value) / 100; const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.closePath(); ctx.fillStyle = 'rgba(108,61,246,.18)'; ctx.strokeStyle = '#6c3df6'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    for (let i = 0; i < n; i++) { const f = factors[i], a = ang(i), rr = (r * f.value) / 100; ctx.beginPath(); ctx.arc(cx + rr * Math.cos(a), cy + rr * Math.sin(a), 3, 0, 2 * Math.PI); ctx.fillStyle = '#6c3df6'; ctx.fill(); }
  }

  // ---------- 迷你走势（合成示意）----------
  function drawSpark(canvas, stock) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320, h = 120;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const days = Math.max(stock.boards || 2, 6);
    const data = []; let p = (stock.price || 10) / Math.pow(1.1, stock.boards || 2);
    for (let i = 0; i < days; i++) {
      const up = i >= days - (stock.boards || 2);
      const open = p, close = up ? open * 1.1 : open * (1 + (Math.random() - 0.45) * 0.04);
      const high = Math.max(open, close) * (1 + Math.random() * 0.02), low = Math.min(open, close) * (1 - Math.random() * 0.02);
      data.push({ open, close, high, low, up }); p = close;
    }
    const min = Math.min(...data.map((d) => d.low)), max = Math.max(...data.map((d) => d.high));
    const pad = (max - min) * 0.1 || 1, lo = min - pad, hi = max + pad, cw = w / days;
    ctx.clearRect(0, 0, w, h);
    data.forEach((d, i) => {
      const x = i * cw + cw / 2;
      const yO = h - ((d.open - lo) / (hi - lo)) * h, yC = h - ((d.close - lo) / (hi - lo)) * h;
      const yH = h - ((d.high - lo) / (hi - lo)) * h, yL = h - ((d.low - lo) / (hi - lo)) * h;
      ctx.strokeStyle = d.up ? '#e53935' : '#15a85a'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
      const bw = Math.max(3, cw * 0.6); ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.abs(yC - yO) || 1);
    });
  }

  // ---------- 真实 K 线（蜡烛图）----------
  function drawCandle(canvas, bars) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 180;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!bars || !bars.length) { ctx.fillStyle = '#9aa'; ctx.font = '12px sans-serif'; ctx.fillText('暂无K线数据', 8, 20); return; }
    const n = bars.length;
    const lo = Math.min(...bars.map((b) => b.low)), hi = Math.max(...bars.map((b) => b.high));
    const pad = (hi - lo) * 0.08 || 1, min = lo - pad, max = hi + pad;
    const cw = w / n;
    bars.forEach((b, i) => {
      const x = i * cw + cw / 2;
      const up = b.close >= b.open;
      const col = up ? '#e53935' : '#15a85a';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      const yH = h - ((b.high - min) / (max - min)) * h, yL = h - ((b.low - min) / (max - min)) * h;
      ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
      const yO = h - ((b.open - min) / (max - min)) * h, yC = h - ((b.close - min) / (max - min)) * h;
      const bw = Math.max(2, cw * 0.6);
      ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.abs(yC - yO) || 1);
    });
  }

  // ---------- 热度排名走势（数值越小越热，故反转绘制：线越高越热）----------
  function drawRankLine(canvas, pts) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 120;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!pts || !pts.length) { ctx.fillStyle = '#9aa'; ctx.font = '12px sans-serif'; ctx.fillText('暂无热度数据', 8, 20); return; }
    const ranks = pts.map((p) => p.rank);
    const maxR = Math.max(...ranks), minR = Math.min(...ranks), span = (maxR - minR) || 1;
    ctx.strokeStyle = '#6c3df6'; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach((p, i) => {
      const x = pts.length > 1 ? (i / (pts.length - 1)) * w : w / 2;
      const y = h - ((maxR - p.rank) / span) * h; // 反转：热度越高线越靠上
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#9aa'; ctx.font = '10px sans-serif';
    ctx.fillText('热度越高线越靠上（排名数值越小越热门）', 6, h - 4);
  }

  const fmtDate = (d) => { const x = new Date(d); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };

  // ---------- 顶部栏 ----------
  function updateTopbar() {
    const d = state.data; if (!d) return;
    const src = d.source === 'api' ? '实时·同花顺' : '演示';
    $('#topDate').textContent = `${d.date} · A股连板概率雷达`;
    $('#topSource').textContent = `${src}数据`;
    state.lastUpdated = new Date();
    const t = state.lastUpdated;
    const p2 = (n) => String(n).padStart(2, '0');
    let txt = `更新 ${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}`;
    if (state.autoRefresh) txt += ` · 自动${state.refreshSec}s`;
    $('#topUpdated').textContent = txt;
  }

  // ---------- 通用：股票行 ----------
  function stockRow(s, onClick) {
    const row = el('div', 'stock-row');
    const boardTxt = s.continueText || ((s.boards || 1) + '板');
    row.innerHTML = `
      <div style="width:18px;text-align:center;color:var(--gold);font-size:16px" data-star>${isWatch(s.code) ? '★' : '☆'}</div>
      <div style="flex:1;min-width:0">
        <div class="name">${s.name} <span class="tiny">${boardTxt}</span></div>
        <div class="code">${s.code}${s.isNew ? ' · 新股' : ''}</div>
      </div>
      <div style="text-align:right"><div class="price">${fmt(s.price)}</div><div style="color:var(--up);font-weight:700">${pctTxt(s.changePct)}</div></div>
      <span class="prob-pill">${s.probability}%</span>`;
    row.querySelector('[data-star]').onclick = (e) => { e.stopPropagation(); toggleWatch(s.code); row.querySelector('[data-star]').textContent = isWatch(s.code) ? '★' : '☆'; };
    row.style.cursor = 'pointer'; row.onclick = () => (onClick ? onClick(s) : openDetail(s.code));
    return row;
  }

  function signalInfo() {
    const lhb = {}, hot = {};
    (state.data.lhb || []).forEach((x) => { lhb[x.thscode] = x; });
    (state.data.hot || []).forEach((x) => { hot[x.thscode] = x; });
    return { lhb, hot };
  }
  function signalBadges(s, info) {
    const b = [];
    if ((s.boards || 1) >= 2) b.push('<span class="sig sig-board">连板</span>');
    if (info.lhb[s.thscode]) b.push('<span class="sig sig-lhb">龙虎</span>');
    if (info.hot[s.thscode]) b.push('<span class="sig sig-hot">人气</span>');
    return b.join('');
  }

  // ---------- 风险标签（从已有数据推导，无需新数据源） ----------
  // 规则：高位连板 / 换手过热 / 一字加速 / 游资上榜 / 机构参与 / 人气前10 / 板块效应
  function riskTags(s, info) {
    const tags = [];
    const boards = s.boards || 1;
    if (boards >= 5) tags.push(['rt-high', '高位连板']);
    if (s.turnover != null && s.turnover >= 25) tags.push(['rt-warn', '换手过热']);
    if (s.limitType === 1 && boards >= 2) tags.push(['rt-warn', '一字加速']);
    const l = info.lhb[s.thscode];
    if (l) {
      if (l.hot_money_net_value) tags.push(['rt-youzi', '游资上榜']);
      if (l.org_net_value) tags.push(['rt-org', '机构参与']);
    }
    const hot = info.hot[s.thscode];
    if (hot && hot.rank != null && hot.rank <= 10) tags.push(['rt-hot', '人气前10']);
    const d = state.data;
    if (d && d.sectors) {
      const sec = d.sectors.find((x) => x.sector === s.sector);
      if (sec && sec.limitCount >= 3) tags.push(['rt-good', '板块效应']);
    }
    return tags;
  }
  const riskTagsHtml = (s, info) => riskTags(s, info).map((t) => `<span class="rtag ${t[0]}">${t[1]}</span>`).join('');

  // ---------- 情绪周期量化（冰点→启动→发酵→高潮→退潮） ----------
  // 完全由当日指标推导：涨停家数 / 连板高度 / 炸板率（口径与豆包一致）
  function sentimentCycle() {
    const d = state.data;
    const ov = d.overview, st = d.stats;
    const limitUp = ov.limitUp || 0;
    const zhaban = ov.zhaban != null ? ov.zhaban : (st && st.open_stock_count) || 0;
    const maxBoards = ov.maxBoards || 1;
    const touched = (st && st.touched_limit_up_stock_count) || null;
    const zhabanRate = touched ? Math.round((zhaban / touched) * 100)
      : (limitUp + zhaban > 0 ? Math.round((zhaban / (limitUp + zhaban)) * 100) : null);
    const sealRate = (st && st.seal_rate != null) ? Math.round(st.seal_rate * 100) : null;
    let promo = null;
    if (st && st.page_boards && st.page_boards.length) {
      const arr = st.page_boards.filter((x) => x.board_level !== 'one' && x.promotion_rate != null).map((x) => x.promotion_rate);
      if (arr.length) promo = Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100);
    }
    const lianban = ov.lianban || 0;
    // 判断顺序：高潮 → 退潮 → 冰点 → 启动 → 发酵（兜底）
    let idx = 2; // 默认发酵
    if (limitUp >= 90 && maxBoards >= 6) idx = 3;                                   // 高潮
    else if (zhabanRate != null && zhabanRate >= 35) idx = 4;                        // 退潮：炸板率抬升
    else if (maxBoards >= 5 && limitUp < 40) idx = 4;                                // 退潮：高位板仍在但涨停骤缩
    else if (limitUp < 30 || maxBoards <= 2) idx = 0;                                // 冰点
    else if (maxBoards <= 4 && limitUp < 50) idx = 1;                                // 启动
    const STAGE = [
      { name: '冰点', cls: 's0', desc: '亏钱效应主导，连板高度被压缩，市场静待新周期。', tip: '空仓观望为主，只跟踪首板动向，等待新周期种子出现。' },
      { name: '启动', cls: 's1', desc: '情绪回暖，先锋板开始出现，试错资金重新进场。', tip: '轻仓试错首板与低位首次晋级，控制单票仓位。' },
      { name: '发酵', cls: 's2', desc: '赚钱效应扩散，板块效应显现，龙头打开空间高度。', tip: '聚焦主流题材中军与梯队低吸，跟随龙头节奏。' },
      { name: '高潮', cls: 's3', desc: '情绪极致一致，分歧随时可能出现，注意兑现节奏。', tip: '只做总龙头，不追高位跟风股，随时准备止盈兑现。' },
      { name: '退潮', cls: 's4', desc: '炸板率抬升或高位断板，亏钱效应开始扩散。', tip: '空仓或只做超跌反抽，严禁接力高位板。' }
    ];
    const stg = STAGE[idx];
    return { idx, stg, m: { limitUp, lianban, maxBoards, zhabanRate, sealRate, promo, zhaban } };
  }
  function renderSentimentCard() {
    const c = sentimentCycle();
    const m = c.m;
    const band = ['冰点', '启动', '发酵', '高潮', '退潮'].map((n, i) =>
      `<div class="cycle-seg ${c.stg.cls} ${i === c.idx ? 'active' : ''}" title="${n}"></div>`).join('');
    const stageLabels = ['冰点', '启动', '发酵', '高潮', '退潮'].map((n, i) =>
      `<span class="cycle-label ${i === c.idx ? 'on' : ''}">${n}</span>`).join('');
    const mt = (v, u) => v != null ? v + (u || '') : '—';
    return `<div class="card cycle-card">
      <h3><span class="bar"></span>今日市场情绪</h3>
      <div class="cycle-head"><span class="cycle-stage ${c.stg.cls}-txt">${c.stg.name}</span>
        <span class="tiny">周期判断由涨停家数 / 连板高度 / 炸板率实时推导</span></div>
      <div class="cycle-band">${band}</div>
      <div class="cycle-labels">${stageLabels}</div>
      <div class="cycle-metrics">
        <div class="cycle-metric">涨停 <b>${mt(m.limitUp, ' 家')}</b></div>
        <div class="cycle-metric">连板 <b>${mt(m.lianban, ' 家')}</b></div>
        <div class="cycle-metric">最高板 <b>${mt(m.maxBoards, ' 板')}</b></div>
        <div class="cycle-metric">晋级率 <b>${mt(m.promo, '%')}</b></div>
        <div class="cycle-metric">炸板率 <b>${mt(m.zhabanRate, '%')}</b></div>
        ${m.sealRate != null ? `<div class="cycle-metric">封板率 <b>${mt(m.sealRate, '%')}</b></div>` : ''}
      </div>
      <div class="cycle-desc tiny">${c.stg.desc}</div>
      <div class="cycle-tip">💡 操作建议：${c.stg.tip}</div>
    </div>`;
  }
  // ---------- 涨停行业分布（横向条形，纯 CSS 复用 capbar） ----------
  function renderSectorDistCard() {
    const d = state.data;
    const rows = (d.sectors || []).slice().sort((a, b) => b.limitCount - a.limitCount).slice(0, 12);
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>涨停行业分布</h3><div class="tiny" style="margin-bottom:6px">当日涨停股按行业/板块统计（含首板），点击行业可跳转雷达页按该题材筛选。</div>`;
    if (!rows.length) { card.appendChild(el('div', 'empty', '暂无行业数据')); return card; }
    const max = Math.max(...rows.map((x) => x.limitCount), 1);
    rows.forEach((x) => {
      const bar = el('div', 'capbar');
      bar.innerHTML = `<div class="capbar-label">${x.sector}</div><div class="capbar-track"><div class="capbar-fill up" style="width:${(x.limitCount / max) * 100}%"></div></div><div class="capbar-val">${x.limitCount} 家</div>`;
      bar.style.cursor = 'pointer';
      bar.onclick = () => { state.filter.sector = x.sector; switchTab('radar'); };
      card.appendChild(bar);
    });
    return card;
  }

  // =========================================================================
  // 渲染：每日复盘
  // =========================================================================
  function renderReview() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const ov = el('div', 'card');
    const useSeal = d.overview.sealRate != null;
    ov.innerHTML = `<h3><span class="bar"></span>市场概览（${d.date}）</h3>
      <div class="overview">
        <div class="ov-item"><div class="v up">${d.overview.limitUp}</div><div class="l">涨停</div></div>
        <div class="ov-item"><div class="v down">${d.overview.limitDown}</div><div class="l">跌停</div></div>
        <div class="ov-item"><div class="v brand">${d.overview.lianban}</div><div class="l">连板</div></div>
        <div class="ov-item"><div class="v">${d.overview.zhaban}</div><div class="l">炸板</div></div>
        <div class="ov-item"><div class="v up">${d.overview.maxBoards}</div><div class="l">最高板</div></div>
        <div class="ov-item"><div class="v ${useSeal ? 'brand' : ''}">${useSeal ? Math.round(d.overview.sealRate * 100) + '%' : d.overview.hotSectors}</div><div class="l">${useSeal ? '封板率' : '热板块'}</div></div>
      </div>`;
    root.appendChild(ov);

    const sc = el('div', 'card');
    sc.innerHTML = `<h3><span class="bar"></span>强势题材</h3>`;
    const secWrap = el('div', 'sectors');
    const hot = d.sectors.filter((s) => s.limitCount >= 2);
    (hot.length ? hot : d.sectors).slice(0, 14).forEach((s) => {
      const c = el('div', 'sector-chip', `${s.sector} <b>${s.limitCount}↑</b>`);
      c.onclick = () => { state.filter.sector = s.sector; switchTab('radar'); };
      secWrap.appendChild(c);
    });
    sc.appendChild(secWrap); root.appendChild(sc);

    // 连板梯队（精简）
    const lad = el('div', 'card');
    lad.innerHTML = `<h3><span class="bar"></span>连板梯队</h3>`;
    if (!d.ladder.length) lad.appendChild(el('div', 'empty', '今日暂无连板股票'));
    d.ladder.forEach((tier) => {
      const t = el('div', 'ladder-tier');
      const head = el('div', 'tier-head');
      head.innerHTML = `<span class="tier-badge ${tier.boards >= 5 ? 'high' : ''}">${tier.boards}连板</span><span class="tier-count">${tier.stocks.length} 只</span>`;
      t.appendChild(head);
      tier.stocks.forEach((s) => t.appendChild(stockRow(s)));
      lad.appendChild(t);
    });
    root.appendChild(lad);

    const mon = el('div', 'card');
    mon.innerHTML = `<h3><span class="bar"></span>妖股榜 TOP5</h3>`;
    d.top.forEach((s, i) => {
      const r = el('div', 'monster-row');
      const rankCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      r.innerHTML = `<span class="rank-badge ${rankCls}">${i + 1}</span>
        <div style="flex:1"><div class="name">${s.name}</div><div class="code">${s.code} · ${s.sector}</div></div>
        <div style="text-align:right"><div class="price">${fmt(s.price)}</div><div class="tiny" style="color:${pctColor(s.changePct)};font-weight:700">${pctTxt(s.changePct)}</div></div>
        <span class="prob-pill">${s.probability}%</span>`;
      r.style.cursor = 'pointer'; r.onclick = () => openDetail(s.code);
      mon.appendChild(r);
    });
    root.appendChild(mon);
  }

  // =========================================================================
  // 渲染：连板梯队（独立）
  // =========================================================================
  async function renderLadder() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>今日连板梯队（共 ${d.ladder.reduce((a, t) => a + t.stocks.length, 0)} 只）</h3>`;
    if (!d.ladder.length) card.appendChild(el('div', 'empty', '今日暂无连板股票'));
    d.ladder.forEach((tier) => {
      const t = el('div', 'ladder-tier');
      const head = el('div', 'tier-head');
      head.innerHTML = `<span class="tier-badge ${tier.boards >= 5 ? 'high' : ''}">${tier.boards}连板</span><span class="tier-count">${tier.stocks.length} 只</span>`;
      t.appendChild(head);
      tier.stocks.forEach((s) => t.appendChild(stockRow(s)));
      card.appendChild(t);
    });
    root.appendChild(card);

    // 近30日连板天梯矩阵（真实接口，缓存避免自动刷新重复拉取）
    const mcard = el('div', 'card');
    mcard.innerHTML = `<h3><span class="bar"></span>近30日连板天梯（晋级/断板追踪）</h3>
      <div class="tiny" style="margin-bottom:8px">来源：limit-up-ladder（近 30 交易日，按日期 × 板位排列）。<span class="lm-stock promo">绿底</span>=次日继续封板(晋级) · <span class="lm-stock broke">灰底</span>=次日断板。</div>
      <div id="ladderMatrix"><div class="tiny">加载中…</div></div>`;
    root.appendChild(mcard);
    if (!state.ladderMatrix) {
      try { state.ladderMatrix = await window.YGData.getLadderMatrix(); } catch (e) { state.ladderMatrix = { items: [], source: 'demo', notice: e.message }; }
    }
    renderLadderMatrix(state.ladderMatrix);
  }

  function renderLadderMatrix(data) {
    const box = $('#ladderMatrix'); if (!box) return;
    const items = data.items || [];
    if (!items.length) { box.innerHTML = '<div class="empty">暂无天梯数据' + (data.notice ? '（' + data.notice + '）' : '') + '</div>'; return; }
    const levels = [['two_board', '2板'], ['three_board', '3板'], ['four_board', '4板'], ['five_board', '5板'], ['six_board', '6板'], ['seven_over', '7板+']];
    let html = '<div class="ladder-scroll"><table class="ladder-matrix"><thead><tr><th>日期</th>';
    levels.forEach(([, label]) => { html += `<th>${label}</th>`; });
    html += '</tr></thead><tbody>';
    items.forEach((it) => {
      html += `<tr><td class="lm-date">${it.date || ''}</td>`;
      levels.forEach(([key]) => {
        const arr = (it.boards && it.boards[key]) || [];
        const cell = arr.map((s) => {
          const cls = s.seal_nextday === true ? ' promo' : (s.seal_nextday === false ? ' broke' : '');
          return `<span class="lm-stock${cls}" title="${s.name || ''}">${s.name || ''}</span>`;
        }).join('');
        html += `<td>${cell || '<span class="tiny">—</span>'}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    box.innerHTML = html;
  }

  // =========================================================================
  // 渲染：妖股雷达（筛选 + 列表 + 雷达）
  // =========================================================================
  function renderRadar() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    // 情绪周期量化（对标豆包：冰点→启动→发酵→高潮→退潮 + 操作建议）
    root.insertAdjacentHTML('beforeend', renderSentimentCard());
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>妖股概率筛选</h3>`;
    const f = el('div', 'filters');
    const minSel = el('select');
    [2, 3, 4, 5, 6, 7, 8].forEach((b) => { const o = el('option', null, `${b}连板及以上`); o.value = b; if (b === state.filter.minBoards) o.selected = true; minSel.appendChild(o); });
    const secSel = el('select');
    // 题材计数跟随「连板」条件动态计算：括号内数字 = 该题材下满足当前连板条件的标的数，
    // 与点击「开始筛选」后的结果条数严格一致（此前用 limitCount 统计全部涨停含首板，与筛选结果对不上）。
    const fillSectorOptions = (minBoards, keep) => {
      const map = {};
      d.stocks.forEach((s) => {
        if ((s.boards || 1) < minBoards) return;
        (s.concepts || [s.sector]).forEach((c) => { map[c] = (map[c] || 0) + 1; });
      });
      const secs = Object.keys(map).map((c) => ({ sector: c, n: map[c] }))
        .sort((a, b) => (b.n - a.n) || a.sector.localeCompare(b.sector, 'zh')).slice(0, 30);
      secSel.innerHTML = '';
      const oAll = el('option', null, '全部题材'); oAll.value = ''; secSel.appendChild(oAll); // value 必须置空，否则 option.value 默认为文本「全部题材」，会导致筛选恒为空
      secs.forEach(({ sector, n }) => { const o = el('option', null, `${sector}(${n})`); o.value = sector; o.title = `该题材下 ${minBoards} 连板及以上共 ${n} 只，与筛选结果一致`; if (sector === keep) o.selected = true; secSel.appendChild(o); });
    };
    fillSectorOptions(state.filter.minBoards, state.filter.sector);
    minSel.onchange = () => fillSectorOptions(+minSel.value, secSel.value);
    const line1 = el('div', 'filter-line'); line1.innerHTML = '<label>连板</label>'; line1.appendChild(minSel);
    const line2 = el('div', 'filter-line'); line2.innerHTML = '<label>题材</label>'; line2.appendChild(secSel);
    f.appendChild(line1); f.appendChild(line2);
    card.appendChild(f);
    const btn = el('button', 'btn', '开始筛选');
    btn.style.marginTop = '12px';
    btn.onclick = () => { state.filter.minBoards = +minSel.value; state.filter.sector = secSel.value; renderRadarList(); };
    card.appendChild(btn); root.appendChild(card);

    const res = el('div', 'card');
    res.innerHTML = `<h3><span class="bar"></span>结果（按妖股概率）</h3><div id="radarList"></div>`;
    root.appendChild(res);
    renderRadarList();
    // 涨停行业分布（对标豆包雷达页底部条形图）
    root.appendChild(renderSectorDistCard());
  }
  function renderRadarList() {
    const box = $('#radarList'); if (!box) return;
    const sec = state.filter.sector;
    const list = state.data.stocks.filter((s) =>
      (s.boards || 1) >= state.filter.minBoards &&
      (sec && sec !== '全部题材' ? (s.concepts || [s.sector]).includes(sec) : true)
    ).sort((a, b) => b.probability - a.probability);
    if (!list.length) { box.innerHTML = '<div class="empty">没有符合条件的标的<br><span style="font-size:12px;opacity:.6">可降低连板/题材条件，或点击右上角刷新更新数据</span></div>'; return; }
    box.innerHTML = '';
    const info = signalInfo();
    list.forEach((s) => {
      const r = el('div', 'monster-row');
      r.innerHTML = `<span class="prob-pill" style="width:54px;text-align:center">${s.probability}</span>${s.scores && s.scores.rating ? `<span class="rating-badge badge-${s.scores.rating}" style="margin-left:6px">${s.scores.rating}</span>` : ''}
        <div style="flex:1;min-width:0"><div class="name">${s.name}</div><div class="code">${s.code} · ${s.continueText || (s.boards + '板')}</div><div class="rtags">${riskTagsHtml(s, info)}</div><div class="dmeta">${fmtDataMeta(s)}</div></div>
        <div style="text-align:right"><div class="price">${fmt(s.price)}</div><div style="color:var(--up);font-weight:700">${pctTxt(s.changePct)}</div></div>`;
      r.style.cursor = 'pointer'; r.onclick = () => openDetail(s.code);
      box.appendChild(r);
    });
  }

  // =========================================================================
  // 渲染：三合一扫描（连板 ∩ 龙虎榜 ∩ 人气）
  // =========================================================================
  function renderScan() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const info = signalInfo();
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>三合一扫描</h3>
      <div class="tiny" style="margin-bottom:6px">同时命中「连板 + 龙虎榜 + 人气」三重信号的个股，视为多维度共振。下方按信号数排序。</div>`;
    const list = d.stocks.filter((s) => (s.boards || 1) >= 2).map((s) => {
      let n = 1; if (info.lhb[s.thscode]) n++; if (info.hot[s.thscode]) n++;
      return Object.assign({}, s, { signals: n });
    }).sort((a, b) => b.signals - a.signals || b.probability - a.probability);
    if (!list.length) card.appendChild(el('div', 'empty', '暂无连板标的'));
    list.forEach((s) => {
      const r = el('div', 'monster-row');
      r.innerHTML = `<span class="prob-pill" style="width:54px;text-align:center">${s.probability}%</span>
        <div style="flex:1;min-width:0"><div class="name">${s.name} ${signalBadges(s, info)}</div><div class="code">${s.code} · ${s.continueText || (s.boards + '板')}</div><div class="dmeta">${fmtDataMeta(s)}</div></div>
        <div style="text-align:right"><div class="price">${fmt(s.price)}</div></div>`;
      r.style.cursor = 'pointer'; r.onclick = () => openDetail(s.code);
      card.appendChild(r);
    });
    root.appendChild(card);
  }

  // =========================================================================
  // 渲染：三大战法
  // =========================================================================
  function renderTactics() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const tactics = [
      { key: 'leader', name: '龙头战法', desc: '聚焦市场最高连板高度的标的，打最硬的板、做板块总龙头。', pick: () => d.stocks.slice().sort((a, b) => (b.boards || 1) - (a.boards || 1) || b.probability - a.probability).slice(0, 8) },
      { key: 'change', name: '换手战法', desc: '选择换手板（非一字）且封单扎实的标的，充分换手上板更利于接力。', pick: () => d.stocks.filter((s) => s.limitType === 2).sort((a, b) => (b.seal || 0) - (a.seal || 0)).slice(0, 8) },
      { key: 'weak', name: '弱转强战法', desc: '首板晋级二板（新晋连板）的标的，由弱转强、开启主升预期。', pick: () => d.stocks.filter((s) => (s.boards || 1) === 2).sort((a, b) => b.probability - a.probability).slice(0, 8) }
    ];
    tactics.forEach((tac) => {
      const card = el('div', 'card tactic-card');
      card.innerHTML = `<h3><span class="bar"></span>${tac.name}</h3><div class="tiny" style="margin-bottom:8px">${tac.desc}</div>`;
      const box = el('div');
      const items = tac.pick();
      if (!items.length) box.appendChild(el('div', 'empty', '暂无匹配标的'));
      items.forEach((s) => box.appendChild(stockRow(s)));
      card.appendChild(box);
      root.appendChild(card);
    });
  }

  // =========================================================================
  // 渲染：龙虎榜
  // =========================================================================
  async function renderLhb() {
    const root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const board = state.lhbBoard;
    let data = state.lhbCache[board];
    if (!data) { data = await window.YGData.getLhb(board); state.lhbCache[board] = data; }
    const card = el('div', 'card');
    const chips = el('div', 'sectors');
    [['all', '全部榜'], ['org', '机构榜'], ['hot_money', '游资榜']].forEach(([v, t]) => {
      const c = el('div', 'sector-chip' + (v === board ? ' active' : ''), t);
      c.onclick = () => { state.lhbBoard = v; renderLhb(); };
      chips.appendChild(c);
    });
    card.innerHTML = `<h3><span class="bar"></span>龙虎榜 ${data.date ? '（' + data.date + '）' : ''}</h3>`;
    card.appendChild(chips);
    root.appendChild(card);

    if (board === 'hot_money' && data.dept && data.dept.length) {
      data.dept.forEach((dep) => {
        const dc = el('div', 'card');
        dc.innerHTML = `<div class="name" style="font-weight:700">${dep.name} <span class="tiny">本席买入 ${yuanYi(dep.buying)}</span></div>`;
        const rows = el('div');
        (dep.rows || []).slice(0, 8).forEach((r) => {
          const rr = el('div', 'stock-row');
          rr.innerHTML = `
            <div style="flex:1;min-width:0"><div class="name">${r.name}</div><div class="code">${r.thscode} · ${(r.concept_list || []).map((c) => c.name).join('/') || '—'}</div></div>
            <div style="text-align:right"><div class="price">${lhbChg(r.change)}</div><div class="tiny" style="color:${pctColor(r.net_value)};font-weight:700">净额${yuanYi(r.net_value)}</div></div>`;
          rr.style.cursor = 'pointer'; rr.onclick = () => { const s = findStock(r.ticker); if (s) openDetail(s.code); };
          rows.appendChild(rr);
        });
        dc.appendChild(rows);
        root.appendChild(dc);
      });
      return;
    }

    const tbl = el('div', 'card');
    const items = data.items || [];
    if (!items.length) tbl.appendChild(el('div', 'empty', '该榜单暂无数据'));
    items.slice(0, 40).forEach((x, i) => {
      const r = el('div', 'stock-row');
      r.innerHTML = `
        <div style="width:22px;color:var(--ink-3);text-align:center">${i + 1}</div>
        <div style="flex:1;min-width:0"><div class="name">${x.name}</div><div class="code">${x.thscode} · ${(x.concept_list || []).map((c) => c.name).join('/') || '—'}</div></div>
        <div style="text-align:right;min-width:96px">
          <div class="price">${lhbChg(x.change)}</div>
          <div class="tiny" style="color:${pctColor(x.net_value)};font-weight:700">净额${yuanYi(x.net_value)}</div>
          <div class="tiny">游资${yuanYi(x.hot_money_net_value)} · 机构${yuanYi(x.org_net_value)}</div>
        </div>`;
      r.style.cursor = 'pointer'; r.onclick = () => { const s = findStock(x.ticker); if (s) openDetail(s.code); };
      tbl.appendChild(r);
    });
    root.appendChild(tbl);
  }

  // =========================================================================
  // 渲染：主力资金（龙虎榜净额 + 板块聚合 + 封单）
  // =========================================================================
  function renderCapital() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const hint = el('div', 'card');
    hint.innerHTML = `<div class="disclaimer">数据来源：① 涨停强度与晋级统计（limit-up-statistics，真实接口）——封板率 / 炸板家数 / 连板晋级率；② 龙虎榜个股净额（真实）；③ 涨停池封单强度（真实）。涨停池接口未直接提供「主力净流入」字段，故以龙虎榜净额与封单锁定程度近似表征资金态度。</div>`;
    root.appendChild(hint);

    // 涨停强度与晋级（limit-up-statistics 真实数据）
    const stats = d.stats;
    if (stats) {
      const sr = stats.seal_rate != null ? (Math.round(stats.seal_rate * 1000) / 10) + '%' : '—';
      const card = el('div', 'card');
      card.innerHTML = `<h3><span class="bar"></span>涨停强度与晋级（limit-up-statistics 真实数据）</h3>
        <div class="cap-stats-kpis">
          <div class="ov-item"><div class="v brand">${sr}</div><div class="l">封板率</div></div>
          <div class="ov-item"><div class="v up">${stats.limit_up_stock_count != null ? stats.limit_up_stock_count : '—'}</div><div class="l">涨停家数</div></div>
          <div class="ov-item"><div class="v down">${stats.open_stock_count != null ? stats.open_stock_count : '—'}</div><div class="l">炸板家数</div></div>
          <div class="ov-item"><div class="v">${stats.touched_limit_up_stock_count != null ? stats.touched_limit_up_stock_count : '—'}</div><div class="l">触及涨停</div></div>
        </div>`;
      const lvlLabel = { one: '首板', two: '2板', three: '3板', four: '4板', five_plus: '5板+' };
      const pb = stats.page_boards || [];
      if (pb.length) {
        const maxCnt = Math.max(1, ...pb.map((x) => x.stock_count || 0));
        let bars = '<div class="section-title">连板晋级（页面档位口径 · 晋级率）</div><div class="promo-bars">';
        pb.forEach((x) => {
          const cnt = x.stock_count || 0;
          const pct = (cnt / maxCnt) * 100;
          const pr = x.promotion_rate != null ? (Math.round(x.promotion_rate * 1000) / 10) + '%' : '—';
          bars += `<div class="promo-row"><div class="promo-label">${lvlLabel[x.board_level] || x.board_level}</div>`
            + `<div class="promo-track"><div class="promo-fill" style="width:${pct}%"></div></div>`
            + `<div class="promo-cnt">${cnt}只</div>`
            + `<div class="promo-rate">晋级 ${pr}</div></div>`;
        });
        bars += '</div>';
        card.appendChild(el('div', null, bars));
      }
      const eb = (stats.exact_boards || []).slice().sort((a, b) => b.board_num - a.board_num);
      if (eb.length) {
        let ex = '<div class="section-title">精确连板家数</div><div class="exact-boards">';
        eb.forEach((x) => { ex += `<span class="exact-chip">${x.board_num}板<b>${x.stock_count}</b>只</span>`; });
        ex += '</div>';
        card.appendChild(el('div', null, ex));
      }
      card.appendChild(el('div', 'tiny', `数据日期：${stats.trade_date || d.date} · 来源：limit-up-statistics（${stats.source === 'api' ? '实时·同花顺' : '演示'}）`));
      root.appendChild(card);
    }

    // 龙虎榜净买入 TOP
    const top = el('div', 'card');
    top.innerHTML = `<h3><span class="bar"></span>龙虎榜净买入 TOP</h3>`;
    const lhb = (d.lhb || []).slice().sort((a, b) => (b.net_value || 0) - (a.net_value || 0)).slice(0, 15);
    if (!lhb.length) top.appendChild(el('div', 'empty', '暂无龙虎榜数据'));
    lhb.forEach((x, i) => {
      const r = el('div', 'stock-row');
      r.innerHTML = `<div style="width:22px;color:var(--ink-3);text-align:center">${i + 1}</div>
        <div style="flex:1;min-width:0"><div class="name">${x.name}</div><div class="code">${(x.concept_list || []).map((c) => c.name).join('/') || '—'}</div></div>
        <div style="text-align:right"><div class="price" style="color:${pctColor(x.net_value)};font-weight:700">${yuanYi(x.net_value)}</div><div class="tiny">买入${yuanYi(x.buy_value)} / 卖出${yuanYi(x.sell_value)}</div></div>`;
      top.appendChild(r);
    });
    root.appendChild(top);

    // 板块资金热力（按概念聚合龙虎榜净额）
    const agg = {};
    (d.lhb || []).forEach((x) => { (x.concept_list || []).forEach((c) => { agg[c.name] = (agg[c.name] || 0) + (x.net_value || 0); }); });
    const secArr = Object.entries(agg).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, 12);
    if (secArr.length) {
      const sc = el('div', 'card');
      sc.innerHTML = `<h3><span class="bar"></span>板块资金热力（龙虎榜净额）</h3>`;
      const max = Math.max(...secArr.map((x) => Math.abs(x.v)), 1);
      secArr.forEach((x) => {
        const pct = (Math.abs(x.v) / max) * 100;
        const bar = el('div', 'capbar');
        bar.innerHTML = `<div class="capbar-label">${x.k}</div><div class="capbar-track"><div class="capbar-fill ${x.v >= 0 ? 'up' : 'down'}" style="width:${pct}%"></div></div><div class="capbar-val ${x.v >= 0 ? 'up' : 'down'}">${yuanYi(x.v)}</div>`;
        sc.appendChild(bar);
      });
      root.appendChild(sc);
    }

    // 涨停封单强度 TOP
    const seal = el('div', 'card');
    seal.innerHTML = `<h3><span class="bar"></span>涨停封单强度 TOP（资金锁定）</h3>`;
    d.stocks.slice().sort((a, b) => (b.seal || 0) - (a.seal || 0)).slice(0, 12).forEach((s) => {
      const r = el('div', 'stock-row');
      r.innerHTML = `<div style="flex:1;min-width:0"><div class="name">${s.name} <span class="tiny">${s.continueText || (s.boards + '板')}</span></div><div class="code">${s.code}</div></div>
        <div style="text-align:right"><div class="price" style="font-weight:700">${fmt(s.seal / 10000, 2)}亿</div></div>`;
      r.style.cursor = 'pointer'; r.onclick = () => openDetail(s.code);
      seal.appendChild(r);
    });
    root.appendChild(seal);
  }

  // =========================================================================
  // 渲染：历史妖股（历史热股榜）
  // =========================================================================
  async function renderHistory() {
    const root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>历史妖股（历史热股榜）</h3>
      <div class="tiny" style="margin-bottom:8px">按自然日回看历史热股/人气榜（同花顺热榜）。可切换日期复盘当时的人气龙头。</div>`;
    const line = el('div', 'filter-line');
    line.innerHTML = '<label>日期</label>';
    const inp = el('input'); inp.type = 'date'; inp.value = state.historyDate || state.data.date;
    const btn = el('button', 'btn ghost', '查看'); btn.style.marginLeft = '8px'; btn.style.width = 'auto';
    btn.onclick = async () => {
      state.historyDate = inp.value;
      const h = await window.YGData.getHotHistory(inp.value);
      state.historyItems = h; renderHistoryList(h);
    };
    line.appendChild(inp); line.appendChild(btn);
    card.appendChild(line);
    root.appendChild(card);

    const listCard = el('div', 'card');
    listCard.innerHTML = `<h3><span class="bar"></span>榜单</h3><div id="histList"></div>`;
    root.appendChild(listCard);
    const h = state.historyItems || await (async () => { const r = await window.YGData.getHotHistory(state.historyDate || state.data.date); state.historyItems = r; return r; })();
    renderHistoryList(h);
  }
  function renderHistoryList(h) {
    const box = $('#histList'); if (!box) return;
    const items = h.items || [];
    if (!items.length) { box.innerHTML = '<div class="empty">该日期暂无历史热股数据</div>'; return; }
    box.innerHTML = '';
    items.slice(0, 40).forEach((x, i) => {
      const r = el('div', 'monster-row');
      r.innerHTML = `<span class="rank-badge">${i + 1}</span>
        <div style="flex:1"><div class="name">${x.name || '—'}</div><div class="code">${x.thscode || ''}</div></div>
        <div style="text-align:right"><div class="tiny">人气排名</div></div>`;
      box.appendChild(r);
    });
    if (h.source === 'demo') box.appendChild(el('div', 'tiny', '（演示数据）'));
  }

  // =========================================================================
  // 渲染：妖股透视（个股深度）
  // =========================================================================
  function renderXray() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>妖股透视</h3><div class="tiny" style="margin-bottom:8px">选择一只个股，深度透视其连板逻辑、多因子、龙虎榜与人气信号。</div>`;
    const sel = el('select');
    const top = d.stocks.slice().sort((a, b) => b.probability - a.probability).slice(0, 50);
    sel.appendChild(el('option', null, '— 选择个股 —'));
    top.forEach((s) => { const o = el('option', null, `${s.name}（${s.probability}%）`); o.value = s.code; if (s.code === state.xrayCode) o.selected = true; sel.appendChild(o); });
    const line = el('div', 'filter-line'); line.innerHTML = '<label>个股</label>'; line.appendChild(sel);
    card.appendChild(line);
    const box = el('div', 'xray-box'); box.id = 'xrayBox';
    card.appendChild(box);
    root.appendChild(card);
    sel.onchange = () => { state.xrayCode = sel.value; renderXrayDetail(); };
    if (state.xrayCode && findStock(state.xrayCode)) renderXrayDetail();
  }
  async function renderXrayDetail() {
    const box = $('#xrayBox'); if (!box) return;
    const s = findStock(state.xrayCode); if (!s) { box.innerHTML = ''; return; }
    const token = ++state.xrayToken;
    const info = signalInfo();
    const lhb = info.lhb[s.thscode], hot = info.hot[s.thscode];
    box.innerHTML = `
      <div class="modal-head" style="margin:6px 0 10px">
        <div><div class="name" style="font-size:18px;font-weight:700">${s.name}</div><div class="code">${s.thscode} · ${s.sector}</div></div>
        <div style="flex:1"></div>
        <div style="text-align:right"><div class="price" style="font-size:20px;font-weight:800">${fmt(s.price)}</div><div style="color:var(--up);font-weight:700">${pctTxt(s.changePct)}</div></div>
      </div>
      <div class="prob-hero">
        <div><div class="tiny">妖股评分</div><div class="num">${s.probability}<span class="tiny">/100</span>${s.scores && s.scores.rating ? `<span class="rating-badge badge-${s.scores.rating}">${s.scores.rating}</span>` : ''}</div></div>
        <div style="flex:1"><div class="tiny">${s.continueText || (s.boards + '连板')} · ${s.limitType === 1 ? '一字/秒板' : '换手板'}</div>
          <div style="margin-top:6px">${signalBadges(s, info) || '<span class="tiny">仅连板信号</span>'}</div></div>
      </div>
      ${s.scores && s.scores.verdict ? `<div class="verdict-badge v-${s.scores.verdict.cls}" style="margin:2px 0 10px">研判：${s.scores.verdict.label}</div>` : ''}
      <div class="dmeta" style="margin:0 0 10px"><b>数据时刻：</b>${fmtDataMeta(s)}</div>
      <div class="radar-wrap"><canvas id="xrayRadar"></canvas></div>
      <div class="section-title">多因子评分</div>
      <div class="kv" id="xrayKV"></div>
      <div class="section-title">连板逻辑</div>
      <div class="reason-box">${s.reason}</div>
      <div class="section-title">四维总览卡片（趋势 / 异动 / 机构 / 热度）</div>
      <div class="xray-ov" id="xrayOverview"><div class="tiny">汇总中…</div></div>
      <div class="section-title">真实 K 线（日线·前复权，约近半年）</div>
      <canvas id="xrayKline" style="width:100%;height:180px"></canvas>
      <div class="section-title">资金与席位（龙虎榜口径）</div>
      <div class="kv">
        <div><div class="k">封单额</div><div class="val">${s.seal ? fmt(s.seal / 10000, 2) + '亿' : '—'}</div></div>
        <div><div class="k">龙虎榜净额</div><div class="val" style="color:${pctColor(lhb ? lhb.net_value : null)}">${lhb ? yuanYi(lhb.net_value) : '未上榜'}</div></div>
        <div><div class="k">机构净额</div><div class="val" style="color:${pctColor(lhb ? lhb.org_net_value : null)}">${lhb ? yuanYi(lhb.org_net_value) : '—'}</div></div>
        <div><div class="k">游资净额</div><div class="val" style="color:${pctColor(lhb ? lhb.hot_money_net_value : null)}">${lhb ? yuanYi(lhb.hot_money_net_value) : '—'}</div></div>
        <div><div class="k">人气排名</div><div class="val">${hot ? '第 ' + hot.rank + ' 名' : '未入榜'}</div></div>
        <div><div class="k">热度</div><div class="val">${hot ? heatTxt(hot.heat) : '—'}</div></div>
      </div>
      <div class="section-title">异动原因（同花顺解读）</div>
      <div id="xrayAnomaly" class="reason-box">加载中…</div>
      <div class="section-title">机构席位明细（龙虎榜）</div>
      <div id="xrayInst" class="reason-box">加载中…</div>
      <div class="section-title">热度排名走势（近30日）</div>
      <canvas id="xrayRank" style="width:100%;height:120px"></canvas>`;
    const kv = $('#xrayKV', box);
    (s.scores ? s.scores.factors : []).forEach((fct) => {
      const item = el('div'); item.innerHTML = `<div class="k">${fct.label}</div><div class="val">${fct.value} <span class="tiny">/${fct.max}</span>${fct.raw ? `<div class="tiny" style="color:var(--muted,#8a8f9d)">${fct.raw}</div>` : ''}</div>`; kv.appendChild(item);
    });
    drawRadar($('#xrayRadar', box), (s.scores ? s.scores.factors : []).map((x) => ({ label: x.label, value: x.max ? x.value / x.max * 100 : x.value })));

    // 缓存：同一股票不重复打接口（避免自动刷新刷爆额度）
    if (!state.xrayCache[s.thscode]) {
      const end = Date.now(), start = end - 160 * 86400000;
      const [k, an, inst, rank] = await Promise.all([
        window.YGData.getKline(s.thscode, start, end),
        window.YGData.getAnomaly(s.thscode),
        window.YGData.getInstitution(s.thscode),
        window.YGData.getRankTrend(s.thscode, fmtDate(Date.now() - 30 * 86400000), fmtDate(Date.now()))
      ]);
      if (token !== state.xrayToken) return;
      state.xrayCache[s.thscode] = { k, an, inst, rank };
    }
    const c = state.xrayCache[s.thscode];
    renderXrayOverview(box, c, s);
    drawCandle($('#xrayKline', box), c.k.item);
    const anBox = $('#xrayAnomaly', box);
    anBox.innerHTML = (c.an && c.an.items && c.an.items.length)
      ? c.an.items.map((it) => `<div class="an-item"><b>${it.tag_name || '异动'}</b> · ${it.stock_name || ''}：${it.analysis_content || '—'}</div>`).join('') || '暂无解读'
      : '暂无异动解读（当日未触发异动标签）';
    const instBox = $('#xrayInst', box);
    instBox.innerHTML = renderInstitution(c.inst);
    drawRankLine($('#xrayRank', box), c.rank.item);
  }

  function renderInstitution(inst) {
    if (!inst || !inst.item || !inst.item.length) return '该股票近期无龙虎榜机构席位记录（或当日数据未就绪）。';
    return inst.item.map((rec) => {
      const deps = (rec.buy_departments || []).slice(0, 5).map((dp) => dp.name).join('、') || '—';
      const net = rec.org_net_value != null ? yuanYi(rec.org_net_value) : '—';
      return `<div class="inst-item">
        <div><b>${rec.range_days === 3 ? '三日榜' : '当日榜'}</b>（${rec.start_date || ''} ~ ${rec.end_date || ''}）</div>
        <div class="tiny">机构净买入 <b style="color:${pctColor(rec.org_net_value)}">${net}</b> · 净占比 ${rec.org_net_rate != null ? (rec.org_net_rate * 100).toFixed(2) + '%' : '—'} · 买 ${rec.org_buy_num || 0} / 卖 ${rec.org_sell_num || 0} 家</div>
        <div class="tiny">买入席位：${deps}</div>
      </div>`;
    }).join('');
  }

  // ---------- 妖股透视：四维总览卡片（趋势 / 异动 / 机构 / 热度）----------
  function xrayOvQ(label, val, sub, cls) {
    return `<div class="xray-ov-q"><div class="xray-ov-label">${label}</div>`
      + `<div class="xray-ov-val ${cls || ''}">${val}</div>`
      + `<div class="xray-ov-sub">${sub}</div></div>`;
  }
  function clip(s, n) { s = s || ''; return s.length > n ? s.slice(0, n) + '…' : s; }
  function renderXrayOverview(box, c, s) {
    const ov = $('#xrayOverview', box); if (!ov) return;
    const k = (c.k && c.k.item) || [];
    let trendChg = null, hi = null, lo = null;
    if (k.length >= 2) {
      const first = k[0].close, last = k[k.length - 1].close;
      trendChg = first ? (last / first - 1) * 100 : null;
      hi = k.reduce((m, b) => Math.max(m, b.high), -Infinity);
      lo = k.reduce((m, b) => Math.min(m, b.low), Infinity);
    }
    const an = (c.an && c.an.items && c.an.items[0]) || null;
    const inst = (c.inst && c.inst.item && c.inst.item[0]) || null;
    const rk = (c.rank && c.rank.item) || [];
    const curRank = rk.length ? rk[rk.length - 1].rank : null;
    const firstRank = rk.length ? rk[0].rank : null;
    const rankDelta = (curRank != null && firstRank != null) ? (firstRank - curRank) : null;
    let html = '<div class="xray-ov-grid">';
    html += xrayOvQ('📈 趋势', trendChg != null ? (trendChg >= 0 ? '+' : '') + trendChg.toFixed(1) + '%' : '—',
      k.length >= 2 ? `${k.length}日 高${fmt(hi)}/低${fmt(lo)}` : '暂无 K线', trendChg != null ? (trendChg >= 0 ? 'up' : 'down') : '');
    html += xrayOvQ('🔥 异动', an ? (an.tag_name || '异动') : '无标签',
      an ? clip(an.analysis_content || '', 22) : '当日未触发异动', an ? 'hot' : '');
    html += xrayOvQ('🏦 机构', inst ? yuanYi(inst.org_net_value) : '未上榜',
      inst ? `买${inst.org_buy_num || 0}/卖${inst.org_sell_num || 0} 家` : '无龙虎榜记录',
      inst ? (inst.org_net_value >= 0 ? 'up' : 'down') : '');
    html += xrayOvQ('🌡 热度', curRank != null ? '第 ' + curRank + ' 名' : '未入榜',
      rankDelta != null ? (rankDelta >= 0 ? '近30日升温 ' + rankDelta + ' 位' : '近30日降温 ' + Math.abs(rankDelta) + ' 位') : '暂无走势',
      curRank != null ? 'hot' : '');
    html += '</div>';
    ov.innerHTML = html;
  }

  // =========================================================================
  // 渲染：自选
  // =========================================================================
  async function renderWatch() {
    const root = $('#view'); root.innerHTML = '';
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>我的自选（${state.watch.length}）</h3>`;
    if (!state.watch.length) {
      card.appendChild(el('div', 'empty', '还没有自选股。在任意页面点击 ☆ 加入。'));
      root.appendChild(card); return;
    }
    const box = el('div'); card.appendChild(box); root.appendChild(card);
    // 池内：直接用涨停池数据（含妖股概率）；池外：拉实时行情照常展示，不再隐藏
    const inPool = [], missing = [];
    state.watch.forEach((code) => { const s = findStock(code); if (s) inPool.push(s); else missing.push(code); });
    inPool.forEach((s) => box.appendChild(stockRow(s)));
    if (!missing.length) return;
    box.appendChild(el('div', 'tiny', '以下自选今日不在涨停池中，显示实时行情（东方财富数据）：'));
    const holder = el('div'); holder.innerHTML = '<div class="tiny">行情加载中…</div>'; box.appendChild(holder);
    let q = {};
    try { q = await window.YGData.getWatchQuotes(missing) || {}; } catch (e) { /* 空对象兜底 */ }
    if (state.tab !== 'watch') return; // 用户已切走，丢弃渲染
    holder.innerHTML = '';
    let shown = 0;
    missing.forEach((code) => {
      const d = q[code];
      const row = el('div', 'monster-row');
      if (!d || d.price == null) {
        row.innerHTML = `<div style="flex:1;min-width:0"><div class="name">${code}</div><div class="code">行情获取失败（停牌/代码异常/网络受限）</div></div>
          <div style="width:18px;text-align:center;color:var(--gold);font-size:16px;cursor:pointer" data-star>★</div>`;
      } else {
        shown++;
        const pct = d.changePct;
        const color = pct > 0 ? 'var(--up)' : (pct < 0 ? 'var(--down)' : 'inherit');
        row.innerHTML = `<div style="width:18px;text-align:center;color:var(--gold);font-size:16px;cursor:pointer" data-star>★</div>
          <div style="flex:1;min-width:0"><div class="name">${d.name}</div><div class="code">${code} · 换手${fmt(d.turnover)}% · 量比${fmt(d.volumeRatio)} · 成交${d.amount != null ? fmt(d.amount) + '亿' : '—'}</div></div>
          <div style="text-align:right"><div class="price">${fmt(d.price)}</div><div style="color:${color};font-weight:700">${pctTxt(pct)}</div></div>`;
      }
      row.querySelector('[data-star]').onclick = (e) => { e.stopPropagation(); toggleWatch(code); renderWatch(); };
      holder.appendChild(row);
    });
    if (!shown && !missing.some((c) => q[c])) holder.appendChild(el('div', 'empty', '实时行情加载失败，请检查网络后重试'));
  }

  // =========================================================================
  // 渲染：设置
  // =========================================================================
  function renderSettings() {
    const root = $('#view'); root.innerHTML = '';
    const api = window.YGData.getApi();
    const disc = el('div', 'card');
    disc.innerHTML = `<h3><span class="bar"></span>风险提示</h3>
      <div class="disclaimer">本应用为连板数据的<b>可视化分析工具</b>，「妖股概率」为基于连板高度、封单、题材热度等公开数据的<b>统计参考</b>，<b>不构成任何投资建议</b>。股市有风险，决策需谨慎，盈亏自负。</div>`;
    root.appendChild(disc);

    const cfg = el('div', 'card');
    cfg.innerHTML = `<h3><span class="bar"></span>数据源（同花顺金融数据API）</h3>
      <div class="tiny" style="margin-bottom:8px">接口地址默认 <b>https://fuyao.aicubes.cn</b>，鉴权通过请求头 <b>X-api-key</b>。关闭开关即使用内置演示数据。</div>`;
    const f = el('div', 'api-box');
    const rowEn = el('div', 'filter-line'); rowEn.innerHTML = '<label>启用</label>';
    const enSel = el('select');
    [['1', '启用真实数据'], ['0', '仅演示数据']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if ((v === '1') === !!api.enabled) o.selected = true; enSel.appendChild(o); });
    rowEn.appendChild(enSel);
    const inpBase = el('input'); inpBase.placeholder = 'API 地址'; inpBase.value = api.base || '';
    const inpKey = el('input'); inpKey.placeholder = 'API Key（sk-fuyao-...）'; inpKey.value = api.key || ''; inpKey.type = 'text';
    const lineK = el('div', 'filter-line'); lineK.innerHTML = '<label>Key</label>'; lineK.appendChild(inpKey);
    const status = el('div', 'tiny', '');
    const saveBtn = el('button', 'btn', '保存并刷新');
    const testBtn = el('button', 'btn ghost', '测试连接');
    const clearBtn = el('button', 'btn ghost', '清除内置 Key');
    saveBtn.onclick = () => { window.YGData.setApi({ base: inpBase.value.trim(), key: inpKey.value.trim(), enabled: enSel.value === '1' }); loadData(); };
    testBtn.onclick = async () => {
      status.textContent = '测试中…';
      window.YGData.setApi({ base: inpBase.value.trim(), key: inpKey.value.trim(), enabled: enSel.value === '1' });
      const dd = await window.YGData.getDaily();
      status.innerHTML = dd.source === 'api' ? `连接成功 ✓ 已获取 ${dd.stocks.length} 只涨停股（${dd.date}）` : `未取到真实数据：${dd.notice || '已回退演示数据'}`;
    };
    clearBtn.onclick = () => { window.YGData.setApi({ base: 'https://fuyao.aicubes.cn', key: '', enabled: false }); inpKey.value = ''; enSel.value = '0'; status.textContent = '已清除 Key，改用演示数据。'; };
    f.appendChild(rowEn); f.appendChild(inpBase); f.appendChild(lineK); f.appendChild(saveBtn); f.appendChild(testBtn); f.appendChild(clearBtn);
    cfg.appendChild(f);
    const warn = el('div', 'disclaimer');
    warn.style.marginTop = '10px'; warn.style.background = '#fff4e5'; warn.style.borderColor = '#ffd8a8'; warn.style.color = '#8a5a00';
    warn.innerHTML = '⚠️ 安全提示：Key 保存在浏览器本地(localStorage)并用于直连接口。当前为纯前端方案，Key 会出现在浏览器请求中——<b>仅适合本机个人使用</b>。若要对外部署，请改由你自己的后端代理转发，避免 Key 泄露。';
    cfg.appendChild(warn);
    root.appendChild(cfg);

    const ar = el('div', 'card');
    ar.innerHTML = `<h3><span class="bar"></span>自动刷新</h3>`;
    const arLine = el('div', 'filter-line'); arLine.innerHTML = '<label>自动刷新</label>';
    const arSel = el('select');
    [['0', '关闭'], ['1', '开启']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if ((v === '1') === state.autoRefresh) o.selected = true; arSel.appendChild(o); });
    arLine.appendChild(arSel);
    const arRateLine = el('div', 'filter-line'); arRateLine.innerHTML = '<label>刷新频率</label>';
    const arRateSel = el('select');
    [5, 10, 30, 60].forEach((s) => { const o = el('option', null, s + ' 秒'); o.value = s; if (s === state.refreshSec) o.selected = true; arRateSel.appendChild(o); });
    arRateLine.appendChild(arRateSel);
    const arHint = el('div', 'tiny', '开启后按设定频率自动拉取最新数据。进入「设置」页时会完全暂停刷新（不再调用接口），以免打断输入框填写与浪费额度。');
    arSel.onchange = () => { state.autoRefresh = arSel.value === '1'; saveAutoRefresh(); state.autoRefresh ? startAutoRefresh() : stopAutoRefresh(); updateTopbar(); };
    arRateSel.onchange = () => { state.refreshSec = parseInt(arRateSel.value, 10); saveRefreshSec(); if (state.autoRefresh) startAutoRefresh(); updateTopbar(); };
    ar.appendChild(arLine); ar.appendChild(arRateLine); ar.appendChild(arHint);
    root.appendChild(ar);

    const about = el('div', 'card');
    about.innerHTML = `<h3><span class="bar"></span>关于</h3>
      <div class="tiny">妖股雷达 · 响应式 H5<br>数据源：同花顺金融数据 API（涨停池 / 涨停统计 / 跌停池 / 龙虎榜 / 热股榜 / 历史热股）<br>内置演示数据，非投资建议。</div>`;
    root.appendChild(about);
  }

  // =========================================================================
  // 详情弹层
  // =========================================================================
  function openDetail(code) {
    const s = findStock(code); if (!s) return;
    const m = $('#modal');
    const limitTxt = s.limitType === 1 ? '一字/秒板' : '换手板';
    const tags = (s.concepts || []).map((c) => `<span class="tag">${c}</span>`).join('') + (s.isNew ? '<span class="tag">未开板新股</span>' : '');
    m.innerHTML = `
      <button class="close" id="modalClose">×</button>
      <div class="modal-head">
        <div><div class="name" style="font-size:18px;font-weight:700">${s.name}</div><div class="code">${s.code} · ${s.sector}</div></div>
        <div style="flex:1"></div>
        <div style="text-align:right"><div class="price" style="font-size:20px;font-weight:800">${fmt(s.price)}</div><div style="color:var(--up);font-weight:700">${pctTxt(s.changePct)}</div></div>
      </div>
      <div class="prob-hero">
        <div><div class="tiny">妖股评分</div><div class="num">${s.probability}<span class="tiny">/100</span>${s.scores && s.scores.rating ? `<span class="rating-badge badge-${s.scores.rating}">${s.scores.rating}</span>` : ''}</div></div>
        <div style="flex:1"><div class="tiny">${s.continueText || (s.boards + '连板')} · ${limitTxt}${s.firstTime ? ' · 首封 ' + s.firstTime : ''}</div><div style="margin-top:6px">${tags}</div></div>
      </div>
      ${s.scores && s.scores.verdict ? `<div class="verdict-badge v-${s.scores.verdict.cls}" style="margin:2px 0 10px">研判：${s.scores.verdict.label}</div>` : ''}
      ${(() => { const t = riskTagsHtml(s, signalInfo()); return t ? `<div class="rtags" style="margin:0 0 10px">${t}</div>` : ''; })()}
      <div class="radar-wrap"><canvas id="radarCanvas"></canvas></div>
      <div class="section-title">多因子评分</div>
      <div class="kv" id="factorKV"></div>
      <div class="section-title">真实 K 线（日线·前复权，约近半年）</div>
      <canvas id="sparkCanvas" style="width:100%;height:160px"></canvas>
      <div class="section-title">连板逻辑</div>
      <div class="reason-box">${s.reason}</div>
      <div class="section-title">盘口与资金</div>
      <div class="kv">
        <div><div class="k">涨停时间</div><div class="val">${s.firstTime || '—'}</div></div>
        <div><div class="k">封单额</div><div class="val">${s.seal ? fmt(s.seal / 10000, 2) + '亿' : '—'}</div></div>
        <div><div class="k">峰值封单</div><div class="val">${s.maxSeal ? fmt(s.maxSeal / 10000, 2) + '亿' : '—'}</div></div>
        <div><div class="k">换手率</div><div class="val">${s.turnover != null ? s.turnover + '%' : '—'}</div></div>
        <div><div class="k">主力净流入</div><div class="val" style="color:${s.mainFlow != null ? pctColor(s.mainFlow) : 'inherit'}">${s.mainFlow != null ? (s.mainFlow >= 0 ? '+' : '') + fmt(s.mainFlow / 10000, 2) + '亿' : '—'}</div></div>
        <div><div class="k">总市值</div><div class="val">${s.cap != null ? fmt(s.cap, 0) + '亿' : '—'}</div></div>
      </div>
      <button class="btn ${isWatch(s.code) ? 'ghost' : ''}" id="watchBtn" style="margin-top:16px">${isWatch(s.code) ? '★ 已加自选（点击取消）' : '☆ 加入自选'}</button>`;
    const kv = $('#factorKV', m);
    (s.scores ? s.scores.factors : []).forEach((fct) => { const item = el('div'); item.innerHTML = `<div class="k">${fct.label}</div><div class="val">${fct.value} <span class="tiny">/${fct.max}</span>${fct.raw ? `<div class="tiny" style="color:var(--muted,#8a8f9d)">${fct.raw}</div>` : ''}</div>`; kv.appendChild(item); });
    $('#modalClose', m).onclick = closeDetail;
    $('#modalMask').classList.add('show');
    drawRadar($('#radarCanvas', m), (s.scores ? s.scores.factors : []).map((x) => ({ label: x.label, value: x.max ? x.value / x.max * 100 : x.value })));
    const sc = $('#sparkCanvas', m);
    if (s.thscode) {
      const end = Date.now(), start = end - 160 * 86400000;
      window.YGData.getKline(s.thscode, start, end).then((k) => { if ($('#sparkCanvas', m)) drawCandle($('#sparkCanvas', m), k.item); });
    } else { drawSpark(sc, s); }
    const wb = $('#watchBtn', m);
    wb.onclick = () => { toggleWatch(s.code); wb.textContent = isWatch(s.code) ? '★ 已加自选（点击取消）' : '☆ 加入自选'; wb.className = 'btn ' + (isWatch(s.code) ? 'ghost' : ''); };
  }
  function closeDetail() { $('#modalMask').classList.remove('show'); }

  function noticeBanner() {
    if (!state.data || !state.data.notice) return null;
    return el('div', 'card', `<div class="disclaimer">${state.data.notice}</div>`);
  }

  // =========================================================================
  // 路由
  // =========================================================================
  function switchTab(tab) {
    state.tab = tab;
    $$('.modnav .chip').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $$('.sidebar .nav-item').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    render(); window.scrollTo(0, 0);
  }
  function render() {
    if (!state.data) { $('#view').innerHTML = '<div class="empty">数据加载中…</div>'; return; }
    const map = { radar: renderRadar, review: renderReview, ladder: renderLadder, scan: renderScan, tactics: renderTactics, lhb: renderLhb, capital: renderCapital, history: renderHistory, xray: renderXray, watch: renderWatch, settings: renderSettings };
    (map[state.tab] || renderRadar)();
  }

  function buildShell() {
    const app = $('#app');
    const navItems = ORDER.map((k) => `<div class="nav-item" data-tab="${k}"><span class="ic">${ICON[k]}</span>${TABS[k]}</div>`).join('');
    const chips = ORDER.map((k) => `<div class="chip" data-tab="${k}"><span class="ic">${ICON[k]}</span>${TABS[k]}</div>`).join('');
    app.innerHTML = `
      <aside class="sidebar">
        <div class="logo">📡 妖股雷达</div>
        ${navItems}
      </aside>
      <div class="main">
        <header class="topwrap">
          <div class="topbar">
            <div class="tb-left">
              <h1>妖股雷达</h1>
              <div class="date" id="topDate"></div>
            </div>
            <div class="tb-right">
              <span class="source-tag" id="topSource"></span>
              <span class="updated" id="topUpdated"></span>
              <button class="refresh-btn" id="refreshBtn" title="刷新数据" aria-label="刷新">⟳</button>
            </div>
          </div>
          <div class="modnav">${chips}</div>
        </header>
        <div class="content" id="view"></div>
      </div>
      <div class="modal-mask" id="modalMask"><div class="modal" id="modal"></div></div>`;
    $$('.modnav .chip').forEach((t) => t.onclick = () => switchTab(t.dataset.tab));
    $$('.sidebar .nav-item').forEach((t) => t.onclick = () => switchTab(t.dataset.tab));
    $('#refreshBtn').onclick = () => refreshAll();
    $('#modalMask').onclick = (e) => { if (e.target.id === 'modalMask') closeDetail(); };
  }

  async function init() {
    loadWatch(); loadAutoRefresh();
    buildShell();
    await loadData();
    switchTab('radar');
    if (state.autoRefresh) startAutoRefresh();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
