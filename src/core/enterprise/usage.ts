/**
 * src/core/enterprise/usage.ts
 *
 * E4 · 企业版用量计量核心（纯逻辑，不依赖 electron，可单测）。
 * - 以「本地时区 YYYY-MM-DD」为日桶；每次操作先比对 date，跨日自动切换新桶。
 * - 配额：基础额度 basePerSeatPerYear × seats 按 365 天折算为当日 quotaLimit；
 *   硬封顶 hardCap = ceil(quotaLimit × hardCapMultiplier)。
 * - 熔断：messages ≥ hardCap 时 isQuotaExceeded() 为 true，recordMessage 仍计数但返回 false。
 * - 持久化：经由注入的 UsageIO 单日读写；无记录按零值处理。
 * 设计文档：docs/plan/enterprise-v2-dev-plan.md §E4。
 */

/** 消息处理类型（计数挂点：provider 回复 / 跳过 / 人工接管） */
export type MessageKind = 'reply' | 'skip' | 'handoff'

/** 会话开合事件 */
export type SessionEvent = 'start' | 'stop'

/** 单日用量快照 */
export interface UsageSnapshot {
  /** 所属日期，格式 'YYYY-MM-DD'（本地时区） */
  date: string
  /** 当前活动的引擎会话数（start +1 / stop -1，最小 0） */
  sessions: number
  /** 已处理消息数（reply / skip / handoff 均计） */
  messages: number
  /** 实际回复数 */
  replies: number
  /** 人工接管触发数 */
  handoffs: number
  /** VLM/LLM 调用估算 */
  apiCalls: number
  /** 当日配额（基础额度日折算） */
  quotaLimit: number
}

/** 单日持久化通道 */
export interface UsageIO {
  /** 读取指定日期的快照；无记录返回 null（视为零值） */
  read(day: string): UsageSnapshot | null
  /** 持久化单个日桶 */
  write(snapshot: UsageSnapshot): void
}

/** 用量计量配置（缺省值见 DEFAULT_USAGE_CONFIG） */
export interface UsageConfig {
  /** 坐席数，默认 5 */
  seats?: number
  /** 每坐席每年基础额度，默认 10000 */
  basePerSeatPerYear?: number
  /** 硬封顶倍率，默认 1.2 */
  hardCapMultiplier?: number
}

/** UsageConfig 缺省值 */
export const DEFAULT_USAGE_CONFIG: Required<UsageConfig> = {
  seats: 5,
  basePerSeatPerYear: 10000,
  hardCapMultiplier: 1.2
}

/** 配额计算结果 */
export interface UsageQuota {
  quotaLimit: number
  hardCap: number
}

/**
 * 由配置计算日配额与硬封顶：
 * - quotaLimit = ceil(basePerSeatPerYear × seats / 365)
 * - hardCap    = ceil(quotaLimit × hardCapMultiplier)
 */
export function computeUsageQuota(config: UsageConfig): UsageQuota {
  const seats = config.seats ?? DEFAULT_USAGE_CONFIG.seats
  const basePerSeatPerYear = config.basePerSeatPerYear ?? DEFAULT_USAGE_CONFIG.basePerSeatPerYear
  const hardCapMultiplier = config.hardCapMultiplier ?? DEFAULT_USAGE_CONFIG.hardCapMultiplier
  const quotaLimit = Math.ceil((basePerSeatPerYear * seats) / 365)
  const hardCap = Math.ceil(quotaLimit * hardCapMultiplier)
  return { quotaLimit, hardCap }
}

/** 补零到两位（手写实现，避免依赖 padStart） */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * 本地时区日期 'YYYY-MM-DD'（手写拼接，不用 toISOString 以避免 UTC 偏移）。
 * 可显式传入 Date 便于测试。
 */
export function localDateString(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** UsageMeter 可选注入项 */
export interface UsageMeterOptions {
  /** 返回「当前时间」的时钟，默认 new Date()；测试注入以验证跨日切桶 */
  now?: () => Date
}

/**
 * E4 用量计量核心。
 * - 同一实例应被单线程顺序调用；每次操作前先比对本地日期，跨日自动建新桶。
 * - 构造函数前两个参数与约定一致；第三个可选参数仅用于测试注入时钟。
 */
export class UsageMeter {
  private readonly io: UsageIO
  private readonly config: Required<UsageConfig>
  private readonly quota: UsageQuota
  private readonly now: () => Date
  /** 当前日桶缓存（可能属于昨天的桶，见 current() 的跨日检测） */
  private cache: UsageSnapshot | null = null

  constructor(io: UsageIO, config?: UsageConfig, options?: UsageMeterOptions) {
    this.io = io
    this.config = {
      seats: config?.seats ?? DEFAULT_USAGE_CONFIG.seats,
      basePerSeatPerYear: config?.basePerSeatPerYear ?? DEFAULT_USAGE_CONFIG.basePerSeatPerYear,
      hardCapMultiplier: config?.hardCapMultiplier ?? DEFAULT_USAGE_CONFIG.hardCapMultiplier
    }
    this.quota = computeUsageQuota(this.config)
    this.now = options?.now ?? (() => new Date())
  }

  /**
   * 记录一条已处理消息并返回是否仍在配额内。
   * - reply 计入 replies；handoff 计入 handoffs；skip 仅计入 messages。
   * - 达到硬封顶后仍继续计数，但返回 false（引擎据此熔断自动回复）。
   */
  recordMessage(kind: MessageKind): boolean {
    const snapshot = this.current()
    const allowed = snapshot.messages < this.quota.hardCap
    snapshot.messages += 1
    if (kind === 'reply') snapshot.replies += 1
    else if (kind === 'handoff') snapshot.handoffs += 1
    this.persist(snapshot)
    return allowed
  }

  /** 会话开合：start 计数 +1；stop 计数 -1（最小 0） */
  recordSession(kind: SessionEvent): void {
    const snapshot = this.current()
    if (kind === 'start') snapshot.sessions += 1
    else if (snapshot.sessions > 0) snapshot.sessions -= 1
    this.persist(snapshot)
  }

  /** 记录一次 VLM/LLM 调用（估算用量） */
  recordApiCall(): void {
    const snapshot = this.current()
    snapshot.apiCalls += 1
    this.persist(snapshot)
  }

  /** 今日快照（返回副本，防止外部改动污染内部状态） */
  getToday(): UsageSnapshot {
    return { ...this.current() }
  }

  /** 是否熔断：已达当日硬封顶（messages >= hardCap） */
  isQuotaExceeded(): boolean {
    return this.current().messages >= this.quota.hardCap
  }

  /** 超限后的降级提示（中文） */
  overageMessage(): string {
    return '已超出今日用量上限,自动回复已暂停,请升级用量包或人工接管。'
  }

  /** 取当前日桶：首次访问或跨日时从 io 读取/重建，并复用当日历史计数 */
  private current(): UsageSnapshot {
    const today = localDateString(this.now())
    const cached = this.cache
    if (cached && cached.date === today) return cached
    const stored = this.io.read(today)
    if (stored && stored.date === today) {
      // 复用已落盘计数，但 quotaLimit 按当前配置重算（坐席/费率变更即时生效）
      this.cache = { ...stored, quotaLimit: this.quota.quotaLimit }
    } else {
      this.cache = this.emptySnapshot(today)
    }
    return this.cache
  }

  private emptySnapshot(day: string): UsageSnapshot {
    return {
      date: day,
      sessions: 0,
      messages: 0,
      replies: 0,
      handoffs: 0,
      apiCalls: 0,
      quotaLimit: this.quota.quotaLimit
    }
  }

  /** 写一份副本，避免 io 持有内部可变引用 */
  private persist(snapshot: UsageSnapshot): void {
    this.io.write({ ...snapshot })
  }
}
