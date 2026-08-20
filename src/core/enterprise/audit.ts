/**
 * 企业版审计日志核心 — JSONL 追加式审计记录（纯逻辑，不依赖 Electron）
 *
 * 每条审计事件以一行 JSON 追加到 `filePath`（JSON Lines），写入时自动创建目录/文件。
 * - `record`   追加一条事件，内部 try/catch，写失败仅 console.error，不抛出。
 * - `list`     读取全文解析，按 filter 过滤后按 ts 倒序，应用 limit（默认 200）。
 * - `export`   按 filter 导出为 JSONL 字符串（含结尾换行）。
 * - `count`    统计全部事件条数。
 *
 * 数据模型：AuditAction 限定可审计动作；actor 区分系统/用户触发；meta 承载结构化上下文。
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type AuditAction =
  | 'engine.start'
  | 'engine.stop'
  | 'settings.update'
  | 'settings.vision.key.updated'
  | 'license.trial.start'
  | 'license.activate'
  | 'license.expire'
  | 'handoff.triggered'
  | 'knowledge.import'
  | 'persona.update'

export interface AuditEvent {
  id: string
  ts: number
  action: AuditAction
  actor: 'system' | 'user'
  detail?: string
  meta?: Record<string, unknown>
}

export interface AuditFilter {
  action?: AuditAction
  actor?: 'system' | 'user'
  since?: number
  until?: number
  limit?: number
}

const DEFAULT_LIMIT = 200

export class AuditLogger {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /**
   * 追加一条审计事件。
   * 写失败时静默降级：仅 console.error 记录异常，不影响业务主流程。
   */
  record(
    action: AuditAction,
    actor: 'system' | 'user',
    detail?: string,
    meta?: Record<string, unknown>
  ): void {
    const event: AuditEvent = {
      id: this.generateId(),
      ts: Date.now(),
      action,
      actor,
      ...(detail !== undefined ? { detail } : {}),
      ...(meta !== undefined ? { meta } : {})
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8')
    } catch (error: unknown) {
      console.error('[AuditLogger] 审计记录写入失败:', error)
    }
  }

  /**
   * 读取全部审计事件，按 filter 过滤后按 ts 倒序返回，最多返回 limit 条（默认 200）。
   */
  list(filter?: AuditFilter): AuditEvent[] {
    let events = this.readAll()

    if (filter) {
      if (filter.action !== undefined) {
        events = events.filter((event) => event.action === filter.action)
      }
      if (filter.actor !== undefined) {
        events = events.filter((event) => event.actor === filter.actor)
      }
      if (filter.since !== undefined) {
        const since = filter.since
        events = events.filter((event) => event.ts >= since)
      }
      if (filter.until !== undefined) {
        const until = filter.until
        events = events.filter((event) => event.ts <= until)
      }
    }

    events = [...events].sort((a, b) => b.ts - a.ts)

    const limit = filter?.limit ?? DEFAULT_LIMIT
    if (limit > 0) {
      events = events.slice(0, limit)
    }
    return events
  }

  /**
   * 导出为 JSONL 字符串（每条一行，结尾带换行；空结果返回空串）。
   */
  export(filter?: AuditFilter): string {
    const events = this.list(filter)
    if (events.length === 0) return ''
    return events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  }

  /** 全部审计事件条数。 */
  count(): number {
    return this.readAll().length
  }

  /** 读取全文并按行解析；文件不存在或解析失败时返回空数组。 */
  private readAll(): AuditEvent[] {
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch {
      return []
    }

    const events: AuditEvent[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        events.push(JSON.parse(trimmed) as AuditEvent)
      } catch {
        // 单行损坏不影响其余事件，跳过
      }
    }
    return events
  }

  /** id = 时间戳（base36）+ 随机 hex，保证单调性与碰撞概率极低。 */
  private generateId(): string {
    return `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`
  }
}
