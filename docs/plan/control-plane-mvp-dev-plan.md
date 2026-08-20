# 中央管理后台（控制面）MVP 开发计划

> 目标：把「管理所有已安装财听猫终端」的总后台从架构设计变成**可 demo 的最小控制面**（多租户登录 / 心跳 / 在线状态 / 舰队视图 / 离线告警 / 计费管理）。
> 设计依据：`docs/business-plan/12-中央管理后台架构.md`（阶段 A 精简实现，数据模型/租户隔离/OTA 协议按 500+ 定义，避免返工）
> 前置：v2.0.0-alpha.1 已含本地 enterprise 模块（用量/审计/密钥加密），Agent 遥测 SDK 可复用它们
> 部署目标：**腾讯云服务器 129.226.204.240**（Docker 28 + nginx 已就绪）
> 基线：2026-08-20

---

## 一、范围界定：MVP「一版」做与不做

### 做（能 demo 的最小闭环）

| # | 模块 | 交付 | 验收 |
|---|---|---|---|
| C0 | 多租户认证 | 登录/注册页 + JWT + RBAC（超管/企业主/坐席）；每企业独立账号 | 两个企业各自登录只看自己数据 |
| C1 | Agent 遥测 SDK | 改造 app：心跳(60s) + 用量批量(10min) + 错误实时；HTTPS + 站点 Token；离线缓冲重放 | 多台机器上报，后台可见 |
| C2 | 控制面后端 | Go 服务：认证 + Agent 接入 API + 心跳落库 + 用量日桶 + 舰队/用量/告警查询 | API 可接收并存储 |
| C3 | 管理后台 Web | React：登录页 + 舰队视图 + 单机详情 + 用量看板 + 告警中心 | 后台看到所有终端状态 |
| C4 | 告警通道 | 离线 >15min → 钉钉/企微/飞书 webhook + 后台告警中心 | 杀进程 ≤15min 收到告警 |
| C5 | 计费管理 | 企业套餐（版本/坐席/到期）/ 用量对账 / 账单记录 | 后台可见每企业订阅与用量 |
| C6 | 部署+安全 | docker compose（Go+PG+Redis+React）+ nginx HTTPS + 服务器安全加固 | 公网 HTTPS 可访问，安全基线通过 |

### 不做（本期明确排除，留设计位）

- ❌ Kafka / TDengine / 微服务（阶段 A 用 PG 存近况）
- ❌ OTA 升级下发 / 配置模板下发——下一里程碑
- ❌ 沉淀学习聚合仓——遥测稳定后再做
- ❌ 私有化控制面形态（onprem 包）
- ❌ 在线支付（对接微信支付/支付宝）——本期只做账单记录与配额，收款流程后置
- ❌ mTLS 双向证书（MVP 用 HTTPS + 站点 Token，mTLS 进阶段 B）

> 原则：**打通「企业登录 → 看自己终端 → 用量 → 告警 → 计费」完整链路**，一台后台管所有企业客户，第一次可见可演示；重的东西设计上留好位。

---

## 二、总体架构（MVP 精简版）

```
┌─────────── 企业 A（N 台值守机）────────┐        ┌──────────── 腾讯云 129.226.204.240（docker compose）────────────┐
│ 财听猫 app（v2.0 + 遥测 SDK）           │        │  nginx(443 反代)                                                 │
│  ├─ 复用：usage/audit/密钥加密           │  HTTPS  │   ├─ Go API (Gin)：/auth 登录 /api/v1/telemetry /api/v1/admin  │
│  ├─ 新增 telemetry.ts：心跳/用量/错误    │ ─────▶ │   ├─ PostgreSQL 16：users/tenants/agents/usage/bills/alerts     │
│  └─ 设置配：后台地址 + 站点 Token        │        │   ├─ Redis：在线状态/JWT黑名单/SSE分发                          │
│                                        │        │   ├─ 告警扫描器 + 计费对账 job                                    │
└────────────────────────────────────────┘        │   └─ React 管理后台（登录页 + 舰队/用量/告警/计费）              │
                                                  └──────────────────────────────────────────────────────────────┘
  企业 B（另 N 台）────────── 相同接入，tenant_id 隔离
```

**角色与权限（RBAC）**：
| 角色 | 范围 | 能力 |
|---|---|---|
| 平台超管 | 全平台 | 建企业、管套餐/计费、全局舰队、运维排障 |
| 企业主 | 本企业 | 看本企业舰队/用量/告警/账单、激活坐席、管理本企业操作员 |
| 坐席/操作员 | 本企业 | 看板、告警 ack、接管（只读为主） |

**关键设计决策（对齐 doc 12 ADR）**：
- 多租户隔离：所有业务表带 `tenant_id`，查询强制注入租户上下文（RLS 进阶段 B，本期 API 层强制过滤）。
- 下行命令暂不做 → MVP 单向上行（心跳/用量/错误）。
- 遥测数据**只有元数据**（无聊天/截图/客户内容）——合规铁律。

---

## 三、技术选型（已确认）

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 后端 | **Go + Gin** | Go 1.22+, Gin v1.10 | 并发好、单二进制部署 |
| 认证 | **JWT + bcrypt + RBAC** | golang-jwt/v5, golang.org/x/crypto/bcrypt | 无额外服务，够 MVP；可加 MFA |
| 数据库 | **PostgreSQL 16** | postgres:16 | 关系型 + 预留 RLS |
| 缓存 | **Redis 7** | redis:7 | last_seen、JWT 黑名单、SSE |
| 前端 | **React + Vite + TS + ECharts** | 复用 app 同栈 | 图表/SSE 生态成熟 |
| 反代/TLS | **nginx（已有）** | 系统 nginx | 443 HTTPS + 静态托管 + /api 反代 |
| 部署 | **docker compose** | compose v2 | 单栈一键起 |

---

## 四、模块设计（文件级接口）

### C0 · 多租户认证

**目录 `control-plane/internal/auth/`**：
- `auth.go`：登录（bcrypt 校验）→ JWT（含 `{sub, tenant_id, role}`，短期 access + refresh）；token 黑名单入 Redis（登出/吊销）。
- `rbac.go`：中间件 `RequireRole(role)`；`RequireTenant()` 强制从 JWT 取 tenant_id 注入上下文。
- `password.go`：bcrypt 哈希；密码强度校验（≥8位+字母数字）。
- **注册策略**：企业账号由**平台超管创建**（后台建企业 → 发邀请链接/初始密码），不开放公网自助注册（防滥用）。

### C1 · Agent 遥测 SDK

**新增 `src/core/enterprise/telemetry.ts` + 主进程装配**（对齐 v2.0 已有 enterprise 模块）

```ts
export interface TelemetryConfig {
  controlPlaneUrl: string   // https://ops.richcat.ai
  siteToken: string
  heartbeatIntervalMs?: number   // 60000
  usageFlushIntervalMs?: number  // 600000
}
export class TelemetryClient {
  constructor(config, deps: { getUsage; getAudit; getSystemInfo; deviceId; onSend? })
  start(); stop();
  sendHeartbeat(); flushUsage(); reportError(code, msgSafe);
}
```
事件信封对齐 doc 12 §2.2（`{schema_version, event_id, event_type, producer{tenant_id,agent_id,machine_id_hmac,...}, payload}`）。

### C2 · 控制面后端

**目录 `control-plane/`**：
```
control-plane/
├── go.mod
├── cmd/server/main.go
├── internal/
│   ├── config/config.go
│   ├── model/models.go          # Tenant/User/Agent/UsageDaily/Alert/Subscription/Bill
│   ├── auth/{auth,rbac,password}.go   # C0
│   ├── api/{router,telemetry,admin,billing}.go
│   ├── store/{tenant,user,agent,usage,alert,bill}.go
│   ├── alert/{scanner,notifier}.go
│   ├── billing/{meter,report}.go     # C5
│   └── middleware/{auth,tenant,ratelimit}.go
├── deploy/docker-compose.yml
├── web/                          # React 管理后台（C3）
└── scripts/smoke.sh              # C6
```

**接口契约**：
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/auth/login` | 登录 → {access, refresh, user} |
| POST | `/api/v1/auth/refresh` | 刷新 token |
| POST | `/api/v1/auth/logout` | 登出（黑名单） |
| POST | `/api/v1/telemetry` | Agent 上报（Bearer 站点 Token，tenant 从 token 解析） |
| GET | `/api/v1/admin/fleet` | 舰队视图（本租户） |
| GET | `/api/v1/admin/agents/:id` | 单机详情 |
| GET | `/api/v1/admin/usage` | 用量看板 |
| GET | `/api/v1/admin/alerts` | 告警列表 |
| POST | `/api/v1/admin/alerts/:id/ack` | 告警确认 |
| GET | `/api/v1/admin/billing/subscription` | 本企业套餐/到期 |
| GET | `/api/v1/admin/billing/bills` | 账单记录 |
| 超管 | `/api/v1/platform/tenants` 等 | 建企业/管套餐（仅 platform_admin） |

### C3 · 管理后台 Web

**`control-plane/web/`**（Vite + React + TS + ECharts）：
1. **登录页**（企业主/坐席/超管，角色不同跳不同首页）。
2. **舰队视图**（第一屏）：KPI（总/在线/离线/降级/待续费）+ 每终端卡片（健康色/last_seen/版本/CPU）。
3. **单机详情**：7 天在线曲线 + 今日用量 + 最近错误 + 告警历史。
4. **用量看板**：日/周/月 消息量/接管/API 成本，配额进度。
5. **告警中心**：列表 + ack/关闭 + 规则展示。
6. **计费页**：本企业套餐（版本/坐席/到期日）、用量 vs 配额、账单记录、续费入口（本期跳转人工）。

### C4 · 告警通道

`alert/scanner.go` 每 1min 扫 Redis last_seen，>15min → alert + webhook；恢复 → resolved。防抖 30min。

### C5 · 计费管理

- `model`：`subscriptions(tenant_id, plan, seats, started_at, expires_at, status)` + `bills(tenant_id, period, amount_cents, status)`。
- `billing/meter.go`：用量日桶（来自遥测 usage）累计到配额；超配额 → 告警/标记。
- `billing/report.go`：月账单生成（本期记录，对接支付后置）。
- 超管可：建企业、配套餐、改坐席/到期、查账单；企业主可：看本企业订阅与账单。

### C6 · 部署 + 安全

**docker-compose.yml**（postgres:16 + redis:7 + server + 可选 web 构建）：
```yaml
services:
  postgres: image: postgres:16
  redis:    image: redis:7
  server:   build: ../.
  nginx:    使用系统 nginx 反代（不重复起容器）
```
**nginx**（复用现有 80/443）：
- 新子域名/路径 `ops.richcat.ai`（或 `129.226.204.240`）→ HTTPS（Let's Encrypt 或自有证书）→ 静态 web/ + /api 反代。
- 限流：/auth/login 每 IP 限速（防爆破）；/api 全局限速。

**安全基线**（本计划强制项）：
1. HTTPS 全链路（nginx 443 + 证书；内部 http）。
2. 密码 bcrypt + 强度校验；JWT 短期 access（15min）+ refresh（7d，可吊销）。
3. **租户隔离**：JWT tenant_id 强制注入，API 层每查询带 tenant 过滤；跨租户访问返回 403。
4. 登录审计：失败次数、IP、时间入库；连续失败 5 次锁定 15min。
5. Agent 站点 Token：哈希存储，可吊销。
6. 数据库：PG 仅监听 docker 内网，不暴露公网；强密码；备份。
7. 服务器：仅开放 443/80（+SSH）；防火墙；关闭不必要的服务。
8. 依赖扫描：`go vuln` + `npm audit` 作为 CI 检查。
9. 敏感数据：账单/用户表字段最小化；日志脱敏（不记密码/token）。
10. CSP/安全头：管理后台设置 CSP、X-Frame-Options、HSTS。

---

## 五、数据模型（MVP）

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY, name TEXT, site_token_hash TEXT,
  plan TEXT DEFAULT 'standard', seats INT DEFAULT 5,
  subscription_start TIMESTAMPTZ, subscription_end TIMESTAMPTZ,
  status TEXT DEFAULT 'active',   -- active|expired|suspended
  created_at TIMESTAMPTZ
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id),  -- 超管 tenant_id NULL
  email TEXT UNIQUE, password_hash TEXT, role TEXT,            -- platform_admin|owner|agent
  failed_logins INT DEFAULT 0, locked_until TIMESTAMPTZ,
  last_login TIMESTAMPTZ, created_at TIMESTAMPTZ
);
CREATE TABLE agents (
  agent_id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id),
  machine_id_hmac TEXT, agent_version TEXT, runtime JSONB,
  status TEXT DEFAULT 'offline', last_seen TIMESTAMPTZ,
  cpu_pct NUMERIC, mem_pct NUMERIC, wechat_state TEXT
);
CREATE TABLE usage_daily (
  agent_id TEXT, tenant_id TEXT, day DATE,
  sessions INT, messages INT, replies INT, handoffs INT, api_calls INT,
  PRIMARY KEY (agent_id, day)
);
CREATE TABLE alerts (
  alert_id TEXT PRIMARY KEY, agent_id TEXT, tenant_id TEXT,
  severity TEXT, category TEXT, title_safe TEXT, detail_safe TEXT,
  state TEXT DEFAULT 'firing', ack_status TEXT DEFAULT 'unacked',
  created_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ
);
CREATE TABLE bills (
  bill_id TEXT PRIMARY KEY, tenant_id TEXT, period TEXT,
  amount_cents INT, status TEXT DEFAULT 'pending',  -- pending|paid|overdue
  created_at TIMESTAMPTZ
);
```

---

## 六、任务拆解与依赖

```
W0 环境：control-plane/ 骨架 + go.mod + compose + nginx 反代占位      [无依赖]

任务A C1 Agent 遥测 SDK（telemetry.ts + 装配 + 单测）                [无依赖，可并行]
任务B C0 认证（auth/rbac/password + 单测）                          [无依赖，可并行]
任务C C2 后端（model/store/api + go test）                          [依赖 B 的 JWT 契约]
任务D C3 管理后台 Web（登录/舰队/详情/用量/告警/计费页）              [依赖 C 的 admin API 契约]
任务E C4 告警 + C5 计费                                             [依赖 C 的 store]
任务F C6 部署 + 安全 + 冒烟全链路                                    [依赖全部]

并行策略：A 与 B 无依赖可并行（A 只改 app，B 只建新目录）；C/D/E 串行于 B 后；
F 收尾。纯逻辑模块（telemetry.ts/auth/password）可派 general-purpose 代理并行写。
```

---

## 七、验收标准（Gate）

1. **多租户登录**：超管建企业 A/B → 分别登录 → 各只看自己舰队/用量/账单；A 越权查 B 数据返回 403。
2. Agent 上报心跳 → 舰队视图显示**在线**，单机详情可见版本/CPU/微信态。
3. 停止上报 → **≤15min**（测试阈值 30s）→ 告警 + webhook + 后台可见；恢复 → resolved。
4. 用量批量上报 → 日桶累计正确（与 app 内 usage 一致）。
5. **计费**：超管配 A 套餐（标准版 5 席，到期日）→ 后台显示订阅；用量 vs 配额进度可见；账单记录生成。
6. 错误实时上报 → 后台可见结构化脱敏错误。
7. 公网 HTTPS 访问正常；登录限流/锁定生效；跨租户 403；PG 不暴露公网。
8. docker compose 一键起 + 冒烟脚本全绿 + `go test ./...` 通过。

---

## 八、时间估算

| 里程碑 | 工作量 |
|---|---|
| C0 认证 + C1 遥测 SDK | 3-4 天（可并行） |
| C2 后端 API + 存储 | 3-4 天 |
| C3 管理后台 Web | 3 天 |
| C4 告警 + C5 计费 | 2-3 天 |
| C6 部署 + 安全 + 联调冒烟 | 2-3 天 |
| **合计** | **约 13-17 天（单人），并行压缩到 ~10-12 天** |

---

## 九、安全清单（交付前逐项确认）

- [ ] HTTPS 全链路（nginx 证书 + HSTS）
- [ ] 密码 bcrypt + 强度校验；JWT 短期 + refresh + 黑名单
- [ ] 租户隔离 API 层强制过滤；跨租户 403 单测
- [ ] 登录限流 + 失败锁定；登录审计
- [ ] 站点 Token 哈希存储 + 可吊销
- [ ] PG 仅内网 + 强密码 + 备份；Redis 内网
- [ ] 服务器防火墙只开 443/80/SSH
- [ ] CSP/X-Frame-Options/安全头；日志脱敏
- [ ] `go vuln` + `npm audit` 无高危
- [ ] 首次登录强制改密（企业主/坐席）

---

## 十、开工前置（已确认）

**已确认**：
- 技术栈 Go+Gin / React / PG16 / Redis7
- 部署腾讯云本机（129.226.204.240），复用系统 nginx 反代
- 安全基线（HTTPS 自签证书 + 10 项安全清单）
- 域名后置：先 IP 直连，后期绑 `ops.richcat.ai` 子域名
- 企业注册：**不开放自助注册（本期），由超管手动建企业账号**；后期可开放预览版自助注册→试用→转付费
- 收款：**不接微信/支付宝**，联系客服付款（人工对账手动开通）

**开工安排**：
```
W0 环境：control-plane/ 骨架 + go.mod + compose + nginx 反代
   │
   ├─ 任务A（并行） C1 Agent 遥测 SDK（telemetry.ts + 主进程装配）
   ├─ 任务B（并行） C0 认证（auth/rbac/password/JWT）
   │
   ├─ 任务C C2 后端 API（model/store/api + go test）
   ├─ 任务D C3 管理后台 Web（登录/舰队/详情/用量/告警/计费）
   ├─ 任务E C4 告警 + C5 计费对账
   │
   └─ 任务F C6 部署 + 安全 + 冒烟全链路
```

---

*本计划为总后台 MVP 的任务拆解；确认域名/注册/支付三点后按 §六 并行开工，每模块完成即跑对应单测，收尾走 C6 安全清单 + 冒烟全链路验证。*
