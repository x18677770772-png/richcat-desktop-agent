// src/core/features/human-handoff/store.ts
// ── F2 人工接管存储（HandoffStore）──
// 与 CustomerStore 同款同步读写 + 内存缓存模式；文件 <userData>/worktrace/handoffs/handoffs.json。
// 设计文档：docs/richcat-v2-design.md §3-F2。
//
// 附加职责：多轮未解决计数（内存 Map，按 contact 累计；回复成功/发送后清零）——
// 不持久化（运行期状态），引擎重启即重置。

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HandoffReason, HandoffRequest, HandoffStatus } from './types'

export type { HandoffReason, HandoffRequest, HandoffStatus } from './types'

interface HandoffFileShape {
  version: number
  handoffs: HandoffRequest[]
}

export interface NewHandoffInput {
  contact: string | null
  reason: HandoffReason
  confidence: number
}

export class HandoffStore {
  private handoffs: HandoffRequest[] | null = null
  /** 多轮未解决计数（内存 Map，按 contact 累计；不持久化） */
  private readonly unresolvedCount = new Map<string, number>()

  constructor(private readonly filePath: string) {}

  /** 全部接管单：open 在前（createdAt 倒序），resolved 在后 */
  list(): HandoffRequest[] {
    const items = [...this.load()]
    items.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1
      return b.createdAt - a.createdAt
    })
    return items
  }

  /** 仅 open 接管单（createdAt 倒序；日报/UI 取数用） */
  listOpen(): HandoffRequest[] {
    return this.list().filter((item) => item.status === 'open')
  }

  /**
   * 新增接管单；同 contact 已存在 open 接管单时返回 null（不重复建，避免骚扰重复通知）。
   * contact 为 null 时不去重（未知客户各自独立记录）。
   */
  add(input: NewHandoffInput): HandoffRequest | null {
    const contact = input.contact?.trim() || null
    const now = Date.now()

    if (contact) {
      const existing = this.load().find(
        (item) => item.status === 'open' && item.contact === contact
      )
      if (existing) {
        console.log(
          `[Handoff] 客户「${contact}」已有 open 接管单，跳过重复创建（${existing.reason}）`
        )
        return null
      }
    }

    const request: HandoffRequest = {
      handoffId: randomUUID(),
      contact,
      reason: input.reason,
      confidence: Math.min(1, Math.max(0, input.confidence)),
      createdAt: now,
      status: 'open'
    }
    this.load().push(request)
    this.flush()
    return request
  }

  /** 标记接管单已处理（open → resolved）；重复/不存在返回 false */
  setStatus(handoffId: string, status: HandoffStatus): boolean {
    const item = this.load().find((entry) => entry.handoffId === handoffId)
    if (!item || item.status !== 'open') return false
    item.status = status
    item.resolvedAt = Date.now()
    this.flush()
    return true
  }

  getById(handoffId: string): HandoffRequest | null {
    return this.load().find((entry) => entry.handoffId === handoffId) ?? null
  }

  // ── 多轮未解决计数（内存态） ──

  getUnresolvedCount(contact: string): number {
    return this.unresolvedCount.get(contact) ?? 0
  }

  incrementUnresolved(contact: string): number {
    const next = this.getUnresolvedCount(contact) + 1
    this.unresolvedCount.set(contact, next)
    return next
  }

  resetUnresolved(contact: string): void {
    this.unresolvedCount.delete(contact)
  }

  // ── 内部：同步读写 + 内存缓存 ──

  private load(): HandoffRequest[] {
    if (this.handoffs) return this.handoffs
    try {
      if (this.filePath && existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf8')
        const parsed = JSON.parse(raw) as HandoffFileShape
        if (parsed && Array.isArray(parsed.handoffs)) {
          this.handoffs = parsed.handoffs.filter(isValidHandoffRequest)
          return this.handoffs
        }
      }
    } catch (error) {
      console.error('[Handoff] 读取 handoffs.json 失败（按空列表继续）:', error)
    }
    this.handoffs = []
    return this.handoffs
  }

  private flush(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      const data: HandoffFileShape = { version: 1, handoffs: this.handoffs ?? [] }
      writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.error('[Handoff] 写入 handoffs.json 失败（不影响主链路）:', error)
    }
  }
}

/** 字段级校验：损坏条目跳过（旧数据/手改文件容错） */
function isValidHandoffRequest(item: unknown): item is HandoffRequest {
  if (!item || typeof item !== 'object') return false
  const raw = item as Record<string, unknown>
  return (
    typeof raw.handoffId === 'string' &&
    typeof raw.reason === 'string' &&
    typeof raw.confidence === 'number' &&
    typeof raw.createdAt === 'number' &&
    (raw.status === 'open' || raw.status === 'resolved')
  )
}
