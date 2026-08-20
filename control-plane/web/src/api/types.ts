// 与后端 Go 契约对齐的 TypeScript 类型定义
// 参考 internal/model/models.go 与 internal/api/*.go

/** 角色：平台超管 / 企业主 / 坐席 */
export type Role = 'platform_admin' | 'owner' | 'agent'

/** 套餐：community 社区版 / strategic 战略伙伴版 / standard 标准版 / pro 专业版 / flagship 旗舰版 */
export type Plan = 'community' | 'strategic' | 'standard' | 'pro' | 'flagship'

/** Agent 状态 */
export type AgentStatus = 'online' | 'degraded' | 'offline'

/** 告警严重级别 */
export type AlertSeverity = 'critical' | 'major' | 'minor' | 'info'

/** 告警状态 */
export type AlertState = 'firing' | 'resolved'

/** 告警确认状态 */
export type AckStatus = 'unacked' | 'acked' | 'closed'

/** 账单状态 */
export type BillStatus = 'pending' | 'paid' | 'overdue'

/** 租户状态 */
export type TenantStatus = 'active' | 'expired' | 'suspended'

export interface User {
  id: string
  tenant_id?: string
  email: string
  role: Role
}

export interface LoginResponse {
  access: string
  refresh: string
  user: User
}

export interface RefreshResponse {
  access: string
  refresh: string
}

export interface Agent {
  agent_id: string
  tenant_id: string
  site_id: string
  machine_id_hmac: string
  agent_version: string
  status: AgentStatus
  last_seen: string | null
  cpu_pct: number
  mem_pct: number
  disk_free_gb: number
  wechat_state: string
  first_seen: string
}

export interface UsageDaily {
  agent_id: string
  tenant_id: string
  day: string // YYYY-MM-DD
  sessions: number
  messages: number
  replies: number
  handoffs: number
  api_calls: number
}

export interface UsageSummary {
  total_sessions: number
  total_messages: number
  total_replies: number
  total_handoffs: number
  total_api_calls: number
}

export interface UsageResponse {
  from: string
  to: string
  summary: UsageSummary
}

export interface Alert {
  alert_id: string
  agent_id: string
  tenant_id: string
  severity: AlertSeverity
  category: string
  title_safe: string
  detail_safe: string
  state: AlertState
  ack_status: AckStatus
  created_at: string
  resolved_at?: string | null
}

export interface Subscription {
  tenant_id: string
  plan: Plan
  seats: number
  subscription_start: string | null
  subscription_end: string | null
  status: TenantStatus
}

export interface Bill {
  bill_id: string
  tenant_id: string
  period: string // YYYY-MM
  amount_cents: number
  status: BillStatus
  note?: string
  created_at: string
  paid_at?: string | null
}

export interface Tenant {
  id: string
  name: string
  plan: Plan
  seats: number
  subscription_start: string | null
  subscription_end: string | null
  status: TenantStatus
  created_at: string
}

export interface ListResponse<T> {
  data: T[]
  total: number
}

export interface AgentDetailResponse {
  agent: Agent
  usage_last_7d: UsageDaily[]
}

export interface CreateTenantRequest {
  name: string
  site_token?: string
  plan?: Plan
  seats?: number
}

export interface CreateTenantResponse {
  tenant: Tenant
  site_token: string
}

export interface CreateBillRequest {
  tenant_id: string
  period: string
  amount_cents: number
  note?: string
}

export interface CreateBillResponse {
  bill: Bill
}

export interface ApiError {
  error: string
}
