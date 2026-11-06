#!/usr/bin/env node
/**
 * capture_midday.js — 妖股雷达「午盘封单快照」采集器（自包含版）
 * ---------------------------------------------------------------------------
 * 用途：收盘快照生成器 build_snapshot.js 的 --mid 输入源。午盘（约 11:30 后）
 *       单独跑一次，把当日涨停池的「午盘封单金额 / 涨停打开次数」落盘，收盘时
 *       build_snapshot 据此算出每只股票的封单衰减率（封单大逃亡 / 相对最强等信号）。
 *
 * 取数：直连东方财富 push2ex getTopicZTPool（与 refresh_snapshot.js 的
 *       fetchEmZtPool 同源同逻辑，这里内联一份，不依赖会话级 MCP 连接器）。
 *
 * 输出：data/_seal_mid_<YYYYMMDD>.json（紧凑日期），内容 { date, stocks:[{c, seal, open}] }
 *       - seal：封单金额0#(元) ÷ 1e4 → 万元，保留 2 位
 *       - open：涨停打开次数（缺省 0）
 *       过滤：ST/*ST、北交所（market=2 / 920、8 开头）。池中 0 只也写出 stocks:[]。
 *
 * 用法：
 *   node tools/capture_midday.js                # 今天，回溯最多 5 天取第一个有涨停池的交易日
 *   node tools/capture_midday.js --date 2026-10-28
 *
 * 本脚本只写文件，不做 git 操作；落盘文件由 .gitignore 的 data/_seal_mid_*.json 排除。
 */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

function log(...a) { console.log('[capture_midday]', ...a); }
function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').replace(/[元亿元%]/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
const code6 = (v) => { const m = /(\d{6})/.exec(String(v || '')); return m ? m[1] : null; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const compact = (ymdStr) => ymdStr.replace(/-/g, '');
const isBJ = (c, market) => (/^[48]/.test(c) || /^920/.test(c) || market === '2');

// ---------------------------------------------------------------- 涨停池（东财直连）
// 与 refresh_snapshot.js 的 fetchEmZtPool 同源：date=YYYYMMDD 真实生效。
async function fetchEmZtPool(dateYmd) {
  const d = compact(dateYmd);
  const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt`
    + `&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=${d}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' }, signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  const pool = (j && j.data && j.data.pool) || [];
  if (!pool.length) return null;
  return pool.map((it) => ({
    c: String(it.c || '').replace(/\D/g, ''),
    n: String(it.n || '').trim(),
    fund: num(it.fund),     // 封单金额(元)
    open: num(it.zbc) || 0, // 涨停打开次数
    market: String(it.m == null ? '' : it.m),
  }));
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const explicitDate = opt('--date', null);
  const candidates = [];
  if (explicitDate) candidates.push(explicitDate);
  else {
    for (let i = 0; i < 5; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      candidates.push(ymd(d));
    }
  }

  let tradeDate = null;
  let raw = null;
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
    if (pool && pool.length) { tradeDate = cand; raw = pool; break; }
  }
  if (!raw) {
    log('所有候选日期的涨停池均为空 → 判定非交易日或数据源不可用，放弃采集');
    process.exit(3);
  }

  // 过滤 ST / 北交所，提取 { c, seal(万元), open }
  const stocks = raw.filter((s) => {
    if (!/^\d{6}$/.test(s.c)) return false;
    if (/ST/i.test(s.n)) return false;
    if (isBJ(s.c, s.market)) return false;
    return true;
  }).map((s) => {
    const seal = s.fund != null ? Math.round((s.fund / 10000) * 100) / 100 : 0; // 元 -> 万
    return { c: s.c, seal, open: s.open || 0 };
  });

  const out = { date: tradeDate, stocks };
  fs.mkdirSync(DATA, { recursive: true });
  const outPath = path.join(DATA, `_seal_mid_${compact(tradeDate)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  log(`已写入 ${path.relative(ROOT, outPath)}：${stocks.length} 只（封单/开板），供收盘 build_snapshot --mid 使用`);
}

main().catch((e) => { console.error('[capture_midday] 失败:', e && e.stack || e); process.exit(1); });
