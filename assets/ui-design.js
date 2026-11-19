/* =========================================================================
 * ui-design.js — 妖股雷达 UI 设计表现层驱动  v2.3.0
 * -------------------------------------------------------------------------
 * 职责（只做视觉读取与 DOM 注入，不改任何业务数据与判断）：
 *  P0：读 .js-ydb-stage 阶段名 → <html data-stage>
 *  P1：读 .js-ydb-temp 温度值 → 在 .verdict-grid 后注入/更新温度带
 * 温度带幂等注入：视图每 5 秒重渲染，靠 dataset 标记 + 定时同步保证不重复、不丢失。
 * ========================================================================= */
(function () {
  'use strict';

  var root = document.documentElement;

  // 阶段名 → data-stage 键（按包含关系匹配，兼容"退潮期/退潮"等写法）
  var STAGE_MAP = [
    { key: 'ice',     words: ['冰点'] },
    { key: 'crash',   words: ['崩塌'] },
    { key: 'ebb',     words: ['退潮'] },
    { key: 'diverge', words: ['分歧'] },
    { key: 'boom',    words: ['高潮'] },
    { key: 'confirm', words: ['确认'] },
    { key: 'launch',  words: ['启动'] },
    { key: 'recover', words: ['修复'] }
  ];

  function mapStage(text) {
    var t = String(text || '');
    for (var i = 0; i < STAGE_MAP.length; i++) {
      for (var j = 0; j < STAGE_MAP[i].words.length; j++) {
        if (t.indexOf(STAGE_MAP[i].words[j]) !== -1) return STAGE_MAP[i].key;
      }
    }
    return '';
  }

  // 阶段主色（与 CSS 令牌一致），JS 直接设到元素，规避简写覆盖问题
  var STAGE_COLOR = {
    ice:'#2f6fed', recover:'#2aa5a0', launch:'#6c5ce7', confirm:'#6c3df6',
    boom:'#f5a623', diverge:'#e87a3f', ebb:'#e53935', crash:'#8e2430'
  };

  // P0：同步阶段 data-stage + 直接着色关键容器
  function syncStage() {
    var el = document.querySelector('.yg-decision-bar .js-ydb-stage');
    if (!el) return;
    var key = mapStage(el.textContent);
    var color = key ? STAGE_COLOR[key] : '';
    if (key) root.setAttribute('data-stage', key);
    else root.removeAttribute('data-stage');
    // 结论卡左边框 / 阶段格数字：直接内联，确保阶段色一定生效
    // 临时关掉 .card 的 border-color 过渡，避免阶段色切换时的 0.35s 紫色闪烁
    document.querySelectorAll('#view .verdict-card').forEach(function (card) {
      card.style.transition = 'none';
      card.style.setProperty('border-left-color', color || '#6c3df6', 'important');
      card.style.setProperty('border-left-width', '5px', 'important');
      card.style.setProperty('border-left-style', 'solid', 'important');
      var stageCell = card.querySelector('.verdict-grid .vcell .v.big');
      if (stageCell) stageCell.style.color = color || '';
      // 强制回流后恢复过渡，保留卡片其它动效
      void card.offsetWidth;
      card.style.transition = '';
    });
  }

  // P1：构建温度带 DOM（仅一次），返回节点
  function buildThermo() {
    var box = document.createElement('div');
    box.className = 'yg-thermo';
    box.setAttribute('data-ui-thermo', '1');
    box.innerHTML =
      '<div class="yg-thermo-head">' +
        '<span class="yg-thermo-lbl">情绪温度 T</span>' +
        '<span class="yg-thermo-val"><span data-tval>—</span><small data-tdir>/ 100</small></span>' +
      '</div>' +
      '<div class="yg-thermo-track"><div class="yg-thermo-needle" data-tneedle style="left:0%"></div></div>' +
      '<div class="yg-thermo-scale"><span>0 冰点</span><span>25 修复</span><span>50 中性</span><span>75 高潮</span><span>100 过热</span></div>' +
      '<div class="yg-thermo-foot"><span>温度带分段着色，指针定位当前值</span><span class="yg-thermo-dir" data-tdir2>—</span></div>';
    return box;
  }

  // 从决策栏读温度与趋势。趋势优先取全局 ΔT3，取不到则不臆造。
  function readTemp() {
    var el = document.querySelector('.yg-decision-bar .js-ydb-temp');
    var m = el && String(el.textContent).match(/T\s*(-?\d+(?:\.\d+)?)/);
    var t = m ? parseFloat(m[1]) : null;
    var dir = '';
    try {
      var D = window.YGDecision && window.YGDecision.build
        ? window.YGDecision.build(window.__ygData || {}) : null;
      // 不强依赖：ΔT3 若在 decision 输出里则取，否则留空
      if (D && D.X && typeof D.X.dT3 === 'number') {
        dir = D.X.dT3 < 0 ? '↓ 降温中' : D.X.dT3 > 0 ? '↑ 升温中' : '→ 走平';
      }
    } catch (e) {}
    return { t: t, dir: dir };
  }

  // P1：幂等注入 + 更新温度带
  function syncThermo() {
    var grid = document.querySelector('#view .verdict-card .verdict-grid');
    if (!grid) return;                       // 当前页无结论卡（如雷达/手册页）则不注入
    var card = grid.parentNode;
    var box = card.querySelector('[data-ui-thermo]');
    if (!box) {
      box = buildThermo();
      grid.insertAdjacentElement('afterend', box);
    }
    var info = readTemp();
    if (info.t == null) return;              // 无有效温度时不改显示
    var t = Math.max(0, Math.min(100, info.t));
    box.querySelector('[data-tval]').textContent = String(t);
    box.querySelector('[data-tneedle]').style.left = t + '%';
    box.querySelector('[data-tdir]').textContent = '/ 100' + (info.dir ? '　' + info.dir : '');
    box.querySelector('[data-tdir2]').textContent = info.dir || '按当前快照实时推导';
  }

  function syncAll() { syncStage(); syncThermo(); }

  // 首帧 + DOMContentLoaded + 低频轮询（覆盖 5 秒重渲染与切栏目）
  syncAll();
  document.addEventListener('DOMContentLoaded', function () { setTimeout(syncAll, 0); });
  setInterval(syncAll, 1200);
})();
