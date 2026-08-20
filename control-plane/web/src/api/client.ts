// API 封装：fetch 包装器，自动带 Bearer Token；401 时尝试 refresh 后重试一次。
import type {
  Agent,
  AgentDetailResponse,
  Alert,
  Bill,
  CreateBillRequest,
  CreateBillResponse,
  CreateTenantRequest,
  CreateTenantResponse,
  ListResponse,
  LoginResponse,
  RefreshResponse,
  Subscription,
  Tenant,
  UsageResponse,
  User,
} from './types'

const ACCESS_KEY = 'richcat_access_token'
const REFRESH_KEY = 'richcat_refresh_token'
const USER_KEY = 'richcat_user'

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY)
  },
  get user(): User | null {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as User
    } catch {
      return null
    }
  },
  setTokens(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  setUser(user: User) {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
  },
}

export class ApiClientError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
  }
}

/** 令牌失效事件名：refresh 失败或登出后触发，供应用层跳转 /login */
export const AUTH_EXPIRED_EVENT = 'richcat:auth-expired'

/** 广播登录失效（供 App 监听并重定向） */
function emitAuthExpired() {
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
}

let refreshing: Promise<boolean> | null = null

/**
 * 尝试用 refresh token 刷新。成功返回 true，失败返回 false。
 * 并发调用共享同一个 refresh Promise，避免重复刷新。
 */
async function tryRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.refresh
  if (!refreshToken) return false

  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (!res.ok) {
          tokenStore.clear()
          emitAuthExpired()
          return false
        }
        const data = (await res.json()) as RefreshResponse
        tokenStore.setTokens(data.access, data.refresh)
        return true
      } catch {
        tokenStore.clear()
        emitAuthExpired()
        return false
      } finally {
        // 留一点时间给其他调用复用结果，然后清空
        setTimeout(() => {
          refreshing = null
        }, 0)
      }
    })()
  }
  return refreshing
}

/** 底层 fetch：带 JSON 解析与统一错误处理。doRetry 控制是否允许 refresh 重试。 */
async function request<T>(path: string, options: RequestInit = {}, doRetry = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = tokenStore.access
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  // 401：尝试刷新一次后重试
  if (res.status === 401 && doRetry) {
    const ok = await tryRefresh()
    if (ok && tokenStore.access) {
      return request<T>(path, options, false)
    }
    throw new ApiClientError(401, '登录已过期，请重新登录')
  }

  let body: unknown = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  if (!res.ok) {
    const msg =
      (body as { error?: string } | null)?.error ||
      (typeof body === 'string' ? body : `请求失败 (${res.status})`)
    throw new ApiClientError(res.status, msg)
  }

  return body as T
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'

// ─── 认证 ───
export async function apiLogin(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function apiLogout(): Promise<void> {
  const refreshToken = tokenStore.refresh
  try {
    await request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  } finally {
    tokenStore.clear()
    emitAuthExpired()
  }
}

// ─── 管理 ───
export async function apiGetFleet(): Promise<ListResponse<Agent>> {
  return request<ListResponse<Agent>>('/admin/fleet')
}

export async function apiGetAgent(id: string): Promise<AgentDetailResponse> {
  return request<AgentDetailResponse>(`/admin/agents/${encodeURIComponent(id)}`)
}

export async function apiGetUsage(from: string, to: string): Promise<UsageResponse> {
  return request<UsageResponse>(`/admin/usage?from=${from}&to=${to}`)
}

export async function apiGetAlerts(status?: 'firing' | 'resolved'): Promise<ListResponse<Alert>> {
  const q = status ? `?status=${status}` : ''
  return request<ListResponse<Alert>>(`/admin/alerts${q}`)
}

export async function apiAckAlert(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/admin/alerts/${encodeURIComponent(id)}/ack`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

// ─── 计费 ───
export async function apiGetSubscription(): Promise<Subscription> {
  return request<Subscription>('/admin/billing/subscription')
}

export async function apiGetBills(): Promise<ListResponse<Bill>> {
  return request<ListResponse<Bill>>('/admin/billing/bills')
}

// ─── 超管 ───
export async function apiListTenants(): Promise<ListResponse<Tenant>> {
  return request<ListResponse<Tenant>>('/platform/tenants')
}

export async function apiCreateTenant(req: CreateTenantRequest): Promise<CreateTenantResponse> {
  return request<CreateTenantResponse>('/platform/tenants', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function apiCreateBill(req: CreateBillRequest): Promise<CreateBillResponse> {
  return request<CreateBillResponse>('/platform/bills', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function apiMarkBillPaid(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/platform/bills/${encodeURIComponent(id)}/paid`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
