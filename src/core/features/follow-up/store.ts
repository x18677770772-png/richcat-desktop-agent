// src/core/features/follow-up/store.ts
// ── F7 待跟进存储（FollowUpStore）──
// 与 CustomerStore 同款同步读写 + 内存缓存模式；文件 <userData>/worktrace/followups/followups.json。
// 设计文档：docs/richcat-v2-design.md §3-F7。
//
// - 生成去重：同 contact + 同 action + 状态 open 不重复建（验收 2b）；
// - 状态机：open → done/cancelled（done 后不再提醒）；
// - 任何读写失败不抛错（记日志并返回空结果），绝不影响主链路。

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FollowUpItem } from './types'

export type { FollowUpItem } from './types'

/** 默认到期时间：无 dueAt 时 now + 24h */
export const DEFAULT_FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000

interface FollowUpFileShape {
  version: number
  items: FollowUpItem[]
}

export interface NewFollowUpInput {
  contact: string | null
  action: string
  dueAt?: number
  source?: 'ai' | 'manual'
}

export class FollowUpStore {
  private items: FollowUpItem[] | null = null

  constructor(private readonly filePath: string) {}

  /** 全部待办：open 在前（dueAt 升序），其余按 createdAt 倒序 */
  list(): FollowUpItem[] {
    const items = [...this.load()]
    items.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1
      if (a.status === 'open') return a.dueAt - b.dueAt
      return b.createdAt - a.createdAt
    })
    return items
  }

  /** 仅 open 待办（dueAt 升序；到期扫描与日报取数用） */
  listOpen(): FollowUpItem[] {
    return this.list().filter((item) => item.status === 'open')
  }

  /**
   * 新增待办；同 contact+action 且 open 时去重（返回 null 表示已存在，不重复建）。
   * action 为空 → 返回 null（不建无意义待办）。
   */
  add(input: NewFollowUpInput): FollowUpItem | null {
    const action = input.action?.trim()
    if (!action) return null
    const contact = input.contact?.trim() || null
    const now = Date.now()

    const existing = this.load().find(
      (item) => item.status === 'open' && item.contact === contact && item.action === action
    )
    if (existing) {
      console.log(`[FollowUp] 已存在相同待办，跳过重复创建: ${contact ?? '未知客户'} - ${action}`)
      return null
    }

    const item: FollowUpItem = {
      followUpId: randomUUID(),
      contact,
      action,
      dueAt:
        typeof input.dueAt === 'number' && Number.isFinite(input.dueAt)
          ? input.dueAt
          : now + DEFAULT_FOLLOW_UP_DELAY_MS,
      status: 'open',
      createdAt: now,
      source: input.source === 'manual' ? 'manual' : 'ai'
    }
    this.load().push(item)
    this.flush()
    return item
  }

  /** 更新状态：open → done/cancelled（done/cancelled 不可再改）；返回是否成功 */
  setStatus(followUpId: string, status: 'done' | 'cancelled'): boolean {
    const item = this.load().find((entry) => entry.followUpId === followUpId)
    if (!item || item.status !== 'open') return false
    item.status = status
    item.doneAt = Date.now()
    this.flush()
    return true
  }

  getById(followUpId: string): FollowUpItem | null {
    return this.load().find((entry) => entry.followUpId === followUpId) ?? null
  }

  // ── 内部：同步读写 + 内存缓存 ──

  private load(): FollowUpItem[] {
    if (this.items) return this.items
    try {
      if (this.filePath && existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf8')
        const parsed = JSON.parse(raw) as FollowUpFileShape
        if (parsed && Array.isArray(parsed.items)) {
          this.items = parsed.items.filter(isValidFollowUpItem)
          return this.items
        }
      }
    } catch (error) {
      console.error('[FollowUp] 读取 followups.json 失败（按空列表继续）:', error)
    }
    this.items = []
    return this.items
  }

  private flush(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      const data: FollowUpFileShape = { version: 1, items: this.items ?? [] }
      writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.error('[FollowUp] 写入 followups.json 失败（不影响主链路）:', error)
    }
  }
}

/** 字段级校验：损坏的条目跳过（旧数据/手改文件容错） */
function isValidFollowUpItem(item: unknown): item is FollowUpItem {
  if (!item || typeof item !== 'object') return false
  const raw = item as Record<string, unknown>
  return (
    typeof raw.followUpId === 'string' &&
    typeof raw.action === 'string' &&
    typeof raw.dueAt === 'number' &&
    (raw.status === 'open' || raw.status === 'done' || raw.status === 'cancelled') &&
    typeof raw.createdAt === 'number'
  )
}
