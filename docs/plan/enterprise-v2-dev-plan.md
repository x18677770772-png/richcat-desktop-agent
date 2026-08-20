# 企业版 v2.0「一版」颗粒化开发计划

> 目标：把 90 天产品端最小闭环（License + 审计 + 用量计量 + 安全 + 企业版 UI）落成**可测试、可构建、可预览**的 v2.0-enterprise-alpha 切片。
> 基线：v1.1.0（已读通 `src/main/index.ts` / stores / feature 装配体系）
> 依据：[14-产品端统一方案](../business-plan/14-产品端统一方案-收费×后台×沉淀学习.md)、[11-收费模式设计](../business-plan/11-收费模式设计.md)、[12-中央管理后台架构](../business-plan/12-中央管理后台架构.md)
> 构建环境：Linux 服务器，`npm install` 后台进行中（下载 Electron + 编译 robotjs，成败决定本机能否跑 `typecheck/build`）。

---

## 一、范围界定：本期"一版"做与不做

### 做（可测试可预览的企业版骨架）

| # | 模块 | 交付物 | 可测性 |
|---|---|---|---|
| E1 | 版本升级 | `package.json` → `2.0.0-alpha.1`；CHANGELOG；版本管理说明 | — |
| E2 | License 授权核心 | `src/core/enterprise/license.ts`（纯逻辑：设备指纹、14 天试用、激活码校验、到期降级、状态机） | 纯函数单测 |
| E3 | 审计日志核心 | `src/core/enterprise/audit.ts`（append-only JSONL：引擎启停/设置变更/License 激活/接管事件） | 纯函数单测 |
| E4 | 用量计量核心 | `src/core/enterprise/usage.ts`（会话/消息/接管计数、日桶持久化、配额熔断） | 纯函数单测 |
| E5 | 密钥静态加密 | `src/core/enterprise/crypto.ts`（派生密钥 + API Key 加解密，替换明文存储） | 纯函数单测 |
| E6 | 主进程装配 | `src/main/index.ts`：初始化 E2-E5、新增 `enterprise:*` IPC、引擎钩子（回复计数/审计事件/配额熔断 gate） | — |
| E7 | 企业版 UI | `src/renderer/src/EnterprisePanel.tsx` + App.tsx 设置侧边栏新增「企业版」tab：License 状态/激活框、用量仪表盘、审计流 | 构建验证 |
| E8 | 冒烟测试 | `scripts/e-enterprise-smoke.ts`（按现有 smoke 脚本模式） | 可运行 |

### 不做（本期明确排除，防拖节奏）

- ❌ 云端控制面（Go/Kafka/PostgreSQL/TDengine）——Phase B 基础设施
- ❌ 真实在线 License 服务端 —— 本期为本地激活（离线码）+ 服务端接口预留
- ❌ 遥测上报 SDK / 多租户隔离 —— 依赖云管
- ❌ 沉淀学习全局回灌 —— 依赖遥测管道
- ❌ 多账号舰队视图 —— 依赖云管控制面
- ❌ API v1 / SSO / SLA 报告 —— 后续版本

> 原则：**先把"能收费、能留痕、能防亏"的三件纯逻辑内核做扎实并可单测**，UI 与 IPC 作为装配层把价值显性化。

---

## 二、模块设计（文件级接口）

### E2 · License 授权核心 — `src/core/enterprise/license.ts`

```ts
export type LicenseStatus = 'trial' | 'active' | 'expired' | 'grace' | 'invalid'

export interface LicenseState {
  status: LicenseStatus
  plan: 'community' | 'strategic' | 'standard' | 'pro' | 'flagship'
  seats: number
  activatedAt: number | null
  expiresAt: number | null   // active/expired 用；trial 用 trialEndsAt
  trialEndsAt: number | null
  deviceId: string
  licenseKey: string | null   // 脱敏展示用
}

export interface LicenseInput {
  deviceId: string
  now?: number               // 可注入时间，便于单测
  /** 到期宽限天数：active 到期后进入 grace 的天数（默认 7） */
  graceDays?: number
  /** 试用时长（默认 14 天） */
  trialDays?: number
}

export class LicenseManager {
  constructor(private io: LicenseIO) {}
  getState(): LicenseState
  startTrial(): LicenseState
  activate(licenseKey: string): { ok: true; state: LicenseState } | { ok: false; error: string }
  /** 引擎每轮调用前的门禁：返回是否允许继续（active/trial/grace=true；expired 且无宽限=false） */
  canRun(): boolean
  /** 过期时降级策略：返回描述文案 */
  degradation(): string
}

/** 持久化接口（主进程用 electron-store / 单测用内存实现） */
export interface LicenseIO {
  read(): Partial<LicenseState>
  write(state: LicenseState): void
}
```

**校验规则（可单测）**：
- 设备指纹：主进程生成 UUID 存 `settings.enterprise.deviceId`（不复用账号指纹）。
- 激活码格式：`RC-XXXX-XXXX-XXXX-XXXX`，HMAC-SHA256 派生校验（密钥内置占位，服务端上线后换公钥/在线校验）。
- 状态机：`无任何记录 → trial(14天) → 到期 → expired`；`激活成功 → active(1年) → 到期 → grace(7天) → expired`。
- `canRun()`：`active|trial|grace → true`；`expired → false`（引擎启动前检查，阻止启动并提示激活/续费）。

### E3 · 审计日志核心 — `src/core/enterprise/audit.ts`

```ts
export type AuditAction =
  | 'engine.start' | 'engine.stop'
  | 'settings.update' | 'settings.vision.key.updated'
  | 'license.trial.start' | 'license.activate' | 'license.expire'
  | 'handoff.triggered' | 'knowledge.import' | 'persona.update'

export interface AuditEvent {
  id: string          // ulid
  ts: number
  action: AuditAction
  actor: 'system' | 'user'
  detail?: string     // 脱敏后的描述（不得含完整 API Key / 手机号）
  meta?: Record<string, unknown>
}

export class AuditLogger {
  constructor(private filePath: string) {}
  /** append-only 写一行 JSONL；写失败仅 log 不抛错（不阻塞主链路） */
  record(action: AuditAction, actor: 'system' | 'user', detail?: string, meta?: Record<string, unknown>): void
  /** 按 action / 时间窗 / actor 过滤查询 */
  list(filter?: AuditFilter): AuditEvent[]
  /** 导出（脱敏版，供 UI/审计） */
  export(filter?: AuditFilter): string   // JSON array 文本
  count(): number
}
```

**规则**：文件 `<userData>/worktrace/audit/audit.jsonl`，append-only，单行 JSON；`list` 读全文过滤（本期数据量小，不做索引）；`detail` 一律脱敏（Key 只留末 4 位、客户名可留）。

### E4 · 用量计量核心 — `src/core/enterprise/usage.ts`

```ts
export interface UsageSnapshot {
  date: string          // YYYY-MM-DD
  sessions: number      // 引擎启动会话数
  messages: number      // 处理消息数（provider 回复/skip 均计）
  replies: number       // 实际回复数
  handoffs: number      // 人工接管触发数
  apiCalls: number      // VLM/LLM 调用估算
  quotaLimit: number    // 当日配额（基础额度日折算）
}

export class UsageMeter {
  constructor(private io: UsageIO) {}
  /** 每处理一条消息调用；返回是否仍在配额内（超限返回 false → 熔断） */
  recordMessage(kind: 'reply' | 'skip' | 'handoff'): boolean
  getToday(): UsageSnapshot
  /** 是否熔断中（达到当日配额上限） */
  isQuotaExceeded(): boolean
  /** 超限后降级策略描述 */
  overageMessage(): string
}

export interface UsageIO {
  read(day: string): UsageSnapshot | null
  write(snapshot: UsageSnapshot): void
}
```

**规则**：
- 配额计算：基础额度 10,000 会话/坐席/年 → 日折算 = `ceil(10000 * seats / 365)`；硬封顶 = 基础×1.2。
- 持久化：`<userData>/worktrace/usage/<YYYY-MM-DD>.json`（单文件单日，跨日自动新桶）。
- 熔断：`isQuotaExceeded()` 为 true 时引擎停止自动回复（`shouldSkipContact` 之外再套一层 gate），只保留人工接管；返回 overageMessage 提示升级用量包。
- 计数挂点：`GenericChannelSession` 的 `provider.reply_text / skip / error` 分支（装配层做）。

### E5 · 密钥静态加密 — `src/core/enterprise/crypto.ts`

```ts
export class SecretBox {
  /** 用 master key（存 settings.enterprise.masterKey，首次生成）派生 AES-256-GCM */
  constructor(masterKey: string)
  encrypt(plain: string): string    // base64(iv|cipher|tag)
  decrypt(payload: string): string
}
```

**规则**：`settings.vision.apiKey` / `chatProvider.config.apiKey` 存密文；读取时解密。masterKey 用 `randomBytes(32)` 生成一次存 settings。这是"静态加密"基线（比明文强），完整 KMS/DPAPI 后续接入。**迁移**：读取旧明文时自动加密写回。

### E6 · 主进程装配 — `src/main/index.ts`（改动点）

| 挂载点 | 改动 |
|---|---|
| `settingsStore` defaults | 加 `enterprise: { deviceId, license, plan, seats, trialEndsAt, expiresAt, activatedAt, masterKey }` |
| `app.whenReady` | 初始化 `licenseManager / auditLogger / usageMeter / secretBox` 单例；新增 IPC |
| `startEngineCore` | 入口先 `license.canRun()`，不通过则返回 `{reason:'license_expired'}`；运行中 `usageMeter.recordMessage(...)` 在 transformResult / reply 分支；配额熔断 gate 加入 `shouldSkipContact` |
| `settings:set` | 钩子：`vision.apiKey` 变化 → 加密存储 + 审计 `settings.vision.key.updated` |
| `engine:start/stop` | 审计 `engine.start / engine.stop` |
| License IPC | `enterprise:license:getState / startTrial / activate / reset` |
| 审计 IPC | `enterprise:audit:list / export / count` |
| 用量 IPC | `enterprise:usage:getToday / isQuotaExceeded / overage` |

### E7 · 企业版 UI — 设置窗口「企业版」tab

- `src/renderer/src/EnterprisePanel.tsx`：三个卡片区
  1. **License 卡片**：状态徽标（试用中/已激活/已过期）、计划名、席位、到期时间；未激活 → 「开始 14 天试用」按钮 + 激活码输入框 + 激活按钮；已过期 → 降级文案 + 续费引导。
  2. **用量仪表盘**：今日会话/消息/回复/接管计数 + 进度条（已用/配额）+ 熔断状态提示 + 超量购买引导。
  3. **审计流**：最近 N 条审计事件（action/时间/actor/detail），「导出」按钮。
- `src/renderer/src/App.tsx`：`SettingsSection` 加 `'enterprise'` 侧边栏项。
- `src/renderer/src/features.css`：复用现有 token，新增企业版样式类。

### E8 · 冒烟测试 — `scripts/e-enterprise-smoke.ts`

按现有脚本模式（`npx ts-node --transpile-only`，头注释带 `TS_NODE_COMPILER_OPTIONS` 模板 + `"target":"esnext"`），断言：
- License 状态机：trial→过期→激活→grace→expired 全流转
- Audit append-only：写入→读取→过滤→导出
- Usage：配额内/超限熔断切换
- Crypto：encrypt→decrypt 往返一致
- 全绿输出 + 失败 exit 非 0

---

## 三、任务拆解与依赖（可并行性标注）

```
W0 前置：npm install 成功（决定本机验证能力）
 │
 ├─ 任务A 版本升级（E1）          [无依赖，先做]
 ├─ 任务B E5 crypto（纯逻辑+单测） [无依赖，可并行]
 ├─ 任务C E2 license（纯逻辑+单测）[依赖 E5 指纹，可并行]
 ├─ 任务D E3 audit（纯逻辑+单测）  [无依赖，可并行]
 ├─ 任务E E4 usage（纯逻辑+单测）  [无依赖，可并行]
 │
 ├─ 任务F E6 主进程装配（index.ts + IPC + 引擎钩子）[依赖 B/C/D/E]
 ├─ 任务G E7 企业版 UI（EnterprisePanel + App.tsx + css）[依赖 F 的 IPC 通道]
 │
 └─ 任务H E8 冒烟 + typecheck/lint/build 验证 [依赖全部]
      └─ 代码审查 pass（code-reviewer 代理）
```

**并行策略**：B/C/D/E 四颗纯逻辑模块无相互依赖，可 4 个 executor 并行；F/G 串行于其后（都动 main 与 renderer，避免冲突）；H 收尾。

---

## 四、验收标准（Gate）

1. `npm run typecheck`（node+web）全绿
2. `npm run lint` 零新增 error（保持基线 124）
3. `npm run build` 通过（main/preload/renderer 产物完整）
4. `npx ts-node --transpile-only scripts/e-enterprise-smoke.ts` 全绿
5. License 门禁生效：`canRun()=false` 时 `engine:start` 返回 license_expired 且不启动
6. 审计：引擎启停 / 设置 Key 更新 / License 激活均有记录可查可导出
7. 用量：计数随引擎运行增长，达到配额上限触发熔断（UI 可见）
8. 密钥：settings.json 中 apiKey 为密文，应用内解密可用

---

## 五、风险与预案

| 风险 | 影响 | 预案 |
|---|---|---|
| npm install 失败（robotjs 原生编译） | 本机无法 build/typecheck | 纯逻辑模块仍可单测（ts-node 不需 electron）；UI/装配代码以审慎编写 + 由用户本机验证；计划不变 |
| Electron 需图形环境才能真正运行 | 服务器无法"预览"GUI | 预览方式 = 用户本地 `npm run dev`；服务器交付 = 可构建产物 + 冒烟 + 截图(若可跑 xvfb 则补) |
| 主进程单文件大（index.ts ~2000 行） | 装配冲突 | 企业版单例抽到 `src/core/enterprise/index.ts`，index.ts 只接线不写业务 |
| API Key 加密改动风险 | 配置不兼容 | 读取旧明文自动迁移加密；解密失败回退原值并 log，不阻断启动 |

---

*计划结束。按三、并行策略派工；每模块完成即跑对应单测，装配完成跑 H 全量验证，最后由 code-reviewer 审查通过后交付预览。*
