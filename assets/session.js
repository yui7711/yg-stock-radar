/* =========================================================================
 * session.js — 全站唯一的北京时间 / 交易时段 / 数据时点标注中心
 * -------------------------------------------------------------------------
 * v20261112b：QA 回归发现 live-pool.js 与 market-today.js 各自用
 *   d.getTime() + d.getTimezoneOffset()*60000 + 8h 配 getUTC*()，
 *   等价于「真实 UTC + 浏览器时区偏移」，只有 UTC+0 恰好正确。
 *   本模块统一为 new Date(Date.now() + 8h) 配 getUTC*()（与 data.js 的
 *   todayISO() 一致），所有模块只从这里取时段，杜绝各处重复实现再次漂移。
 *
 * 对外接口（window.YGSession）：
 *   beijingNow()              -> Date（用 getUTC* 读，即北京时间墙钟）
 *   todayISO() / todayCompact() / hhmm() / hhmmss() / minutes() / weekday()
 *   isWeekend() / isSessionComplete() / phase() / phaseLabel() / statusText()
 *   compact(s) / isoOf(c) / shiftISO(iso, delta)
 *   dataTimeLabel(d, opts)    -> 全站统一「数据时点」文案
 * ========================================================================= */
(function (global) {
  'use strict';

  var TZ_MS = 8 * 3600 * 1000;   // Asia/Shanghai 固定 UTC+8，中国不实行夏令时

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 北京时间墙钟：Date 对象的 UTC 字段即北京时间的年/月/日/时/分/秒。 */
  function beijingNow() { return new Date(Date.now() + TZ_MS); }

  function todayISO() {
    var b = beijingNow();
    return b.getUTCFullYear() + '-' + pad2(b.getUTCMonth() + 1) + '-' + pad2(b.getUTCDate());
  }
  function todayCompact() { return todayISO().replace(/-/g, ''); }
  function hhmm() {
    var b = beijingNow();
    return pad2(b.getUTCHours()) + ':' + pad2(b.getUTCMinutes());
  }
  function hhmmss() { return hhmm() + ':' + pad2(beijingNow().getUTCSeconds()); }
  function minutes() {
    var b = beijingNow();
    return b.getUTCHours() * 60 + b.getUTCMinutes();
  }
  function weekday() { return beijingNow().getUTCDay(); }
  function isWeekend() { var w = weekday(); return w === 0 || w === 6; }
  /** 15:00 后当日交易完结；15:00 前的当日池是盘中残缺数据。 */
  function isSessionComplete() { return minutes() >= 15 * 60; }

  /**
   * 交易时段：'preopen' | 'morning' | 'noon' | 'afternoon' | 'closed' | 'holiday'
   * 说明：前端无法内置法定节假日日历，'holiday' 仅表示周末；工作日若当日
   * 涨停池为空（节假日 / 接口异常），由 live-pool.js 的 fallback 状态另行标注。
   */
  function phase() {
    if (isWeekend()) return 'holiday';
    var m = minutes();
    if (m < 9 * 60 + 30) return 'preopen';
    if (m < 11 * 60 + 30) return 'morning';
    if (m < 13 * 60) return 'noon';
    if (m < 15 * 60) return 'afternoon';
    return 'closed';
  }
  var PHASE_LABEL = {
    preopen: '尚未开盘', morning: '早盘交易中', noon: '午间休市',
    afternoon: '午盘交易中', closed: '已收盘', holiday: '非交易日'
  };
  function phaseLabel(p) { return PHASE_LABEL[p || phase()] || '—'; }
  /** 顶部状态条左半：YYYYMMDD · 早盘交易中 10:21 */
  function statusText() { return todayCompact() + ' · ' + phaseLabel() + ' ' + hhmm(); }

  function compact(s) { return String(s == null ? '' : s).replace(/-/g, '').slice(0, 8); }
  function isoOf(c) {
    var s = compact(c);
    return /^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : String(c || '');
  }
  function shiftISO(iso, delta) {
    var y = Number(String(iso).slice(0, 4)), m = Number(String(iso).slice(5, 7)), d = Number(String(iso).slice(8, 10));
    var dt = new Date(Date.UTC(y, m - 1, d + delta));
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }

  /**
   * 全站唯一的「数据时点」文案。所有页面（顶部状态条 / 栏目 hero / 口径注解 /
   * 专题判定 / 报告）必须调用本函数，禁止再各自写「盘前数据（当日尚未开盘）」
   * 这类与真实时段矛盾的话。
   *
   * d: daily data；opts: { date, session, degraded }
   * 返回示例：
   *   盘中实时 2026-11-12 10:21 · 未收盘，数据会变动
   *   当日收盘 2026-11-12 15:05 · 已收盘
   *   当日收盘数据尚未生成，展示最近已收盘交易日 2026-11-11 · 收盘
   *   实时接口不可达，已降级到 2026-11-11 静态收盘快照
   */
  function dataTimeLabel(d, opts) {
    opts = opts || {};
    if (!d) return statusText();
    var raw = opts.date || d.date || d.livePoolDate || '';
    var dateISO = /^\d{8}$/.test(String(raw)) ? isoOf(raw) : String(raw || '');
    var isToday = compact(raw) === todayCompact();
    var ph = phase();
    var session = opts.session || d.session || '';
    var intraday = !!(d.intraday || session === 'intraday');
    var fallback = !!(d.liveFallback || session === 'fallback');
    var degraded = !!(d.degraded || opts.degraded);

    if (degraded) return '实时接口不可达，已降级到 ' + dateISO + ' 静态收盘快照';
    if (intraday && isToday) return '盘中实时 ' + dateISO + ' ' + hhmm() + ' · 未收盘，数据会变动';
    if (isToday && isSessionComplete()) return '当日收盘 ' + dateISO + ' ' + hhmm() + ' · 已收盘';
    if (fallback) return '当日收盘数据尚未生成，展示最近已收盘交易日 ' + dateISO + ' · 收盘';
    if (ph === 'holiday' || ph === 'preopen' || ph === 'noon') {
      return '当日收盘数据尚未生成，展示最近已收盘交易日 ' + dateISO + ' · 收盘';
    }
    return '最近已收盘交易日 ' + dateISO + ' · 收盘';
  }

  global.YGSession = {
    TZ_MS: TZ_MS,
    beijingNow: beijingNow, todayISO: todayISO, todayCompact: todayCompact,
    hhmm: hhmm, hhmmss: hhmmss, minutes: minutes, weekday: weekday,
    isWeekend: isWeekend, isSessionComplete: isSessionComplete,
    phase: phase, phaseLabel: phaseLabel, statusText: statusText,
    compact: compact, isoOf: isoOf, shiftISO: shiftISO,
    dataTimeLabel: dataTimeLabel
  };
})(typeof window !== 'undefined' ? window : this);
