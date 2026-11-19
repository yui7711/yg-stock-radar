/* =========================================================================
 * clean-ui.js — 妖股雷达「详 / 简」视图切换  v2.1.0
 * -------------------------------------------------------------------------
 * 职责：仅注入一个切换按钮 + 记忆用户偏好，不触碰任何业务渲染逻辑。
 * 默认：精简（ yg-compact 开启）；点击按钮切换，localStorage 记忆。
 * 标记：给"数据源："徽章加 .yg-tech，供 clean-ui.css 在精简模式下隐藏。
 * ========================================================================= */
(function () {
  'use strict';

  var KEY = 'yg_compact_v1';
  var root = document.documentElement;

  function isCompact() {
    try {
      var v = localStorage.getItem(KEY);
      return v === null ? true : v === '1'; // 默认精简
    } catch (e) { return true; }
  }

  function apply(compact) {
    root.classList.toggle('yg-compact', !!compact);
    try { localStorage.setItem(KEY, compact ? '1' : '0'); } catch (e) {}
    syncBtn();
  }

  // 给"数据源："徽章打标记，精简模式下由 CSS 隐藏（预警类徽章不受影响）
  function markTechBadges() {
    var badges = document.querySelectorAll('.verdict-badge-line .vbadge');
    for (var i = 0; i < badges.length; i++) {
      if (/数据源/.test(badges[i].textContent || '')) badges[i].classList.add('yg-tech');
    }
  }

  function syncBtn() {
    var compact = root.classList.contains('yg-compact');
    var btns = document.querySelectorAll('.js-cui-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = compact ? '详' : '简';
      btns[i].title = compact ? '查看完整数据口径说明' : '切换为精简视图';
      btns[i].setAttribute('aria-label', btns[i].title);
      btns[i].classList.toggle('on', !compact);
    }
  }

  // 在两组操作区各注入一个按钮（桌面侧栏 / 移动端顶栏），保持既有 UI 一致性
  function injectButtons() {
    var hosts = ['.side-actions', '.mini-actions'];
    hosts.forEach(function (sel) {
      var host = document.querySelector(sel);
      if (!host || host.querySelector('.js-cui-toggle')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cui-btn js-cui-toggle';
      btn.addEventListener('click', function () {
        apply(!root.classList.contains('yg-compact'));
        markTechBadges();
      });
      host.appendChild(btn);
    });
  }

  // 立即应用偏好（避免闪烁，与主题预置脚本同思路）
  apply(isCompact());

  // 按钮宿主由 buildShell() 动态生成，DOMContentLoaded 后注入；并做轻量重试兜底
  function bootstrap() {
    injectButtons();
    markTechBadges();
    syncBtn();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // 视图每 5 秒可能重渲染，用轮询兜底保证新渲染的徽章被打标（轻量、低频）
  setInterval(markTechBadges, 4000);
})();
