# 财听猫 RichCat — UI 高端视觉设计系统（v2 · 翡翠鎏金 Jade & Gold）

> **版本**：v2（由 designer2 重写，替代 v1 草案）
> **设计目标**：把财听猫从"够用、偏工程风"提升为"高级、克制、有品牌感、值得信任的桌面工具"。
> **实现原则**：**不改任何 JSX 结构、不触碰任何业务逻辑/IPC/事件**，全部通过 CSS 变量（`:root`）+ 组件样式换肤实现。
> **一句话设计**：墨夜底 + 翡翠主色 + 鎏金点缀 + 细腻玻璃拟态 + 微动效，营造"昂贵精密设备"的质感。

---

## 0. 给工程师的快速上手（先读这里）

### 0.1 三步换肤法
1. **替换 `:root` 变量块**（见 §3），把 `index.css` 顶部的 `:root` 整体换成新 token —— 这是 80% 的换肤工作。
2. **补充组件级样式**（见 §8）：新增 `.gradient-border`、`.nav-active-bar`、`.brand-gradient-text` 等少量工具类，以及各组件 hover/active 的精修。
3. **加动效与细节**（见 §9）：氛围光、发光点、开关滑动、滚动条等。

### 0.2 ⚠️ 编码警告（必须处理，否则改坏文件）
- 当前 `src/renderer/src/index.css` 是 **GBK 编码**（非 UTF-8，含中文注释）。用编辑器直接打开会显示乱码，保存后可能破坏中文注释。
- **先转换**：在项目根目录用 PowerShell 执行一次（只改编码、内容不变）：
  ```powershell
  $p = "src\renderer\src\index.css"
  $t = [System.IO.File]::ReadAllText((Resolve-Path $p), [System.Text.Encoding]::GetEncoding(936))
  [System.IO.File]::WriteAllText((Resolve-Path $p), $t, (New-Object System.Text.UTF8Encoding($false)))
  ```
- 转换后注释变为正常中文（UTF-8），再开始改样式。其他 `.tsx` / `features.css` 已是 UTF-8，无需处理。

### 0.3 文件作用域
| 文件 | 内容 | 本次动作 |
|---|---|---|
| `src/renderer/src/index.css` | 主样式（:root + 全部组件） | 替换 :root、精修组件样式 |
| `src/renderer/src/features.css` | 功能开关面板 + 开关 + 待跟进列表 | 换肤（开关/徽章/行 hover） |
| `src/renderer/src/App.tsx` | 主界面 + 设置窗口 JSX | **尽量不动**；如需新工具类类名可补（见 §8） |
| 各子窗口/面板 `.tsx` | JSX 结构 | **不动**，只靠类名换肤 |

---

## 1. 设计理念

### 1.1 品牌与隐喻
- **财听猫** = 财富（财）+ 倾听（听）+ 猫（敏捷、亲近、陪伴）。
- **金** → 财富/尊贵/VIP（点缀，克制使用）。
- **翡翠绿** → 在线值守、生命力、专业服务（主色，延续现有绿色系，保持品牌连续）。
- **墨夜蓝黑** → 专注、科技、信赖（底）。
- **紫** → AI / 智能体 / 创新（辅助，少量用于"智能体/自定义角色/思考"语境）。

### 1.2 气质关键词
精密 · 克制 · 奢华 · 智能 · 可信 · 有温度

### 1.3 三大层次（z 轴分层）
1. **背景层**：墨夜渐变 + 低饱和氛围光晕（右上翡翠、左下鎏金、偶尔一缕紫）。
2. **内容层**：毛玻璃卡片（半透明 + backdrop-blur + 细边框 + 顶部内高光）。
3. **前景层**：发光强调元素（状态点、主按钮、选中态、品牌渐变字）。

### 1.4 原则
- 深度优先于装饰：少而精，克制地用光效与渐变。
- 一切可量化为 token：色值/字号/圆角/阴影/间距/动效时长全部进 `:root`。
- 状态永远有颜色反馈：running=翡翠呼吸光、idle=灰、error=珊瑚红、warning=琥珀。

---

## 2. 现状诊断（已通读全部 renderer 代码）

### 2.1 结构总览（类名 → 文件 映射）
| 界面 | 结构 | 关键类名 |
|---|---|---|
| 主控制面板 | header + ControlPanel + BottomBar | `.app` `.app-header` `.app-logo` `.status-indicator` `.card` `.message-log` `.bottom-bar` `.bottom-btn-play/stop/settings` `.toast` |
| 设置窗口 | settings-shell 侧边栏 + 主区 | `.settings-shell` `.settings-sidebar` `.settings-nav-item` `.settings-main` `.settings-page` `.card` `.form-input` `.btn*` `.provider-card` `.provider-config-card` |
| 角色设定 | PersonaPanel | `.persona-panel` `.persona-editor` `.persona-card` `.persona-badge` `.badge-builtin/custom/active/off` |
| 功能开关 | FeaturePanel | `.feature-panel-card` `.feature-row` `.feature-badge` `.feature-switch` `.feature-row-config` `.followup-item` |
| 工作记忆 | MemoryWindow（sidebar 导航 + trace/cards） | `.memory-shell` `.memory-sidebar` `.memory-session-item` `.memory-timeline` `.trace-step-card` `.phase-badge` `.replay-slider` `.step-detail-*` `.memory-card` `.source-badge` |
| 知识库 | KnowledgeWindow | `.kb-window` `.kb-header` `.kb-toolbar` `.kb-import` `.kb-editor` `.kb-list` `.kb-item` `.kb-tag` `.badge-import` `.kb-item-off` |
| 客户管理 | CustomerWindow（左列表右详情） | `.crm-window` `.crm-sidebar` `.crm-tag-filter-item` `.crm-customer-item` `.crm-detail` `.crm-section` `.crm-category-item` `.crm-memory-item` `.crm-memory-reply` |

### 2.2 现有优点（保留并强化）
- ✅ 已是暗黑 + 玻璃拟态方向：`backdrop-filter: blur`、半透明 `--bg-glass`、`--bg-frosted` 已就位。
- ✅ 已有氛围光晕：`.app::before/::after` 两个 radial 光斑 + float 动画 —— 基础很好，只是颜色饱和度过低、缺金色。
- ✅ 已有完整 `:root` token 体系：背景/文字/强调/状态/圆角/字体/过渡 全有 —— 换肤改造面小。
- ✅ 已有渐变主按钮（`.bottom-btn-play`）和圆角体系（8/12/16/24）。
- ✅ 状态指示、日志面板、徽章、开关等组件已分离，类名语义清晰。

### 2.3 现有问题（本次要解决的）
- ❌ **主色廉价感**：`--accent: #10b981` 是 Tailwind 默认 emerald，饱和偏高、偏"荧光"，缺高级感；主按钮文字用纯黑 `#000` 在荧光绿上对比生硬。
- ❌ **背景是纯黑** `#0a0b10`，无色彩倾向，缺少墨夜的层次与"昂贵"质感。
- ❌ **卡片平**：边框 `rgba(255,255,255,0.07)` 太淡、无阴影分层、hover 只有描边变亮，缺乏"立起来"的感觉。
- ❌ **品牌弱**：logo 只有 22px 干巴巴放着，无光效、无渐变字标、无金色"财富"呼应。
- ❌ **导航项**：active 只有浅绿底 + 细边框，无竖条/发光，层级感弱。
- ❌ **动效碎片化**：过渡时长/曲线不统一，`@keyframes` 缺呼吸发光、缺渐变边框、缺滑动开关的质感。
- ❌ **字体栈缺中文**：`--font-sans` 没有 PingFang / 微软雅黑 / 鸿蒙，中文渲染在中低端 Windows 上偏"系统味"。
- ❌ **日志/数字无等宽数字特性**：时间戳、版本号、计数用默认数字，未开 `tabular-nums`，对齐不精致。
- ❌ **滚动条**：只有 4px 极细、hover 变化微弱，hover 命中面积小。
- ❌ **细节未统一**：多处内联 style（如目标应用卡的状态点颜色 `#34d399`/`#fbbf24` 写死在 JSX 里）、部分 rgba 硬编码散落（`rgba(16,185,129,0.1)` 等），未走 token。

---

## 3. 完整 CSS Token 体系（可直接复制的 :root）

> 下方是**推荐直接整体替换**的 `:root`。命名保持与现状一致（`--bg-primary`、`--accent` 等），新增 `--bg-elevated`、`--accent-gold`、`--gradient-*`、`--shadow-*`、`--space-*`、`--text-*` 等新 token，工程师可在不破坏引用的情况下增量使用。

```css
:root {
  /* ══ 背景（墨夜：带蓝紫倾向，非纯黑） ══ */
  --bg-primary: #080a12;
  --bg-elevated: #0d101c;            /* 卡片/面板的略亮底 */
  --bg-glass: rgba(255, 255, 255, 0.04);
  --bg-glass-heavy: rgba(255, 255, 255, 0.07);
  --bg-glass-input: rgba(3, 5, 12, 0.55);
  --bg-frosted: rgba(9, 11, 19, 0.82);

  /* ══ 背景氛围渐变（右上翡翠 + 左下鎏金 + 左上微紫） ══ */
  --gradient-bg: radial-gradient(1100px 560px at 82% -12%, rgba(16, 185, 129, 0.13), transparent 58%),
                 radial-gradient(900px 520px at -8% 112%, rgba(212, 175, 55, 0.08), transparent 55%),
                 radial-gradient(700px 480px at 18% -20%, rgba(139, 124, 246, 0.06), transparent 60%),
                 linear-gradient(155deg, #080a12 0%, #0b0e1a 55%, #080a12 100%);

  /* ══ 品牌渐变（翡翠 → 深翡翠 → 鎏金；"财富+生命"） ══ */
  --gradient-brand: linear-gradient(135deg, #34d399 0%, #10b981 48%, #d4af37 100%);
  --gradient-brand-strong: linear-gradient(135deg, #3ee6a6 0%, #0ea878 55%, #e0bd5f 100%);
  --gradient-brand-soft: linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(212, 175, 55, 0.09));
  --gradient-brand-vertical: linear-gradient(180deg, #34d399, #d4af37);

  /* ══ 文字 ══ */
  --text-primary: #f2f4fb;
  --text-secondary: #9aa3b8;
  --text-muted: #5d6780;

  /* ══ 主强调色（翡翠 emerald，延续品牌色系） ══ */
  --accent: #10b981;
  --accent-hover: #2fd3a0;
  --accent-deep: #0b8f6b;            /* 渐变深端 / active 深底 */
  --accent-glow: rgba(16, 185, 129, 0.35);
  --accent-subtle: rgba(16, 185, 129, 0.10);
  --accent-border: rgba(16, 185, 129, 0.28);

  /* ══ 鎏金（财富/尊贵，点缀用） ══ */
  --accent-gold: #d4af37;
  --accent-gold-hover: #e6c76a;
  --accent-gold-soft: rgba(212, 175, 55, 0.12);
  --accent-gold-glow: rgba(212, 175, 55, 0.22);

  /* ══ AI 紫（智能体/自定义/思考） ══ */
  --accent-violet: #a78bfa;
  --accent-violet-soft: rgba(167, 139, 250, 0.10);

  /* ══ 状态色 ══ */
  --success: #10b981;
  --success-bg: rgba(16, 185, 129, 0.10);
  --error: #f0655e;                  /* 更柔和的珊瑚红，替代刺眼的 #f87171 */
  --error-bg: rgba(240, 101, 94, 0.10);
  --warning: #f0b34c;                /* 柔和琥珀 */
  --warning-bg: rgba(240, 179, 76, 0.10);
  --info: #5aa9f6;
  --info-bg: rgba(90, 169, 246, 0.10);

  /* ══ 边框 ══ */
  --glass-border: rgba(255, 255, 255, 0.09);
  --glass-border-light: rgba(255, 255, 255, 0.16);
  --border-focus: var(--accent);
  --border-gradient: linear-gradient(135deg, rgba(16, 185, 129, 0.5), rgba(255, 255, 255, 0.08) 42%, rgba(212, 175, 55, 0.35));

  /* ══ 圆角 ══ */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 22px;
  --radius-full: 9999px;

  /* ══ 阴影（分层 + 光晕） ══ */
  --shadow-sm: 0 2px 10px rgba(0, 0, 0, 0.35);
  --shadow-md: 0 10px 28px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 20px 52px rgba(0, 0, 0, 0.55);
  --shadow-glow: 0 4px 22px var(--accent-glow);
  --shadow-gold: 0 4px 22px var(--accent-gold-glow);
  --inset-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.07);

  /* ══ 字体 ══ */
  --font-sans: 'Inter', 'SF Pro Display', 'PingFang SC', 'HarmonyOS Sans SC',
               'Microsoft YaHei', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;

  /* ══ 字号阶梯 ══ */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;
  --text-2xl: 26px;

  /* ══ 间距 ══ */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* ══ 动效 ══ */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 260ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-smooth: 450ms var(--ease-out-expo);
}
```

### 3.1 新增工具类（可加到 index.css 末尾或独立文件）
```css
/* 渐变描边卡片：1px 渐变边框 + 玻璃底（用于强调卡/选中卡/品牌卡） */
.gradient-border {
  position: relative;
  background: linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,
              var(--border-gradient) border-box;
  border: 1px solid transparent;
}

/* 品牌渐变文字（logo 字标/标题强调） */
.brand-gradient-text {
  background: var(--gradient-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* 导航 active 左侧渐变竖条 */
.nav-active-bar::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 3px;
  border-radius: var(--radius-full);
  background: var(--gradient-brand-vertical);
  box-shadow: 0 0 8px var(--accent-glow);
}

/* 呼吸发光（运行中状态点） */
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 6px var(--accent-glow), 0 0 14px var(--accent-glow); }
  50%      { box-shadow: 0 0 12px var(--accent-glow), 0 0 26px var(--accent-glow); }
}
```

---

## 4. 色彩系统与使用规则

### 4.1 主色：翡翠（Emreald，延续品牌）
| 用途 | Token | 色值 |
|---|---|---|
| 主强调（运行中/主按钮/选中态） | `--accent` | `#10b981` |
| hover 提亮 | `--accent-hover` | `#2fd3a0` |
| 渐变深端 | `--accent-deep` | `#0b8f6b` |
| 光晕/底色 | `--accent-glow` / `--accent-subtle` | `rgba(16,185,129,.35)` / `.10` |
| 选中描边 | `--accent-border` | `rgba(16,185,129,.28)` |

### 4.2 辅助色：鎏金（财富/尊贵，**克制**）
> 规则：金色**只在**这些地方出现 —— 品牌渐变尾部、logo 光效、VIP/尊贵相关徽章、主按钮 hover 高光、品牌字标。不要大面积铺金，否则显俗。
| 用途 | Token | 色值 |
|---|---|---|
| 鎏金主 | `--accent-gold` | `#d4af37` |
| hover | `--accent-gold-hover` | `#e6c76a` |
| 浅底 | `--accent-gold-soft` | `rgba(212,175,55,.12)` |
| 光晕 | `--accent-gold-glow` | `rgba(212,175,55,.22)` |

### 4.3 AI 紫（智能体/自定义角色/思考日志）
| 用途 | Token | 色值 |
|---|---|---|
| AI 紫 | `--accent-violet` | `#a78bfa` |
| 浅底 | `--accent-violet-soft` | `rgba(167,139,250,.10)` |
> 对应现状里 `.badge-custom`（自定义角色）已用 `#a78bfa`，本次正式纳入体系并统一到 token。

### 4.4 状态色（语义恒定）
- **success / 运行中**：翡翠 `#10b981` + 呼吸光。
- **error / 异常**：珊瑚 `#f0655e`（比 `#f87171` 柔和、更高级）。
- **warning / 待处理**：琥珀 `#f0b34c`。
- **info / 信息**：天蓝 `#5aa9f6`。
- **idle / 待命**：`--text-muted` 灰点。

### 4.5 文字层级
| 层级 | Token | 用途 |
|---|---|---|
| 主文字 | `--text-primary #f2f4fb` | 标题、正文 |
| 次文字 | `--text-secondary #9aa3b8` | 描述、标签、次要信息 |
| 弱文字 | `--text-muted #5d6780` | 时间戳、版本、占位符、空状态 |

### 4.6 背景层次（从底到顶）
1. `--bg-primary`（窗口底）
2. `--gradient-bg`（氛围光）
3. `--bg-frosted`（header/底栏/侧边栏 毛玻璃）
4. `--bg-glass` / `--bg-glass-heavy`（卡片/列表 hover）
5. `--bg-elevated`（卡片实底，玻璃失效兜底）
6. 强调色底（`--accent-subtle` 等）

---

## 5. 字体排印

### 5.1 字体栈
- **正文/界面**：`--font-sans`（Inter → SF Pro → **PingFang SC → HarmonyOS Sans SC → 微软雅黑**）。补上中文字体后，中英文混排明显更精致。
- **数字/时间戳/日志/版本/代码**：`--font-mono`（JetBrains Mono → SF Mono → Cascadia → Consolas）。

### 5.2 全局规则
```css
body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'cv11', 'ss01'; /* Inter 可选特性，保留数字等宽 */
}
/* 数字一律 tabular-nums：日志/时间戳/计数/版本号对齐更精致 */
.mono-nums, .log-time, .trace-step-time, .replay-progress,
.provider-version, .crm-count, .memory-session-meta,
.form-input, .memory-card-stats {
  font-variant-numeric: tabular-nums;
}
```

### 5.3 字号阶梯（对应 token）
| Token | 值 | 用途 |
|---|---|---|
| `--text-2xl` | 26px / 700 | 设置页大标题（h1） |
| `--text-xl` | 20px / 700 | 子窗口主标题 |
| `--text-lg` | 16px / 600 | 卡片标题 h2/h3、页面小节标题 |
| `--text-md` | 14px / 600 | 条目标题（客户名/知识标题/角色名） |
| `--text-base` | 13px / 400~500 | 正文、按钮、状态文本 |
| `--text-sm` | 12px / 400~500 | 描述、标签、次信息 |
| `--text-xs` | 11px / 400~600 | 徽章、时间戳、版本、提示 |

### 5.4 品牌字标
- logo 区文字可用 `.brand-gradient-text`（翡翠→鎏金渐变字）。
- 版本号用 `--font-mono` + `--text-xs` + `--text-muted`。

---

## 6. 圆角 / 阴影 / 边框 / 玻璃拟态

### 6.1 圆角语义
| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 8px | 按钮、输入框、小徽章底、日志行 |
| `--radius-md` | 12px | 卡片、列表项、标签 |
| `--radius-lg` | 16px | 主卡片、面板 |
| `--radius-xl` | 22px | 大容器/强调卡 |
| `--radius-full` | 9999px | 开关、胶囊按钮、状态点 |

### 6.2 阴影语义
- `--shadow-sm`：默认卡片浮起（静态也带一层，避免"贴纸感"）。
- `--shadow-md`：hover 卡片 / 浮层。
- `--shadow-lg`：设置窗口内大浮层、选中大卡。
- `--shadow-glow`：主按钮、运行状态、选中态（翡翠光）。
- `--shadow-gold`：VIP/财富相关强调。
- `--inset-highlight`：玻璃面顶部内高光（`inset 0 1px 0 rgba(255,255,255,.07)`），几乎每个卡片都要。

### 6.3 玻璃拟态配方
```css
.glass-surface {
  background: var(--bg-glass);
  backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm), var(--inset-highlight);
}
```

### 6.4 渐变描边
- 强调/选中卡片用 `.gradient-border`（见 §3.1）：翡翠→白→鎏金 1px 渐变边，高级感立现。
- 主按钮 hover 时叠一层渐变高光。

---

## 7. 布局层次优化

### 7.1 主控制面板（App）
```
┌────────────────────────────────────────────┐
│  header: logo + 品牌字标     版本(mono)      │  ← 顶部 1px 渐变高光线
├────────────────────────────────────────────┤
│  status-indicator（发光状态胶囊）             │
│  目标应用卡（渐变描边 .gradient-border）      │
│  运行日志卡（毛玻璃 + 等宽 + 彩色类型点）      │
├────────────────────────────────────────────┤
│  bottom-bar: [▶ 启动引擎]  ⚙ 记忆 知识 客户   │  ← 底部毛玻璃 + 顶部渐变线
└────────────────────────────────────────────┘
```
- header 顶部加 1px 渐变高光线：`linear-gradient(90deg, transparent, var(--accent-subtle), var(--accent-subtle), transparent)`。
- 主内容区左右留白加大（16px→20px），卡片之间 `gap` 用 `--space-3/4`。

### 7.2 设置窗口 / 各子窗口（settings-shell 系）
- 侧边栏宽保持 190px（设置）/ 250px（记忆）/ 300px（CRM），统一 `--bg-frosted` + 右侧 `--glass-border`。
- 侧边栏导航项 active 用 `.nav-active-bar` 渐变竖条 + 渐变软底（§8.5）。
- 主区标题统一：h1 `--text-2xl` 700 + 副标题 `--text-sm --text-secondary`。
- 三栏式列表页（provider-list / memory / crm）统一列表项圆角 `--radius-md`、hover `--bg-glass-heavy`、选中渐变描边。

---

## 8. 组件风格规范（逐组件）

> 每个组件给出"现状 → 目标"的关键差异。类名不变，只改样式。

### 8.1 按钮 `.btn` `.btn-primary` `.btn-secondary` `.btn-danger` `.bottom-btn-*`
| 变体 | 目标样式 |
|---|---|
| `.btn-primary` | `background: var(--gradient-brand)`；文字 `#06120c`（深墨绿，替代纯黑，对比更柔）；700 字重；`border-radius: var(--radius-md)`；`box-shadow: var(--shadow-glow), var(--inset-highlight)`；hover：`filter: brightness(1.08)` + `translateY(-1px)` + 光晕增强；active：`translateY(0) scale(0.98)` |
| `.btn-secondary` | `--bg-glass-heavy` + `--glass-border`；hover 文字 `--text-primary`、描边 `--glass-border-light`、微发光 |
| `.btn-danger` | `--error-bg` + 珊瑚描边；hover 底加深 + 珊瑚光晕 |
| `.btn-large` | 全宽 + `--radius-md` |
| `.bottom-btn-play` | 渐变 `--gradient-brand-strong`，深色字，hover 上浮 + 双光晕 + 金尾光 |
| `.bottom-btn-stop` | 珊瑚系渐变底，hover 发光 |
| `.bottom-btn-settings` | 圆形毛玻璃；hover 上浮 + 发光；active 翡翠字 + 翡翠光 |
| 通用 | `transition: all var(--transition-normal)`；`:active { transform: translateY(0) scale(.98) }`；`:disabled` 不透明度 .4 且无阴影 |

### 8.2 输入框 / 文本域 `.form-input` `.input` `.textarea` `.kb-search`
- 背景 `--bg-glass-input`（更深的墨色，聚焦时才亮）。
- 边框 `--glass-border`；圆角 `--radius-md`。
- **focus**：`border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-subtle), var(--shadow-sm)`。
- `::placeholder { color: var(--text-muted); }`。
- `select.form-input` 保留自定义下拉箭头（换成金色箭头 `%23d4af37` 与整体呼应）。
- `textarea` 行高 1.55、`resize: vertical`。

### 8.3 卡片 `.card` `.provider-card` `.kb-item` `.crm-section` `.persona-card` `.memory-card` `.trace-step-card` `.status-indicator`
- 统一玻璃配方：`--bg-glass` + `blur(14px) saturate(140%)` + `--glass-border` + `--radius-lg` + `--shadow-sm` + `--inset-highlight`。
- **hover**：`border-color: var(--glass-border-light)` + `--shadow-md` + `translateY(-1px)`。
- **选中/active**：`.gradient-border`（渐变描边）+ `--accent-subtle` 底 + `--shadow-glow`。
- `.card-title`（小节标题）：`--text-xs`、600、`--text-muted`、`text-transform: uppercase`、`letter-spacing: .08em`（更精致）。

### 8.4 开关 `.feature-switch`
- 关闭：`--bg-glass-heavy` 底 + `--glass-border-light` 边；滑块白 + `--shadow-sm`。
- 开启：`background: var(--gradient-brand)` + `--accent-glow` 光 + 滑块白带微光。
- 过渡 `--transition-normal`；thumb 滑动用 `var(--ease-out-expo)`（更"跟手"）。
- 禁用：opacity .55。

### 8.5 导航项 `.settings-nav-item`
- 默认：透明底、`--text-secondary`、13px/500、圆角 `--radius-sm`。
- hover：`--bg-glass-heavy`、文字 `--text-primary`、左侧出现 3px 渐变竖条（`opacity .5`）。
- active：`position: relative` + `.nav-active-bar::before` 竖条 + 渐变软底 `--gradient-brand-soft` + 文字 `--text-primary`（600）+ `--shadow-sm`。

### 8.6 徽章 / 标签 `.badge-*` `.kb-tag` `.phase-badge` `.source-badge` `.outcome-badge` `.feature-badge`
- 统一样式：`--radius-full`、`--text-xs`、600、`padding: 2px 8px`、半透明底 + 同色描边。
- 语义色映射（替换散落的硬编码 rgba）：
  - 翡翠系：`.badge-builtin` `.outcome-ok` `.feature-badge.on` `.source-agent_summary`（可改为 info 蓝亦可，见下）→ `--accent-subtle`/`--accent`。
  - 琥珀系：`.badge-off` `.outcome-skip`(改灰) `.source-human_takeover` `.actor-badge` `.feature-badge.changed` → `--warning-bg`/`--warning`。
  - 珊瑚系：`.outcome-fail` → `--error-bg`/`--error`。
  - 紫系：`.badge-custom` `.source-agent_summary`（AI 语境）→ `--accent-violet-soft`/`--accent-violet`。
  - 信息蓝：`.phase-observe` → `--info-bg`/`--info`。
- `.badge-active`（"当前"徽章）：翡翠实底白字（或深墨字）+ 微光。

### 8.7 日志面板 `.message-log` `.log-entry` `.log-type`
- 容器：`--bg-glass-input` + `--glass-border` + `--radius-md`，等宽 `--font-mono` `--text-sm`，行高 1.7。
- 行分隔：`rgba(255,255,255,0.03)` 细线。
- 类型前缀：每条日志加 4px 彩色圆点（用 `.log-type::before`），语义色：
  - `thinking` 琥珀、`reply` 翡翠、`skip` 灰、`error` 珊瑚。
- 时间戳：`--text-xs` `--text-muted` `tabular-nums`。
- 空状态：居中 `--text-muted`。

### 8.8 状态指示 `.status-indicator` `.status-dot`
- 容器：玻璃卡（`--bg-glass` + `--radius-md`）。
- `running`：翡翠底 `--success-bg` + 翡翠描边 + `box-shadow: var(--shadow-glow)`；圆点 `--success` + `pulse-glow` 呼吸动画。
- `idle`：灰点 `--text-muted`，无光。
- `error`：珊瑚底 + 珊瑚点。
- 文字 13px/500。

### 8.9 滚动条（全局）
```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.10);
  border-radius: var(--radius-full);
}
::-webkit-scrollbar-thumb:hover { background: var(--accent); }
```
> 从 4px 提到 6px，hover 变翡翠色，命中面积和反馈都更好。

### 8.10 Toast `.toast`
- 底部胶囊：`--bg-frosted` + `blur(16px)` + `--glass-border`。
- success：翡翠字 + 翡翠描边 + 微光；error：珊瑚。
- 动画：`300ms var(--ease-out-expo)` 滑入。

### 8.11 空状态（`.kb-empty` `.crm-empty` `.memory-empty` `.persona-panel-empty` 等）
- 居中、`--text-muted`、行高 1.7。
- 可选加一个柔光圆形图标底（`background: radial-gradient(circle, var(--accent-subtle), transparent 70%)`）提升"有设计感"。

### 8.12 进度/回放 `.replay-slider`
- `accent-color: var(--accent)`；`height: 4px`，thumb 加翡翠光晕。

---

## 9. 动效与细节清单

| # | 动效 | 规范 |
|---|---|---|
| 1 | 背景氛围光 | `body` 用 `--gradient-bg`，静态低饱和（不闪）；`.app::before/after` 光斑保留 float 动画但改为翡翠/鎏金低饱和（`rgba(16,185,129,.08)` → 金 `rgba(212,175,55,.05)`） |
| 2 | 主按钮 | hover：`brightness(1.06)` + `translateY(-1px)` + 光晕增强；active：`scale(.98)` 回弹；`:active` 后 transition 用 `--ease-out-expo` |
| 3 | 卡片 hover | `translateY(-1px)` + `--shadow-md` + 描边提亮 |
| 4 | 选中卡 | 渐变描边浮现（`.gradient-border`）+ `--shadow-glow` |
| 5 | 导航 active | 左竖条 `scaleY(0→1)` 生长（`transform-origin: top`，`250ms var(--ease-out-expo)`） |
| 6 | 运行状态点 | `pulse-glow` 呼吸（scale 1→1.3 + 光晕 6px→26px，1.6s ease-in-out infinite） |
| 7 | 开关 | 滑块 `transform` 用 `--ease-out-expo`（180ms），底色渐变 |
| 8 | 品牌字标 | 可选流光：`background-size: 200%` + `background-position` 5s 循环（默认关闭，低饱和） |
| 9 | 首屏 | 保留 `.fade-in` / `.slide-up`，改为 `var(--ease-out-expo)` 420ms |
| 10 | Toast | 滑入 + 淡出 300ms |
| 11 | 滚动条 hover | 变翡翠色 |
| 12 | 减少动画 | `@media (prefers-reduced-motion: reduce) { * { animation-duration: .01ms !important; transition-duration: .01ms !important; } }` |

---

## 10. 各子窗口 / 面板统一方案

### 10.1 设置窗口（SettingsWindow）
- 侧边栏：`--bg-frosted` + 右描边；品牌区 logo 加 `drop-shadow(0 0 10px var(--accent-glow))`，"设置"字标用 `.brand-gradient-text`。
- 导航：§8.5 规则。
- 主区：h1 `--text-2xl` + 副标题；各 `card` 统一 §8.3。

### 10.2 智能体页（AgentPanel）
- `.provider-card`：玻璃卡，选中态 `.gradient-border` + `--shadow-glow`；"启用中"徽章用翡翠实底白字 + 光点。
- `.provider-version`：`--font-mono` `--text-xs` `--text-muted`。
- 右侧 `.provider-config-card`：大玻璃卡 + `--shadow-md`，内部表单按 §8.2。

### 10.3 角色设定（PersonaPanel）
- `.persona-card.active`：渐变描边 + `--accent-subtle` 底 + 左翡翠边。
- 徽章：内置=翡翠系、自定义=紫系、当前=实底、已停用=琥珀系。
- 编辑器 `.persona-editor`：玻璃卡，prompt 文本框用 `--font-mono`。

### 10.4 功能开关（FeaturePanel）
- `.feature-row`：行间分隔 `--glass-border`；hover 行底色 `--bg-glass-heavy`（整行可点感）。
- `.feature-badge.on/off/changed` 按 §8.6 语义色。
- `.feature-switch` 按 §8.4。
- `.followup-item` / `.handoff-item`：小玻璃条 + hover 提亮；"已到期"文字用琥珀。

### 10.5 工作记忆（MemoryWindow）
- 时间轴：`.trace-step-card` 玻璃卡；左侧用 2px 渐变竖线 + 圆点节点（翡翠→鎏金），体现"轨迹"。
- `.phase-badge`：observe=info 蓝、think=violet 紫、act=翡翠、verify=琥珀。
- `.replay-slider` 按 §8.12；回放按钮渐变主按钮。
- `.memory-card`（经验卡）：玻璃卡，`.source-badge` 语义色；`.memory-card-scenario` 用 `--text-md` 600。

### 10.6 知识库（KnowledgeWindow）
- `.kb-item`：玻璃卡；`.badge-import` 紫系、`.kb-item-off` 琥珀系；标题 `--text-md` 600。
- 搜索框 `.kb-search` 聚焦翡翠光环。
- 批量导入/编辑器：玻璃卡，操作按钮右对齐。

### 10.7 客户管理（CustomerWindow）
- 左列表 `.crm-customer-item`：hover `--bg-glass-heavy`、active `.gradient-border` + 翡翠字。
- `.crm-tag-filter-item.active` / `.crm-category-item.active`：翡翠实底深墨字 + 微光（替代纯黑字）。
- `.crm-section`：玻璃卡；`.crm-memory-item` 小玻璃条，`.crm-memory-reply` 保留左翡翠边线 + `--text-sm`。
- `.crm-count` / 统计：`--font-mono` `tabular-nums`。

---

## 11. 实施指南（工程师）

### 11.1 改动范围（最小集）
1. `index.css`：替换 `:root`（§3）+ 按 §8 精修组件 + 追加工具类（§3.1）+ 滚动条（§8.9）+ 动效（§9）。
2. `features.css`：开关（§8.4）、徽章（§8.6）、行 hover（§10.4）。
3. **JSX 几乎不动**。确需承载新视觉时，仅允许：给现有元素补工具类名（如给选中的 `.provider-card.selected` 加 `.gradient-border`，或给 `.settings-nav-item.active` 加 `.nav-active-bar`）。**不新增/删除 DOM 节点、不改事件与业务逻辑。**

### 11.2 不要动的东西（红线）
- 所有 `window.electron?.invoke / on`、IPC 通道、settings/customer/knowledge/memory/features/trace 调用。
- Provider 安装、引擎启停、截图/框选逻辑。
- 组件树的 JSX 结构与 props 传参。
- 只需确保视觉层（CSS 变量、类样式、工具类）落地。

### 11.3 实施顺序（推荐）
1. 编码转换（§0.2）。
2. 替换 `:root` → 观察整体底色/文字/强调色是否就位。
3. 逐组件精修（§8）：按钮→输入→卡片→开关→导航→徽章→日志→状态→滚动条。
4. 加动效（§9）与背景氛围。
5. 检查 5 个窗口 + 设置 4 个页面统一性（§10）。
6. 自查内联样式残留：App.tsx 目标应用卡里的状态点颜色（`#34d399`/`#fbbf24`）改为走 CSS 类（可在 JSX 里换成 class，属允许的最小改动）。

### 11.4 验收
- `npm run typecheck` 通过（无 TS 错误）。
- `npm run build` 通过。
- `npm run dev` 打开：主控制台 / 设置 / 记忆 / 知识库 / 客户管理 5 个界面全部呈现新视觉。
- 功能回归：启停引擎、保存设置、新增/编辑/删除知识、角色切换、开关切换、CRM 增删标签——全部与改版前一致。
- 一致性：任意窗口截图对比设计 token，确认无旧色残留（搜索 `#10b981`、`rgba(16,185,129` 等是否还有未走 token 的硬编码）。

---

## 12. 验收自检表（给 reviewer）

- [ ] `:root` 是否已替换为新 token，且所有组件仍引用有效变量。
- [ ] 5 窗口 + 设置 4 页是否统一（背景/卡片/按钮/输入/开关/徽章/导航）。
- [ ] 主色是否有"廉价荧光感"残留（应呈现翡翠+鎏金的高级感）。
- [ ] 有无旧色硬编码残留（rgba(16,185,129…)、#34d399、#fbbf24 等应走 token）。
- [ ] 渐变描边/渐变按钮/品牌渐变字是否到位。
- [ ] 动效是否克制统一（无突兀动画），`prefers-reduced-motion` 是否处理。
- [ ] typecheck + build 通过；业务功能未回归。
- [ ] index.css 编码是否已转 UTF-8（中文注释正常）。

---

*本文档由 designer2 撰写，作为工程师（t2）与评审（t3）的唯一样式事实来源。*
