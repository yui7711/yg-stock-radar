#!/usr/bin/env node
/**
 * build_snapshot.js — 妖股雷达「每日收盘快照」生成器
 * --------------------------------------------------------------------------
 * 输入（由智能体侧 MCP 取数后落盘的 3 个原始 JSON）：
 *   --tdx <file>  通达信·涨停池  (tdx_screener(message="涨停", pageSize=50))
 *   --mx  <file>  东财妙想·行情  (mx_ashare_finance_data: 换手率/量比/流通市值/主力净流入)
 *   --lhb <file>  腾讯自选股·龙虎榜机构榜 (data_lhb(date, type="jg"))
 *   --out <file>  输出 data/snapshot.json
 *
 * 输出：与现有 data/snapshot.json 完全一致的 schema。
 *   字段映射（2026-10-28 实测对齐，已交叉验证）：
 *     tdx 封单金额0#(元) ÷1e4        -> seal(万元)
 *     tdx 板型含"一字板" 或 首封<=09:30且非T字板 -> lt=1(否则2)
 *     tdx 涨停原因(点号分隔)         -> cx[]，首项 -> sec
 *     tdx 连续涨停天数               -> b
 *     mx  流通市值(亿)               -> cap
 *     mx  换手率(%)                  -> to
 *     mx  量比                      -> vr
 *     mx  主力净流入(万元) ÷1e4      -> mf(亿)
 *     lhb netBuyAmt/instBuyAmt(元) ÷1e8 -> net/org(亿)，按 code 去重取 |net| 最大
 *
 * 过滤：ST/*ST、北交所(market=2 / 920/8 开头) 不进快照。
 */

'use strict';
const fs = require('fs');
const path = require('path');

function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').replace(/[元亿元%]/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function toMin(hhmmss) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmmss || '');
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function hm(hhmmss) {
  return (hhmmss || '').length >= 5 ? (hhmmss || '').slice(0, 5) : (hhmmss || '');
}
function codeOf(label) {
  const m = /(\d{6})/.exec(String(label || ''));
  return m ? m[1] : null;
}

// ---------- 通达信涨停池 ----------
function parseTdx(raw) {
  const data = (raw && raw.data) || [];
  const dateRaw = data[0] && data[0]['发生日期'];
  const tradeDate = dateRaw ? String(dateRaw).replace(/\./g, '-') : null;
  const seen = new Set();
  const stocks = [];
  for (const r of data) {
    const code = String(r.sec_code || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const name = String(r.sec_name || '').trim();
    if (/ST/i.test(name)) continue;                       // 过滤 ST
    const market = String(r.market || '');
    if (market === '2') continue;                          // 过滤 北交所
    if (/^[48]/.test(code) || /^920/.test(code)) continue; // 双保险：北交所代码前缀
    if (seen.has(code)) continue;
    seen.add(code);

    const reason = String(r['涨停原因'] || '');
    const cx = reason.split(/[.．·、，,\s]+/).map((s) => s.trim()).filter(Boolean);
    const sec = cx[0] || '其他';
    const firstT = String(r['首次涨停时间'] || '');
    const panType = String(r['板型'] || '');
    // 与现有快照一致：仅「一字板」判 lt=1，其余（T字板/换手板/空）均为 lt=2
    const lt = /一字板/.test(panType) ? 1 : 2;
    const sealYuan = num(r['封单金额0#']);
    stocks.push({
      c: code, n: name,
      p: num(r.now_price), pct: num(r.chg),
      b: num(r['连续涨停天数']) || 1,
      seal: sealYuan != null ? Math.round((sealYuan / 10000) * 100) / 100 : null, // 元 -> 万
      lt, open: num(r['涨停打开次数']) || 0,
      first: hm(firstT), sec, cx
    });
  }
  return { tradeDate, stocks };
}

// ---------- 东财妙想行情（兼容两种混用布局） ----------
// 布局A（如 流通市值/量比）：columns=[日期, 股票1, 股票2...]，items=[[指标, 值1, 值2...]]
// 布局B（如 换手率/主力净流入）：columns=[指标, 日期]，items=[[股票1, 值1],[股票2, 值2]...]
function assignMetric(out, metric, code, rawV) {
  if (!code) return;
  const isCap = /流通市值/.test(metric);
  const isVr = /量比/.test(metric);
  const isTo = /换手率/.test(metric);
  const isMf = /主力净流入/.test(metric);
  if (!isCap && !isVr && !isTo && !isMf) return;
  const val = num(rawV);
  if (val == null) return;
  const o = out[code] || (out[code] = {});
  if (isCap) { if (o.cap == null) o.cap = val; }                 // 亿元 -> 亿
  else if (isVr) { if (o.vr == null) o.vr = val; }
  else if (isTo) { if (o.to == null) o.to = val; }               // %
  else if (isMf) { if (o.mf == null) o.mf = /万/.test(rawV) ? Math.round((val / 10000) * 10000) / 10000 : val; } // 万元 -> 亿
}
function parseMx(raw) {
  const out = {};
  for (const sheet of (raw && raw.data) || []) {
    const cols = sheet.columns || [];
    const items = sheet.items || [];
    const colCodes = cols.map((c, i) => (i === 0 ? null : codeOf(c))); // 布局A：股票在列 1..
    if (colCodes.some(Boolean)) {
      for (const row of items) {                 // 布局A：指标在 row[0]，值对齐 cols[1..]
        const metric = String(row[0] || '');
        for (let i = 1; i < row.length; i++) {
          if (colCodes[i]) assignMetric(out, metric, colCodes[i], String(row[i] || ''));
        }
      }
    } else {                                     // 布局B：指标在 cols[0]，股票在 row[0]
      const metric = String(cols[0] || '');
      for (const row of items) {
        assignMetric(out, metric, codeOf(row[0]), String(row[1] || ''));
      }
    }
  }
  return out;
}

// ---------- 腾讯自选股龙虎榜机构榜 ----------
function parseLhb(raw) {
  const jg = (raw && raw.data && raw.data.jg) || [];
  const date = (raw && raw.data && raw.data.date) || null;
  const map = {};
  for (const x of jg) {
    const code = codeOf(x.code) || String(x.code || '');
    if (!/^\d{6}$/.test(code)) continue;
    const name = String(x.name || '');
    if (/转债$/.test(name) || /退$/.test(name)) continue;
    const net = num(x.netBuyAmt);   // 元
    const org = num(x.instBuyAmt);  // 元
    const cur = map[code];
    if (!cur || Math.abs(net || 0) > Math.abs(cur.netRaw || 0)) {
      map[code] = {
        c: code, n: name,
        net: net != null ? Math.round((net / 1e8) * 10000) / 10000 : null,
        org: org != null ? Math.round((org / 1e8) * 10000) / 10000 : null,
        netRaw: net || 0
      };
    }
  }
  return { date, list: Object.values(map).map(({ netRaw, ...rest }) => rest) };
}

// ---------- 组装 ----------
function build(tdx, mxMap, lhb) {
  const stocks = tdx.stocks.map((s) => {
    const m = mxMap[s.c] || {};
    return {
      c: s.c, n: s.n, p: s.p, pct: s.pct, b: s.b,
      seal: s.seal, lt: s.lt, open: s.open, first: s.first, sec: s.sec, cx: s.cx,
      cap: m.cap != null ? m.cap : null,
      to: m.to != null ? m.to : null,
      vr: m.vr != null ? m.vr : null,
      mf: m.mf != null ? m.mf : null
    };
  });

  const exact = {};
  stocks.forEach((s) => { const b = s.b || 1; exact[b] = (exact[b] || 0) + 1; });
  const exact_boards = Object.keys(exact).map(Number).sort((a, b) => a - b)
    .map((board_num) => ({ board_num, stock_count: exact[board_num] }));

  const openCount = stocks.filter((s) => (s.open || 0) >= 3).length;
  const total = stocks.length;
  const seal_rate = total ? Math.round(((total - openCount) / total) * 100) / 100 : null;

  return {
    date: tdx.tradeDate,
    generatedAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('.000', '').replace('Z', '+08:00'),
    sources: ['通达信·涨停池', '东方财富妙想·流通市值/换手/量比/主力净流入', '腾讯自选股·龙虎榜(机构榜)'],
    note: '盘前/接口不可达时的静态兜底快照。炸板家数按「开板≥3次」估算；龙虎榜为机构榜口径（游资因子仅覆盖上榜标的）。',
    lhbDate: lhb.date || tdx.tradeDate,
    stats: { open_stock_count: openCount, seal_rate, exact_boards },
    lhb: lhb.list,
    hot: [],
    stocks
  };
}

// ---------- 入口 ----------
function main() {
  const argv = process.argv.slice(2);
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const tdxF = get('--tdx'), mxF = get('--mx'), lhbF = get('--lhb'), outF = get('--out') || 'data/snapshot.json';
  if (!tdxF || !mxF || !lhbF) {
    console.error('用法: node build_snapshot.js --tdx <f> --mx <f> --lhb <f> [--out <f>]');
    process.exit(2);
  }
  const tdx = parseTdx(JSON.parse(fs.readFileSync(tdxF, 'utf8')));
  const mx = parseMx(JSON.parse(fs.readFileSync(mxF, 'utf8')));
  const lhb = parseLhb(JSON.parse(fs.readFileSync(lhbF, 'utf8')));
  const snap = build(tdx, mx, lhb);

  // 校验：必须有股票，否则视为取数失败，不覆盖旧快照
  if (!snap.stocks.length) {
    console.error('[build_snapshot] 涨停池为空，疑似非交易日/取数失败，拒绝覆盖旧快照。');
    process.exit(3);
  }
  fs.writeFileSync(outF, JSON.stringify(snap, null, 2), 'utf8');
  console.log(`[build_snapshot] 成功：${snap.stocks.length} 只涨停，龙虎榜 ${snap.lhb.length} 条，连板分布 ${JSON.stringify(snap.stats.exact_boards)}，炸板 ${snap.stats.open_stock_count}，封板率 ${snap.stats.seal_rate}，日期 ${snap.date}`);
  // 输出被覆盖前的兜底提示
  console.log(`[build_snapshot] 已写入 ${path.resolve(outF)}`);
}

main();
