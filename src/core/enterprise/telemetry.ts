/**
 * src/core/enterprise/telemetry.ts
 *
 * C1 · Agent 遥测 SDK 核心（纯逻辑，不依赖 Electron，可单测）。
 *
 * 每台终端（值守机）向中央控制面上报三类事件：
 *   - 心跳（heartbeat）：60s 一次，携带系统资源、微信状态、版本信息。
 *   - 用量（usage）：10min 一次批量，携带引擎会话/消息/API 调用统计。
 *   - 错误（error）：实时上报，携带枚举错误码与白名单安全文案。
 *
 * 合规铁律：
 *   payload 只含用量统计与枚举码/白名单文案，绝不带聊天/截图/客户内容。
 *   敏感标识（deviceId）经 HMAC-SHA256 脱敏后上传，明文 deviceId 不出设备。
 *
 * 设计文档：docs/plan/control-plane-mvp-dev-plan.md §C1
 *           docs/business-plan/12-中央管理后台架构.md §2.2-2.4
 */

import { randomUUID, createHmac } from 'node:crypto'

/** Agent 遥测 SDK 配置 */
export interface TelemetryConfig {
  /** 控制面 URL，如 https://ops.richcat.ai */
  controlPlaneUrl: string
  /** 站点 Token（租户级），用于 Authorization 认证 */
  siteToken: string
  /** 心跳间隔，默认 60000ms（60s） */
  heartbeatIntervalMs?: number
  /** 用量批量上报间隔，默认 600000ms（10min） */
  usageFlushIntervalMs?: number
  /** 离线缓冲上限，默认 5000 条 */
  maxQueue?: number
}

/** 主机系统信息快照 */
export interface SystemInfo {
  agentVersion: string
  os: string
  cpuPct: number
  memPct: number
  diskFreeGb: number
  wechatState: 'logged_in' | 'logged_out' | 'captcha' | 'window_missing' | 'unknown'
}

/** 遥测事件类型 */
export type TelemetryEventType = 'heartbeat' | 'usage' | 'error'

/** 遥测错误枚举码 */
export type TelemetryErrorCode =
  | 'AGENT_CRASH'
  | 'WATCHDOG_RESTART'
  | 'MODEL_TIMEOUT'
  | 'MODEL_API_ERROR'
  | 'VISUAL_MISJUDGE'
  | 'VLM_UNAVAILABLE'
  | 'WECHAT_SESSION_LOST'
  | 'WECHAT_CAPTCHA'
  | 'WECHAT_WINDOW_MISSING'
  | 'CONFIG_APPLY_FAIL'
  | 'UPGRADE_FAIL'
  | 'NETWORK_OFFLINE'

/** 统一 Telemetry Event 信封（对齐 doc 12 §2.2） */
export interface TelemetryEvent {
  schema_version: '1.0'
  event_id: string
  event_type: TelemetryEventType
  occurred_at: string
  producer: {
    tenant_id: string
    site_id: string
    agent_id: string
    machine_id_hmac: string
    agent_version: string
    runtime: { vlm: string; llm: string; os: string }
  }
  payload: Record<string, unknown>
}

/** TelemetryClient 依赖注入 */
export interface TelemetryDeps {
  /** 租户 ID */
  tenantId: string
  /** 站点/部署单元 ID */
  siteId: string
  /** 值守机实例 ID */
  agentId: string
  /** 设备指纹（原始值，不上行，仅用于 HMAC 计算） */
  deviceId: string
  /** 当前 VLM 模型名 */
  vlm: string
  /** 当前 LLM 模型名 */
  llm: string
  /** 系统信息快照回调 */
  getSystemInfo: () => SystemInfo
  /**
   * 用量快照回调（应与 usage.ts UsageMeter.getToday() 对齐）。
   * date: 本地时区 YYYY-MM-DD
   */
  getUsage: () => {
    date: string
    sessions: number
    messages: number
    replies: number
    handoffs: number
    apiCalls: number
  }
  /** 测试/冒烟钩子：设置后所有事件不经网络发送，直接入此回调 */
  onEvent?: (event: TelemetryEvent) => void
  /** 时钟注入（测试用），返回毫秒时间戳，默认 Date.now */
  now?: () => number
}

const DEFAULT_HEARTBEAT_INTERVAL = 60_000
const DEFAULT_USAGE_FLUSH_INTERVAL = 600_000
const DEFAULT_MAX_QUEUE = 5000
const SEND_TIMEOUT_MS = 10_000

/**
 * C1 · Agent 遥测 SDK 核心。
 *
 * 职责：
 * - 按固定间隔发送心跳与用量事件到控制面。
 * - 实时上报错误事件。
 * - 网络不可达时自动缓冲，`flushQueue()` 带 `replayed: true` 标记重放。
 * - 通过 `setEnabled()` 控制发送开关（默认关）。
 *
 * 使用方法：
 * ```ts
 * const client = new TelemetryClient(config, deps)
 * client.setEnabled(true)
 * client.start()
 * // ... 应用运行 ...
 * client.stop()
 * ```
 */
export class TelemetryClient {
  private readonly _config: Required<
    Pick<TelemetryConfig, 'heartbeatIntervalMs' | 'usageFlushIntervalMs' | 'maxQueue'>
  > & { controlPlaneUrl: string; siteToken: string }
  private readonly _deps: TelemetryDeps
  private readonly _machineIdHmac: string
  private readonly _now: () => number

  private _enabled = false
  private _started = false
  private _queue: TelemetryEvent[] = []
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private _usageTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: TelemetryConfig, deps: TelemetryDeps) {
    this._config = {
      controlPlaneUrl: config.controlPlaneUrl,
      siteToken: config.siteToken,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL,
      usageFlushIntervalMs: config.usageFlushIntervalMs ?? DEFAULT_USAGE_FLUSH_INTERVAL,
      maxQueue: config.maxQueue ?? DEFAULT_MAX_QUEUE
    }
    this._deps = deps
    this._machineIdHmac = createHmac('sha256', config.siteToken).update(deps.deviceId).digest('hex')
    this._now = deps.now ?? (() => Date.now())
  }

  /**
   * 启动心跳定时器 + 用量定时器。
   * 定时器触发时会调用 sendHeartbeat / flushUsage。
   * 仅当 setEnabled(true) 后才真正发送；未启用时事件被丢弃。
   */
  start(): void {
    if (this._started) return
    this._started = true

    if (this._config.heartbeatIntervalMs > 0) {
      this._heartbeatTimer = setInterval(() => {
        this.sendHeartbeat().catch(() => {})
      }, this._config.heartbeatIntervalMs)
    }

    if (this._config.usageFlushIntervalMs > 0) {
      this._usageTimer = setInterval(() => {
        this.flushUsage().catch(() => {})
      }, this._config.usageFlushIntervalMs)
    }
  }

  /** 停止所有定时器 */
  stop(): void {
    this._started = false
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
    if (this._usageTimer !== null) {
      clearInterval(this._usageTimer)
      this._usageTimer = null
    }
  }

  /** 发送一次心跳事件 */
  async sendHeartbeat(): Promise<boolean> {
    const now = this._now()
    const sysInfo = this._deps.getSystemInfo()
    const usage = this._deps.getUsage()

    const event: TelemetryEvent = {
      schema_version: '1.0',
      event_id: randomUUID(),
      event_type: 'heartbeat',
      occurred_at: new Date(now).toISOString(),
      producer: this._buildProducer(sysInfo),
      payload: {
        state: sysInfo.wechatState === 'logged_in' ? 'online' : 'degraded',
        wechat_client: { state: sysInfo.wechatState },
        resources: {
          cpu_pct: sysInfo.cpuPct,
          mem_pct: sysInfo.memPct,
          disk_free_gb: sysInfo.diskFreeGb
        },
        active_sessions: usage.sessions,
        messages_today: usage.messages,
        queue_backlog: this._queue.length
      }
    }

    return this._send(event)
  }

  /** 手动触发用量批量上报 */
  async flushUsage(): Promise<boolean> {
    const now = this._now()
    const sysInfo = this._deps.getSystemInfo()
    const usage = this._deps.getUsage()

    const event: TelemetryEvent = {
      schema_version: '1.0',
      event_id: randomUUID(),
      event_type: 'usage',
      occurred_at: new Date(now).toISOString(),
      producer: this._buildProducer(sysInfo),
      payload: {
        bucket_start: usage.date,
        session_count: usage.sessions,
        message_count: usage.messages,
        auto_reply_count: usage.replies,
        human_handover_count: usage.handoffs,
        llm_calls: usage.apiCalls
      }
    }

    return this._send(event)
  }

  /** 实时上报错误事件 */
  async reportError(code: TelemetryErrorCode, messageSafe: string): Promise<boolean> {
    const now = this._now()
    const sysInfo = this._deps.getSystemInfo()

    const event: TelemetryEvent = {
      schema_version: '1.0',
      event_id: randomUUID(),
      event_type: 'error',
      occurred_at: new Date(now).toISOString(),
      producer: this._buildProducer(sysInfo),
      payload: {
        error_code: code,
        message_safe: messageSafe,
        count: 1
      }
    }

    return this._send(event)
  }

  /**
   * 重放离线缓冲队列。
   * 重放事件 payload 会被添加 `replayed: true` 标记。
   * 发送成功后从队列移除；首个发送失败时停止（剩余保留）。
   * 返回成功发送条数。
   */
  async flushQueue(): Promise<number> {
    let sent = 0
    while (this._queue.length > 0) {
      const event = this._queue[0]
      const replayedEvent: TelemetryEvent = {
        ...event,
        payload: { ...event.payload, replayed: true }
      }
      const ok = await this._rawSend(replayedEvent)
      if (ok) {
        this._queue.shift()
        sent++
      } else {
        break
      }
    }
    return sent
  }

  /** 当前离线缓冲队列长度 */
  queueSize(): number {
    return this._queue.length
  }

  /** 设置页开关（默认关）。开启后心跳/用量/错误才真正发送。 */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled
  }

  // ── private ──

  private _buildProducer(sysInfo: SystemInfo): TelemetryEvent['producer'] {
    return {
      tenant_id: this._deps.tenantId,
      site_id: this._deps.siteId,
      agent_id: this._deps.agentId,
      machine_id_hmac: this._machineIdHmac,
      agent_version: sysInfo.agentVersion,
      runtime: {
        vlm: this._deps.vlm,
        llm: this._deps.llm,
        os: sysInfo.os
      }
    }
  }

  /**
   * 发送事件：
   * - 未启用时直接丢弃，返回 false。
   * - 启用后尝试发送；失败时入队离线缓冲。
   */
  private async _send(event: TelemetryEvent): Promise<boolean> {
    if (!this._enabled) return false
    const ok = await this._rawSend(event)
    if (!ok) {
      this._enqueue(event)
    }
    return ok
  }

  /**
   * 裸发送（不检查 enabled，不入队）。
   * - 测试模式（onEvent 已设置）时直接回调，不发起网络请求。
   * - 正常模式：POST `${controlPlaneUrl}/api/v1/telemetry`，超时 10s。
   */
  private async _rawSend(event: TelemetryEvent): Promise<boolean> {
    if (this._deps.onEvent) {
      this._deps.onEvent(event)
      return true
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
      const resp = await fetch(`${this._config.controlPlaneUrl}/api/v1/telemetry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this._config.siteToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event),
        signal: controller.signal
      })
      clearTimeout(timer)
      return resp.ok
    } catch (err) {
      console.error('[Telemetry] 发送失败:', err)
      return false
    }
  }

  /** 入队离线缓冲；超上限时丢弃最旧 */
  private _enqueue(event: TelemetryEvent): void {
    if (this._queue.length >= this._config.maxQueue) {
      this._queue.shift()
    }
    this._queue.push(event)
  }
}
