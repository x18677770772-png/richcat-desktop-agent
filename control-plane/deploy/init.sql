-- 财听猫中央管理后台 初始化 DDL
-- 设计依据：docs/plan/control-plane-mvp-dev-plan.md §五
-- 安全：所有表带 tenant_id（除 users 超管）；RLS 进阶段 B，本期 API 层强制租户过滤

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 租户（企业客户）
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,               -- tn_ 前缀
  name TEXT NOT NULL,
  site_token_hash TEXT NOT NULL,     -- HMAC 哈希，不存明文 Token
  plan TEXT DEFAULT 'standard',      -- community|strategic|standard|pro|flagship
  seats INT DEFAULT 5,
  subscription_start TIMESTAMPTZ,
  subscription_end TIMESTAMPTZ,
  status TEXT DEFAULT 'active',      -- active|expired|suspended
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 用户（平台超管 tenant_id 为 NULL）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,               -- usr_ 前缀
  tenant_id TEXT REFERENCES tenants(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner', -- platform_admin|owner|agent
  failed_logins INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  must_change_password BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent（值守机）
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,         -- ag_ 前缀
  tenant_id TEXT REFERENCES tenants(id) NOT NULL,
  site_id TEXT NOT NULL,
  machine_id_hmac TEXT NOT NULL,
  agent_version TEXT,
  runtime JSONB,
  status TEXT DEFAULT 'offline',     -- online|degraded|offline
  last_seen TIMESTAMPTZ,
  cpu_pct NUMERIC,
  mem_pct NUMERIC,
  disk_free_gb NUMERIC,
  wechat_state TEXT DEFAULT 'unknown',
  first_seen TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen);

-- 用量日桶
CREATE TABLE IF NOT EXISTS usage_daily (
  agent_id TEXT REFERENCES agents(agent_id),
  tenant_id TEXT NOT NULL,
  day DATE NOT NULL,
  sessions INT DEFAULT 0,
  messages INT DEFAULT 0,
  replies INT DEFAULT 0,
  handoffs INT DEFAULT 0,
  api_calls INT DEFAULT 0,
  PRIMARY KEY (agent_id, day)
);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_day ON usage_daily(tenant_id, day);

-- 告警
CREATE TABLE IF NOT EXISTS alerts (
  alert_id TEXT PRIMARY KEY,         -- al_ 前缀
  agent_id TEXT REFERENCES agents(agent_id),
  tenant_id TEXT NOT NULL,
  severity TEXT NOT NULL,            -- critical|major|minor|info
  category TEXT NOT NULL,            -- offline|degraded|resource|model|security
  title_safe TEXT NOT NULL,
  detail_safe TEXT,
  state TEXT DEFAULT 'firing',       -- firing|resolved
  ack_status TEXT DEFAULT 'unacked', -- unacked|acked|closed
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_state ON alerts(tenant_id, state);

-- 订阅（套餐）—— 与 tenants 可拆，本期精简
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) NOT NULL,
  plan TEXT NOT NULL,
  seats INT NOT NULL,
  started_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 账单（人工收款：联系客服付费，不接支付网关）
CREATE TABLE IF NOT EXISTS bills (
  bill_id TEXT PRIMARY KEY,          -- bl_ 前缀
  tenant_id TEXT REFERENCES tenants(id) NOT NULL,
  period TEXT NOT NULL,              -- YYYY-MM
  amount_cents INT NOT NULL,
  status TEXT DEFAULT 'pending',     -- pending|paid|overdue
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bills_tenant ON bills(tenant_id);

-- 登录审计
CREATE TABLE IF NOT EXISTS login_audits (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_audits_email ON login_audits(email);
