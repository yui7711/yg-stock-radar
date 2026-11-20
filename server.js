/**
 * 妖股雷达 —— 本地开发服务器 + 东方财富行情代理
 *
 * 启动：node server.js  （默认端口 3001，可用 PORT 环境变量覆盖）
 * 访问：http://localhost:3001  即应用入口 index.html
 *
 * 作用：
 *  1) 静态托管项目目录（index.html + assets/），使 H5 与代理同源，免 CORS 烦恼；
 *  2) /api/em/quote?codes=600519.SH,000823.SZ
 *     批量取东方财富公开行情（push2）的「流通市值(f117)」「换手率(f168)」
 *     「量比(f50)」「成交额(f48)」「主力净流入(f62)」，补齐妖股雷达 8 因子模型在
 *     真实同花顺模式下缺失的字段（流通市值/换手率/量比/封单强度分母/主力净流入）。
 *     带 5 分钟缓存 + 限并发，避免反复打东方财富被限流。
 *
 * 注：东方财富 push2 为公开接口、无需 key；本代理负责缓存/批处理/单位归一。
 *     若 H5 未经过本代理（如直接 file:// 打开），data.js 会直连 push2（其 CORS=*）。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const ROOT = __dirname;
const EM_BASE = 'https://push2.eastmoney.com/api/qt/stock/get';
// 主力净流入要走资金流快照端点：qt/stock/get 的 f62 恒为占位值 2（实测），ulist.np/get 才返回真实值（元），支持 secids 批量
const EM_ULIST_BASE = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const EM_FIELDS = 'f117,f168,f50,f48'; // f117=流通市值(元), f168=换手率(%), f50=量比, f48=成交额(元)
// 注意：f46 是「今开盘价」而非成交额（实测茅台 1322.5 / 平安银行 11.48 / 甘化 9.4 均为开盘价），成交额必须用 f48。
// 同花顺 API（服务端代理用，Key 只留在服务端，不进小程序包）
const THS_BASE = 'https://fuyao.aicubes.cn';
const THS_KEY = 'sk-fuyao-ZzXGDrEg8LVWl_4cb_T6KAuZO08Z5_z7';
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟（量比/成交额/主力净流入盘中都在变，不能缓存太久）
const CONCURRENCY = 6; // 打东方财富的并发上限

const cache = new Map(); // secid -> { floatMv, turnover, volumeRatio, amount, mainNetIn, ts }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

// thscode(600519.SH) -> secid(1.600519)；沪=1 深/北=0
function thscodeToSecid(ts) {
  const m = /^(\d{6})\.(SH|SZ|BJ)$/i.exec(ts || '');
  if (!m) return null;
  const market = m[2].toUpperCase() === 'SH' ? '1' : '0';
  return market + '.' + m[1];
}

// 限并发的 map
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

// 单个 secid 取行情（带缓存）
function fetchEMOne(secid) {
  return new Promise((resolve) => {
    const hit = cache.get(secid);
    if (hit && Date.now() - hit.ts < CACHE_TTL) { resolve(hit); return; }
    const url = `${EM_BASE}?secid=${encodeURIComponent(secid)}&fields=${EM_FIELDS}&invt=2&fltt=2`;
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' }
    }, (r) => {
      let b = [];
      r.on('data', (d) => b.push(d));
      r.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(b).toString('utf8'));
          const d = (j && j.data) || {};
          let floatMv = null, turnover = null, volumeRatio = null, amount = null;
          if (d.f117 != null && d.f117 !== '-' && !isNaN(Number(d.f117))) floatMv = Number(d.f117) / 1e8; // 元 -> 亿
          if (d.f168 != null && d.f168 !== '-' && !isNaN(Number(d.f168))) turnover = Number(d.f168); // %
          if (d.f50 != null && d.f50 !== '-' && !isNaN(Number(d.f50))) volumeRatio = Number(d.f50); // 量比
          if (d.f48 != null && d.f48 !== '-' && !isNaN(Number(d.f48))) amount = Number(d.f48) / 1e8; // 成交额(元) -> 亿
          const prev = cache.get(secid);
          const rec = {
            floatMv, turnover, volumeRatio, amount,
            mainNetIn: (prev && Date.now() - prev.ts < CACHE_TTL) ? prev.mainNetIn : null, // 主力净流入由批量 ulist 端点补充
            ts: Date.now()
          };
          // 仅在至少取到一个有效字段时才缓存：网络抖动/接口瞬时失败的空结果不缓存，
          // 下一次请求会立即重试，避免「量比等字段空白长达一个缓存周期」。
          const hasData = floatMv != null || turnover != null || volumeRatio != null || amount != null;
          if (hasData) cache.set(secid, rec);
          resolve(rec);
        } catch (e) {
          resolve({ floatMv: null, turnover: null, volumeRatio: null, amount: null, mainNetIn: null, ts: Date.now() });
        }
      });
    });
    req.on('error', () => resolve({ floatMv: null, turnover: null, volumeRatio: null, amount: null, mainNetIn: null, ts: Date.now() }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ floatMv: null, turnover: null, volumeRatio: null, amount: null, mainNetIn: null, ts: Date.now() }); });
  });
}

// 批量取主力净流入（f62，元）：走 ulist.np/get 资金流快照（qt/stock/get 的 f62 恒为占位值 2）
const netInCache = new Map(); // secid -> { mainNetIn(亿), ts }
function fetchEMNetInBatch(secids) {
  return new Promise((resolve) => {
    const out = {};
    const now = Date.now();
    const missing = [];
    secids.forEach((s) => {
      const hit = netInCache.get(s);
      if (hit && now - hit.ts < CACHE_TTL) out[s] = hit.mainNetIn;
      else missing.push(s);
    });
    if (!missing.length) { resolve(out); return; }
    const url = `${EM_ULIST_BASE}?fltt=2&secids=${encodeURIComponent(missing.join(','))}&fields=f12,f62`;
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' }
    }, (r) => {
      let b = [];
      r.on('data', (d) => b.push(d));
      r.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(b).toString('utf8'));
          const diff = (j && j.data && j.data.diff) || [];
          diff.forEach((row) => {
            const code = row.f12; // 6位代码
            const v = row.f62;
            if (code == null || v == null || v === '-' || isNaN(Number(v))) return;
            const secid = (String(code).startsWith('6') ? '1.' : '0.') + code; // 6开头沪市，其余深/北
            const mainNetIn = Number(v) / 1e8; // 元 -> 亿
            netInCache.set(secid, { mainNetIn, ts: Date.now() });
            out[secid] = mainNetIn;
          });
          resolve(out);
        } catch (e) { resolve(out); }
      });
    });
    req.on('error', () => resolve(out));
    req.setTimeout(10000, () => { req.destroy(); resolve(out); });
  });
}

// 腾讯行情兜底（qt.gtimg.cn，GBK）：东财 push2 被限流/不可达时补齐 流通市值/换手率/量比/成交额。
// 字段索引（2026-10 实测）：37成交额(万) 38换手率 44流通市值(亿) 49量比
function fetchTencentBatch(codes6) {
  return new Promise((resolve) => {
    const list = (codes6 || []).filter((c) => /^\d{6}$/.test(String(c)));
    if (!list.length) { resolve({}); return; }
    const pref = (c) => (/^(6|9|5)/.test(c) ? 'sh' : (/^(4|8)/.test(c) ? 'bj' : 'sz'));
    const url = 'https://qt.gtimg.cn/q=' + list.map((c) => pref(c) + c).join(',');
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com/' } }, (r) => {
      const b = [];
      r.on('data', (d) => b.push(d));
      r.on('end', () => {
        try {
          const txt = new TextDecoder('gbk').decode(Buffer.concat(b));
          const map = {};
          const re = /v_(?:sh|sz|bj)(\d{6})="([^"]*)"/g;
          let m;
          while ((m = re.exec(txt))) {
            const f = m[2].split('~');
            if (f.length < 50) continue;
            const num = (i, div) => (f[i] == null || f[i] === '' || isNaN(Number(f[i]))) ? null : Number(f[i]) / (div || 1);
            map[m[1]] = { floatMv: num(44), turnover: num(38), volumeRatio: num(49), amount: num(37, 10000) };
          }
          resolve(map);
        } catch (e) { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(10000, () => { req.destroy(); resolve({}); });
  });
}

function handleEMQuote(res, codesParam) {
  const list = String(codesParam || '').split(',').map((s) => s.trim()).filter(Boolean);
  const secids = list.map(thscodeToSecid).filter(Boolean);
  Promise.all([
    Promise.all(list.map((ts) => {
      const secid = thscodeToSecid(ts);
      if (!secid) return Promise.resolve({ thscode: ts, floatMv: null, turnover: null, volumeRatio: null, amount: null, mainNetIn: null });
      return fetchEMOne(secid).then((r) => ({ thscode: ts, floatMv: r.floatMv, turnover: r.turnover, volumeRatio: r.volumeRatio, amount: r.amount, mainNetIn: null, _secid: secid }));
    })),
    secids.length ? fetchEMNetInBatch(secids) : Promise.resolve({})
  ]).then(async ([arr, netInMap]) => {
    arr.forEach((x) => { if (x._secid) x.mainNetIn = (netInMap[x._secid] != null) ? netInMap[x._secid] : null; delete x._secid; });
    // 东财全空（限流/不可达）→ 腾讯行情兜底（只填空缺字段，不覆盖东财已取到的值）
    const emptyCodes = arr
      .filter((x) => x.floatMv == null && x.turnover == null && x.volumeRatio == null && x.amount == null)
      .map((x) => String(x.thscode).split('.')[0]);
    if (emptyCodes.length) {
      const tmap = await fetchTencentBatch(emptyCodes);
      arr.forEach((x) => {
        const t = tmap[String(x.thscode).split('.')[0]];
        if (!t) return;
        ['floatMv', 'turnover', 'volumeRatio', 'amount'].forEach((k) => { if (x[k] == null && t[k] != null) x[k] = t[k]; });
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(arr));
  }).catch(() => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('[]');
  });
}

// ============================================================================
// v2.4.5：服务端代理东财 clist 主力资金排行（多周期资金 + 资金结构）。
// 浏览器直连东财 clist 在部分网络环境会被拦截；服务端出网更稳定，
// 由前端先请求同源 /api/em/fund，失败再降级前端直连。
// ============================================================================
const EM_CLIST_BASES = [
  'https://push2.eastmoney.com/api/qt/clist/get',
  'https://push2delay.eastmoney.com/api/qt/clist/get',
  'https://push2his.eastmoney.com/api/qt/clist/get'
];
const FUND_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const FUND_FIELDS = 'f12,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f164,f165,f166,f167,f174,f175,f168,f169,f205';
const fundCache = new Map(); // code(6位) -> { ...fields, ts }
const FUND_TTL = 60 * 1000;

function httpsJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' }
    }, (r) => {
      const b = [];
      r.on('data', (d) => b.push(d));
      r.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(b).toString('utf8'))); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(12000, () => { req.destroy(); resolve(null); });
  });
}

async function fetchFundPage(base, fid, po, page) {
  const q = `pn=${page}&pz=100&po=${po}&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&wbp2u=|0|0|0|web&fid=${fid}&fs=${encodeURIComponent(FUND_FS)}&fields=${FUND_FIELDS}`;
  const j = await httpsJson(`${base}?${q}`);
  return (j && j.data && j.data.diff) || null;
}

// 拉取三个周期榜单，合并到按代码索引的 map（只保留我们关心的代码时由前端过滤）
async function fetchAllFund() {
  const now = Date.now();
  const out = {};
  const plans = [
    { fid: 'f164', po: 1, pages: 4 },
    { fid: 'f174', po: 1, pages: 4 },
    { fid: 'f62', po: 1, pages: 3 }
  ];
  for (const plan of plans) {
    for (let page = 1; page <= plan.pages; page++) {
      let rows = null;
      for (const base of EM_CLIST_BASES) {
        rows = await fetchFundPage(base, plan.fid, plan.po, page);
        if (rows && rows.length) break;
      }
      if (!rows || !rows.length) break;
      rows.forEach((it) => {
        const code = String(it.f12 || '');
        if (!/^\d{6}$/.test(code)) return;
        const num = (v, div) => (v == null || v === '-' || isNaN(Number(v))) ? null : Number(v) / (div || 1);
        const prev = fundCache.get(code) || {};
        const rec = {
          code,
          mainNetIn: num(it.f62, 1e8), netIn5: num(it.f164, 1e8), netIn5Ratio: num(it.f165),
          netIn10: num(it.f174, 1e8), netIn10Ratio: num(it.f175),
          superBig: num(it.f66, 1e8), big: num(it.f72, 1e8),
          medium: num(it.f78, 1e8), small: num(it.f84, 1e8),
          turnover: num(it.f168), volumeRatio: num(it.f169), amount: num(it.f205, 1e8),
          ts: now
        };
        // 保留其他周期已取到的非空字段
        ['mainNetIn', 'netIn5', 'netIn5Ratio', 'netIn10', 'netIn10Ratio', 'superBig', 'big', 'medium', 'small', 'turnover', 'volumeRatio', 'amount'].forEach((k) => {
          if (rec[k] == null && prev[k] != null && now - (prev.ts || 0) < FUND_TTL) rec[k] = prev[k];
        });
        out[code] = rec;
      });
    }
  }
  Object.keys(fundCache).forEach((c) => { if (now - (fundCache.get(c).ts || 0) > FUND_TTL) fundCache.delete(c); });
  Object.keys(out).forEach((c) => fundCache.set(c, out[c]));
  return out;
}

let fundInflight = null;
async function handleFund(res) {
  try {
    if (!fundInflight || Date.now() - (fundInflight.ts || 0) > FUND_TTL) {
      fundInflight = { ts: Date.now(), p: fetchAllFund() };
    }
    const data = await fundInflight.p;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('{}');
  }
}

// ============================================================================
// v2.4.9：东财 datacenter 龙虎榜代理（比同花顺更新及时，实测可达）。
// 返回按代码索引的龙虎榜资金：净额/买入/卖出/成交额/换手/流通市值。
// ============================================================================
const EM_DATACENTER = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
let emLhbCache = null;
async function handleEMLhb(res) {
  try {
    if (!emLhbCache || Date.now() - emLhbCache.ts > 10 * 60 * 1000) {
      const url = EM_DATACENTER + '?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=800&pageNumber=1&source=WEB&client=WEB';
      const j = await httpsJson(url);
      const rows = (j && j.result && j.result.data) || [];
      const map = {};
      rows.forEach((it) => {
        const code = String(it.SECURITY_CODE || '');
        if (!/^\d{6}$/.test(code)) return;
        const num = (v) => (v == null || isNaN(Number(v))) ? null : Number(v);
        const prev = map[code];
        const rec = {
          code, date: String(it.TRADE_DATE || '').slice(0, 10),
          net: num(it.BILLBOARD_NET_AMT), buy: num(it.BILLBOARD_BUY_AMT),
          sell: num(it.BILLBOARD_SELL_AMT), amount: num(it.ACCUM_AMOUNT),
          turnover: num(it.TURNOVERRATE), floatMv: num(it.FREE_MARKET_CAP),
          reason: it.EXPLANATION || ''
        };
        // 同一代码保留最新日期
        if (!prev || (rec.date || '') >= (prev.date || '')) map[code] = rec;
      });
      emLhbCache = { ts: Date.now(), map };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(emLhbCache.map));
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('{}');
  }
}

// 同花顺 API 代理：小程序经此访问，Key 不落客户端。
// 用法：/api/ths?path=/api/a-share/special-data/limit-up-pool&page=1&size=200&sort_field=continue_day_cnt&sort_dir=desc
function handleThs(res, parsedUrl) {
  const path = parsedUrl.searchParams.get('path');
  if (!path || !/^\/api\//.test(path)) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ code: 4001, message: '缺少有效 path 参数' }));
    return;
  }
  // 透传除 path 外的所有查询参数
  const q = new URLSearchParams();
  parsedUrl.searchParams.forEach((v, k) => { if (k !== 'path') q.append(k, v); });
  const qs = q.toString();
  const up = https.get(THS_BASE + path + (qs ? '?' + qs : ''), {
    headers: { 'X-api-key': THS_KEY, 'User-Agent': 'Mozilla/5.0' }
  }, (r) => {
    const b = [];
    r.on('data', (d) => b.push(d));
    r.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(Buffer.concat(b));
    });
  });
  up.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ code: 5000, message: '上游请求失败: ' + e.message }));
  });
  up.setTimeout(15000, () => { up.destroy(); res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ code: 5002, message: '上游超时' })); });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    // 开发服务器提供 /api/em/quote 代理；用这个开关告知 data.js 可以走同源代理，
    // 静态托管（GitHub Pages）没有该端点，data.js 会直接跳过，避免 404 噪声。
    if (ext === '.html') {
      let html = data.toString('utf8').replace('<head>', `<head>
  <script>
    window.YG_QUOTE_PROXY=true;
    // v2.4.8：WorkBuddy 托管要求每个请求（含 /api/*）带 sharecode。
    (function () {
      var m = location.search.match(/[?&]sharecode=([^&]+)/);
      if (!m) return;
      var sc = m[1];
      var orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.charAt(0) === '/' && url.indexOf('sharecode=') < 0) {
          url += (url.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + encodeURIComponent(sc);
        }
        return orig.apply(this, [url, opts]);
      };
    })();
  </script>`);
      // v2.4.8：WorkBuddy 托管要求每个请求（含静态资源）带 sharecode，否则返回"链接不完整"页面。
      // 从当前请求 URL 取 sharecode，注入到所有 assets/xxx?v= 资源 URL 后，避免浏览器加载错误页导致
      // 全部 JS 逻辑失效（用户截图始终是旧缓存值 193万的根因）。
      const sc = (req && req.url || '').match(/[?&]sharecode=([^&]+)/);
      if (sc) {
        const share = sc[1];
        html = html.replace(/(assets\/[^"'\s]+)/g, (m) => m + (m.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + encodeURIComponent(share));
      }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url || '/', 'http://localhost');
  const path0 = parsed.pathname;
  if (path0 === '/api/em/quote') return handleEMQuote(res, parsed.searchParams.get('codes'));
  if (path0 === '/api/em/fund') return handleFund(res);
  if (path0 === '/api/em/lhb') return handleEMLhb(res);
  if (path0 === '/api/ths') return handleThs(res, parsed);
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`妖股雷达 dev server: http://localhost:${PORT}  (EM 代理 /api/em/quote 已启用)`);
  console.log(`EM 代理字段版本 v3: f117流通市值 f168换手率 f50量比 f48成交额 + ulist批量f62主力净流入（若缺 volumeRatio/mainNetIn 字段说明跑的是旧进程，请重启）`);
});
