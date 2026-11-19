# 妖股雷达 · 视觉设计规范（Design System）

> 版本 v2.3.0 · 配套 `assets/clean-ui.css`、`assets/clean-ui.js`、`assets/ui-design.css`、`assets/ui-design.js`
> 本文是**组件契约**：新增页面/卡片时照此套用即可获得一致视觉，无需重复调样式。
> 铁律：所有视觉值来自令牌，不写硬编码；不改业务渲染逻辑；涨红跌绿 + 品牌紫为不可变语义。

---

## 一、令牌表（唯一视觉来源）

定义在 `clean-ui.css` 顶部 `:root`，深色态在 `html[data-theme="dark"]` 覆盖。

| 类别 | 令牌 | 值 | 用途 |
|---|---|---|---|
| 圆角 | `--cui-r-sm` | 8px | 徽章、按钮、进度条 |
| 圆角 | `--cui-r-md` | 12px | 小卡、胶囊、指标格 |
| 圆角 | `--cui-r-lg` | 16px | 主卡、面板、决策栏 |
| 字号 | `--cui-fs-hero` | 22px | 结论数字 |
| 字号 | `--cui-fs-title` | 17px | 卡片标题 |
| 字号 | `--cui-fs-sub` | 15px | 次级标题/决策阶段 |
| 字号 | `--cui-fs-h` | 14px | 栏目标题 |
| 字号 | `--cui-fs-body` | 12.5px | 正文/结论说明 |
| 字号 | `--cui-fs-note` | 11px | 注解/口径小字（最小，不得低于） |
| 间距 | `--cui-sp-1/2/3/4` | 4/8/12/16px | 4pt 栅格 |
| 语义色 | `--cui-bar-1/2` | 紫渐变 | 六维条常规 |
| 语义色 | `--cui-bar-hot-1/2` | 珊瑚红渐变 | 高分区（强/热） |
| 语义色 | `--cui-bar-cool-1/2` | 青绿渐变 | 低分区（弱/冷） |
| 阴影 | `--cui-shadow-bar/card/chip` | — | 决策栏/卡片/胶囊三级 |

**继承的品牌变量**（来自 `style.css`，不在此重复定义）：`--brand #6C3DF6`、`--up #E53935`（涨）、`--down #15A85A`（跌）、`--gold`、`--ink/2/3`、`--glass-2`、`--soft`。

---

## 二、四类标准组件

### 1. 结论卡 `.verdict-card`
页面第一视觉焦点，承载"当前是什么状态、该怎么做"。

```html
<div class="card verdict-card">
  <div class="verdict-head">
    <div class="verdict-title">退潮期 · 涨停 23 家 / 最高 3 板 · 综合 4.8 / 10</div>
    <div class="verdict-badge-line"><span class="vbadge">…</span></div>
  </div>
  <div class="verdict-grid">
    <div class="vcell"><div class="k">情绪阶段</div><div class="v big">…</div></div>
    <!-- ×4：情绪阶段 / 综合评分 / 操作档位 / 建议仓位 -->
  </div>
  <div class="verdict-sub">…</div>
</div>
```
- 视觉：左边框 5px 品牌紫；`.vcell` 用 `--cui-r-md` + `--cui-shadow-card`；数字 `--cui-fs-hero`。
- 窄屏（≤640px）：标题降到 `--cui-fs-sub` 并允许折行；`.verdict-grid` 由 4 列变 2 列（style.css 已有）。
- 精简态：`.verdict-sub` 最多两行；"数据源"徽章由 JS 打 `.yg-tech` 标记后隐藏。

### 2. 评分条 `.six-bar`
用于任何 0–10 的量纲表达。

```html
<div class="six-row">
  <div class="six-top"><span class="six-nm">维度名</span><span class="six-sc hi">9.4</span></div>
  <div class="six-bar"><i class="hi" style="width:94%"></i></div>
  <div class="tiny">维度说明</div>
</div>
```
- 三态由 `<i>` 的 class 决定：默认紫 / `.hi` 珊瑚红（≥7）/ `.lo` 青绿（≤4）；宽度 = 分数×10%。
- `.six-sc` 同色语义（`.hi`/`.lo`）。
- 精简态：`.six-row .tiny` 隐藏；`.six-note`（口径长文）隐藏。

### 3. 指标网格 `.metric-grid`
键值对密集型数据，如核心指标 12 项。

```html
<div class="card" id="metricGlossaryCard">
  <h3>核心指标 · 口径注解 …</h3>
  <div class="metric-grid">
    <div class="metric-item">
      <div class="metric-head"><span class="metric-name">涨停家数</span><span class="metric-val">23 家</span></div>
      <div class="metric-def">口径定义…</div>
      <div class="metric-thr">阈值怎么读…</div>
    </div>
    <!-- … -->
  </div>
</div>
```
- 精简态：`> .tiny`、`.metric-def`、`.metric-thr`、`.metric-src`、`.metric-foot` 全部隐藏，仅留 `.metric-head`；`.metric-item` 加 `--cui-r-md` 底色，成为紧凑卡片。
- 详细态（点"详"）：全部恢复，合规信息完整。

### 4. 徽章 `.vbadge` / `.caliber-tag` / `.six-chip`
- `.vbadge`：结论卡内标签；`.hot` 红=预警、`.cool` 绿=安全。含"数据源"的由 JS 标记 `.yg-tech`，精简态隐藏。
- `.caliber-tag`：口径标识；`.caliber-live` 绿=实测、`.caliber-est` 黄=估算。**不隐藏**（合规必需）。
- `.six-chip`：六维汇总胶囊（综合/最强/最弱）。

---

## 三、详 / 简 双态契约

| 元素 | 精简（默认） | 详细（点"详"） |
|---|---|---|
| 口径长句 `.caliber-note` / `.view-hero-note` | 隐藏 | 显示 |
| 维度说明 `.six-row .tiny` | 隐藏 | 显示 |
| 指标定义 `.metric-def` / `.metric-thr` | 隐藏 | 显示 |
| 数据源徽章 `.yg-tech` | 隐藏 | 显示 |
| 口径标识 `.caliber-tag` | **始终显示** | 显示 |
| 结论 / 评分 / 数值 | **始终显示** | 显示 |

切换按钮 `.cui-btn` 注入到 `.side-actions`（桌面）与 `.mini-actions`（移动）；状态存 localStorage `yg_compact_v1`，默认精简。

---

## 四、新增页面 SOP（约 10 分钟）

1. 结构套用：焦点区用结论卡，量纲用评分条，键值用指标网格，标签用徽章。
2. 样式只写结构（flex/grid/gap），**颜色字号圆角一律引用令牌**。
3. 需要收起的说明文字：加 `.tiny` 或归入上述精简态隐藏清单。
4. 深色态自检：切主题看一遍，确认无白底黑字残留。
5. 跑护栏：`node tools/check-design-system.mjs`，全 PASS 才算完成。

## 五、不可变红线

- ❌ 改涨红跌绿语义、品牌紫 `--brand`
- ❌ 隐藏 `.caliber-tag` 口径标识、免责声明、数据口径（合规）
- ❌ 在组件内写硬编码色值/圆角/字号（必须走令牌）
- ❌ 字号低于 `--cui-fs-note`（11px）
- ❌ 引入商业字体/图片素材（仅系统字体 + 自绘 SVG）

## 六、UI 设计表现层（v2.3.0 · P0–P3）

新增 `assets/ui-design.css` + `assets/ui-design.js`，三层框架中的 L1/L2 表现层。

### P0 八阶段语义色（核心）
| 阶段 | 令牌 | 色值 | 阶段 | 令牌 | 色值 |
|---|---|---|---|---|---|
| 冰点 | `--st-ice` | #2f6fed | 高潮 | `--st-boom` | #f5a623 |
| 修复 | `--st-recover` | #2aa5a0 | 分歧 | `--st-diverge` | #e87a3f |
| 启动 | `--st-launch` | #6c5ce7 | 退潮 | `--st-ebb` | #e53935 |
| 确认 | `--st-confirm` | #6c3df6 | 崩塌 | `--st-crash` | #8e2430 |

- `ui-design.js` 读 `.js-ydb-stage` 文本 → `<html data-stage>`，`--stage` 随之切换。
- **色域分离铁律**：`--stage` 只染容器/徽章/边框；个股数字仍用 `--up`/`--down`，互不干扰。
- JS 直接内联给结论卡左边框着色（含 `.card` transition 临时关闭，避免 0.35s 闪色）。

### P1 温度带
- `ui-design.js` 读 `.js-ydb-temp` 的 T 值 → 在 `.verdict-grid` 后幂等注入 `.yg-thermo`。
- 0–100 分段渐变 + 指针定位；数字 T 值保留为权威，图形仅辅助。每 1.2s 同步，覆盖 5s 重渲染。

### P2 六维阈值
- `.six-bar::after` 在 70% 画 7 分强弱虚线，首行显示标签；红(≥7)/绿(≤4)/紫(中间)三档语义。

### P3 卡片主次
- 主卡 `.verdict-card`：阶段色 5px 左边框 + 重阴影 + 大留白 + 数字 23px。
- 次卡：`.card:has(.six-list)` 与 `#metricGlossaryCard` 降低权重；深色用 `--ui-soft` 防浅色回退。

## 七、回滚

删除 `index.html` 中 `clean-ui.css` / `clean-ui.js` / `ui-design.css` / `ui-design.js` 四行引用即可完全复原，业务代码零改动。
