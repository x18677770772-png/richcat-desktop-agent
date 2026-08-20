/**
 * src/core/enterprise/license.ts
 * 企业版 License 授权核心 — 纯逻辑状态机（不依赖 Electron，可单测）
 *
 * 职责：管理本机授权状态（试用 / 已激活 / 宽限期 / 过期 / 无效），对外提供
 * 状态查询、激活、试用启动、可运行性判断与降级中文文案。
 *
 * 设计约定：
 * - 时间通过构造参数 `now` 注入，便于确定性测试；不注入时回落 `Date.now()`。
 * - 持久化通过 `LicenseIO` 抽象注入，调用方可在 Electron 侧用 electron-store / 文件实现。
 * - 状态写入统一走 `persist()`：先改内存再落盘，保持单一写入点。
 * - 授权码激活为「本地格式 + 确定性伪校验」占位，服务端上线后应替换为在线校验。
 *
 * 状态机（`now` 为当前时间戳）：
 * - 无记录        → status:'invalid'；调用 startTrial() 进入试用。
 * - trial         → now > trialEndsAt                          → expired
 * - active        → now > expiresAt：宽限期（graceDays 天）内   → grace
 *                                                               → 否则 expired
 * - grace         → now > expiresAt + graceDays                 → expired
 * - invalid/expired → 仅可通过 activate() 恢复；invalid 还可通过 startTrial() 进入试用。
 *
 * 激活校验（占位，服务端上线换在线校验）：
 *   授权码形如 `RC-XXXX-XXXX-XXXX-XXXX`，取第 4 组（最后一段，如 `1A2B`）
 *   的第 3 位字符，要求其 charCode 为偶数。该规则仅为离线确定性占位，
 *   生产环境必须替换为服务端签名 / 在线校验。
 */

export type LicenseStatus = 'trial' | 'active' | 'expired' | 'grace' | 'invalid'
export type LicensePlan = 'community' | 'strategic' | 'standard' | 'pro' | 'flagship'

export interface LicenseState {
  status: LicenseStatus
  plan: LicensePlan
  seats: number
  activatedAt: number | null
  expiresAt: number | null
  trialEndsAt: number | null
  deviceId: string
  /** 脱敏末 4 位，如 `••••-••••-••••-1A2B` */
  licenseKey: string | null
  error?: string
}

export interface LicenseInput {
  deviceId: string
  /** 注入的当前时间戳（ms）；缺省用 Date.now() */
  now?: number
  /** 宽限期天数，默认 7 */
  graceDays?: number
  /** 试用期天数，默认 14 */
  trialDays?: number
}

export interface LicenseIO {
  /** 读取已持久化的授权记录（可缺字段；无记录返回空对象） */
  read(): Partial<LicenseState>
  /** 写入完整授权记录 */
  write(state: LicenseState): void
}

const DAY_MS = 86400000
const GRACE_DAYS_DEFAULT = 7
const TRIAL_DAYS_DEFAULT = 14
const LICENSE_DURATION_MS = 365 * DAY_MS
const LICENSE_KEY_PATTERN = /^RC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
const MASKED_PREFIX = '••••-••••-••••-'

const VALID_STATUSES: readonly LicenseStatus[] = ['trial', 'active', 'expired', 'grace', 'invalid']
const VALID_PLANS: readonly LicensePlan[] = ['community', 'strategic', 'standard', 'pro', 'flagship']

function createInitialState(deviceId: string): LicenseState {
  return {
    status: 'invalid',
    plan: 'community',
    seats: 0,
    activatedAt: null,
    expiresAt: null,
    trialEndsAt: null,
    deviceId,
    licenseKey: null
  }
}

/** 将持久化记录归一化为合法的 LicenseState，兜底损坏/被篡改数据 */
function normalizeState(stored: Partial<LicenseState>, deviceId: string): LicenseState {
  // 设备绑定：持久化中的 deviceId 与当前设备不一致 → 视为无记录（防止授权文件拷贝复用）
  if (stored.deviceId !== undefined && stored.deviceId !== '' && stored.deviceId !== deviceId) {
    return createInitialState(deviceId)
  }

  const state: LicenseState = { ...createInitialState(deviceId), ...stored, deviceId }

  // 非法枚举值兜底，防止损坏数据破坏状态机
  if (!VALID_STATUSES.includes(state.status)) state.status = 'invalid'
  if (!VALID_PLANS.includes(state.plan)) state.plan = 'community'

  // 结构性自愈：active/grace 必须有过期时间；trial 必须有试用截止时间
  if ((state.status === 'active' || state.status === 'grace') && state.expiresAt === null) {
    return createInitialState(deviceId)
  }
  if (state.status === 'trial' && state.trialEndsAt === null) {
    return createInitialState(deviceId)
  }

  return state
}

/** 脱敏：仅保留授权码末 4 位（最后一段），如 `••••-••••-••••-1A2B` */
function maskKey(licenseKey: string): string {
  const groups = licenseKey.split('-')
  const lastGroup = groups[4] ?? ''
  return `${MASKED_PREFIX}${lastGroup}`
}

export class LicenseManager {
  private readonly graceDays: number
  private readonly trialDays: number
  private readonly injectedNow: number | null
  private readonly io: LicenseIO
  private state: LicenseState

  constructor(input: LicenseInput, io: LicenseIO) {
    this.graceDays = input.graceDays ?? GRACE_DAYS_DEFAULT
    this.trialDays = input.trialDays ?? TRIAL_DAYS_DEFAULT
    this.injectedNow = input.now ?? null
    this.io = io
    this.state = normalizeState(io.read(), input.deviceId)
  }

  /** 当前授权状态；调用前会先按 `now` 刷新时间相关状态。 */
  getState(): LicenseState {
    return this.refresh()
  }

  /**
   * 启动试用（仅允许从 invalid 状态进入）。
   * 已激活 / 宽限期 / 试用中 / 已过期均不生效，防止误触或反复续试用。
   */
  startTrial(): LicenseState {
    if (this.state.status !== 'invalid') {
      return { ...this.state }
    }
    const now = this.now()
    return this.persist({
      status: 'trial',
      plan: 'community',
      seats: 1,
      activatedAt: null,
      expiresAt: null,
      trialEndsAt: now + this.trialDays * DAY_MS,
      licenseKey: null,
      error: undefined
    })
  }

  /**
   * 激活授权。
   * - 格式不符合 `RC-XXXX-XXXX-XXXX-XXXX` → { ok:false, error:'授权码格式不正确' }
   * - 格式通过但伪校验失败 → { ok:false, error:'授权码校验未通过' }
   * 激活成功：status:'active'、plan:'standard'、seats:5、有效期 365 天、licenseKey 存脱敏末 4 位。
   */
  activate(
    licenseKey: string
  ): { ok: true; state: LicenseState } | { ok: false; error: string } {
    const key = licenseKey.trim()
    if (!LICENSE_KEY_PATTERN.test(key)) {
      return { ok: false, error: '授权码格式不正确' }
    }
    if (!this.isPseudoValid(key)) {
      return { ok: false, error: '授权码校验未通过' }
    }
    const now = this.now()
    const state = this.persist({
      status: 'active',
      plan: 'standard',
      seats: 5,
      activatedAt: now,
      expiresAt: now + LICENSE_DURATION_MS,
      trialEndsAt: null,
      licenseKey: maskKey(key),
      error: undefined
    })
    return { ok: true, state }
  }

  /** 按当前 `now` 刷新状态后判断是否可运行（active / trial / grace）。 */
  canRun(): boolean {
    const status = this.refresh().status
    return status === 'active' || status === 'trial' || status === 'grace'
  }

  /** 授权过期时的降级中文提示文案。 */
  degradation(): string {
    return '授权已过期,已暂停自动回复,请续费后继续使用'
  }

  // ── 内部 ──

  private now(): number {
    return this.injectedNow ?? Date.now()
  }

  /** 按当前时间重算状态；发生转移时落盘，返回对外安全副本。 */
  private refresh(): LicenseState {
    return { ...this.recomputeStatus(this.now()) }
  }

  /**
   * 时间驱动状态机：
   * trial 超期 → expired；active 超期 → grace（宽限期内）→ 超宽限期 expired；grace 超期 → expired。
   */
  private recomputeStatus(now: number): LicenseState {
    const { status, trialEndsAt, expiresAt } = this.state
    switch (status) {
      case 'trial':
        if (trialEndsAt !== null && now > trialEndsAt) {
          return this.persist({ status: 'expired', error: this.degradation() })
        }
        break
      case 'active':
        if (expiresAt !== null && now > expiresAt) {
          const graceEndsAt = expiresAt + this.graceDays * DAY_MS
          if (now <= graceEndsAt) {
            return this.persist({ status: 'grace', error: undefined })
          }
          return this.persist({ status: 'expired', error: this.degradation() })
        }
        break
      case 'grace':
        if (expiresAt !== null && now > expiresAt + this.graceDays * DAY_MS) {
          return this.persist({ status: 'expired', error: this.degradation() })
        }
        break
      default:
        break
    }
    return this.state
  }

  /** 单一写入点：更新内存 + 落盘，返回对外安全副本。 */
  private persist(patch: Partial<LicenseState>): LicenseState {
    this.state = { ...this.state, ...patch }
    this.io.write(this.state)
    return { ...this.state }
  }

  /**
   * 确定性伪校验（占位）：取授权码第 4 组（最后一段）第 3 位字符，要求其 charCode 为偶数。
   * 仅离线占位，保证本地可验证；生产环境必须替换为服务端签名 / 在线校验。
   */
  private isPseudoValid(licenseKey: string): boolean {
    const groups = licenseKey.split('-')
    const fourthGroup = groups[4]
    const thirdChar = fourthGroup.charAt(2)
    return thirdChar.charCodeAt(0) % 2 === 0
  }
}
