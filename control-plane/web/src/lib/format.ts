// 通用格式化工具

/** 相对时间：刚刚 / n分钟前 / n小时前 / n天前 / 日期 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} 天前`
  return formatDate(iso)
}

/** 格式化日期 YYYY-MM-DD */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 格式化日期时间 YYYY-MM-DD HH:mm */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 金额：分 → 元字符串 */
export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** 今天 YYYY-MM-DD */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** n 天前的日期 YYYY-MM-DD */
export function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 套餐中文名 */
export function planName(plan: string): string {
  const map: Record<string, string> = {
    community: '社区版',
    strategic: '战略伙伴版',
    standard: '标准版',
    pro: '专业版',
    flagship: '旗舰版',
  }
  return map[plan] ?? plan
}

/** 角色中文名 */
export function roleName(role: string): string {
  const map: Record<string, string> = {
    platform_admin: '平台超管',
    owner: '企业主',
    agent: '坐席',
  }
  return map[role] ?? role
}

/** Agent 状态中文名 */
export function statusName(status: string): string {
  const map: Record<string, string> = {
    online: '在线',
    degraded: '降级',
    offline: '离线',
  }
  return map[status] ?? status
}

/** 告警类别中文名 */
export function categoryName(cat: string): string {
  const map: Record<string, string> = {
    offline: '离线',
    degraded: '降级',
    resource: '资源',
    model: '模型',
    security: '安全',
  }
  return map[cat] ?? cat
}

/** 严重级别中文名 */
export function severityName(sev: string): string {
  const map: Record<string, string> = {
    critical: '严重',
    major: '主要',
    minor: '次要',
    info: '提示',
  }
  return map[sev] ?? sev
}

/** 账单状态中文名 */
export function billStatusName(status: string): string {
  const map: Record<string, string> = {
    pending: '待付',
    paid: '已付',
    overdue: '逾期',
  }
  return map[status] ?? status
}

/** 租户状态中文名 */
export function tenantStatusName(status: string): string {
  const map: Record<string, string> = {
    active: '正常',
    expired: '已到期',
    suspended: '已停用',
  }
  return map[status] ?? status
}

/** 订阅状态中文名 */
export function subscriptionStatusName(status: string): string {
  const map: Record<string, string> = {
    active: '生效中',
    expired: '已到期',
    suspended: '已停用',
  }
  return map[status] ?? status
}
