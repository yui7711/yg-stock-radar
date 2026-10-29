#!/usr/bin/env node
/**
 * refresh_snapshot.js — 妖股雷达「每日收盘快照」自动刷新器（自包含版）
 * ---------------------------------------------------------------------------
 * 为什么要有这个脚本：
 *   原来的定时任务依赖「智能体会话内的 MCP 工具」。自动化任务运行在独立会话里，
 *   会话级连接器未绑定时 list_installed_plugins 返回 "No connectors installed"，
 *   ToolSearch 也检索不到 tdx_screener / mx_ashare_finance_data / data_lhb，
 *   于是取数链路整段失败（2026-10-28 收盘任务即因此失败）。
 *
 * 本脚本不依赖任何会话 MCP 能力，取数分三层、逐级降级：
 *   1) 涨停池     ：东方财富 push2ex getTopicZTPool（直连，date 参数真实生效）
 *                    └ 失败 → 通达信连接器（经本地 8787 服务代理）
 *   2) 行情因子   ：腾讯自选股 data_quote + data_fund_flow（经本地 8787 服务代理）
 *                    └ 失败 → 腾讯行情 qt.gtimg.cn 直连（无主力净流入）
 *                    └ 失败 → 东方财富妙想 mx_ashare_finance_data（经本地 8787 服务代理）
 *   3) 龙虎榜机构 ：腾讯自选股 data_lhb（经本地 8787 服务代理）
 *                    └ 失败 → 东方财富 datacenter 直连（RPT_DAILYBILLBOARD_DETAILSNEW + 席位明细）
 *
 * 取到的原始数据统一转成 build_snapshot.js 认识的 tdx / mx / lhb 三种形状，
 * 落盘为 data/_raw_tdx.json、data/_raw_mx.json、data/_raw_lhb.json，
 * 再调用既有生成器 tools/build_snapshot.js 产出 data/snapshot.json。
 *
 * 用法：
 *   node tools/refresh_snapshot.js                # 自动推断交易日（今天，回溯最多 5 天）
 *   node tools/refresh_snapshot.js --date 2026-10-28
 *   node tools/refresh_snapshot.js --no-push       # 只生成不提交
 *   node tools/refresh_snapshot.js --no-generate  # 只落盘原始数据
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const TOOLS = path.join(ROOT, 'tools');
const LOCAL_RADAR = process.env.LOCAL_RADAR_URL || 'http://127.0.0.1:8787';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

function log(...a) { console.log('[refresh]', ...a); }
function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').replace(/[元亿元%]/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
const code6 = (v) => { const m = /(\d{6})/.exec(String(v || '')); return m ? m[1] : null; };
const hhmm = (v) => {
  const s = String(v == null ? '' : v).padStart(6, '0');
  return s.length >= 5 ? `${s.slice(0, 2)}:${s.slice(2, 4)}` : '';
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const compact = (ymdStr) => ymdStr.replace(/-/g, '');

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
  log(`写入 ${path.relative(ROOT, p)}`);
}

// ---------------------------------------------------------------- 1) 涨停池
// 东方财富 push2ex getTopicZTPool：date=YYYYMMDD，返回该交易日真实涨停池。
async function fetchEmZtPool(dateYmd) {
  const d = compact(dateYmd);
  const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt`
    + `&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=${d}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' }, signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  const pool = (j && j.data && j.data.pool) || [];
  if (!pool.length) return null;
  return pool.map((it) => ({
    sec_code: String(it.c || '').replace(/\D/g, ''),
    sec_name: String(it.n || '').trim(),
    now_price: num(it.p) / 1000,
    chg: num(it.zdp),
    发生日期: dateYmd,
    '封单金额0#': num(it.fund),
    '首次涨停时间': hhmm(it.fbt),
    '涨停打开次数': num(it.zbc) || 0,
    // 东财池只给行业题材；作为「涨停原因」的首项，前端概念热度据此聚合
    '涨停原因': String(it.hybk || '').trim() || '其他',
    '连续涨停天数': num(it.lbc) || 1,
    // 板型：首封==最后封且无炸板 → 一字板，否则按换手板处理
    '板型': (it.fbt && it.lbt && String(it.fbt).padStart(6, '0') === String(it.lbt).padStart(6, '0') && !num(it.zbc)) ? '一字板' : '换手板',
    market: String(it.m == null ? '' : it.m),
    _floatCap: num(it.ltsz) / 1e8,   // 流通市值(亿)，东财直连时本地就有
    _turnover: num(it.hs),          // 换手率(%)
  }));
}

// 通达信连接器（经本地 8787 服务代理调用会话外 MCP）
async function tdxScreener(pageSize) {
  const r = await localCall('tdx-connector', 'tdx_screener', { message: '涨停', pageSize });
  const obj = JSON.parse(r.text);
  const arr = obj && obj.data;
  if (!Array.isArray(arr) || !arr.length) throw new Error('通达信返回空');
  return arr;
}

async function localCall(connector, tool, args) {
  const u = `${LOCAL_RADAR}/api/connector-call?connector=${encodeURIComponent(connector)}&tool=${encodeURIComponent(tool)}&args=${encodeURIComponent(JSON.stringify(args || {}))}`;
  const res = await fetch(u, { signal: AbortSignal.timeout(60000) });
  const j = await res.json();
  if (!j.ok) throw new Error(`本地服务调用失败 ${connector}.${tool}: ${j.error || res.status}`);
  return j;
}

// ---------------------------------------------------------------- 2) 行情因子
// 腾讯自选股 data_quote + data_fund_flow：换手率/量比/流通市值/主力净流入
// 服务端有 QPS 限频，故：行情与资金流分开取，资金流失败时单独重试并降级
// （行情不丢，只丢主力净流入 mf），不要让限频把整批因子拉垮。
async function fetchWestockFactors(codes) {
  const withMkt = codes.map((c) => (String(c).startsWith('6') ? 'sh' : 'sz') + c);
  const out = {};
  const CH = 40;

  // ============ 链路 A：行情（换手率/量比/流通市值） ============
  // A1 腾讯自选股 data_quote；A2 腾讯行情 qt.gtimg.cn 直连
  let quoteSource = '';
  try {
    const batchCodes = [];
    for (let i = 0; i < withMkt.length; i += CH) batchCodes.push(withMkt.slice(i, i + CH));
    for (const batch of batchCodes) {
      const q = await localCall('westock-mcp', 'data_quote', { codes: batch.join(',') });
      const qd = JSON.parse(q.text).data || {};
      for (const key of Object.keys(qd)) {
        const rec = qd[key] || {};
        const code = code6(rec.code || key);
        if (!code) continue;
        const o = out[code] || (out[code] = {});
        const cap = num(rec.circulating_market_cap);
        o.cap = cap != null ? cap / 1e8 : null;
        o.to = num(rec.turnover_rate);
        o.vr = num(rec.volume_ratio);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    quoteSource = '腾讯自选股';
    log(`行情来源：腾讯自选股，命中 ${Object.keys(out).length}/${codes.length}`);
  } catch (e) {
    log(`腾讯自选股行情被限频(${e.message})，改用腾讯行情直连`);
    const tq = await fetchTencentQuotes(codes);
    for (const c of Object.keys(tq)) {
      const o = out[c] || (out[c] = {});
      o.cap = tq[c].cap; o.to = tq[c].to; o.vr = tq[c].vr;
    }
    quoteSource = '腾讯行情直连';
    log(`行情来源：腾讯直连，命中 ${Object.keys(tq).length}/${codes.length}`);
  }

  // ============ 链路 B：主力净流入（mf） ============
  // B1 腾讯自选股 data_fund_flow；B2 东方财富妙想
  // 该接口限频很硬，一旦触发通常短时间内整条通道都拒，故只做 1 次探测，失败即切 B2。
  let fundHit = 0;
  let fundSource = '';
  const FUND_CH = 20;
  const fundBatches = [];
  for (let i = 0; i < withMkt.length; i += FUND_CH) fundBatches.push(withMkt.slice(i, i + FUND_CH));
  let fundBlocked = false;
  for (const batch of fundBatches) {
    if (fundBlocked) break;
    try {
      const f = await localCall('westock-mcp', 'data_fund_flow', { codes: batch.join(',') });
      const fd = JSON.parse(f.text).data || {};
      for (const key of Object.keys(fd)) {
        const code = code6((fd[key] || {}).code || key);
        if (!code) continue;
        const flow = ((fd[key] || {}).data || [])[0] || {};
        const mf = num(flow.MainNetFlow);
        if (mf == null) continue;
        const o = out[code] || (out[code] = {});
        o.mf = Math.round((mf / 1e8) * 10000) / 10000;
        fundHit++;
      }
    } catch (e) {
      log(`腾讯资金流被限频，切换妙想通道: ${e.message}`);
      fundBlocked = true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (fundHit) { fundSource = '腾讯自选股'; log(`主力净流入来源：腾讯自选股，命中 ${fundHit}/${codes.length}`); }

  // B2 妙想补齐剩余缺口（腾讯部分成功或全失败都走这里）
  const miss = codes.filter((c) => !out[c] || out[c].mf == null);
  if (miss.length) {
    try {
      const mxmf = await fetchMxMainNet(miss);
      let n = 0;
      for (const c of miss) {
        const v = mxmf[c];
        if (v == null) continue;
        const o = out[c] || (out[c] = {});
        o.mf = v; n++;
      }
      log(`主力净流入来源：妙想补齐 ${n}/${miss.length}`);
      if (n) fundSource = fundSource ? `${fundSource}+妙想` : '妙想';
    } catch (e) {
      log(`妙想补齐主力净流入失败: ${e.message}`);
    }
  }
  const mfCovered = codes.filter((c) => out[c] && out[c].mf != null).length;
  log(`因子覆盖：行情 ${Object.keys(out).length}/${codes.length}（${quoteSource}），主力净流入 ${mfCovered}/${codes.length}（${fundSource || '无'}）`);
  return out;
}

// 妙想：仅取「主力净流入」，输出 亿
async function fetchMxMainNet(codes) {
  const out = {};
  const CH = 30;
  for (let i = 0; i < codes.length; i += CH) {
    const batch = codes.slice(i, i + CH);
    const r = await localCall('mx-ds-mcp', 'mx_ashare_finance_data', {
      query: `${batch.join(',')} 在最近一个交易日的区间主力净流入资金`,
    });
    const sheets = (JSON.parse(r.text).data) || [];
    for (const sheet of sheets) {
      const cols = sheet.columns || [];
      const items = sheet.items || [];
      const metric = String(cols[0] || '');
      if (!/主力净流入/.test(metric)) continue;
      for (const row of items) {
        const c = code6(row[0]);
        if (!c) continue;
        const v = num(row[1]);
        if (v == null) continue;
        out[c] = /万/.test(String(row[1])) ? Math.round((v / 1e4) * 10000) / 10000 : v;
      }
    }
    await new Promise((r2) => setTimeout(r2, 600));
  }
  return out;
}

// 腾讯行情直连兜底：换手率 f[38]、量比 f[49]、流通市值 f[44](亿)、涨跌幅 f[32]、现价 f[3]
async function fetchTencentQuotes(codes) {
  const out = {};
  for (let i = 0; i < codes.length; i += 60) {
    const batch = codes.slice(i, i + 60).map((c) => (String(c).startsWith('6') ? 'sh' : 'sz') + c);
    const res = await fetch(`https://qt.gtimg.cn/q=${batch.join(',')}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const txt = new TextDecoder('gbk').decode(buf);
    for (const line of txt.split('\n')) {
      const m = line.match(/v_([a-z]{2}\d{6})="([^"]*)"/);
      if (!m) continue;
      const code = code6(m[1]);
      if (!code) continue;
      const f = m[2].split('~');
      const g = (i2) => (f[i2] !== undefined && f[i2] !== '' ? parseFloat(f[i2]) : null);
      out[code] = {
        p: g(3), pct: g(32), to: g(38), vr: g(49),
        cap: g(44),
        mf: null, // 腾讯基础行情无主力净流入
      };
    }
  }
  return out;
}

// 东方财富妙想（经本地服务代理），输出与 westock 同构
async function fetchMxFactors(codes, dateYmd) {
  const out = {};
  const CH = 30;
  for (let i = 0; i < codes.length; i += CH) {
    const batch = codes.slice(i, i + CH);
    const r = await localCall('mx-ds-mcp', 'mx_ashare_finance_data', {
      query: `${batch.join(',')} 在${dateYmd}的换手率、量比、流通市值、主力净流入`,
    });
    const sheets = (JSON.parse(r.text).data) || [];
    for (const sheet of sheets) {
      const cols = sheet.columns || [];
      const items = sheet.items || [];
      const layoutA = cols.map((c, j) => (j === 0 ? null : code6(c))).some(Boolean);
      const pick = (label, raw) => {
        const c = code6(label);
        if (!c) return;
        const v = num(raw);
        if (v == null) return;
        const o = out[c] || (out[c] = {});
        if (/流通市值/.test(label)) { if (o.cap == null) o.cap = v; }
        else if (/量比/.test(label)) { if (o.vr == null) o.vr = v; }
        else if (/换手率/.test(label)) { if (o.to == null) o.to = v; }
        else if (/主力净流入/.test(label)) { if (o.mf == null) o.mf = /万/.test(String(raw)) ? v / 1e4 : v; }
      };
      if (layoutA) {
        for (const row of items) for (let j = 1; j < row.length; j++) pick(`${cols[j]} ${row[0]}`, row[j]);
      } else {
        const metric = String(cols[0] || '');
        for (const row of items) pick(`${row[0]} ${metric}`, row[1]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 3) 龙虎榜机构榜
async function fetchLhbWestock(dateYmd) {
  const r = await localCall('westock-mcp', 'data_lhb', { date: dateYmd, type: 'jg' });
  const obj = JSON.parse(r.text);
  const jg = (obj && obj.data && obj.data.jg) || [];
  if (!jg.length) throw new Error('data_lhb 返回空');
  return { date: (obj.data && obj.data.date) || dateYmd, jg };
}

// 东方财富 datacenter 直连兜底：总净额来自列表，机构净额来自席位明细「机构专用」
async function fetchLhbEastmoney(dateYmd) {
  const filter = encodeURIComponent(`(TRADE_DATE='${dateYmd}')`);
  const listUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL`
    + `&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1&pageSize=200&pageNumber=1&source=WEB&client=WEB&filter=${filter}`;
  const jr = await fetch(listUrl, { headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' }, signal: AbortSignal.timeout(20000) });
  const rows = (await jr.json()).result.data || [];
  if (!rows.length) throw new Error('东财龙虎榜为空');

  const orgNet = {};
  for (const side of ['BUY', 'SELL']) {
    const u = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_BILLBOARD_DAILYDETAILS${side}&columns=ALL`
      + `&pageSize=500&pageNumber=1&source=WEB&client=WEB&filter=${filter}`;
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' }, signal: AbortSignal.timeout(20000) });
      const det = (await res.json()).result.data || [];
      for (const d of det) {
        if (!/机构专用/.test(String(d.OPERATEDEPT_NAME || ''))) continue;
        const c = String(d.SECURITY_CODE || '').replace(/\D/g, '');
        if (!/^\d{6}$/.test(c)) continue;
        orgNet[c] = (orgNet[c] || 0) + (num(d.NET) || 0);
      }
    } catch (e) { log(`席位明细 ${side} 取数失败: ${e.message}`); }
  }

  const jg = rows.map((r) => {
    const c = String(r.SECURITY_CODE || '').replace(/\D/g, '');
    return {
      code: c,
      name: r.SECURITY_NAME_ABBR,
      netBuyAmt: num(r.BILLBOARD_NET_AMT),
      instBuyAmt: orgNet[c] != null ? orgNet[c] : null,
    };
  }).filter((x) => /^\d{6}$/.test(x.code));
  return { date: dateYmd, jg };
}

// ---------------------------------------------------------------- 组装 raw 文件
// mx raw：build_snapshot 的 parseMx 支持「指标在 row[0]、股票在 columns[1..]」与
// 「指标在 columns[0]、股票在 row[0]」两种布局，这里统一用后者，一指标一张 sheet。
function buildMxRaw(factors, codes) {
  const sheets = [];
  const mk = (metric, unit) => {
    const items = [];
    for (const c of codes) {
      const f = factors[c];
      if (!f || f[unit] == null) continue;
      items.push([`${c}`, String(f[unit])]);
    }
    if (items.length) sheets.push({ columns: [metric, ''], items });
  };
  mk('流通市值(亿)', 'cap');
  mk('量比', 'vr');
  mk('换手率(%)', 'to');
  mk('主力净流入(亿)', 'mf');
  return { data: sheets };
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const explicitDate = opt('--date', null);
  const doPush = !flag('--no-push');
  const doGenerate = !flag('--no-generate');

  // 交易日推断：指定日期直接用；否则今天起回溯最多 5 天，取第一个有涨停池的交易日
  let tradeDate = null;
  let tdxRaw = null;
  const candidates = [];
  if (explicitDate) candidates.push(explicitDate);
  else {
    for (let i = 0; i < 5; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      candidates.push(ymd(d));
    }
  }
  for (const cand of candidates) {
    const wd = new Date(cand + 'T00:00:00').getDay();
    if (wd === 0 || wd === 6) { log(`${cand} 非交易日，跳过`); continue; }
    let pool = null;
    try {
      pool = await fetchEmZtPool(cand);
      log(`东财 push2ex ${cand} 涨停池 ${pool ? pool.length : 0} 只`);
    } catch (e) {
      log(`东财涨停池取数失败(${cand}): ${e.message}`);
    }
    if (pool && pool.length) { tradeDate = cand; tdxRaw = pool; break; }
  }
  if (!tdxRaw) {
    log('所有候选日期的涨停池均为空 → 判定非交易日或数据源不可用，放弃刷新（保留上一日快照）');
    process.exit(3);
  }

  // 过滤 ST / 北交所（build_snapshot 内也会过滤，这里提前剔除以免拉取无效因子）
  const rawStocks = tdxRaw.filter((s) => {
    if (!/^\d{6}$/.test(s.sec_code)) return false;
    if (/ST/i.test(s.sec_name)) return false;
    if (/^[48]/.test(s.sec_code) || /^920/.test(s.sec_code)) return false;
    if (s.market === '2') return false;
    return true;
  });
  if (!rawStocks.length) { log('过滤后无有效涨停股，放弃刷新'); process.exit(3); }
  const codes = rawStocks.map((s) => s.sec_code);
  log(`交易日 ${tradeDate}，有效涨停股 ${codes.length} 只`);

  // 因子（行情 + 主力净流入，内部已含多层降级）
  let factors = {};
  try {
    factors = await fetchWestockFactors(codes);
  } catch (e) {
    log(`腾讯链路整体失败: ${e.message}，改用腾讯行情直连`);
    try {
      const tq = await fetchTencentQuotes(codes);
      factors = tq;
      log(`腾讯行情直连：命中 ${Object.keys(tq).length}/${codes.length}`);
    } catch (e2) {
      log(`腾讯行情直连失败: ${e2.message}，改用东方财富妙想`);
      try {
        factors = await fetchMxFactors(codes, tradeDate);
        log(`妙想取数：命中 ${Object.keys(factors).length}/${codes.length}`);
      } catch (e3) {
        log(`妙想取数失败: ${e3.message}`);
      }
    }
    // 降级链路的 mf 兜底：腾讯直连无主力净流入，妙想链路已含 mf
    const mfMiss = codes.filter((c) => !factors[c] || factors[c].mf == null);
    if (mfMiss.length) {
      try {
        const mxmf = await fetchMxMainNet(mfMiss);
        let n = 0;
        for (const c of mfMiss) { if (mxmf[c] != null) { factors[c] = factors[c] || {}; factors[c].mf = mxmf[c]; n++; } }
        log(`妙想补齐主力净流入：${n}/${mfMiss.length}`);
      } catch (e4) { log(`妙想补齐主力净流入失败: ${e4.message}`); }
    }
  }
  // 东财池自带流通市值/换手率，作为最后兜底补齐
  for (const s of rawStocks) {
    const o = factors[s.sec_code] || (factors[s.sec_code] = {});
    if (o.cap == null && s._floatCap != null) o.cap = s._floatCap;
    if (o.to == null && s._turnover != null) o.to = s._turnover;
  }

  // 龙虎榜
  let lhbRaw = null;
  try {
    lhbRaw = await fetchLhbWestock(tradeDate);
    log(`龙虎榜(腾讯自选股) ${lhbRaw.jg.length} 条`);
  } catch (e) {
    log(`腾讯龙虎榜取数失败: ${e.message}，改用东方财富 datacenter`);
    try {
      lhbRaw = await fetchLhbEastmoney(tradeDate);
      log(`龙虎榜(东财直连) ${lhbRaw.jg.length} 条`);
    } catch (e2) {
      log(`东财龙虎榜取数失败: ${e2.message}`);
    }
  }

  // 落盘原始数据（tdx/mx/lhb 三种形状，交给既有生成器）
  writeJson(path.join(DATA, '_raw_tdx.json'), { data: rawStocks });
  writeJson(path.join(DATA, '_raw_mx.json'), buildMxRaw(factors, codes));
  writeJson(path.join(DATA, '_raw_lhb.json'), { data: lhbRaw || { date: tradeDate, jg: [] } });

  if (!doGenerate) { log('--no-generate：仅落盘原始数据，结束'); return; }

  // 调用既有生成器
  const gen = execFileSync(process.execPath, [
    path.join(TOOLS, 'build_snapshot.js'),
    '--tdx', path.join(DATA, '_raw_tdx.json'),
    '--mx', path.join(DATA, '_raw_mx.json'),
    '--lhb', path.join(DATA, '_raw_lhb.json'),
    '--out', path.join(DATA, 'snapshot.json'),
  ], { encoding: 'utf8' });
  log(gen.trim());

  const snap = JSON.parse(fs.readFileSync(path.join(DATA, 'snapshot.json'), 'utf8'));
  if (!snap.stocks || !snap.stocks.length) { log('快照股票数为空，放弃推送'); process.exit(3); }
  log(`快照就绪：${snap.stocks.length} 只涨停，龙虎榜 ${(snap.lhb || []).length} 条，日期 ${snap.date}`);

  if (!doPush) { log('--no-push：跳过提交推送'); return; }

  // 提交并推送（remote 内含 token；沙箱内 TLS 吊销检查会失败，必须带 -c 参数）
  const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('add', 'data/snapshot.json');
  const dirty = git('status', '--porcelain', 'data/snapshot.json').trim();
  if (!dirty) { log('快照无变化，无需提交'); return; }
  git('commit', '-m', `snapshot: ${tradeDate} 收盘快照自动刷新 (${snap.stocks.length}只涨停)`);
  git('-c', 'http.schannelCheckRevoke=false', '-c', 'http.sslVerify=false', 'push');
  log('推送完成');
}

main().catch((e) => { console.error('[refresh] 失败:', e && e.stack || e); process.exit(1); });
