// src/core/features/daily-report/report.ts
// ── F6 服务日报：当日数据汇总（DailyReportGenerator）──
// 设计文档：docs/richcat-v2-design.md §3-F6。
// 回滚说明：本文件属于 F6 独立 commit；revert 后日报不再生成，reports/*.md 残留无害。
//
// 数据来源全部只读（现有 store + F2/F7 可选接口）：
// - CustomerStore.listCustomers() 过滤 lastSeenAt ∈ 当日 → 服务客户/名单
// - VIP 判定（category=VIP || tags 含 VIP）→ 今日互动 VIP / 今日新增 VIP
// - 情绪风险：今日互动客户中带 F5 风险标签（情绪负面/退款意向/投诉/紧急）者
// - F7 FollowUpStore（可选接口，未实现显示 0/无）→ 今日新增待跟进
// - F2 HandoffStore（可选接口，未实现显示 0/无）→ 待处理接管
// - listTraceSessions（可选接口）→ 今日服务轮次
//
// 依赖注入解耦：F6 不 import 任何其他 feature 模块（文档 §1.3：禁止 features 互 import），
// 待跟进/接管通过 DailyReportSources 可选函数注入，F2/F7 落地后由装配方接线即可。

import { CustomerProfile, CustomerStore } from '../../customers/customer-store'
import { TraceSessionMeta } from '../../trace/trace-types'

/** F7 待跟进的只读子集（避免依赖 follow-up 模块类型） */
export interface FollowUpLike {
  action: string
  contact: string | null
  dueAt: number
  status: string
  createdAt: number
}

/** F2 人工接管的只读子集（避免依赖 human-handoff 模块类型） */
export interface HandoffLike {
  reason: string
  contact: string | null
  confidence: number
  status: string
  createdAt: number
}

/** 日报数据源（全部只读；F2/F7 未实现时对应函数缺省 → 该节显示 0/无） */
export interface DailyReportSources {
  customerStore: () => CustomerStore
  worktraceBaseDir: () => string
  /** 今日轨迹会话（服务轮次）；缺省返回空数组 */
  listTraceSessions?: (baseDir: string) => Promise<TraceSessionMeta[]>
  /** F7：全部待跟进（日报按 createdAt∈当日 && status=open 过滤）；缺省 → 0/无 */
  listFollowUps?: () => FollowUpLike[]
  /** F2：全部接管（日报按 status=open 过滤）；缺省 → 0/无 */
  listHandoffs?: () => HandoffLike[]
}

/** 当日日报汇总数据 */
export interface DailyReportData {
  /** YYYY-MM-DD（本地时区） */
  date: string
  dayStart: number
  /** 当日互动过的客户（按 lastSeenAt ∈ [dayStart, dayEnd)） */
  servedCustomers: CustomerProfile[]
  /** 当日互动的 VIP 客户 */
  vipServed: CustomerProfile[]
  /** 当日新增的 VIP 客户（firstSeenAt ∈ 当日 且判定为 VIP） */
  vipNewToday: CustomerProfile[]
  /** 当日互动且带 F5 风险标签的客户（情绪风险） */
  riskCustomers: CustomerProfile[]
  /** 今日新增待跟进（F7；未实现为空） */
  followUps: FollowUpLike[]
  /** 待处理接管（F2；未实现为空） */
  handoffs: HandoffLike[]
  /** 今日轨迹会话（服务轮次） */
  traceSessionsToday: TraceSessionMeta[]
}

/** VIP 判定（与 §3-F3 一致；F6 自包含，不 import features/vip——§1.3 禁互 import） */
export function isVipCustomer(customer: CustomerProfile): boolean {
  return customer.category === 'VIP' || customer.tags.includes('VIP')
}

/** F5 风险标签（与 features/emotion-risk/emotion.ts 打标文案保持一致） */
export const RISK_TAGS = ['情绪负面', '退款意向', '投诉', '紧急'] as const

export function hasRiskTag(customer: CustomerProfile): boolean {
  return RISK_TAGS.some((tag) => customer.tags.includes(tag))
}

export class DailyReportGenerator {
  constructor(private readonly sources: DailyReportSources) {}

  /** 汇总指定日期（默认今天）的日报数据；所有读取失败均降级为空，绝不抛错 */
  async generate(day: Date = new Date()): Promise<DailyReportData> {
    const date = formatDayKey(day)
    const dayStart = startOfDay(day).getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000

    let customers: CustomerProfile[] = []
    let followUps: FollowUpLike[] = []
    let handoffs: HandoffLike[] = []
    let traceSessions: TraceSessionMeta[] = []
    try {
      customers = this.sources.customerStore().listCustomers()
    } catch (error) {
      console.error('[DailyReport] 读取客户档案失败:', error)
    }
    try {
      followUps = this.sources.listFollowUps?.() ?? []
    } catch (error) {
      console.error('[DailyReport] 读取待跟进失败:', error)
    }
    try {
      handoffs = this.sources.listHandoffs?.() ?? []
    } catch (error) {
      console.error('[DailyReport] 读取接管记录失败:', error)
    }
    try {
      traceSessions =
        (await this.sources.listTraceSessions?.(this.sources.worktraceBaseDir())) ?? []
    } catch (error) {
      console.error('[DailyReport] 读取轨迹会话失败:', error)
    }

    const servedCustomers = customers
      .filter((customer) => customer.lastSeenAt >= dayStart && customer.lastSeenAt < dayEnd)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    const vipServed = servedCustomers.filter(isVipCustomer)
    const vipNewToday = vipServed.filter(
      (customer) => customer.firstSeenAt >= dayStart && customer.firstSeenAt < dayEnd
    )
    const riskCustomers = servedCustomers.filter(hasRiskTag)
    const followUpsToday = followUps
      .filter(
        (item) => item.status === 'open' && item.createdAt >= dayStart && item.createdAt < dayEnd
      )
      .sort((a, b) => b.createdAt - a.createdAt)
    const handoffsOpen = handoffs.filter((item) => item.status === 'open')
    const traceSessionsToday = traceSessions.filter(
      (session) => session.startedAt >= dayStart && session.startedAt < dayEnd
    )

    return {
      date,
      dayStart,
      servedCustomers,
      vipServed,
      vipNewToday,
      riskCustomers,
      followUps: followUpsToday,
      handoffs: handoffsOpen,
      traceSessionsToday
    }
  }
}

export function startOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate())
}

export function formatDayKey(day: Date): string {
  const y = day.getFullYear()
  const m = String(day.getMonth() + 1).padStart(2, '0')
  const d = String(day.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
