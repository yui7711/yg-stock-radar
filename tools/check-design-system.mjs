#!/usr/bin/env node
/**
 * check-design-system.mjs — 视觉设计系统静态护栏
 * ---------------------------------------------------------------------------
 * 每次改动前后运行：node tools/check-design-system.mjs
 * 校验令牌完整性、无硬编码散值、引入与版本一致、详简切换脚本完好。
 * 不依赖第三方库，只读文件，不改任何代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('\n妖股雷达 · 设计系统护栏\n' + '='.repeat(40));

let css, html, js, spec, uiCss, uiJs;
try {
  css = read('assets/clean-ui.css');
  html = read('index.html');
  js = read('assets/clean-ui.js');
  spec = read('DESIGN-SYSTEM.md');
  uiCss = read('assets/ui-design.css');
  uiJs = read('assets/ui-design.js');
} catch (e) {
  console.error('读取文件失败：', e.message);
  process.exit(1);
}

// 1) 令牌完整性：规范文档列出的核心令牌必须在 CSS 中定义
console.log('\n[1] 令牌完整性');
const requiredTokens = [
  '--cui-r-sm', '--cui-r-md', '--cui-r-lg',
  '--cui-fs-hero', '--cui-fs-title', '--cui-fs-sub', '--cui-fs-h', '--cui-fs-body', '--cui-fs-note',
  '--cui-sp-1', '--cui-sp-2', '--cui-sp-3', '--cui-sp-4',
  '--cui-bar-1', '--cui-bar-2', '--cui-bar-hot-1', '--cui-bar-hot-2', '--cui-bar-cool-1', '--cui-bar-cool-2',
  '--cui-shadow-bar', '--cui-shadow-card', '--cui-shadow-chip', '--cui-riskoff-bg',
];
const missing = requiredTokens.filter((t) => !new RegExp(`${t}\\s*:`).test(css));
ok(`${requiredTokens.length} 个核心令牌全部定义`, missing.length === 0, missing.join(', '));

// 2) 无硬编码散值：圆角不得出现令牌定义行之外的裸 px
console.log('\n[2] 无硬编码散值');
const radiusLines = css.split('\n').filter((l) =>
  /border-radius:\s*\d+px/.test(l) && !/--cui-r-/.test(l)
);
ok('无残留硬编码圆角', radiusLines.length === 0, radiusLines.join(' | ').trim());

// 3) 令牌被实际引用（防止定义了却没人用）
console.log('\n[3] 令牌引用');
const used = new Set([...css.matchAll(/var\((--cui-[a-z0-9-]+)\)/g)].map((m) => m[1]));
const unused = requiredTokens.filter((t) => !used.has(t));
ok('所有核心令牌均被引用', unused.length === 0, unused.join(', '));

// 4) 引入与版本一致
console.log('\n[4] 引入与版本');
ok('index.html 引入 clean-ui.css', /clean-ui\.css\?v=[\d.]+/.test(html));
ok('index.html 引入 clean-ui.js', /clean-ui\.js\?v=[\d.]+/.test(html));
const cssV = (html.match(/clean-ui\.css\?v=([\d.]+)/) || [])[1];
const jsV = (html.match(/clean-ui\.js\?v=([\d.]+)/) || [])[1];
const assetV = (html.match(/YG_ASSET_V = '([\d.]+)'/) || [])[1];
ok('三处版本号一致', cssV && cssV === jsV && jsV === assetV, `css=${cssV} js=${jsV} asset=${assetV}`);

// 5) 详简切换脚本完好
console.log('\n[5] 详简切换');
ok('localStorage 键存在', /yg_compact_v1/.test(js));
ok('默认精简逻辑存在', /v === null \? true/.test(js));
ok('数据源徽章标记逻辑存在', /yg-tech/.test(js));
ok('双端按钮注入（桌面+移动）', /side-actions/.test(js) && /mini-actions/.test(js));
ok('规范文档含四类组件契约', /结论卡/.test(spec) && /评分条/.test(spec) && /指标网格/.test(spec) && /徽章/.test(spec));

// 6) UI 设计表现层（v2.3.0 · P0-P3）
console.log('\n[6] UI 设计表现层');
ok('index.html 引入 ui-design.css', /ui-design\.css\?v=[\d.]+/.test(html));
ok('index.html 引入 ui-design.js', /ui-design\.js\?v=[\d.]+/.test(html));
ok('8 阶段语义色令牌齐全', ['ice','recover','launch','confirm','boom','diverge','ebb','crash'].every(function(k){return new RegExp('--st-'+k+'\\s*:').test(uiCss);}));
ok('data-stage 选择器齐全', ['ice','recover','launch','confirm','boom','diverge','ebb','crash'].every(function(k){return uiCss.indexOf('[data-stage="'+k+'"]')!==-1;}));
ok('阶段映射表含全部阶段', ['冰点','修复','启动','确认','高潮','分歧','退潮','崩塌'].every(function(w){return uiJs.indexOf(w)!==-1;}));
ok('温度带幂等注入逻辑', /data-ui-thermo/.test(uiJs) && /insertAdjacentElement/.test(uiJs));
ok('六维阈值线（70% = 7分）', /left:70%/.test(uiCss));
ok('深色主题软色回退防护', /data-theme="dark"/.test(uiCss) && /--ui-soft/.test(uiCss));

console.log('\n' + '='.repeat(40));
console.log(`结果：${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
