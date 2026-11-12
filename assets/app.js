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

  const ICON = { v_dash: '🌡️', v_topic: '🔥', v_turn: '⚡', v_sw: '🔀', v_sec: '🎯', v_plan: '💼', v_rep: '📋', more: '⋯',
    radar: '🎯', plan: '📋', journal: '📰', review: '📒', ladder: '🪜', scan: '🔍', tactics: '⚔️', lhb: '🐉', capital: '💰', history: '📜', xray: '🔬', watch: '⭐', handbook: '📖', toolbox: '🧮', settings: '⚙️' };
  const TABS = {
    v_dash: '周期判定', v_topic: '题材热点', v_turn: '拐点识别', v_sw: '主线切换', v_sec: '主线·龙头·中军·补涨', v_plan: '操作策略', v_rep: '复盘报告', more: '更多',
    radar: '妖股雷达', plan: '交易计划', journal: '复盘文章', review: '每日复盘', ladder: '连板梯队', scan: '三合一扫描',
    tactics: '三大战法', lhb: '龙虎榜', capital: '主力资金', history: '历史妖股',
    xray: '妖股透视', watch: '自选', handbook: '判定手册', toolbox: '判定工具箱', settings: '设置',
    deeprules: '完整推导与选股明细'
  };
  // v20261110d：主导航改为 7 个一级栏目 + 「更多」二级入口；原 15 个页面全部保留，收进更多页。
  const PRIMARY = ['v_dash', 'v_topic', 'v_turn', 'v_sw', 'v_sec', 'v_plan', 'v_rep', 'more'];
  const ORDER = PRIMARY;

  const state = { tab: 'v_dash', deepView: 'v_dash', data: null, watch: [], autoRefresh: false, refreshSec: 5, refreshTimer: null, sessionClock: null, lastUpdated: null, filter: { minBoards: 2, sector: '', maxCap: 2000, sortKey: 'probability' }, lhbBoard: 'all', lhbCache: {}, historyDate: '', historyItems: null, xrayCode: '', ladderMatrix: null, xrayToken: 0, xrayCache: {}, lastRenderSig: null, lastRedrawAt: 0, redrawPending: false };

  // =========================================================================
  // v20261109b · 分区折叠 / 快捷锚点 / 表格排序（通用状态与工具）
  // =========================================================================
  const ZKEY = 'yg_zones_v1';
  const RISK_W = { 'rt-high': 0, 'rt-warn': 1, 'rt-org': 2, 'rt-youzi': 3, 'rt-good': 4 };
  const sortState = { seal: { key: 'risk', dir: 'asc' }, watch: { key: 'risk', dir: 'asc' } };
  const tableData = { seal: [], watch: [] };
  const SORT_LABELS = { probability: '妖股概率', risk: '风险优先', boards: '连板高度', seal: '收盘封单', sr: '封成比' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function readZones() {
    try { return JSON.parse(localStorage.getItem(ZKEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeZones(z) { try { localStorage.setItem(ZKEY, JSON.stringify(z)); } catch (e) {} }
  function toggleZone(sec, id, forceOpen) {
    const collapsed = forceOpen ? false : !sec.classList.contains('collapsed');
    sec.classList.toggle('collapsed', collapsed);
    const b = sec.querySelector('.zone-toggle'); if (b) b.textContent = collapsed ? '＋' : '－';
    const z = readZones(); z[id] = collapsed; writeZones(z);
  }

  // 概念榜加权排序：连板占比加权、弱封扣权，全部由当前快照实时推导
  function conceptScore(sec, stocks) {
    const members = stocks.filter((s) => (s.concepts || [s.sector]).includes(sec.sector));
    const total = members.length || sec.limitCount || 1;
    const lb = members.filter((s) => (s.boards || 1) >= 2).length;
    const weak = members.filter((s) => { const r = sealRatio(s); return r != null && r < 0.15; }).length;
    return (sec.limitCount || total) * (1 + lb / total) - weak * 0.5;
  }
  function sortSectors(sectors, stocks) {
    return sectors.slice().sort((a, b) => (conceptScore(b, stocks) - conceptScore(a, stocks)) || (b.limitCount - a.limitCount));
  }

  // 表格排序：空值恒排最后；判定列按风险权重
  const SEAL_KEYS = {
    name: (r) => r.s.name, boards: (r) => r.s.boards, sm: (r) => r.s.sm,
    seal: (r) => r.s.seal, decay: (r) => r.s.decay, sr: (r) => r.sr, risk: (r) => RISK_W[r.j.cls]
  };
  const WATCH_KEYS = {
    name: (r) => r.s.name, boards: (r) => r.s.boards, openTimes: (r) => (r.s.openTimes || 0),
    concept: (r) => r.concept, sr: (r) => r.sr, risk: (r) => RISK_W[r.j.cls]
  };
  function cmpRows(a, b, get, dir) {
    const va = get(a), vb = get(b);
    const na = va == null || (typeof va === 'number' && isNaN(va));
    const nb = vb == null || (typeof vb === 'number' && isNaN(vb));
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    const c = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'zh');
    return dir === 'desc' ? -c : c;
  }
  function sortedTableRows(t) {
    const st = sortState[t], keys = t === 'seal' ? SEAL_KEYS : WATCH_KEYS;
    const get = keys[st.key] || keys.risk;
    // 次级：同权重内封成比升序（越弱越靠前），再按连板降序
    return tableData[t].slice().sort((a, b) => cmpRows(a, b, get, st.dir)
      || (a.sr == null ? 1 : (b.sr == null ? -1 : a.sr - b.sr))
      || ((b.s.boards || 1) - (a.s.boards || 1)));
  }
  function syncSortIndicators(t) {
    const st = sortState[t];
    $$('th[data-table="' + t + '"]').forEach((th) => {
      const i = th.querySelector('.sort-ind');
      if (i) i.textContent = th.dataset.key === st.key ? (st.dir === 'asc' ? '▲' : '▼') : '';
    });
  }
  function renderTableBody(t) {
    const tbody = document.getElementById(t + 'Tbody'); if (!tbody) return;
    const rows = sortedTableRows(t), fn = t === 'seal' ? sealRowHtml : watchRowHtml;
    tbody.innerHTML = rows.length ? rows.map(fn).join('')
      : '<tr><td colspan="' + (t === 'seal' ? 7 : 6) + '" class="empty">今日无连板高标</td></tr>';
    syncSortIndicators(t);
  }

  // ---------- 工具 ----------
  const yuanYi = (v) => (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + fmt(v / 1e8, 2) + '亿';
  const lhbChg = (c) => (c == null || isNaN(c)) ? '—' : (c >= 0 ? '+' : '') + (c * 100).toFixed(2) + '%';
  const heatTxt = (h) => { const n = Number(h); return isNaN(n) ? '—' : (n >= 1e4 ? fmt(n / 1e4, 1) + '万' : fmt(n, 0)); };
  // 股票卡片「数据时刻」标注：明确各机构级因子的时效，消除"是否沿用前一天"的疑惑
  function fmtDataMeta(s) {
    const m = (s && s.meta) || {};
    const lhb = m.lhbDate || (state.data && state.data.lhbDate) || '';
    const lhbTxt = m.youzi === 'lhb' ? ('游资：' + (lhb ? lhb.slice(5) : '') + ' 龙虎榜')
      : m.youzi === 'na' ? '游资：无数据（缺项）' : '游资：未上榜';
    const sealTxt = m.seal === 'ths' ? '封单：实时' : (m.seal === 'snapshot' ? '封单：快照' : '封单：降级缺失');
    const sectorTxt = m.sector === 'em' ? '题材：东财行业' : (m.sector === 'snapshot' ? '题材：快照' : '题材：实时');
    const quoteTxt = m.degraded ? '行情：东财降级'
      : m.quote === 'demo' ? '行情：演示'
        : m.quote === 'snapshot' ? '行情：快照' : '行情：实时';
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
  // v20261112b：复盘报告页只读 localStorage 冻结存档，不参与 5 秒实时刷新。
  function startAutoRefresh() { if (state.refreshTimer) clearInterval(state.refreshTimer); state.refreshTimer = setInterval(() => { if (state.tab !== 'settings' && state.tab !== 'v_rep') refreshAll({ silent: true }); }, state.refreshSec * 1000); }
  function stopAutoRefresh() { if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; } }
  /** 顶部状态条时钟：每秒只更新时间文本，不拉接口、不重绘页面。 */
  function startSessionClock() {
    if (state.sessionClock) clearInterval(state.sessionClock);
    state.sessionClock = setInterval(() => { updateSessionBar(); }, 1000);
  }

  // ---------- 数据 ----------
  // v20261110d：用于判断「本次刷新是否真的换了一份快照」。
  // 交互输入型页面（手册 / 工具箱）只在数据签名变化时才需要重绘，避免每 5 秒
  // 自动刷新把用户正在填写的内容冲掉并造成页面跳动。
  function dataSignature(d) {
    if (!d) return 'null';
    const ov = d.overview || {}, st = d.stats || {}, mk = d.market || {};
    // v20261110e：行情接口口径独立进签名，换日/数值变化才重绘交互页。
    return [d.date, (d.stocks || []).length, ov.limitUp, ov.maxBoards, ov.lianban, ov.zhaban,
      st.open_stock_count, mk.date, mk.ztCount, mk.zbCount, mk.zbRate, mk.prem, mk.promoRate,
      mk.upRatio, mk.volChange, mk.ok].join('|');
  }
  let marketFetchedAt = 0;
  const compactDay = (s) => String(s || '').replace(/-/g, '').slice(0, 8);
  async function loadData() { await refreshAll(); }

  /** 报告生成专用：拉取 mode='close' 的收盘口径数据（含汇总行情），不改写 state.data。 */
  async function fetchCloseData() {
    const d = await window.YGData.getDaily({ mode: 'close' });
    const MT = window.YGMarketToday;
    if (MT && typeof MT.fetchToday === 'function') {
      try {
        const m = await MT.fetchToday({ mode: 'close' });
        if (m) {
          d.market = m;
          d.marketMismatch = !!(compactDay(m.date) && compactDay(d.date) && compactDay(m.date) !== compactDay(d.date));
          d.preMarket = !!(d.preMarket || m.backtracked || m.preMarket);
        }
      } catch (e) { /* 行情补充失败不阻断报告生成，缺项在报告里标注 */ }
    }
    return d;
  }
  function reportCtx() {
    return {
      data: state.data,
      fetchCloseData: fetchCloseData,
      loadDeepAssets: loadDeepAssets,
      rerender: () => {
        if (state.tab === 'v_rep' && window.YGReport && typeof window.YGReport.render === 'function') {
          window.YGReport.render($('#view'), reportCtx());
        }
      }
    };
  }

  async function refreshAll(opts = {}) {
    const btns = $$('.js-refresh-btn');
    if (!opts.silent) btns.forEach((b) => b.classList.add('spinning'));
    try {
      // v20261112b：复盘报告页不参与实时刷新，只读 localStorage 冻结存档；
      // 这里仅更新顶部状态条时间、并检查自动补生成。
      if (state.tab === 'v_rep') {
        updateTopbar(); updateSessionBar();
        if (window.YGReport && typeof window.YGReport.ensureAuto === 'function') {
          try { window.YGReport.ensureAuto(reportCtx()).catch(() => {}); } catch (e) { /* ignore */ }
        }
        return;
      }
      // 除 v_rep 外全部栏目使用 mode='live'（当天盘中实时）。
      const mode = 'live';
      state.data = await window.YGData.getDaily({ mode: mode });
      state.lhbCache.all = { items: state.data.lhb, dept: [], date: state.data.lhbDate, source: state.data.source };
      const MT = window.YGMarketToday;
      if (MT && typeof MT.fetchToday === 'function') {
        const day = compactDay(state.data.date);
        const cached = (typeof MT.get === 'function') ? MT.get() : null;
        const fresh = cached && cached.ok && (Date.now() - marketFetchedAt < 5 * 60 * 1000)
          && cached.mode === mode;
        if (fresh) {
          state.data.market = cached;
        } else {
          try {
            let m = await MT.fetchToday({ mode: mode });
            if ((!m || !m.ok || m.ztCount == null) && day) {
              const alt = await MT.fetchToday({ mode: mode, date: day });
              if (alt && alt.ok && (alt.ztCount != null || alt.upCount != null)) m = alt;
            }
            if (m) { state.data.market = m; marketFetchedAt = Date.now(); }
          } catch (e) { /* 行情补充失败不阻断主流程，工具箱会按缺项降级 */ }
        }
        const mk = state.data.market;
        const md = mk ? compactDay(mk.date) : '';
        state.data.marketMismatch = !!(md && day && md !== day);
        state.data.preMarket = !!(state.data.preMarket || (mk && (mk.backtracked || mk.preMarket)));
      }
      updateTopbar();
      updateSessionBar();
      const sig = dataSignature(state.data);
      const sigChanged = sig !== state.lastRenderSig;
      if (sigChanged) state.redrawPending = true;
      // v20261112b：盘中实时数据每 5 秒都在变，签名会频繁变化。交互页（内嵌工具箱 /
      // 手册章节 / 输入框）60 秒内最多重绘一次，其余刷新只更新数据与顶部状态条，
      // 不重建 DOM；PERSIST 幂等 + 滚动位置恢复保证用户输入不丢、页面不跳动。
      const interactiveTab = PRIMARY.includes(state.tab)
        || ['handbook', 'toolbox', 'deeprules', 'xray', 'history', 'watch', 'scan', 'tactics', 'radar', 'plan'].includes(state.tab);
      const REDRAW_MS = 60000;
      const now = Date.now();
      let doRender = false;
      if (state.tab !== 'settings') {
        if (state.redrawPending && (now - state.lastRedrawAt) >= REDRAW_MS) doRender = true;
        else if (!interactiveTab && sigChanged) doRender = true;
      }
      if (doRender) {
        const scroller = document.scrollingElement || document.documentElement;
        const scrollY = scroller ? scroller.scrollTop : 0;
        render();
        state.lastRedrawAt = now;
        state.redrawPending = false;
        if (scroller) requestAnimationFrame(() => { try { scroller.scrollTop = scrollY; } catch (e) { /* ignore */ } });
      }
      state.lastRenderSig = sig;
    } catch (e) {
      updateTopbar();
      updateSessionBar();
    } finally {
      if (!opts.silent) setTimeout(() => btns.forEach((b) => b.classList.remove('spinning')), 400);
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
  // v20261112a：新增 em-live（浏览器直连东财实时涨停池）数据源，所有标注统一走这里，
  // 避免出现「东财实时数据」被误标成「演示 / 实时接口」的情况。
  const SOURCE_TEXT = {
    'api': '实时·同花顺', 'snapshot': '收盘快照', 'em-fallback': '东财降级',
    'em-live': '东财实时涨停池', 'demo': '演示'
  };
  const sourceText = (d) => (d && SOURCE_TEXT[d.source]) || '演示';
  /** 统计卡片的数据源标签：识别 em-live，避免落回「演示」（QA 回归项 3）。 */
  function statsSourceLabel(d) {
    const s = (d && d.stats && d.stats.source) || (d && d.statsSource) || (d && d.source) || '';
    return SOURCE_TEXT[s] || (s === 'em-live' ? '东财实时涨停池' : (s || '未标注'));
  }
  /** 侧栏 / 移动端数据源短标注：盘中绝不出现「收盘 / 最近收盘」字样。 */
  function dataShortLabel(d) {
    if (!d) return '';
    if (d.intraday) return '盘中实时 · 未收盘';
    if (d.degraded) return '实时接口不可达 · 已降级';
    if (d.dataTimeLabel) return d.dataTimeLabel;
    return d.preMarket ? '最近已收盘交易日' : '当日收盘';
  }

  function updateTopbar() {
    const d = state.data; if (!d) return;
    const src = sourceText(d);
    state.lastUpdated = new Date();
    const t = state.lastUpdated;
    const p2 = (n) => String(n).padStart(2, '0');
    let txt = `更新 ${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}`;
    if (state.autoRefresh) txt += ` · 自动${state.refreshSec}s`;
    // v20261109c：状态信息在「侧栏底部」与「移动端精简条」各有一份，用 class 批量更新
    // v20261112b：日期、数据源、数据时点全部跟随 state.data，时段文案统一走 YGSession
    $$('.js-date').forEach((n) => { n.textContent = `${d.date} · A股连板梯队雷达`; });
    $$('.js-source').forEach((n) => { n.textContent = `${src} · ${d.date} · ${dataShortLabel(d)}`; });
    $$('.js-updated').forEach((n) => { n.textContent = txt; });
  }

  /** v20261112b 顶部状态条：YYYYMMDD · 早盘交易中 10:21 + 更新于 HH:mm:ss + 完整手册 / 刷新 / 自动 */
  function sessionBarHtml() {
    return `<div class="yg-session-bar">
      <div class="yg-session-left">
        <span class="yg-live-dot"></span>
        <span class="yg-session-txt js-session-txt"></span>
        <span class="yg-session-data js-session-data"></span>
      </div>
      <div class="yg-session-right">
        <span class="yg-session-time js-session-time"></span>
        <button class="yg-sbtn" type="button" data-goto="handbook">完整手册</button>
        <button class="yg-sbtn js-session-refresh" type="button">刷新</button>
        <button class="yg-sbtn js-session-auto" type="button">自动：关</button>
      </div></div>`;
  }
  function updateSessionBar() {
    const s = window.YGSession, d = state.data;
    $$('.js-session-txt').forEach((n) => { n.textContent = s ? s.statusText() : ''; });
    $$('.js-session-time').forEach((n) => { n.textContent = '更新于 ' + (s ? s.hhmmss() : ''); });
    $$('.js-session-auto').forEach((b) => {
      b.textContent = '自动：' + (state.autoRefresh ? '开' : '关');
      b.classList.toggle('on', state.autoRefresh);
    });
    $$('.yg-live-dot').forEach((n) => {
      n.classList.toggle('live', !!(d && d.intraday));
      n.classList.toggle('degraded', !!(d && d.degraded));
    });
    $$('.js-session-data').forEach((n) => {
      n.textContent = d ? (d.dataTimeLabel || (s ? s.dataTimeLabel(d) : '')) : '';
    });
    // v20261112c：栏目页内实时标注条独立同步（主体重绘有 60s 节流）
    $$('.js-live-note-txt').forEach((n) => {
      n.textContent = d ? (d.dataTimeLabel || (s ? s.dataTimeLabel(d) : '')) : '';
    });
    $$('.js-live-note-tag').forEach((n) => { n.textContent = dataShortLabel(d); });
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
  // =========================================================================
  // v20261109a · 情绪六维评分 + 头部结论条（对标参考看板，全部由本快照实时推导）
  // 说明：参考看板六维含「指数环境」「量能/主线切换」，我们的收盘快照不含指数与成交额，
  //       故替换为快照可算的「主线集中度」「封板质量」，并在卡片内标注口径，绝不臆造数据。
  // =========================================================================
  const clamp10 = (v) => Math.max(0, Math.min(10, Math.round(v * 10) / 10));
  function emotionSixDim() {
    const d = state.data, ov = d.overview, st = d.stats || {};
    const c = sentimentCycle(), m = c.m;
    const stocks = d.stocks || [];
    const limitUp = ov.limitUp || stocks.length || 0;
    const lianban = ov.lianban != null ? ov.lianban : stocks.filter((s) => (s.boards || 1) >= 2).length;
    const maxBoards = ov.maxBoards || 1;
    const zhabanRate = m.zhabanRate;
    const sealRate = m.sealRate;
    const promo = m.promo;
    // ① 连板高度与梯队：高度分 + 梯队完整度（缺一层扣分）
    const tiers = {};
    stocks.forEach((s) => { const b = s.boards || 1; tiers[b] = (tiers[b] || 0) + 1; });
    let gaps = 0;
    for (let b = 2; b < maxBoards; b++) if (!tiers[b]) gaps++;
    const heightScore = clamp10(Math.min(10, 1.3 * maxBoards + 1) - gaps * 0.8);
    // ② 晋级率/接力意愿：优先真实晋级率，缺失时用连板占比代理
    const lianbanRatio = limitUp ? (lianban / limitUp) : 0;
    const promoScore = promo != null
      ? clamp10((promo / 40) * 10)
      : clamp10((lianbanRatio / 0.35) * 10);
    const promoNote = promo != null ? `晋级率 ${promo}%` : `连板占比 ${(lianbanRatio * 100).toFixed(1)}%（晋级率缺失，用连板占比代理）`;
    // ③ 涨停广度
    const breadthScore = clamp10((limitUp / 80) * 10);
    // ④ 主线集中度：涨停最多题材的家数占比（替代参考看板「量能/主线切换」）
    const secs = (d.sectors || []).slice().sort((a, b) => b.limitCount - a.limitCount);
    const topSec = secs[0] ? secs[0].limitCount : 0;
    const topSecName = secs[0] ? secs[0].sector : '—';
    const secRatio = limitUp ? topSec / limitUp : 0;
    const mainScore = clamp10((secRatio / 0.25) * 10);
    // ⑤ 封板质量：封板率 + 弱封占比（封成比 <0.15 视为弱封）
    let weakCnt = 0, validSr = 0;
    stocks.forEach((s) => { const r = sealRatio(s); if (r != null) { validSr++; if (r < 0.15) weakCnt++; } });
    const weakRatio = validSr ? weakCnt / validSr : null;
    let qualityScore;
    if (sealRate != null && weakRatio != null) qualityScore = clamp10((sealRate / 100) * 6 + (1 - weakRatio) * 4);
    else if (sealRate != null) qualityScore = clamp10((sealRate / 100) * 10);
    else if (weakRatio != null) qualityScore = clamp10((1 - weakRatio) * 10);
    else qualityScore = null;
    const qualityNote = weakRatio != null
      ? `封板率 ${sealRate != null ? sealRate + '%' : '—'} · 弱封 ${weakCnt}/${validSr} 只（封成比&lt;0.15）`
      : `封板率 ${sealRate != null ? sealRate + '%' : '数据缺失'}`;
    // ⑥ 炸板率/封板质量（反向计分）
    const blastScore = zhabanRate != null ? clamp10((1 - zhabanRate / 60) * 10) : null;
    const dims = [
      { name: '连板高度与梯队', score: heightScore, desc: `最高 ${maxBoards} 板 · 连板 ${lianban} 家${gaps ? ` · 梯队断层 ${gaps} 处` : ' · 梯队完整'}` },
      { name: '晋级率 / 接力意愿', score: promoScore, desc: promoNote },
      { name: '涨停广度 / 数量', score: breadthScore, desc: `涨停 ${limitUp} 家（80 家为满分基准）` },
      { name: '主线集中度', score: mainScore, desc: `最大题材 ${topSecName} ${topSec} 家，占比 ${(secRatio * 100).toFixed(1)}%` },
      { name: '封板质量', score: qualityScore, desc: qualityNote },
      { name: '炸板率 / 回封质量', score: blastScore, desc: zhabanRate != null ? `炸板率 ${zhabanRate}%（越低分越高）` : '炸板率数据缺失' }
    ];
    const valid = dims.filter((x) => x.score != null);
    const total = valid.length ? Math.round((valid.reduce((a, b) => a + b.score, 0) / valid.length) * 10) / 10 : null;
    const strongest = valid.slice().sort((a, b) => b.score - a.score)[0] || null;
    const weakest = valid.slice().sort((a, b) => a.score - b.score)[0] || null;
    return { dims, total, strongest, weakest, validCount: valid.length, c, m, gaps, weakCnt, validSr };
  }

  function renderVerdictCard() {
    const s = emotionSixDim(), c = s.c, m = s.m, d = state.data;
    const scoreTxt = s.total != null ? s.total.toFixed(1) + ' / 10' : '—';
    const scoreCls = s.total == null ? '' : (s.total >= 6 ? 'up' : s.total <= 4 ? 'down' : '');
    // v20261112c：盘中实时态不得写「收盘」，避免与实时口径自相矛盾
    const sessionTxt = d.intraday ? '盘中实时 · 未收盘' : (d.degraded ? '实时接口不可达 · 已降级' : '收盘');
    const badges = [
      `<span class="vbadge">${d.date || ''} ${sessionTxt}</span>`,
      `<span class="vbadge">数据源：${sourceText(d)}（${d.date || '—'}）</span>`,
      s.gaps ? `<span class="vbadge hot">梯队断层 ${s.gaps} 处</span>` : '',
      (s.weakCnt && s.validSr && s.weakCnt / s.validSr >= 0.4) ? `<span class="vbadge hot">弱封占比 ${Math.round(s.weakCnt / s.validSr * 100)}%</span>` : '',
      (m.zhabanRate != null && m.zhabanRate >= 35) ? `<span class="vbadge hot">炸板率 ${m.zhabanRate}%</span>` : ''
    ].join('');
    const weakTxt = s.weakest ? `最弱维度 <b>${s.weakest.name} ${s.weakest.score.toFixed(1)}</b>（${s.weakest.desc}）` : '';
    const strongTxt = s.strongest ? `最强维度 <b>${s.strongest.name} ${s.strongest.score.toFixed(1)}</b>` : '';
    return `<div class="card verdict-card">
      <div class="verdict-head">
        <div class="verdict-title">${c.stg.name} · 涨停 ${m.limitUp} 家 / 最高 ${m.maxBoards} 板 · 综合 ${scoreTxt}</div>
        <div class="verdict-badge-line">${badges}</div>
      </div>
      <div class="verdict-grid">
        <div class="vcell"><div class="k">情绪阶段</div><div class="v big">${c.stg.name}</div></div>
        <div class="vcell"><div class="k">综合评分</div><div class="v big ${scoreCls}">${scoreTxt}</div></div>
        <div class="vcell"><div class="k">操作档位</div><div class="v big">${c.stg.gear}</div></div>
        <div class="vcell"><div class="k">建议仓位</div><div class="v big">${c.stg.pos}</div></div>
      </div>
      <div class="verdict-sub">${strongTxt}${strongTxt && weakTxt ? ' · ' : ''}${weakTxt}。<br>${c.stg.desc} ${c.stg.tip}</div>
    </div>`;
  }

  function renderSixDimCard() {
    const s = emotionSixDim();
    const rows = s.dims.map((x) => {
      if (x.score == null) return `<div class="six-row"><div class="six-top"><span class="six-nm">${x.name}</span><span class="six-sc">—</span></div><div class="six-bar"><i style="width:0%"></i></div><div class="tiny" style="margin-top:3px">${x.desc}</div></div>`;
      const cls = x.score >= 7 ? 'hi' : x.score <= 4 ? 'lo' : '';
      return `<div class="six-row"><div class="six-top"><span class="six-nm">${x.name}</span><span class="six-sc ${cls}">${x.score.toFixed(1)}</span></div>
        <div class="six-bar"><i class="${cls}" style="width:${x.score * 10}%"></i></div>
        <div class="tiny" style="margin-top:3px">${x.desc}</div></div>`;
    }).join('');
    const tags = [
      `<span class="six-chip">综合评分 <b>${s.total != null ? s.total.toFixed(1) + ' / 10' : '—'}</b></span>`,
      s.strongest ? `<span class="six-chip">最强 <b>${s.strongest.name} ${s.strongest.score.toFixed(1)}</b></span>` : '',
      s.weakest ? `<span class="six-chip">最弱 <b>${s.weakest.name} ${s.weakest.score.toFixed(1)}</b></span>` : ''
    ].join('');
    return `<div class="card">
      <h3><span class="bar"></span>情绪六维评分 · 10 分制</h3>
      <div class="six-list">${rows}</div>
      <div class="six-tags">${tags}</div>
      <div class="six-note">口径说明：全部由当前快照实时推导，等权平均（缺失维度不计入分母）。「指数环境 / 量能切换」需要指数与两市成交额数据，本快照不含，故采用可由涨停池直接计算的「主线集中度 / 封板质量」替代，未使用任何外部写死数值。</div>
    </div>`;
  }

  // =========================================================================
  // v20261110e · 统一「炸板 / 封板」口径（全站唯一入口）
  // -------------------------------------------------------------------------
  // 口径陷阱：snapshot.stats.open_stock_count 是「涨停池内开板≥3 次的个股数」，
  //   stats.seal_rate 是「涨停池内未开板≥3 次比例」，二者都是估算口径，
  //   不是全市场炸板家数 / 封板率，混用会让情绪分档结论反转。
  // 优先用当日收盘实时行情 d.market（东财涨停池 + 炸板池实测）：
  //   炸板率 = 炸板池 tc ÷（涨停池 tc + 炸板池 tc）；封板率 = 1 − 炸板率。
  // 仅在 market 不可用时回退快照估算口径，并用 kind / note 显式标注边界。
  // =========================================================================
  function marketCaliber(d) {
    const ov = (d && d.overview) || {}, st = (d && d.stats) || {};
    const mk = (d && d.market && d.market.ok) ? d.market : null;
    const n = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
    const limitUp = n(mk && mk.ztCount) != null ? mk.ztCount : (n(ov.limitUp) != null ? ov.limitUp : 0);
    const maxBoards = n(mk && mk.maxBoards) != null ? mk.maxBoards : (ov.maxBoards || 1);
    const lianban = n(mk && mk.lianbanCount) != null ? mk.lianbanCount : (ov.lianban || 0);
    let zhaban, zhabanRate, sealRate, kind;
    if (mk && n(mk.zbCount) != null) {
      zhaban = mk.zbCount;
      const den = (n(mk.ztCount) != null ? mk.ztCount : limitUp) + zhaban;
      // 与 market-today.js / auto-fill.js 保持同一精度：zbRate 为百分数(16.96)，
      // sealRate 为小数(0.8304)；避免首页显示 17% 而工具箱显示 16.96% 的不一致。
      zhabanRate = n(mk.zbRate) != null ? mk.zbRate
        : (den > 0 ? Math.round(zhaban / den * 100) : null);
      sealRate = n(mk.sealRate) != null ? Math.round(mk.sealRate * 10000) / 100
        : (den > 0 ? Math.round((den - zhaban) / den * 100) : null);
      kind = 'market';
    } else {
      zhaban = n(ov.zhaban) != null ? ov.zhaban : (n(st.open_stock_count) != null ? st.open_stock_count : 0);
      const touched = n(st.touched_limit_up_stock_count);
      zhabanRate = touched ? Math.round(zhaban / touched * 100)
        : (limitUp + zhaban > 0 ? Math.round(zhaban / (limitUp + zhaban) * 100) : null);
      sealRate = n(st.seal_rate) != null ? Math.round(st.seal_rate * 100) : null;
      kind = 'estimate';
    }
    // v20261112b：数据时点文案统一取 YGSession，盘中绝不标「当日收盘」。
    const dtl = (d && d.dataTimeLabel) || (window.YGSession ? window.YGSession.dataTimeLabel(d || {}) : '');
    const note = kind === 'market'
      ? ((dtl ? dtl + ' · ' : '') + '东财涨停池 / 炸板池实测口径'
        + (mk && mk.backtracked ? '（历史交易日，仅当日可得的实时字段一律置 null + 缺项）' : ''))
      : '估算口径，仅供参考：快照 ' + ((d && d.date) || '—') + '，非当日实时行情；open_stock_count 为涨停池内开板≥3 次个股数，seal_rate 为未开板≥3 次比例';
    return { limitUp, maxBoards, lianban, zhaban, zhabanRate, sealRate, kind, note,
      marketDate: mk ? (mk.dateISO || mk.date) : null };
  }
  // v20261110e：所有展示炸板率 / 封板率的卡片统一挂口径标签，避免估算值被当成实测值。
  // v20261112b：盘中实时数据标「盘中实时口径 · 未收盘」，不得标成收盘值。
  function caliberLabel(m) {
    const isMkt = m && m.caliber === 'market';
    const intra = !!(m && m.intraday) || !!(state.data && state.data.intraday);
    return `<span class="caliber-tag ${isMkt ? 'caliber-live' : 'caliber-est'}">${isMkt ? (intra ? '盘中实时口径 · 未收盘' : '实时实测口径') : '估算口径 · 仅供参考'}</span>`;
  }
  function caliberNoteHtml(m) {
    return `<div class="caliber-note">口径：${esc((m && m.caliberNote) || '—')}</div>`;
  }
  function sentimentCycle() {
    const d = state.data;
    const st = d.stats;
    const cal = marketCaliber(d);
    const { limitUp, zhaban, maxBoards, zhabanRate, sealRate } = cal;
    let promo = null;
    if (d.market && d.market.promoRate != null) promo = d.market.promoRate;
    else if (st && st.page_boards && st.page_boards.length) {
      const arr = st.page_boards.filter((x) => x.board_level !== 'one' && x.promotion_rate != null).map((x) => x.promotion_rate);
      if (arr.length) promo = Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100);
    }
    const lianban = cal.lianban;
    // 判断顺序：高潮 → 退潮 → 冰点 → 启动 → 发酵（兜底）
    let idx = 2; // 默认发酵
    if (limitUp >= 90 && maxBoards >= 6) idx = 3;                                   // 高潮
    else if (zhabanRate != null && zhabanRate >= 35) idx = 4;                        // 退潮：炸板率抬升
    else if (maxBoards >= 5 && limitUp < 40) idx = 4;                                // 退潮：高位板仍在但涨停骤缩
    else if (limitUp < 30 || maxBoards <= 2) idx = 0;                                // 冰点
    else if (maxBoards <= 4 && limitUp < 50) idx = 1;                                // 启动
    const STAGE = [
      { name: '冰点', cls: 's0', desc: '亏钱效应主导，连板高度被压缩，市场静待新周期。', tip: '空仓观望为主，只跟踪首板动向，等待新周期种子出现。', gear: '空仓观望', pos: '0%-10%' },
      { name: '启动', cls: 's1', desc: '情绪回暖，先锋板开始出现，试错资金重新进场。', tip: '轻仓试错首板与低位首次晋级，控制单票仓位。', gear: '轻仓试错', pos: '10%-30%' },
      { name: '发酵', cls: 's2', desc: '赚钱效应扩散，板块效应显现，龙头打开空间高度。', tip: '聚焦主流题材中军与梯队低吸，跟随龙头节奏。', gear: '聚焦主流', pos: '30%-60%' },
      { name: '高潮', cls: 's3', desc: '情绪极致一致，分歧随时可能出现，注意兑现节奏。', tip: '只做总龙头，不追高位跟风股，随时准备止盈兑现。', gear: '只做龙头', pos: '30%-50%' },
      { name: '退潮', cls: 's4', desc: '炸板率抬升或高位断板，亏钱效应开始扩散。', tip: '空仓或只做超跌反抽，严禁接力高位板。', gear: '空仓避险', pos: '0%-10%' }
    ];
    const stg = STAGE[idx];
    return { idx, stg, m: { limitUp, lianban, maxBoards, zhabanRate, sealRate, promo, zhaban,
      caliber: cal.kind, caliberNote: cal.note, marketDate: cal.marketDate } };
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
        <span class="gear-badge">档位：${c.stg.gear} · 仓位 ${c.stg.pos}</span>
        <span class="tiny">由涨停家数 / 连板高度 / 炸板率实时推导</span>${caliberLabel(m)}</div>
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
      ${caliberNoteHtml(m)}
      <div class="cycle-desc tiny">${c.stg.desc}</div>
      <div class="cycle-tip">💡 操作建议：${c.stg.tip}</div>
    </div>`;
  }

  // ---------- 总览增强（对标豆包「情绪流战法」总览） ----------
  // ① 核心情绪指标宫格
  function emotionTilesCard() {
    const c = sentimentCycle(); const m = c.m;
    const t = (v, u) => v != null ? v + (u || '') : '—';
    const zhCls = m.zhabanRate == null ? '' : (m.zhabanRate >= 30 ? 'bad' : m.zhabanRate >= 20 ? 'warn' : 'good');
    const sealCls = m.sealRate == null ? '' : (m.sealRate >= 75 ? 'good' : m.sealRate >= 60 ? 'warn' : 'bad');
    const promoCls = m.promo == null ? '' : (m.promo >= 30 ? 'good' : 'warn');
    const tiles = [
      { l: '涨停家数', v: t(m.limitUp, ' 家'), s: '炸板 ' + t(m.zhaban, ' 家'), cls: 'up' },
      { l: '连板高度', v: t(m.maxBoards, ' 板'), s: '连板 ' + t(m.lianban, ' 家'), cls: 'up' },
      { l: '炸板率', v: t(m.zhabanRate, '%'), s: '越高接力越难', cls: zhCls },
      { l: '封板率', v: t(m.sealRate, '%'), s: '封单锁定强度', cls: sealCls },
      { l: '晋级率', v: t(m.promo, '%'), s: '连板晋级均值', cls: promoCls },
      { l: '情绪档位', v: c.stg.gear, s: '建议仓位 ' + c.stg.pos, cls: 'brand' }
    ];
    const grid = tiles.map((x) => `<div class="tile ${x.cls}"><div class="tl">${x.l}</div><div class="tv">${x.v}</div><div class="ts">${x.s}</div></div>`).join('');
    return `<div class="card"><h3><span class="bar"></span>核心情绪指标 ${caliberLabel(m)}</h3>
      <div class="tile-grid">${grid}</div>
      <div class="tiny" style="margin-top:8px">炸板率≥30% / 封板率&lt;65% / 晋级率&lt;30% 会亮黄红灯，作为接力难度参考。</div>
      ${caliberNoteHtml(m)}</div>`;
  }
  // ② 连板梯队分布（金字塔）
  function pyramidCard() {
    const d = state.data;
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>连板梯队分布</h3><div class="tiny" style="margin-bottom:6px">从首板到高位板的金字塔结构，层级越完整、高度越高，情绪越强。点击股票名看详情。</div>`;
    const lv = d.ladder || [];
    if (!lv.length) { card.appendChild(el('div', 'empty', '今日暂无连板股票')); return card; }
    const total = lv.reduce((a, t) => a + t.stocks.length, 0);
    lv.forEach((tier) => {
      const n = tier.stocks.length;
      const w = Math.max(6, Math.round((n / Math.max(total, 1)) * 100));
      const names = tier.stocks.slice(0, 6).map((s) => `<span class="pyr-name" data-code="${s.code}">${s.name}</span>`).join('') + (n > 6 ? `<span class="tiny">+${n - 6}</span>` : '');
      const row = el('div', 'pyr-row');
      row.innerHTML = `<div class="pyr-label">${tier.boards}板</div>
        <div class="pyr-track"><div class="pyr-fill" style="width:${w}%"></div></div>
        <div class="pyr-count">${n} 只</div>`;
      card.appendChild(row);
      const nm = el('div', 'pyr-names'); nm.innerHTML = names; card.appendChild(nm);
    });
    card.querySelectorAll('.pyr-name').forEach((n) => { n.onclick = () => openDetail(n.dataset.code); });
    return card;
  }
  // ③ 连板梯队健康度（v20261109a：断层 / 两极 / 虚胖 / 倒金字塔，全部由当前快照推导）
  function renderLadderHealthCard() {
    const d = state.data, stocks = d.stocks || [];
    const tiers = {};
    stocks.forEach((s) => { const b = s.boards || 1; (tiers[b] = tiers[b] || []).push(s); });
    const maxB = Object.keys(tiers).reduce((m, k) => Math.max(m, +k), 1);
    const first = (tiers[1] || []).length;
    const high = stocks.length - first;
    const gaps = [];
    for (let b = 2; b < maxB; b++) if (!tiers[b] || !tiers[b].length) gaps.push(b);
    // 封成比强弱分布
    const sr = (s) => sealRatio(s);
    const weak = stocks.filter((s) => { const r = sr(s); return r != null && r < 0.15; }).length;
    const strong = stocks.filter((s) => { const r = sr(s); return r != null && r >= 1; }).length;
    const validSr = stocks.filter((s) => sr(s) != null).length;
    // 同梯队内强封与弱封并存 = 两极
    const polarTiers = Object.keys(tiers).filter((b) => {
      const arr = tiers[b] || [];
      return arr.some((s) => { const r = sr(s); return r != null && r >= 1; }) &&
             arr.some((s) => { const r = sr(s); return r != null && r < 0.15; });
    });
    const weakRatio = validSr ? weak / validSr : 0;
    const firstRatio = stocks.length ? first / stocks.length : 0;
    const virtual = firstRatio >= 0.65 && weakRatio >= 0.3;      // 虚胖：首板多且弱封多
    const inverted = first > high * 2 && maxB >= 4;               // 倒金字塔：首板远多于连板且有高标
    const tags = [];
    if (gaps.length) tags.push(`<span class="htag bad">断层：${gaps.join('、')} 板空缺</span>`);
    if (polarTiers.length) tags.push(`<span class="htag warn">两极：${polarTiers.map((b) => b + '板').join('、')} 强弱封并存</span>`);
    if (virtual) tags.push(`<span class="htag bad">虚胖：首板占比 ${(firstRatio * 100).toFixed(0)}%、弱封占比 ${(weakRatio * 100).toFixed(0)}%</span>`);
    if (inverted) tags.push(`<span class="htag warn">倒金字塔：首板 ${first} / 连板 ${high}，高标独苗</span>`);
    if (!tags.length) tags.push('<span class="htag good">梯队结构完整，无断层 / 虚胖信号</span>');
    const rows = [];
    for (let b = maxB; b >= 1; b--) {
      const arr = tiers[b] || [];
      if (!arr.length && b < maxB && b >= 2) {
        rows.push(`<tr><td><b>${b} 板</b></td><td class="num">0</td><td class="num lost">空缺</td><td><span class="jdesc">该板位无标的，上下梯队断档</span></td></tr>`);
        continue;
      }
      if (!arr.length) continue;
      const names = arr.slice(0, 4).map((s) => `${s.name}${sr(s) != null ? '(' + sr(s).toFixed(2) + ')' : ''}`).join('、') + (arr.length > 4 ? ` 等${arr.length}只` : '');
      const w = arr.filter((s) => { const r = sr(s); return r != null && r < 0.15; }).length;
      const stg = w >= 2 ? '<span class="rtag rt-high">弱封集中</span>'
        : (arr.some((s) => { const r = sr(s); return r != null && r >= 1; }) && w ? '<span class="rtag rt-warn">两极</span>'
        : (w ? '<span class="rtag rt-warn">含弱封</span>' : '<span class="rtag rt-good">结构正常</span>'));
      rows.push(`<tr><td><b>${b} 板</b></td><td class="num">${arr.length}</td><td class="num">${w}</td><td>${stg}<div class="jdesc">${names}</div></td></tr>`);
    }
    return `<div class="card ladder-health">
      <h3><span class="bar"></span>连板梯队健康度</h3>
      <table class="mini-table">
        <thead><tr><th>梯队</th><th class="num">家数</th><th class="num">弱封</th><th>健康度 / 代表个股（封成比）</th></tr></thead>
        <tbody>${rows.join('') || '<tr><td colspan="4" class="empty">暂无梯队数据</td></tr>'}</tbody>
      </table>
      <div class="health-tags">${tags.join('')}</div>
      <div class="tiny" style="margin-top:8px">弱封 = 封成比 &lt; 0.15；封成比 = 封单 ÷ (流通市值 × 100 × 换手率)。本快照仅含收盘涨停股，<b>炸板股不在池内</b>，故不展示炸板金额与失守标记。</div>
    </div>`;
  }

  // ③ 风险信号
  function riskSignalCard() {
    const c = sentimentCycle(); const m = c.m;
    const warns = [];
    if (m.zhabanRate != null && m.zhabanRate >= 30) warns.push(`炸板率 ${m.zhabanRate}% 偏高，接力打板需谨慎`);
    if (m.sealRate != null && m.sealRate < 65) warns.push(`封板率 ${m.sealRate}% 偏低，封板资金不坚决`);
    if (m.maxBoards >= 5 && m.lianban <= 6) warns.push(`最高 ${m.maxBoards} 板但连板仅 ${m.lianban} 家，高位孤板谨防断板`);
    if (m.limitUp < 30) warns.push(`涨停仅 ${m.limitUp} 家，赚钱效应不足`);
    const ok = !warns.length;
    const list = ok ? '市场情绪平稳，无重大风险信号' : warns.map((w) => `<div>⚠️ ${w}</div>`).join('');
    return `<div class="card"><h3><span class="bar"></span>风险信号</h3>
      <div class="${ok ? 'risk-ok' : 'risk-bad'}">${list}</div></div>`;
  }
  // ④ 交易计划共享数据（总览速览 + 计划页共用）
  function planData() {
    const d = state.data, c = sentimentCycle();
    const picked = [];
    const push = (s, why) => { if (s && !picked.find((x) => x.code === s.code) && picked.length < 8) picked.push(Object.assign({}, s, { why })); };
    (d.top || []).slice(0, 5).forEach((s) => push(s, '妖股评分 ' + s.probability));
    (d.ladder[0] ? d.ladder[0].stocks.slice(0, 2) : []).forEach((s) => push(s, '最高板空间龙头'));
    (d.ladder[1] ? d.ladder[1].stocks.slice(0, 2) : []).forEach((s) => push(s, '次高位卡位'));
    d.stocks.filter((s) => (s.boards || 1) === 2).sort((a, b) => b.probability - a.probability).slice(0, 2)
      .forEach((s) => push(s, '首板晋级·弱转强'));
    return { c, picked };
  }
  function planQuickCard() {
    const { c, picked } = planData();
    const chips = picked.slice(0, 6).map((s) => `<span class="sector-chip" data-code="${s.code}">${s.name}<b> ${s.boards}板</b></span>`).join('');
    const card = el('div', 'card');
    card.innerHTML = `<h3><span class="bar"></span>今日交易计划 · 速览</h3>
      <div class="plan-quick">
        <div class="pq-item"><div class="pq-l">今日操作</div><div class="pq-v">${c.stg.gear}</div></div>
        <div class="pq-item"><div class="pq-l">建议仓位</div><div class="pq-v">${c.stg.pos}</div></div>
      </div>
      <div class="pq-section tiny">明日关注标的</div>
      <div class="sectors">${chips || '<span class="tiny">暂无</span>'}</div>
      <button class="btn ghost" id="planMore" style="margin-top:10px">查看完整交易计划 →</button>`;
    card.querySelectorAll('.sector-chip').forEach((n) => { n.onclick = () => openDetail(n.dataset.code); });
    card.querySelector('#planMore').onclick = () => switchTab('plan');
    return card;
  }
  // ---------- 涨停行业分布（横向条形，纯 CSS 复用 capbar） ----------
  function renderSectorDistCard() {
    const d = state.data;
    const rows = sortSectors(d.sectors || [], d.stocks || []).slice(0, 12);
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

  // 涨停主线概念热度 Top（v20261109a）：解读基于本快照的行业聚类与封成比，
  // 不引用参考看板的「概念涨幅 / 领涨股退化」等需要外部行情的数据。
  function renderConceptInsightCard() {
    const d = state.data;
    const rows = sortSectors(d.sectors || [], d.stocks || []).slice(0, 8);
    if (!rows.length) return '';
    const stocks = d.stocks || [];
    const body = rows.map((x, i) => {
      const members = stocks.filter((s) => (s.concepts || [s.sector]).includes(x.sector));
      const lead = members.slice().sort((a, b) => (b.boards - a.boards) || ((b.seal || 0) - (a.seal || 0)))[0] || null;
      const maxB = members.reduce((mm, s) => Math.max(mm, s.boards || 1), 0);
      const weak = members.filter((s) => { const r = sealRatio(s); return r != null && r < 0.15; }).length;
      let tag = '支线', cls = '';
      let why = `涨停 ${x.limitCount} 家，未成主线`;
      if (x.limitCount >= 3 && maxB >= 2) { tag = '成立'; cls = 'r'; why = `${x.limitCount} 家涨停且最高 ${maxB} 板，产业链自洽`; }
      else if (x.limitCount >= 3) { tag = '跟踪'; cls = 'a'; why = `${x.limitCount} 家但全为首板，概念强于个股`; }
      if (weak >= 2) { tag = '退化'; cls = 'a'; why += `；含 ${weak} 只弱封（封成比<0.15）`; }
      const leadTxt = lead ? `${lead.name} ${lead.boards}板` : '—';
      return `<tr><td class="num">${i + 1}</td><td><b>${x.sector}</b></td><td class="num">${x.limitCount}</td>
        <td>${leadTxt}</td><td><span class="tag ${cls}">${tag}</span><div class="jdesc" title="${esc(why)}">${why}</div></td></tr>`;
    }).join('');
    return `<div class="card">
      <h3><span class="bar"></span>涨停主线概念热度 Top ${rows.length}</h3>
      <div class="tbl-wrap"><div class="scroll-hint">← 左右滑动查看全部列 →</div>
      <table class="concept-table">
        <thead><tr><th class="num">#</th><th>概念</th><th class="num">涨停</th><th>领涨股</th><th>解读</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      <div class="tiny" style="margin-top:8px">排序已按连板股占比加权、弱封（封成比&lt;0.15）扣权，不只数涨停家数。口径：题材取自当前快照的行业/概念标签（共 ${(d.sectors || []).length} 个，本身为行业分类，无需噪声剔除）；「成立」需 ≥3 家涨停且含连板股，「退化」指簇内出现 ≥2 只弱封。「概念涨幅 / 龙头炸板」需外部概念行情，本快照不含，故不展示。</div>
    </div>`;
  }

  // 风险提示增强（v20261109a）：数据来源、快照时点、指标口径、免责声明
  function renderRiskExtCard() {
    const d = state.data, s = emotionSixDim();
    const gen = d.notice ? String(d.notice).replace(/<[^>]+>/g, '') : '';
    const genAt = (gen.match(/生成于\s*([0-9\-: ]+)/) || [])[1] || d.date || '—';
    return `<div class="card">
      <h3><span class="bar"></span>风险提示与数据口径</h3>
      <div class="risk-ext">
        <b>数据来源</b>：<span class="src">${d.source === 'snapshot' ? '收盘静态快照（通达信涨停池 · 东财妙想行情 · 腾讯自选股龙虎榜）' : d.source === 'em-live' ? '东方财富涨停池（浏览器直连）' : sourceText(d)}</span>；数据时点 <b>${genAt}</b>，行情日 <b>${d.date || '—'}</b>${d.dataTimeLabel ? '，<b>' + esc(d.dataTimeLabel) + '</b>' : ''}。<br>
        <b>指标口径</b>：封成比 = 封单(万元) ÷ (流通市值(亿) × 100 × 换手率%)；精确回封率 = 曾开板只数 ÷ (曾开板 + 开板≥3 次)；封单衰减率 = (收盘封单 − 午盘封单) ÷ 午盘封单；六维评分由本快照实时推导、等权平均。<br>
        <b>已知边界</b>：本快照仅含收盘涨停股，<b>炸板股、指数、两市成交额、概念板块涨幅均不在数据内</b>，相关结论不会臆造；${s.validSr ? `封成比有效样本 ${s.validSr} 只` : '封成比样本缺失'}。<br>
        <b>免责声明</b>：本工具基于公开数据与历史规律的量化参考，题材炒作与连板接力风险极高，评分与研判仅供研究，<b>不构成任何投资建议</b>，据此操作风险自担。
      </div>
    </div>`;
  }

  // =========================================================================
  // 渲染：交易计划（档位 / 仓位 / 明日关注 / 止损纪律）
  // =========================================================================
  function renderPlan() {
    const { c, picked } = planData();
    const root = $('#view'); root.innerHTML = '';
    const liveNote = liveDataNote(); if (liveNote) root.appendChild(liveNote);
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    // 档位主卡
    const hero = el('div', 'card plan-hero');
    hero.innerHTML = `
      <h3><span class="bar"></span>今日操作档位</h3>
      <div class="plan-hero-row">
        <div class="plan-gear ${c.stg.cls}-txt">${c.stg.gear}</div>
        <div class="plan-pos"><div class="tiny">建议仓位</div><div class="num">${c.stg.pos}</div></div>
      </div>
      <div class="cycle-band">${['冰点', '启动', '发酵', '高潮', '退潮'].map((n, i) => `<div class="cycle-seg ${c.stg.cls} ${i === c.idx ? 'active' : ''}" title="${n}"></div>`).join('')}</div>
      <div class="cycle-labels">${['冰点', '启动', '发酵', '高潮', '退潮'].map((n, i) => `<span class="cycle-label ${i === c.idx ? 'on' : ''}">${n}</span>`).join('')}</div>
      <div class="cycle-desc tiny">情绪「${c.stg.name}」：${c.stg.desc}</div>
      <div class="cycle-tip">💡 ${c.stg.tip}</div>`;
    root.appendChild(hero);
    // 明日关注标的
    const watch = el('div', 'card');
    watch.innerHTML = `<h3><span class="bar"></span>明日关注标的（${picked.length}）</h3>
      <div class="tiny" style="margin-bottom:6px">由妖股评分 TOP、最高板空间龙头、次高位卡位、首板晋级弱转强四路信号自动汇总，点击查看详情。</div>`;
    if (!picked.length) watch.appendChild(el('div', 'empty', '今日暂无符合条件标的'));
    picked.forEach((s) => {
      const r = el('div', 'monster-row');
      r.innerHTML = `<span class="prob-pill" style="width:54px;text-align:center">${s.probability}%</span>
        <div style="flex:1;min-width:0"><div class="name">${s.name}</div>
          <div class="code">${s.code} · ${s.continueText || (s.boards + '板')} · ${s.sector || '—'}</div>
          <div class="rtags"><span class="rtag rt-good">${s.why}</span></div></div>
        <div style="text-align:right"><div class="price">${fmt(s.price)}</div><div style="color:var(--up);font-weight:700">${pctTxt(s.changePct)}</div></div>`;
      r.style.cursor = 'pointer'; r.onclick = () => openDetail(s.code);
      watch.appendChild(r);
    });
    root.appendChild(watch);
    // 止损纪律
    const rule = el('div', 'card');
    rule.innerHTML = `<h3><span class="bar"></span>止损纪律（通用风控参考）</h3>
      <div class="kv">
        <div><div class="k">单票止损</div><div class="val down">-5% 无条件离场</div></div>
        <div><div class="k">总仓回撤</div><div class="val warn-txt">4% 即降仓一半</div></div>
        <div><div class="k">断板</div><div class="val">次日不涨停即走</div></div>
        <div><div class="k">炸板</div><div class="val">尾盘炸板不加仓</div></div>
      </div>
      <div class="disclaimer" style="margin-top:10px">以上纪律为连板打板场景的通用风控参考，非投资建议；请结合自身风险承受能力调整。</div>`;
    root.appendChild(rule);
  }

  // =========================================================================
  // 渲染：复盘文章（自动生成当日复盘，可复制）
  // =========================================================================
  function buildJournalText() {
    const d = state.data, c = sentimentCycle(), m = c.m;
    const t = (v, u) => v != null ? v + (u || '') : '—';
    const lv = d.ladder || [];
    const ladderTxt = lv.length
      ? lv.map((tier) => `${tier.boards}板 ${tier.stocks.length} 只`).reverse().join('、') + '。'
      : '今日无连板梯队。';
    const secs = (d.sectors || []).slice().sort((a, b) => b.limitCount - a.limitCount).slice(0, 5);
    const secTxt = secs.length ? secs.map((s) => `${s.sector}(${s.limitCount})`).join('、') : '—';
    const lhbTop = (d.lhb || []).slice().sort((a, b) => (b.net_value || 0) - (a.net_value || 0)).slice(0, 3)
      .map((x) => `${x.name} ${yuanYi(x.net_value)}`).join('、') || '—';
    const { picked } = planData();
    return [
      `【妖股雷达】${d.date} 复盘：情绪「${c.stg.name}」，档位「${c.stg.gear}」`,
      '',
      `一、市场情绪`,
      `今日涨停 ${t(m.limitUp, ' 家')}，连板 ${t(m.lianban, ' 家')}，最高 ${t(m.maxBoards, ' 板')}，炸板率 ${t(m.zhabanRate, '%')}，封板率 ${t(m.sealRate, '%')}，晋级率 ${t(m.promo, '%')}。情绪处于「${c.stg.name}」阶段：${c.stg.desc}操作上：${c.stg.tip}`,
      '',
      `二、梯队结构`,
      `连板梯队：${ladderTxt}`,
      '',
      `三、题材主线`,
      `涨停集中在前排题材：${secTxt}。主流题材决定赚钱效应的方向，优先在主线内寻找中军与梯队低吸机会。`,
      '',
      `四、资金动向`,
      `龙虎榜净买入居前：${lhbTop}。机构与游资共同参与的标的，次日溢价概率相对更高。`,
      '',
      `五、明日策略`,
      `情绪档位「${c.stg.gear}」，建议仓位 ${c.stg.pos}。明日关注：${picked.slice(0, 6).map((s) => s.name).join('、') || '—'}。`,
      `止损纪律：单票 -5% 无条件离场；总仓回撤 4% 即降仓一半。`,
      '',
      `（本文由妖股雷达基于 ${d.date || '—'} 公开行情数据自动生成，数据源：${sourceText(d)}，不构成投资建议。）`
    ].join('\n');
  }
  function renderJournal() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const text = buildJournalText();
    const card = el('div', 'card journal-card');
    card.innerHTML = `<h3><span class="bar"></span>复盘文章（${d.date} 自动生成）<button class="btn ghost copy-btn" style="margin-left:auto;padding:4px 12px;font-size:12px">📋 复制全文</button></h3>
      <pre class="journal-body">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
      <div class="tiny" style="margin-top:8px">内容全部来自当日真实数据推导，点「复制全文」可粘贴到笔记 / 群里。</div>`;
    card.querySelector('.copy-btn').onclick = async (e) => {
      try { await navigator.clipboard.writeText(text); e.target.textContent = '✓ 已复制'; }
      catch (err) {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove(); e.target.textContent = '✓ 已复制';
      }
      setTimeout(() => { e.target.textContent = '📋 复制全文'; }, 2000);
    };
    root.appendChild(card);
  }

  // =========================================================================
  // 渲染：每日复盘
  // =========================================================================
  function renderReview() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const nb = noticeBanner(); if (nb) root.appendChild(nb);
    const ov = el('div', 'card');
    const cal = marketCaliber(d);
    const mk = d.market || {};
    const nz = (v) => (v == null ? '—' : v);
    const limitDown = mk.dtCount != null ? mk.dtCount : d.overview.limitDown;
    ov.innerHTML = `<h3><span class="bar"></span>市场概览（${cal.marketDate || d.date}）${caliberLabel({ caliber: cal.kind })}</h3>
      <div class="overview">
        <div class="ov-item"><div class="v up">${nz(cal.limitUp)}</div><div class="l">涨停</div></div>
        <div class="ov-item"><div class="v down">${nz(limitDown)}</div><div class="l">跌停</div></div>
        <div class="ov-item"><div class="v brand">${nz(cal.lianban)}</div><div class="l">连板</div></div>
        <div class="ov-item"><div class="v">${nz(cal.zhaban)}</div><div class="l">炸板</div></div>
        <div class="ov-item"><div class="v up">${nz(cal.maxBoards)}</div><div class="l">最高板</div></div>
        <div class="ov-item"><div class="v brand">${cal.sealRate != null ? cal.sealRate + '%' : '—'}</div><div class="l">封板率</div></div>
      </div>
      ${caliberNoteHtml({ caliberNote: cal.note })}`;
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
  // =========================================================================
  // 新增：辅助信号 · 尾盘封单变化（核心警示） & 高标个股与明日关注
  // 复用快照新字段 sm(午盘封单万元) / decay(封单衰减率%)；无午盘数据时优雅降级。
  // 注意：app 内股票对象字段名与快照不同（boards=连板 / openTimes=开板次数 /
  //       turnover=换手率% / concepts=题材 / sector=题材首项 / seal=收盘封单万元 / cap=流通市值亿）。
  // =========================================================================
  // 封成比 = 封单(万元) ÷ (流通市值(亿) × 100 × 换手率(%))
  function sealRatio(s) {
    if (!s || s.seal == null || s.cap == null || s.turnover == null || s.turnover <= 0) return null;
    return Math.round(s.seal / (s.cap * 100 * s.turnover) * 1000) / 1000;
  }
  // 金额格式化：万元数值统一显示为「X.XX亿」（与参考站点一致，且始终带单位，避免 440.94 这类无单位歧义）
  function fmtWan(v) {
    if (v == null || isNaN(v)) return '—';
    return (v / 10000).toFixed(2) + '亿';
  }
  // 尾盘封单变化 · 单只判定（maxSr=高标中封成比最大者，用于「相对最强」）
  // 每条判定都带 desc：解释「为什么」+「明日怎么走」，对标参考站点的判定说明
  function deriveSealJudgement(s, maxSr) {
    const sr = sealRatio(s);
    const srTxt = sr != null ? sr.toFixed(2) : '—';
    if (sr != null && sr < 0.05) return { label: '高危·裸封', cls: 'rt-high', desc: `封单近乎为零（封成比 ${srTxt}），明日必开板` };
    if (sr != null && sr < 0.1) return { label: '高危', cls: 'rt-high', desc: `封成比仅 ${srTxt}，资金封板意愿极弱，明日断板概率高` };
    if (s.decay != null && s.decay <= -50) return { label: '高危·封单逃逸', cls: 'rt-high', desc: `午盘 ${fmtWan(s.sm)} → 收盘 ${fmtWan(s.seal)}（衰减 ${s.decay}%），资金系统性撤离，明日断板风险极高` };
    if ((s.openTimes || 0) >= 3) return { label: '假回封', cls: 'rt-warn', desc: `开板 ${s.openTimes} 次尾盘强封，制造连板数据，实为垂死封板，明日大概率低开断板` };
    if (sr != null && s === maxSr) return { label: '相对最强', cls: 'rt-good', desc: `全场封成比最强（${srTxt}）且封单稳定，连板空间核心` };
    if (s.boards === 2 && sr != null) return { label: '新晋', cls: 'rt-youzi', desc: `收盘封单靠前（${fmtWan(s.seal)}），新晋接力候选` };
    return { label: '关注', cls: 'rt-org', desc: '封单与封成比中性，列入观察，等明日确认' };
  }
  // 辅助信号 · 尾盘封单变化（核心警示）
  function renderSealChangeCard(dd) {
    const stocks = (dd && dd.stocks) || [];
    const highs = stocks.filter((s) => (s.boards || 1) >= 2);
    // 高标中封成比最大者（用于「相对最强」判定）
    let maxSr = null, maxSrVal = -1;
    highs.forEach((s) => { const r = sealRatio(s); if (r != null && r > maxSrVal) { maxSrVal = r; maxSr = s; } });
    // 顶部警示：高标中封单显著衰减(<=−50%) 或 封成比<0.1
    const dangerCount = highs.filter((s) => {
      const sr = sealRatio(s);
      return (s.decay != null && s.decay <= -50) || (sr != null && sr < 0.1);
    }).length;
    const banner = dangerCount > 0
      ? `<div class="seal-warn-banner">⚠ 封单大逃亡：${dangerCount} 只高标封单显著衰减/封成比过低，明日断板风险高</div>`
      : '';
    // 精确回封率：曾开板>0 的只数 ÷ (曾开板只数 + 开板≥3只数)
    const reseal = stocks.filter((s) => (s.openTimes || 0) > 0).length;
    const blast = stocks.filter((s) => (s.openTimes || 0) >= 3).length;
    const rate = (reseal + blast) ? Math.round((reseal / (reseal + blast)) * 100) : null;
    const rateTxt = rate != null ? rate + '%' : '—';
    // 是否有午盘封单数据（无则优雅降级提示）
    const hasMid = stocks.some((s) => s.sm != null);
    const noMidHint = hasMid ? '' : `<div class="risk-note" style="margin:8px 0">今日无午盘封单数据（需在交易时段 11:35 采集、19:00 合并），封单变化暂不计算，仅展示收盘封成比与开板</div>`;
    // 回封质量（v20261109a）：开板次数分布 + 弱封占比，对标参考看板「回封质量极差」判定
    const open3 = stocks.filter((s) => (s.openTimes || 0) >= 3).length;
    const open5 = stocks.filter((s) => (s.openTimes || 0) >= 5).length;
    const open10 = stocks.filter((s) => (s.openTimes || 0) >= 10).length;
    const srValid = stocks.filter((s) => sealRatio(s) != null);
    const weakSeal = srValid.filter((s) => sealRatio(s) < 0.15).length;
    const weakPct = srValid.length ? Math.round(weakSeal / srValid.length * 100) : null;
    const quality = `<div class="quality-strip">
        <span class="qchip">曾开板 <b>${reseal}</b> 只</span>
        <span class="qchip ${open3 ? 'warn' : ''}">开板≥3次 <b>${open3}</b> 只</span>
        <span class="qchip ${open5 ? 'bad' : ''}">开板≥5次 <b>${open5}</b> 只</span>
        ${open10 ? `<span class="qchip bad">开板≥10次 <b>${open10}</b> 只</span>` : ''}
        <span class="qchip ${weakPct != null && weakPct >= 30 ? 'bad' : ''}">弱封(封成比&lt;0.15) <b>${weakSeal}/${srValid.length}</b>${weakPct != null ? ' · ' + weakPct + '%' : ''}</span>
      </div>
      <div class="tiny" style="margin:0 0 6px">${open3 >= 3 ? `⚠ 回封质量偏差：${open3} 只开板≥3次仍勉强回封，属尾盘凑数封板` : '回封质量尚可：未见大规模反复开板'}。本快照仅含收盘涨停股，炸板股不在池内，故不虚构「失守 / 炸板金额」。</div>`;
    // 高标稳定性表（v20261109b：默认风险优先排序，高危股置顶；表头可点击换序）
    tableData.seal = highs.map((s) => ({ s, j: deriveSealJudgement(s, maxSr), sr: sealRatio(s) }));
    const rows = sortedTableRows('seal').map(sealRowHtml).join('');
    return `<div class="card seal-change-card" id="sealCard">
      <h3><span class="bar"></span>辅助信号 · 尾盘封单变化（核心警示）</h3>
      ${banner}
      <div class="tiny" style="margin:6px 0 4px">精确回封率 <b style="color:var(--up)">${rateTxt}</b>（曾开板 ${reseal} 只 / 其中开板≥3次 ${blast} 只）</div>
      ${quality}
      ${noMidHint}
      <div class="tbl-wrap"><div class="scroll-hint">← 左右滑动查看全部列 · 点击表头可排序 →</div>
      <table class="mini-table">
        <thead><tr>
          <th class="sortable" data-table="seal" data-key="name">标的 <i class="sort-ind"></i></th>
          <th class="num sortable" data-table="seal" data-key="boards">连板 <i class="sort-ind"></i></th>
          <th class="num sortable" data-table="seal" data-key="sm">午盘封单 <i class="sort-ind"></i></th>
          <th class="num sortable" data-table="seal" data-key="seal">收盘封单 <i class="sort-ind"></i></th>
          <th class="num sortable" data-table="seal" data-key="decay">衰减 <i class="sort-ind"></i></th>
          <th class="num sortable" data-table="seal" data-key="sr">封成比 <i class="sort-ind"></i></th>
          <th class="sortable" data-table="seal" data-key="risk">判定 <i class="sort-ind"></i></th>
        </tr></thead>
        <tbody id="sealTbody">${rows || '<tr><td colspan="7" class="empty">今日无连板高标</td></tr>'}</tbody>
      </table></div>
      <div class="tiny" style="margin-top:6px;color:var(--ink-3)">默认按风险优先排序（高危裸封 / 封单逃逸置顶），点击表头可切换排序方向。</div>
    </div>`;
  }

  function sealRowHtml(r) {
    const s = r.s, j = r.j, sr = r.sr;
    const dec = s.decay != null
      ? `<td class="num ${s.decay <= -50 ? 'decay-neg' : (s.decay >= 0 ? 'decay-pos' : '')}">${s.decay > 0 ? '+' : ''}${s.decay}%</td>`
      : '<td class="num">—</td>';
    return `<tr>
      <td>${s.name}<span class="code"> ${s.code}</span></td>
      <td class="num">${s.boards}</td>
      <td class="num">${s.sm != null ? fmtWan(s.sm) : '—'}</td>
      <td class="num">${s.seal != null ? fmtWan(s.seal) : '—'}</td>
      ${dec}
      <td class="num">${sr != null ? sr.toFixed(2) : '—'}</td>
      <td><span class="rtag ${j.cls}">${j.label}</span><div class="jdesc" title="${esc(j.desc)}">${j.desc}</div></td>
    </tr>`;
  }
  // 高标个股与明日关注 · 单只状态信号
  // ctx: { maxBoard, maxSrByTop(最高板组内封成比最大者), topB2Seal(b=2 组内封单最大者) }
  function deriveWatchSignal(s, ctx) {
    const sr = sealRatio(s);
    const srTxt = sr != null ? sr.toFixed(2) : '—';
    if (sr != null && sr < 0.1) return { label: '高危·不接力', cls: 'rt-high', desc: `封成比仅 ${srTxt}，封板不牢，不参与接力` };
    if (s.decay != null && s.decay <= -50) return { label: '高危·不接力', cls: 'rt-high', desc: `午盘→收盘封单衰减 ${s.decay}%，资金撤离，不接力` };
    if ((s.openTimes || 0) >= 3) return { label: '高危·不接力', cls: 'rt-high', desc: `开板 ${s.openTimes} 次，回封质量差，不参与` };
    if (s.turnover != null && s.turnover >= 35) return { label: '警告·天量', cls: 'rt-warn', desc: `换手 ${s.turnover}%（天量），纯情绪过渡，不追` };
    if (sr != null && s.boards === ctx.maxBoard && s === ctx.maxSrByTop) return { label: '最强·核心', cls: 'rt-good', desc: `最高板且封成比最强（${srTxt}），${s.boards}→${s.boards + 1} 板空间核心，首选` };
    if (s.boards === 2 && sr != null && s.seal === ctx.topB2Seal) return { label: '新晋·候选', cls: 'rt-youzi', desc: `收盘封单靠前（${fmtWan(s.seal)}），${s.boards}→${s.boards + 1} 板接力候选` };
    return { label: '观察', cls: 'rt-org', desc: '封单/封成比中性，列入观察' };
  }
  function watchRowHtml(r) {
    const s = r.s, j = r.j, sr = r.sr;
    return `<tr>
      <td>${s.name}<span class="code"> ${s.code}</span></td>
      <td class="num">${s.boards}</td>
      <td class="num">${s.openTimes || 0}</td>
      <td>${r.concept}</td>
      <td class="num">${sr != null ? sr.toFixed(2) : '—'}</td>
      <td><span class="rtag ${j.cls}">${j.label}</span><div class="jdesc" title="${esc(j.desc)}">${j.desc}</div></td>
    </tr>`;
  }
  // 高标个股与明日关注 · 收盘信号
  function renderHighWatchCard(dd) {
    const stocks = (dd && dd.stocks) || [];
    const highs = stocks.filter((s) => (s.boards || 1) >= 2);
    const maxBoard = highs.reduce((m, s) => Math.max(m, s.boards || 1), 0);
    // 最高板组内封成比最大者
    const topStocks = highs.filter((s) => (s.boards || 1) === maxBoard);
    let maxSrByTop = null, maxSrTopVal = -1;
    topStocks.forEach((s) => { const r = sealRatio(s); if (r != null && r > maxSrTopVal) { maxSrTopVal = r; maxSrByTop = s; } });
    // b=2 组内封单最大者
    const b2 = highs.filter((s) => s.boards === 2);
    const topB2Seal = b2.reduce((m, s) => Math.max(m, s.seal != null ? s.seal : -1), -1);
    const ctx = { maxBoard, maxSrByTop, topB2Seal };
    // 高标个股表（v20261109b：默认风险优先排序，高危不接力置顶；表头可点击换序）
    tableData.watch = highs.map((s) => ({
      s, j: deriveWatchSignal(s, ctx), sr: sealRatio(s),
      concept: (s.concepts && s.concepts[0]) || s.sector || '—'
    }));
    const rows = sortedTableRows('watch').map(watchRowHtml).join('');
    // 明日关注推导
    // ① 进攻首选：最高板且封成比最大
    let attack = null, attackVal = -1;
    topStocks.forEach((s) => { const r = sealRatio(s); if (r != null && r > attackVal) { attackVal = r; attack = s; } });
    // ② 接力候选：封成比最高的 b=2
    let relay = null, relayVal = -1;
    b2.forEach((s) => { const r = sealRatio(s); if (r != null && r > relayVal) { relayVal = r; relay = s; } });
    // ③ 低吸观察：首板/2板中封成比最高且 >=0.3
    let dip = null, dipVal = 0.299;
    stocks.filter((s) => (s.boards === 1 || s.boards === 2)).forEach((s) => {
      const r = sealRatio(s); if (r != null && r >= 0.3 && r > dipVal) { dipVal = r; dip = s; }
    });
    const chipDesc = (s) => s ? deriveWatchSignal(s, ctx).desc : '';
    const chip = (s, why) => s
      ? `<span class="chip" data-code="${s.code}" title="${chipDesc(s)}">${s.name}<b> ${s.boards}板</b><i>${why}</i></span>`
      : '';
    const chipsHtml = `<div class="tomorrow-chips">
        ${chip(attack, '进攻首选')}${chip(relay, '接力候选')}${chip(dip, '低吸观察')}
        ${!attack && !relay && !dip ? '<span class="tiny">暂无明显信号</span>' : ''}
      </div>`;
    const rules = [
      '禁止接封成比 &lt; 0.1 的涨停',
      '不碰开板 ≥ 3 的回封票',
      '单票 −5% 或破 5 日线清仓'
    ].map((t) => `<li>${t}</li>`).join('');
    // 明日进攻量化条件（v20261109a）：阈值全部由「今日基线」动态推导，不写死外部数值
    const ov = (dd && dd.overview) || {}, m = sentimentCycle().m;
    const todayLimit = ov.limitUp || 0;
    const todayBlast = m.zhabanRate;
    const leader = topStocks.slice().sort((a, b) => (b.seal || 0) - (a.seal || 0))[0] || null;
    const leaderSeal = leader && leader.seal != null ? leader.seal : null;
    const conds = [
      `涨停家数 ≥ <b>${todayLimit} 家</b>（今日基线，不缩量）`,
      todayBlast != null ? `炸板率 ≤ <b>${Math.max(0, todayBlast - 5)}%</b>（今日 ${todayBlast}%，需改善 5 个百分点）` : '炸板率数据缺失，暂不设阈值',
      leaderSeal != null ? `<b>${leader.name}</b> 封单 ≥ <b>${fmtWan(leaderSeal)}</b>（今日封单，不再衰减）` : '龙头封单数据缺失，暂不设阈值'
    ];
    const gear = sentimentCycle().stg;
    return `<div class="card hw-card">
      <h3><span class="bar"></span>高标个股与明日关注 · 收盘信号</h3>
      <div class="tbl-wrap"><div class="scroll-hint">← 左右滑动查看全部列 · 点击表头可排序 →</div>
      <table class="mini-table hw-table">
        <thead><tr>
          <th class="sortable" data-table="watch" data-key="name">标的 <i class="sort-ind"></i></th>
          <th class="num sortable" data-table="watch" data-key="boards">连板 <i class="sort-ind"></i></th>
          <th class="num sortable" data-table="watch" data-key="openTimes">开板 <i class="sort-ind"></i></th>
          <th class="sortable" data-table="watch" data-key="concept">概念 <i class="sort-ind"></i></th>
          <th class="num sortable" data-table="watch" data-key="sr">封成比 <i class="sort-ind"></i></th>
          <th class="sortable" data-table="watch" data-key="risk">状态 <i class="sort-ind"></i></th>
        </tr></thead>
        <tbody id="watchTbody">${rows || '<tr><td colspan="6" class="empty">今日无连板高标</td></tr>'}</tbody>
      </table></div>
      <div class="tiny" style="margin-top:6px;color:var(--ink-3)">默认按风险优先排序（高危·不接力置顶），点击表头可切换排序方向。</div>
      <div class="pq-section tiny" style="margin-top:10px">明日关注</div>
      ${chipsHtml}
      <div class="attack-box">
        <div class="attack-title">明日进攻条件 · 三条件须同时满足</div>
        <ul class="attack-list">${conds.map((c) => `<li>${c}</li>`).join('')}</ul>
        <div class="attack-verdict">满足 → 维持/上调至 <b>${gear.gear}</b>（${gear.pos}）；缺一 → 降一档，优先减掉弱封票。</div>
        <div class="tiny" style="margin-top:6px;color:var(--ink-3)">阈值为今日收盘数据的相对基线，随每日快照自动更新；不使用外部写死数值。</div>
      </div>
      <div class="risk-note" style="margin-top:10px">风控铁律：<ul style="margin:4px 0 0;padding-left:18px">${rules}</ul></div>
    </div>`;
  }

  // 顶部快捷锚点：仅在雷达页存在（#view 切 tab 会被清空）
  function anchorBarHtml() {
    const items = [
      ['zone-verdict', '今日结论'], ['zone-signal', '核心警示'], ['zone-detail', '结构与明细'],
      ['sealCard', '封单警示'], ['radarList', '筛选结果']
    ];
    return `<nav class="anchor-bar" aria-label="页面快捷导航">${items.map(([id, t]) => `<a href="#${id}" data-target="${id}">${t}</a>`).join('')}</nav>`;
  }

  function renderRadar() {
    const d = state.data, root = $('#view'); root.innerHTML = '';
    const liveNote = liveDataNote(); if (liveNote) root.appendChild(liveNote);
    root.insertAdjacentHTML('beforeend', anchorBarHtml());
    const zones = readZones();
    // 分区顺序沿用原有 16 张卡片顺序，仅按「情绪流复盘」叙事层次分组（v20261109b）
    const makeZone = (id, title, sub, count) => {
      const sec = el('section', 'zone' + (zones[id] ? ' collapsed' : ''));
      sec.id = 'zone-' + id;
      sec.innerHTML = `<div class="zone-head" data-zone="${id}">
        <div class="zone-txt"><b>${title}</b><span class="zone-sub">${sub}</span><span class="zone-count">${count} 项</span></div>
        <button class="zone-toggle" type="button" aria-label="折叠或展开分区">${zones[id] ? '＋' : '－'}</button>
      </div><div class="zone-body"></div>`;
      root.appendChild(sec);
      return sec.querySelector('.zone-body');
    };
    // 兼容「HTML 字符串」与「DOM 节点」两种渲染方式，保留筛选卡原有的事件绑定
    const add = (body, x) => {
      if (x == null || x === '') return;
      if (typeof x === 'string') body.insertAdjacentHTML('beforeend', x);
      else body.appendChild(x);
    };
    const z1 = makeZone('verdict', '① 今日结论', '情绪阶段 · 六维评分 · 操作档位', 5);
    const z2 = makeZone('signal', '② 核心警示与信号', '梯队 · 封单变化 · 明日进攻', 6);
    const z3 = makeZone('detail', '③ 结构与明细', '筛选 · 行业 · 概念 · 指标口径', 6);

    add(z1, noticeBanner());
    add(z1, renderVerdictCard());
    add(z1, renderSentimentCard());
    add(z1, emotionTilesCard());
    add(z1, renderSixDimCard());

    add(z2, pyramidCard());
    add(z2, renderLadderHealthCard());
    add(z2, riskSignalCard());
    add(z2, renderSealChangeCard(d));
    add(z2, planQuickCard());
    add(z2, renderHighWatchCard(d));

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
    const sortSel = el('select'); sortSel.className = 'sort-select';
    Object.keys(SORT_LABELS).forEach((k) => {
      const o = el('option', null, SORT_LABELS[k]); o.value = k;
      if (k === state.filter.sortKey) o.selected = true;
      sortSel.appendChild(o);
    });
    const line3 = el('div', 'filter-line'); line3.innerHTML = '<label>排序</label>'; line3.appendChild(sortSel);
    f.appendChild(line1); f.appendChild(line2); f.appendChild(line3);
    sortSel.onchange = () => {
      state.filter.sortKey = sortSel.value;
      const t = document.getElementById('resultTitle');
      if (t) t.textContent = '结果（按' + (SORT_LABELS[state.filter.sortKey] || '妖股概率') + '）';
      renderRadarList();
    };
    card.appendChild(f);
    const btn = el('button', 'btn', '开始筛选');
    btn.style.marginTop = '12px';
    btn.onclick = () => { state.filter.minBoards = +minSel.value; state.filter.sector = secSel.value; renderRadarList(); };
    card.appendChild(btn); add(z3, card);

    const res = el('div', 'card');
    res.innerHTML = `<h3><span class="bar"></span><span id="resultTitle">结果（按${SORT_LABELS[state.filter.sortKey] || '妖股概率'}）</span></h3><div id="radarList"></div>`;
    add(z3, res);
    renderRadarList();
    // 涨停行业分布（对标豆包雷达页底部条形图）
    add(z3, renderSectorDistCard());
    // 主线概念热度解读 + 风险提示（v20261109a）
    add(z3, renderConceptInsightCard());
    add(z3, renderRiskExtCard());
    // 核心指标口径注解（v20261110a）：12 项定义 / 阈值 / 本站当前值，放在「数据口径」分区末位
    add(z3, renderMetricGlossaryCard());

    syncSortIndicators('seal');
    syncSortIndicators('watch');
  }
  function renderRadarList() {
    const box = $('#radarList'); if (!box) return;
    const sec = state.filter.sector, key = state.filter.sortKey || 'probability';
    const num = (v) => (v == null || isNaN(v) ? null : v);
    const SORT_GET = {
      probability: (s) => s.probability,
      boards: (s) => s.boards || 1,
      seal: (s) => s.seal,
      sr: (s) => sealRatio(s)
    };
    const get = SORT_GET[key] || SORT_GET.probability;
    const list = state.data.stocks.filter((s) =>
      (s.boards || 1) >= state.filter.minBoards &&
      (sec && sec !== '全部题材' ? (s.concepts || [s.sector]).includes(sec) : true)
    ).sort((a, b) => {
      if (key === 'risk') {
        // 风险代理：封成比升序（越弱越前）→ 开板次数降序 → 封单衰减升序；空值恒排最后
        const ra = num(sealRatio(a)), rb = num(sealRatio(b));
        if (ra == null && rb != null) return 1;
        if (rb == null && ra != null) return -1;
        if (ra != null && rb != null && ra !== rb) return ra - rb;
        const oc = (b.openTimes || 0) - (a.openTimes || 0); if (oc) return oc;
        const da = num(a.decay), db = num(b.decay);
        if (da != null && db != null && da !== db) return da - db;
        return (b.probability || 0) - (a.probability || 0);
      }
      const va = num(get(a)), vb = num(get(b));
      if (va == null && vb != null) return 1;
      if (vb == null && va != null) return -1;
      if (va == null && vb == null) return 0;
      return (vb - va) || ((b.boards || 1) - (a.boards || 1));
    });
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
    // v20261112b QA 回归项 3：em-live 不得落回「静态快照 / 演示」。
    // 三分支：同花顺实时接口 / 东财实时涨停池映射 / 静态收盘快照。
    const stats = d.stats;
    const srcKind = (d.source === 'api') ? 'api'
      : ((d.source === 'em-live' || d.statsSource === 'em-live' || (stats && stats.source === 'em-live')) ? 'em-live' : 'snapshot');
    const mktMeasured = !!(d.market && d.market.ok && d.market.zbCount != null);
    const capCaliber = mktMeasured ? 'market' : (srcKind === 'api' ? 'market' : 'estimate');
    const estSuffix = capCaliber === 'estimate' ? '（估算）' : '';
    let hintTxt;
    if (srcKind === 'api') hintTxt = '当前为<b>同花顺实时接口口径</b>（真实炸板家数 / 封板率）。';
    else if (srcKind === 'em-live') hintTxt = '当前为<b>东财实时涨停池映射口径</b>：open_stock_count 是「涨停池内开板≥3 次个股数」、seal_rate 是「未开板≥3 次比例」，<b>不是全市场炸板家数 / 封板率</b>；全市场实测炸板率 / 封板率取当日行情（东财涨停池 / 炸板池），缺项标「—」。数据时点：' + esc(d.dataTimeLabel || '—') + '。';
    else hintTxt = '<b>当前为静态收盘快照口径</b>：open_stock_count 是「涨停池内开板≥3 次个股数」、seal_rate 是「未开板≥3 次比例」，不是全市场炸板家数 / 封板率，仅供参考；全站判定优先使用当日实时行情。';
    hint.innerHTML = `<div class="disclaimer">数据来源：① 涨停强度与晋级统计（limit-up-statistics）——封板率 / 炸板家数 / 连板晋级率；② 龙虎榜个股净额；③ 涨停池封单强度。涨停池接口未直接提供「主力净流入」字段，故以龙虎榜净额与封单锁定程度近似表征资金态度。
      ${hintTxt}</div>`;
    root.appendChild(hint);

    // 涨停强度与晋级（limit-up-statistics 真实数据）
    if (stats) {
      const sr = stats.seal_rate != null ? (Math.round(stats.seal_rate * 1000) / 10) + '%' : '—';
      const card = el('div', 'card');
      card.innerHTML = `<h3><span class="bar"></span>涨停强度与晋级（limit-up-statistics）${caliberLabel({ caliber: capCaliber, intraday: d.intraday })}</h3>
        <div class="cap-stats-kpis">
          <div class="ov-item"><div class="v brand">${sr}</div><div class="l">封板率${estSuffix}</div></div>
          <div class="ov-item"><div class="v up">${stats.limit_up_stock_count != null ? stats.limit_up_stock_count : '—'}</div><div class="l">涨停家数</div></div>
          <div class="ov-item"><div class="v down">${stats.open_stock_count != null ? stats.open_stock_count : '—'}</div><div class="l">炸板家数${estSuffix}</div></div>
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
      card.appendChild(el('div', 'tiny', `数据日期：${stats.trade_date || d.date} · 来源：limit-up-statistics（${statsSourceLabel(d)}） · 数据时点：${d.dataTimeLabel || '—'}`));
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
      status.innerHTML = (dd.source === 'api' || dd.source === 'em-live')
        ? `连接成功 ✓ 已获取 ${dd.stocks.length} 只涨停股（${dd.date} · ${sourceText(dd)}）`
        : (dd.source === 'snapshot' || dd.source === 'em-fallback') ? `接口暂不可达，已启用兜底：${dd.notice || (dd.source === 'snapshot' ? '收盘快照' : '东财降级数据')}`
        : `未取到真实数据：${dd.notice || '已回退演示数据'}`;
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

  /** v20261112c：妖股雷达 / 交易计划页顶部的实时数据时点标注。
   *  两页都走 refreshAll 的 mode='live'（5 秒刷新），但主体 60s 才重绘一次，
   *  因此标注文本由 updateSessionBar() 单独同步，随时跟上最新时点。 */
  function liveDataNote() {
    const d = state.data; if (!d) return null;
    const s = window.YGSession;
    const label = d.dataTimeLabel || (s ? s.dataTimeLabel(d) : '');
    const box = el('div', 'card live-data-note');
    box.innerHTML = `<div class="live-note-head">
        <span class="live-note-dot"></span><b>实时数据</b>
        <span class="live-note-tag js-live-note-tag">${esc(dataShortLabel(d))}</span>
        <span class="live-note-txt js-live-note-txt">${esc(label)}</span>
      </div>
      <div class="live-note-sub tiny">数据源：${esc(sourceText(d))} · 行情日 <b>${esc(d.date || '—')}</b>
        · 每 ${state.refreshSec}s 自动刷新${d.intraday ? '，当前为盘中实时、非收盘定稿，数值会随行情变动' : ''}。
        缺项字段留空或标「? 缺项」，不用估算值冒充实测。</div>`;
    return box;
  }

  // =========================================================================
  // v20261110a · (A) 核心指标口径注解卡
  // 硬约束：所有「本站当前值」均由当前 state.data 实时推导；取不到一律显示「—」
  //         并标注边界，绝不写入参考站数值或任何外部写死数字。
  // 口径复用：炸板率 / 晋级率直接取 sentimentCycle() 的现成算法结果；
  //          晋级率缺失时只说明「另设连板占比代理维度」，不展示代理具体数值，避免被误读为晋级率。
  //          v20261110b：stats 缺失时炸板家数/炸板率不再显示降级 0，改为「—」+ 边界标注。
  // =========================================================================
  function renderMetricGlossaryCard() {
    const d = state.data;
    const ov = d.overview || {};
    const c = sentimentCycle(), m = c.m;
    const cal = marketCaliber(d), mk = d.market || {};
    const live = cal.kind === 'market';
    const EDGE = '需昨日快照 / 外部行情，本快照不含';
    const noZhaban = !live && (!d.stats || d.stats.open_stock_count == null);
    const ZEDGE = '本快照 stats 缺少炸板统计，数据管线降级为 0 不代表实测值';
    const has = (v) => v != null && !isNaN(v);
    const val = (v, unit) => has(v) ? v + (unit || '') : '—';
    const promoHas = has(m.promo);
    const LIVE_SRC = (d.intraday ? '盘中实时 · 未收盘 ' : '当日收盘 ') + (cal.marketDate || '—') + '（东财公开接口实测）';
    const estEdge = live ? '' : '估算口径，仅供参考：快照 ' + (d.date || '—') + ' 的 open_stock_count / seal_rate 不是全市场炸板家数 / 封板率';
    const premVal = has(mk.prem) ? (mk.prem > 0 ? '+' : '') + mk.prem + '%' : '—';
    const damianVal = has(mk.damian) ? mk.damian + ' 家' : '—';
    const uprVal = has(mk.upRatio) ? mk.upRatio + '%' : '—';
    const amtVal = has(mk.amountToday) ? (Math.round(mk.amountToday / 1e8 * 10) / 10).toLocaleString('zh-CN') + ' 亿' : '—';
    const items = [
      {
        n: '涨停家数', v: val(m.limitUp, ' 家'),
        def: '当日收盘仍封住涨停的个股总数，是赚钱效应的第一手证据，不含炸板个股。',
        thr: '<30 弱 / 30–60 中 / >60 强；连续 3 日递增代表资金扩散，从峰值腰斩代表资金撤离。',
        src: live ? LIVE_SRC + ' · getTopicZTPool 的 data.tc' : '取自 d.overview.limitUp（当日收盘涨停池，共 ' + (d.stocks || []).length + ' 只）'
      },
      {
        n: '跌停家数', v: has(mk.dtCount) ? mk.dtCount + ' 家' : val(ov.limitDown, ' 家'),
        tag: has(mk.dtCount) ? '' : '降级值',
        def: '当日封死跌停的个股总数，是亏钱效应的硬指标。',
        thr: '>10 家说明风险开始传导，>20 家通常对应崩塌期，需无条件降仓。',
        src: has(mk.dtCount) ? LIVE_SRC + ' · getTopicDTPool 的 data.tc'
          : '取自 d.overview.limitDown；本快照不含跌停池，该字段为数据管线降级默认值，不代表全市场实测跌停数'
      },
      {
        n: '炸板家数', v: noZhaban ? '—' : val(m.zhaban, ' 家'), edge: noZhaban ? ZEDGE : estEdge,
        tag: live ? '实时实测' : '估算口径',
        def: '盘中触及涨停但收盘未封住的个股数，炸板即买盘承接失败。',
        thr: '炸板集中在同一板块时，说明该题材当日已被资金否决。',
        src: live ? LIVE_SRC + ' · getTopicZBPool 的 data.tc'
          : (noZhaban ? '需 d.stats.open_stock_count（曾开板只数），本快照不含'
            : '取自 d.overview.zhaban / d.stats.open_stock_count；该字段是「涨停池内开板≥3 次个股数」，非全市场炸板家数')
      },
      {
        n: '炸板率', v: (noZhaban || m.zhabanRate == null) ? '—' : m.zhabanRate + '%',
        edge: (noZhaban || m.zhabanRate == null) ? ZEDGE : estEdge,
        tag: live ? '实时实测' : '估算口径',
        def: '炸板数 ÷（涨停数 + 炸板数）×100%，衡量封板质量。',
        thr: '<30% 承接强、情绪稳；>40% 板上抛压重，次日溢价大概率转负。',
        src: live ? LIVE_SRC + ' · 炸板池 tc ÷（涨停池 tc + 炸板池 tc）×100'
          : (noZhaban ? '需 d.stats.open_stock_count 才能计算，本快照不含'
            : '估算口径：open_stock_count ÷（涨停数 + open_stock_count）；与全市场炸板率不同源，仅供参考')
      },
      {
        n: '最高连板', v: val(m.maxBoards, ' 板'),
        def: '全市场当日最高连板高度（空间板），决定整个市场的天花板。',
        thr: '≤2 板为冰点期，≥5 板进入主升，≥6 板进入手册禁买的高位区。',
        src: '取自 d.overview.maxBoards'
      },
      {
        n: '连板家数', v: val(m.lianban, ' 家'),
        def: '连板（≥2 板）个股的家数，代表梯队厚度而非高度。',
        thr: '梯队厚说明资金有层次可接力；<5 家说明断层，龙头一旦断板无补位。',
        src: '取自 d.overview.lianban（连板池计数）'
      },
      {
        n: '昨日涨停溢价', v: premVal, edge: has(mk.prem) ? '' : EDGE,
        tag: has(mk.prem) ? '实时实测' : '',
        def: '昨日涨停股在今日的平均涨幅，是「接力还有没有钱赚」的直接答案。',
        thr: '>0 有溢价、可接力；<0 为亏钱效应，全线停手。',
        src: has(mk.prem) ? LIVE_SRC + ' · 上一交易日涨停池 ' + (mk.prevDate || '—') + ' 全部代码 → 今日批量行情 f3 涨跌幅算术平均'
          : '需昨日涨停池样本 + 今日行情，收盘快照不含'
      },
      {
        n: '连板晋级率', v: promoHas ? m.promo + '%' : '—', edge: promoHas ? '' : EDGE,
        tag: promoHas && has(mk.promoRate) ? '实时实测' : '',
        def: '昨日 N 板个股中、今日成功晋级 N+1 板的比例，衡量接力意愿强度。',
        thr: '≥35% 说明愿意高位接货；<15% 说明梯队断层，只做首板不做接力。',
        src: has(mk.promoRate) ? LIVE_SRC + ' · 上一交易日 lbc≥2 连板股中今日 lbc 增加者占比'
          : (promoHas ? '取自 d.stats.page_boards 各板位晋级率均值'
            : '当前快照 stats 无 page_boards（需昨日连板池）；情绪六维评分另设「连板占比」作代理维度，二者口径不同，此处不以代理值代替晋级率')
      },
      {
        n: '大面股', v: damianVal, edge: has(mk.damian) ? '' : EDGE,
        tag: has(mk.damian) ? '实时实测' : '',
        def: '昨日涨停、今日跌幅 ≥9%（接近跌停）的个股家数，最灵敏的退潮信号。',
        thr: '≥5 家且连续 2 日即退潮确认，说明接力资金已经开始亏钱。',
        src: has(mk.damian) ? LIVE_SRC + ' · 上一交易日涨停池代码今日 f3 < −9% 的家数'
          : '需昨日涨停池 + 今日跌幅，收盘快照不含'
      },
      {
        n: '中位股死亡', v: '—', edge: EDGE,
        def: '既非龙头也非首板的「中位股」出现大跌 / 跌停的只数。',
        thr: '中位股先于龙头与指数走弱，是退潮的领先指标。',
        src: '需个股角色标注与多日行情，收盘快照不含'
      },
      {
        n: '上涨家数占比', v: uprVal, edge: has(mk.upRatio) ? '' : EDGE,
        tag: has(mk.upRatio) ? '实时实测' : '',
        def: '全市场上涨家数 ÷ 统计总数，衡量普涨 / 普跌的广度。',
        thr: '≥60% 为普涨（情绪高潮常见），<25% 极弱；与涨停家数背离说明赚钱效应集中在极少数票。',
        src: has(mk.upRatio) ? LIVE_SRC + ' · 上证 f104 + 深证 f104 占（涨+跌+平）合计'
          : '需全市场行情宽度接口，收盘快照不含'
      },
      {
        n: '两市成交', v: amtVal, edge: has(mk.amountToday) ? '' : EDGE,
        tag: has(mk.amountToday) ? '实时实测' : '',
        def: '沪市 + 深市当日合计成交额（亿元），量能是情绪的燃料。',
        thr: '≥1.2 万亿为活跃可进攻，8000 亿以下为存量博弈，题材持续性普遍打折。',
        src: has(mk.amountToday) ? LIVE_SRC + ' · 上证 f6 + 深证 f6，换算为亿元'
          : '需指数与两市成交额，收盘快照不含'
      }
    ];
    const rows = items.map((it) => {
      const na = it.v === '—';
      const tag = it.tag ? `<span class="metric-tag">${esc(it.tag)}</span>` : '';
      const edge = it.edge ? `<div class="metric-edge">⚠ ${esc(it.edge)}</div>` : '';
      const src = it.src ? `<div class="metric-src">取值：${esc(it.src)}</div>` : '';
      return `<div class="metric-item">
        <div class="metric-head"><span class="metric-name">${esc(it.n)}</span><span class="metric-val${na ? ' na' : ''}">${esc(it.v)}${tag}</span></div>
        <div class="metric-def"><b>口径定义：</b>${esc(it.def)}</div>
        <div class="metric-thr"><b>阈值怎么读：</b>${esc(it.thr)}</div>
        ${edge}${src}
      </div>`;
    }).join('');
    return `<div class="card" id="metricGlossaryCard">
      <h3><span class="bar"></span>核心指标 · 口径注解 ${caliberLabel({ caliber: cal.kind })}</h3>
      <div class="tiny" style="margin-bottom:9px">12 项指标的定义、阈值与本站当前值。${d.intraday ? '当前为盘中实时口径 · 未收盘，数据会变动；' : ''}标「实时实测」的取自 ${esc(cal.marketDate || '—')} 行情接口；标「估算口径」的来自快照、仅供参考；标「—」的无数据，不臆造、不补写。</div>
      ${caliberNoteHtml({ caliberNote: cal.note })}
      <div class="metric-grid">${rows}</div>
      <div class="metric-foot">${esc(d.dataTimeLabel || (window.YGSession ? window.YGSession.dataTimeLabel(d) : ''))}；${d.intraday ? '盘中残缺值不作为收盘定稿，数据会随行情变动。' : ''}指数、成交额、昨日溢价等仅当日实时可得的字段缺项时留空，不用估算值冒充实测。</div>
    </div>`;
  }

  // =========================================================================
  // v20261110c · 判定手册（26 章原文全文）/ 判定工具箱（5 个交互工具）
  // 两个模块各有独立文件，通过 window.YGManual / window.YGToolbox 暴露 render()。
  // 主站只负责把 #view 交给它们并做依赖缺失降级，不干预其内部渲染与事件，
  // 避免与 buildShell() 的全局委托（分区折叠 / 锚点 / 表头排序）互相干扰。
  // =========================================================================
  function renderHandbook() {
    const root = $('#view');
    // 切页 / 换日重绘时统一清空；常规自动刷新已被 refreshAll() 的快照签名拦下，不会走到这里。
    root.innerHTML = '';
    const M = window.YGManual;
    if (!M || typeof M.render !== 'function') {
      root.insertAdjacentHTML('beforeend', '<div class="card"><div class="empty">完整手册未加载，请刷新页面重试</div></div>');
      return;
    }
    M.render(root);
  }

  function renderToolbox() {
    const root = $('#view');
    // 与手册页同理：这里只在「切页 / 真正换了快照」时执行；工具箱模块级 PERSIST 会恢复输入、勾选、结果与当前工具。
    root.innerHTML = '';
    const T = window.YGToolbox;
    if (!T || typeof T.render !== 'function') {
      root.insertAdjacentHTML('beforeend', '<div class="card"><div class="empty">判定工具箱未加载，请刷新页面重试</div></div>');
      return;
    }
    T.render(root, state.data);
  }

  // =========================================================================
  // v20261110d · 7 个一级栏目页：今日数据卡 + 判定工具 + 手册对应章节原文
  // v20261110e · 判定工具 / 手册章节默认折叠且「点开才渲染」，避免进页面就加载重手册。
  // =========================================================================
  const TOOL_NAMES = { thermo: '情绪温度计', mainline: '主线强度', diverge: '分歧性质', dragon: '龙头体检', locate: '周期定位' };
  // 按栏目记住展开状态：切到该栏目时重置为全关，只有用户主动点开才为 true。
  const viewFold = {};
  // v20261110g：切页回来工具 / 手册重新收起；数据卡区默认展开，用户主动收起后一直记住。
  function resetViewFold(v) {
    const prev = viewFold[v];
    viewFold[v] = { tool: false, manual: false, cards: prev ? prev.cards !== false : true,
      topic: prev ? prev.topic !== false : true };
  }
  const VIEWS = {
    v_dash:  { name: '周期判定', desc: '定位当前情绪周期阶段：八阶段判定、情绪温度与仓位档位', chapters: ['market-cycle', 'thermo'], tool: 'thermo', cards: ['verdict', 'sixdim', 'metric'] },
    v_topic: { name: '题材热点', desc: '判断哪个题材是真主线：板块情绪周期与主线 / 支线判定', chapters: ['sector-cycle', 'mainline'], tool: 'mainline', cards: ['sectorDist', 'concept'] },
    v_turn:  { name: '拐点识别', desc: '识别拐点与分歧性质：八大拐点信号与良性 / 恶性分歧', chapters: ['turning', 'divergence'], tool: 'diverge', cards: ['seal', 'highWatch', 'risk'] },
    v_sw:    { name: '主线切换', desc: '旧主线退潮与新主线启动的切换判据', chapters: ['switch', 'mainline'], tool: 'mainline', cards: ['concept', 'sectorDist'] },
    v_sec:   { name: '主线·龙头·中军·补涨', desc: '梯队结构与四类角色的判定标准', chapters: ['echelon', 'dragon', 'zhongjun', 'buzhang'], tool: 'dragon', cards: ['ladderHealth', 'highWatch'] },
    v_plan:  { name: '操作策略', desc: '十种手法、仓位矩阵与风控纪律', chapters: ['methods', 'position', 'risk'], tool: 'locate', cards: ['verdict', 'risk'] },
    v_rep:   { name: '复盘报告', desc: '速查流程与真实历史案例复盘', chapters: ['quickref', 'cases', 'cases-b'], tool: 'thermo', cards: ['metric', 'sentiment', 'concept'] }
  };
  /* v20261110h：四个栏目的「专题判定」区块，内容由 decision.js 按当日收盘数据自动生成。
     结果优先、长明细折叠；默认展开保证用户不必再点一次就能看到判定结论。 */
  const DECISION = {
    v_turn: { name: '八大拐点 · 逐条信号明细', desc: '命中分数、信号 ✓×?、唯一结论与对应动作' },
    v_sw:   { name: '主线切换判定', desc: '旧主线死亡 7 条 / 新主线成立 7 条 / 终局三选二 / 行业 4 日趋势' },
    v_sec:  { name: '板块主线判定与角色买卖点', desc: '按 100 分评分卡排序，龙头 / 中军 / 补涨逐只给出逻辑与买卖点' },
    v_plan: { name: '具体标的与操作逻辑', desc: '环境 → 策略 → 个股三层链路，优中选优最多 3 只' }
  };
  const CARD_FNS = {
    verdict: renderVerdictCard, sentiment: renderSentimentCard, sixdim: renderSixDimCard,
    ladderHealth: renderLadderHealthCard, sectorDist: renderSectorDistCard,
    concept: renderConceptInsightCard, risk: renderRiskExtCard,
    metric: renderMetricGlossaryCard, seal: renderSealChangeCard, highWatch: renderHighWatchCard
  };
  function renderView(v) {
    const cfg = VIEWS[v];
    if (!cfg) { renderRadar(); return; }
    const d = state.data, root = $('#view'), ov = d.overview || {};
    root.innerHTML = '';
    const cal = marketCaliber(d);
    const zbl = cal.zhabanRate != null ? cal.zhabanRate + '%' : '—';
    const fmtDay = (s) => { const t = String(s || '').replace(/-/g, ''); return /^\d{8}$/.test(t) ? t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8) : String(s || '—'); };
    // v20261112b：数据时点文案统一走 YGSession，杜绝「10:00 已开盘却写盘前 /
    // 当日尚未开盘」这类自相矛盾的说明；仅真实日期错位时保留黄色警告。
    const dtn = d.dataTimeLabel || (window.YGSession ? window.YGSession.dataTimeLabel(d) : '');
    const dateNote = d.marketMismatch
      ? `<div class="view-date-warn">日期提示：当日行情为 <b>${esc(fmtDay(d.market && d.market.date))}</b>，个股明细来自 <b>${esc(fmtDay(d.date))}</b>，两者日期不同。汇总指标以当日行情为准，个股判定会逐项标注自己的数据来源日期，请勿混读。</div>`
      : (dtn ? `<div class="view-date-ok">${esc(dtn)}</div>` : '');
    root.insertAdjacentHTML('beforeend', `<div class="card view-hero">
      <div class="view-hero-top"><span class="view-hero-ic">${ICON[v]}</span>
        <div><h2>${esc(cfg.name)}</h2><div class="view-hero-desc">${esc(cfg.desc)}</div></div>
        ${caliberLabel({ caliber: cal.kind })}</div>
      <div class="view-hero-stats">
        <span>行情 <b>${esc(cal.marketDate || d.date || '—')}</b></span>
        <span>涨停 <b>${cal.limitUp != null ? cal.limitUp : '—'}</b></span>
        <span>最高板 <b>${cal.maxBoards != null ? cal.maxBoards : '—'}</b></span>
        <span>连板 <b>${cal.lianban != null ? cal.lianban : '—'}</b></span>
        <span>炸板率 <b>${zbl}</b></span>
      </div>
      <div class="view-hero-note">数据时点：${esc(dtn || '—')}（${esc(fmtDay(d.date))} · ${esc(sourceText(d))}）· 工具与章节按需展开，自动测算。</div>
      ${caliberNoteHtml({ caliberNote: cal.note })}
      ${dateNote}
    </div>`);

    // v20261112e：题材热点页顶部结论横幅——明确题材排序口径，回答「排序是否正确」
    if (v === 'v_topic') {
      const _secs = (d.sectors || []).slice().sort((a, b) => (b.limitCount || 0) - (a.limitCount || 0));
      const _top = _secs[0] || null;
      const _topName = _top ? _top.sector : '—';
      const _topN = _top ? (_top.limitCount || 0) : 0;
      root.insertAdjacentHTML('beforeend', `<div class="dc-judge" style="margin-top:12px">
        <div class="dc-j-eyebrow">题材热点排序（按涨停家数降序 · 连板占比加权）</div>
        <div class="dc-j-title">当前最强题材 = 【${esc(_topName)}】　${_topN} 家涨停</div>
        <div class="dc-j-sub">排序正确：本页题材按<b>当日涨停家数</b>并叠加<b>连板股占比加权、弱封（封成比&lt;0.15）扣权</b>自动降序，非人工；第 1 名即当前最强题材候选。需要按<b>六维综合评分（100 分）</b>降序的权威主线排名，见「主线·龙头·中军·补涨」页。</div>
      </div>`);
    }

    // v20261110g：数据卡区可一键收起，状态按栏目记忆；默认展开保证当日行情可见。
    // 收起时既不重建卡片，也不影响下方两个懒加载块。
    const fold = viewFold[v] || (viewFold[v] = { tool: false, manual: false, cards: true, topic: true });
    if (fold.topic == null) fold.topic = true;
    const offset = DECISION[v] ? 1 : 0;   // 有专题判定时，后面三块编号顺延
    const idx = (n) => ['①', '②', '③', '④'][n - 1 + offset] || String(n + offset);

    // v20261110h：① 专题判定（拐点 / 切换 / 板块角色 / 操作策略）
    // 内容按当日收盘行情自动生成，折叠状态按栏目记忆，默认展开。
    if (DECISION[v]) {
      const dc = DECISION[v];
      const sec0 = el('section', 'view-section');
      sec0.innerHTML = `<details class="view-details view-details-topic"${fold.topic === false ? '' : ' open'}>
        <summary class="view-summary">
          <span class="view-sec-idx">①</span>
          <span class="view-summary-main"><b>${esc(dc.name)}</b><em>${esc(dc.desc)} · 按当前数据时点自动判定</em></span>
          <span class="view-fold-hint">点击收起</span>
        </summary>
        <div class="view-fold-body dc-slot"></div>
      </details>`;
      const det0 = sec0.querySelector('details');
      const slot0 = det0.querySelector('.dc-slot');
      const fillTopic = () => {
        if (slot0.dataset.loaded === '1') return;
        slot0.dataset.loaded = '1';
        if (window.YGDecision && typeof window.YGDecision.render === 'function') {
          try { window.YGDecision.render(slot0, v, d); }
          catch (e) { slot0.innerHTML = '<div class="empty">专题判定加载失败，请刷新重试</div>'; }
        } else slot0.innerHTML = '<div class="empty">专题判定模块未加载</div>';
      };
      det0.addEventListener('toggle', () => { fold.topic = det0.open; if (det0.open) fillTopic(); });
      if (det0.open) fillTopic();
      root.appendChild(sec0);
    }

    const sec1 = el('section', 'view-section');
    sec1.innerHTML = `<details class="view-details view-details-data"${fold.cards === false ? '' : ' open'}>
      <summary class="view-summary">
        <span class="view-sec-idx">${idx(1)}</span>
        <span class="view-summary-main"><b>当前行情数据</b><em>按当前数据时点实时推导</em></span>
        <span class="view-fold-hint">点击收起</span>
      </summary>
      <div class="view-fold-body view-cards"></div>
    </details>`;
    const detData = sec1.querySelector('details');
    const cardsBox = detData.querySelector('.view-cards');
    const fillCards = () => {
      if (cardsBox.dataset.loaded === '1') return;
      cardsBox.dataset.loaded = '1';
      cfg.cards.forEach((k) => {
        const fn = CARD_FNS[k]; if (!fn) return;
        try {
          const out = fn(d);
          if (!out) return;                                        // 部分卡片在无数据时返回 ''
          if (typeof out === 'string') cardsBox.insertAdjacentHTML('beforeend', out);
          else if (out.nodeType === 1) cardsBox.appendChild(out);  // renderSectorDistCard 返回 DOM 节点，须保留其 onclick
        } catch (e) { /* 单卡失败不影响整页 */ }
      });
    };
    detData.addEventListener('toggle', () => { fold.cards = detData.open; if (detData.open) fillCards(); });
    if (detData.open) fillCards();
    root.appendChild(sec1);

    // v20261110g：按手册规则的完整推导 / 选股明细已完全移出栏目页，
    // 改由「更多 → 完整推导与选股明细」按需加载模块后再展示。栏目页不再有任何入口与占位 DOM。

    // ② 判定工具 / ③ 手册章节：<details> 默认收起，展开时才渲染（懒加载）。
    const sec2 = el('section', 'view-section');
    sec2.innerHTML = `<details class="view-details" data-lazy="tool"${fold.tool ? ' open' : ''}>
      <summary class="view-summary">
        <span class="view-sec-idx">${idx(2)}</span>
        <span class="view-summary-main"><b>判定工具 · ${esc(TOOL_NAMES[cfg.tool] || '')}</b>
          <em>按当前数据时点自动测算，展开时加载</em></span>
        <span class="view-fold-hint">点击展开</span>
      </summary>
      <div class="view-fold-body">
        <div class="view-fold-links"><button class="view-link" type="button" data-goto="toolbox">打开完整工具箱 →</button></div>
        <div class="view-tool-slot"></div>
      </div>
    </details>`;
    root.appendChild(sec2);

    const sec3 = el('section', 'view-section');
    sec3.innerHTML = `<details class="view-details" data-lazy="manual"${fold.manual ? ' open' : ''}>
      <summary class="view-summary">
        <span class="view-sec-idx">${idx(3)}</span>
        <span class="view-summary-main"><b>手册对应章节（${cfg.chapters.length} 章原文）</b>
          <em>方法论全文，展开时加载</em></span>
        <span class="view-fold-hint">点击展开</span>
      </summary>
      <div class="view-fold-body">
        <div class="view-fold-links"><button class="view-link" type="button" data-goto="handbook">阅读完整 26 章 →</button></div>
        <div class="view-manual-slot"></div>
      </div>
    </details>`;
    root.appendChild(sec3);

    $$('.view-details[data-lazy]', root).forEach((det) => {
      const kind = det.dataset.lazy;
      const mount = () => {
        if (det.dataset.loaded === '1') return;
        det.dataset.loaded = '1';
        mountViewBlock(det, v, d, kind);
      };
      det.addEventListener('toggle', () => {
        fold[kind] = det.open;
        if (det.open) mount();
      });
      if (det.open) mount();   // 重绘时恢复用户主动展开过的状态
    });

    $$('.view-link', root).forEach((b) => { b.onclick = () => switchTab(b.dataset.goto); });
    syncSortIndicators('seal'); syncSortIndicators('watch');
  }

  // 折叠块按需挂载：工具箱 / 手册章节都只在用户主动展开后才创建 DOM 与事件。
  function mountViewBlock(det, v, d, kind) {
    const cfg = VIEWS[v];
    if (kind === 'tool') {
      const slot = det.querySelector('.view-tool-slot');
      if (!slot) return;
      if (window.YGToolbox && typeof window.YGToolbox.render === 'function') {
        try { window.YGToolbox.render(slot, d, { onlyTool: cfg.tool, compact: true }); }
        catch (e) { slot.innerHTML = '<div class="empty">判定工具加载失败，请刷新重试</div>'; }
      } else slot.innerHTML = '<div class="empty">判定工具箱未加载</div>';
    } else {
      const slot = det.querySelector('.view-manual-slot');
      if (!slot) return;
      if (window.YGManual && typeof window.YGManual.render === 'function') {
        try { window.YGManual.render(slot, { chapterIds: cfg.chapters, compact: true, showTree: false }); }
        catch (e) { slot.innerHTML = '<div class="empty">手册章节加载失败，请刷新重试</div>'; }
      } else slot.innerHTML = '<div class="empty">完整手册未加载</div>';
    }
  }

  // =========================================================================
  // v20261110g · 完整推导 / 选股明细：只在「更多 → 完整推导与选股明细」按需加载。
  // 首页不再静态引用 views-deep.js / views-deep.css，首屏少下约 121 KB。
  // =========================================================================
  const DEEP_KEYS = ['v_dash', 'v_topic', 'v_turn', 'v_sw', 'v_sec', 'v_plan', 'v_rep'];
  function loadDeepAssets() {
    if (window.YGViewsDeep && typeof window.YGViewsDeep.render === 'function') return Promise.resolve(true);
    if (loadDeepAssets.p) return loadDeepAssets.p;
    const ver = window.YG_ASSET_V || '20261110g';
    if (!document.querySelector('link[data-yg-deep]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = 'assets/views-deep.css?v=' + ver;
      link.setAttribute('data-yg-deep', '1');
      document.head.appendChild(link);
    }
    loadDeepAssets.p = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'assets/views-deep.js?v=' + ver;
      s.onload = () => resolve(!!(window.YGViewsDeep && window.YGViewsDeep.render));
      s.onerror = () => { loadDeepAssets.p = null; resolve(false); };
      document.body.appendChild(s);
    });
    return loadDeepAssets.p;
  }
  function renderDeepRules() {
    const root = $('#view'), d = state.data;
    const cur = DEEP_KEYS.includes(state.deepView) ? state.deepView : DEEP_KEYS[0];
    state.deepView = cur;
    root.innerHTML = `<div class="card view-hero">
      <div class="view-hero-top"><span class="view-hero-ic">🧭</span>
        <div><h2>完整推导与选股明细</h2>
          <div class="view-hero-desc">按 26 章手册逐条推导 · 内容较长，仅主动打开本页时才加载</div></div></div>
      <div class="view-hero-note">该模块不在栏目页展示；切换下方栏目查看对应推导与优中选优结果。</div>
    </div>
    <div class="card deep-rules-bar"><div class="deep-rules-tabs">
      ${DEEP_KEYS.map((k) => `<button type="button" class="deep-rules-tab${k === cur ? ' active' : ''}" data-deep-view="${k}">${esc(VIEWS[k].name)}</button>`).join('')}
    </div></div>
    <div class="deep-rules-slot" id="deepRulesSlot"><div class="empty">正在按需加载研判模块…</div></div>`;
    const slot = $('#deepRulesSlot');
    $$('.deep-rules-tab', root).forEach((b) => {
      b.onclick = () => { state.deepView = b.dataset.deepView; renderDeepRules(); };
    });
    loadDeepAssets().then((ok) => {
      if (state.tab !== 'deeprules' || !slot.isConnected) return;  // 用户已切走，避免写入旧 DOM
      if (!ok) { slot.innerHTML = '<div class="empty">研判模块加载失败，请刷新重试</div>'; return; }
      try { window.YGViewsDeep.render(slot, state.deepView, d); }
      catch (e) { slot.innerHTML = '<div class="empty">研判模块暂不可用，请刷新重试</div>'; }
    });
  }

  function renderMore() {
    const root = $('#view'); root.innerHTML = '';
    const groups = [
      // v20261112c：与侧栏「题材与个股」分组同名，保证移动端也能按同一语义找到入口
      { t: '题材与个股', keys: ['radar', 'plan'] },
      { t: '复盘记录', keys: ['journal', 'review', 'ladder'] },
      { t: '选股工具', keys: ['scan', 'tactics', 'lhb', 'capital', 'history', 'xray'] },
      { t: '方法与速查', keys: ['handbook', 'toolbox'] },
      { t: '我的', keys: ['watch', 'settings'] }
    ];
    let html = `<div class="card view-hero"><div class="view-hero-top"><span class="view-hero-ic">⋯</span>
      <div><h2>更多功能</h2><div class="view-hero-desc">原有全部页面与数据模块，按分组收录</div></div></div></div>`;
    groups.forEach((g) => {
      html += `<div class="card more-group"><h3><span class="bar"></span>${esc(g.t)}</h3><div class="more-grid">` +
        g.keys.map((k) => `<button class="more-item" type="button" data-goto="${k}"><span class="more-ic">${ICON[k]}</span><b>${esc(TABS[k])}</b></button>`).join('') +
        `</div></div>`;
    });
    // v20261110g：长篇推导 / 选股明细的唯一入口放在「更多」页，点击才下载研判模块。
    html += `<div class="card more-deep">
      <button class="deep-entry" type="button" data-goto="deeprules">
        <span class="deep-entry-main"><b>完整推导与选股明细</b>
          <em>按手册规则的逐条依据 / 优中选优表 · 按需加载，不在栏目页展示</em></span>
        <span class="deep-entry-go">打开 →</span>
      </button>
    </div>`;
    root.insertAdjacentHTML('beforeend', html);
    $$('.more-item, .deep-entry', root).forEach((b) => { b.onclick = () => switchTab(b.dataset.goto); });
  }

  // =========================================================================
  // 路由
  // =========================================================================
  function switchTab(tab) {
    state.tab = tab;
    // 每次进入栏目页都重置为全收起：只有用户主动点开才展开（自动刷新重绘则保留展开状态）。
    if (VIEWS[tab]) resetViewFold(tab);
    // 从「更多」进入的旧页面不在一级导航里，保持「更多」高亮，避免导航出现无选中状态。
    // v20261112c：radar / plan 已在侧栏「题材与个股」分组内，侧栏需高亮自身；
    // 移动端 chips 仍只保留 7 栏目 + 更多，故用 more 兜底高亮，避免导航全灭。
    const sideTab = (PRIMARY.includes(tab) || tab === 'radar' || tab === 'plan') ? tab : 'more';
    const chipTab = ORDER.includes(tab) ? tab : 'more';
    $$('.modnav .chip').forEach((t) => t.classList.toggle('active', t.dataset.tab === chipTab));
    $$('.sidebar .nav-item').forEach((t) => t.classList.toggle('active', t.dataset.tab === sideTab));
    // 切页显式清空，杜绝栏目页内嵌的 .tb-wrap / .mn-root 被下一个页面误判为「同模块 DOM」而残留。
    $('#view').innerHTML = '';
    render(); window.scrollTo(0, 0);
  }
  // v20261112b：复盘报告栏目委托给独立模块 YGReport，其余 6 个栏目通用结构不动。
  // 报告页只读 localStorage 冻结存档，不参与 5 秒实时刷新。
  function renderReportView() {
    const root = $('#view');
    if (window.YGReport && typeof window.YGReport.render === 'function') {
      window.YGReport.render(root, reportCtx());
    } else root.innerHTML = '<div class="empty">复盘报告模块未加载，请刷新重试</div>';
  }
  function render() {
    if (!state.data) { $('#view').innerHTML = '<div class="empty">数据加载中…</div>'; return; }
    const map = {
      v_dash: () => renderView('v_dash'), v_topic: () => renderView('v_topic'),
      v_turn: () => renderView('v_turn'), v_sw: () => renderView('v_sw'),
      v_sec: () => renderView('v_sec'), v_plan: () => renderView('v_plan'),
      v_rep: renderReportView, more: renderMore, deeprules: renderDeepRules,
      radar: renderRadar, plan: renderPlan, journal: renderJournal, review: renderReview, ladder: renderLadder, scan: renderScan, tactics: renderTactics, lhb: renderLhb, capital: renderCapital, history: renderHistory, xray: renderXray, watch: renderWatch, handbook: renderHandbook, toolbox: renderToolbox, settings: renderSettings
    };
    (map[state.tab] || renderRadar)();
  }

  function buildShell() {
    const app = $('#app');
    // v20261109c：桌面端顶部栏与侧边栏重复 → 顶部栏只保留给移动端（精简为状态行 + 横向导航），
    // 桌面端由侧边栏承担品牌、分组导航、数据状态与操作按钮。
    // v20261110d：一级导航只留 7 个栏目 + 「更多」，原 15 个页面由更多页收录。
    const groups = [
      { title: '情绪研判', keys: ['v_dash', 'v_turn', 'v_sw'] },
      // v20261112c：妖股雷达 / 交易计划从「更多」提升到主界面「题材与个股」分组
      { title: '题材与个股', keys: ['v_topic', 'v_sec', 'radar', 'plan'] },
      { title: '执行与复盘', keys: ['v_plan', 'v_rep'] },
      { title: '全部功能', keys: ['more'] }
    ];
    const navHtml = groups.map((g) => `<div class="nav-group">
        <div class="nav-group-title">${g.title}</div>
        ${g.keys.map((k) => `<div class="nav-item" data-tab="${k}"><span class="ic">${ICON[k]}</span>${TABS[k]}</div>`).join('')}
      </div>`).join('');
    const chips = ORDER.map((k) => `<div class="chip" data-tab="${k}"><span class="ic">${ICON[k]}</span>${TABS[k]}</div>`).join('');
    app.innerHTML = `
      <aside class="sidebar">
        <div class="logo">📡 妖股雷达</div>
        <div class="side-nav">${navHtml}</div>
        <div class="side-foot">
          <div class="side-status">
            <div class="js-date side-date"></div>
            <div class="side-tags"><span class="source-tag js-source"></span><span class="updated js-updated"></span></div>
          </div>
          <div class="side-actions">
            <button class="theme-btn js-theme-btn" title="切换浅色/深色主题" aria-label="切换浅色/深色主题">☾</button>
            <button class="refresh-btn js-refresh-btn" title="刷新数据" aria-label="刷新">⟳</button>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topwrap">
          ${sessionBarHtml()}
          <div class="mini-status">
            <div class="mini-meta">
              <span class="js-date"></span>
              <span class="source-tag js-source"></span>
              <span class="updated js-updated"></span>
            </div>
            <div class="mini-actions">
              <button class="theme-btn js-theme-btn" title="切换浅色/深色主题" aria-label="切换浅色/深色主题">☾</button>
              <button class="refresh-btn js-refresh-btn" title="刷新数据" aria-label="刷新">⟳</button>
            </div>
          </div>
          <div class="modnav">${chips}</div>
        </header>
        <div class="content" id="view"></div>
      </div>
      <div class="modal-mask" id="modalMask"><div class="modal" id="modal"></div></div>`;
    $$('.modnav .chip').forEach((t) => t.onclick = () => switchTab(t.dataset.tab));
    $$('.sidebar .nav-item').forEach((t) => t.onclick = () => switchTab(t.dataset.tab));
    $$('.js-refresh-btn').forEach((b) => b.onclick = () => refreshAll());
    // v20261112b 顶部状态条：完整手册 / 刷新 / 自动开关
    $$('.js-session-refresh').forEach((b) => b.onclick = () => refreshAll());
    $$('.js-session-auto').forEach((b) => b.onclick = () => {
      state.autoRefresh = !state.autoRefresh;
      saveAutoRefresh();
      if (state.autoRefresh) startAutoRefresh(); else stopAutoRefresh();
      updateTopbar(); updateSessionBar();
    });
    $$('.yg-session-bar [data-goto]').forEach((b) => b.onclick = () => switchTab(b.dataset.goto));
    // 浅色/深色一键切换：两份按钮（侧栏 / 移动端状态条）同步，localStorage 记忆，index.html 预置脚本防闪白
    const TKEY = 'yg_theme_v1';
    const syncThemeBtn = () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      $$('.js-theme-btn').forEach((b) => { b.textContent = dark ? '☀' : '☾'; b.title = dark ? '切换到浅色主题' : '切换到深色主题'; });
      const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', dark ? '#0d1120' : '#6c3df6');
    };
    syncThemeBtn();
    $$('.js-theme-btn').forEach((b) => b.onclick = () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (dark) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', 'dark');
      try { localStorage.setItem(TKEY, dark ? 'light' : 'dark'); } catch (e) {}
      syncThemeBtn();
    });
    $('#modalMask').onclick = (e) => { if (e.target.id === 'modalMask') closeDetail(); };
    // v20261109b：分区折叠 / 锚点跳转 / 表头排序 —— 一次性全局委托，切 tab 重建 #view 后依然生效
    document.addEventListener('click', (e) => {
      const t = e.target;
      const head = t.closest && t.closest('.zone-head');
      if (head) {
        const sec = head.closest('.zone');
        if (sec) toggleZone(sec, head.dataset.zone);
        return;
      }
      const a = t.closest && t.closest('.anchor-bar a');
      if (a) {
        e.preventDefault();
        const target = document.getElementById(a.dataset.target);
        if (!target) return;
        const zone = target.closest && target.closest('.zone');
        if (zone && zone.classList.contains('collapsed')) toggleZone(zone, zone.id.replace('zone-', ''), true);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $$('.anchor-bar a').forEach((n) => n.classList.toggle('active', n === a));
        return;
      }
      const th = t.closest && t.closest('th[data-table]');
      if (th) {
        const id = th.dataset.table, k = th.dataset.key;
        if (!sortState[id]) return;
        if (sortState[id].key === k) sortState[id].dir = sortState[id].dir === 'asc' ? 'desc' : 'asc';
        else { sortState[id].key = k; sortState[id].dir = 'asc'; }
        renderTableBody(id);
      }
    });
  }

  async function init() {
    loadWatch(); loadAutoRefresh();
    buildShell();
    updateSessionBar();
    startSessionClock();
    await loadData();
    switchTab('v_dash');
    if (state.autoRefresh) startAutoRefresh();
    // v20261112b：站点加载即检查一次自动补生成（不依赖用户是否点开复盘报告页）。
    // 纯静态无服务端，故用「唤醒即补」语义；ensureAuto 内部按交易日 / 时段 / 去重守卫。
    try {
      if (window.YGReport && typeof window.YGReport.ensureAuto === 'function') {
        window.YGReport.ensureAuto(reportCtx()).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
