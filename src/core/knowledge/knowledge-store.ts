// src/core/knowledge/knowledge-store.ts
// 知识库存储 — AI 客服的专业知识来源
//
// 每个知识条目是一段「问题域 → 标准答案」的内容。运行时把启用的知识条目
// 注入回复 prompt，让客服的回答基于知识库而不是模型自由发挥。
//
// 检索策略（轻量、零外部依赖）：
// 当前截图链路尚未接入 OCR，无法在运行时拿到用户提问原文，因此采用
// 「全量注入 + 上限控制」：启用条目全部压缩进 system prompt（默认上限 30 条），
// 由模型自行参考。同时提供基于关键词打分的 search() 供 UI 查询与管理。
// 未来接入 OCR 后可升级为 query → 检索 topK 的 RAG 模式。

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type KnowledgeItemSource = 'manual' | 'import'

export interface KnowledgeItem {
  itemId: string
  /** 短标题，如「运费政策」 */
  title: string
  /** 正文内容，如「满 99 元包邮，偏远地区除外……」 */
  content: string
  /** 标签，用于分类与检索，如 ["售后", "物流"] */
  tags: string[]
  source: KnowledgeItemSource
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface NewKnowledgeItem {
  title: string
  content: string
  tags?: string[]
  source?: KnowledgeItemSource
}

interface KnowledgeFileShape {
  version: number
  items: KnowledgeItem[]
}

/** 运行时注入的知识库上限（超出时按最近更新优先截断） */
export const KNOWLEDGE_INJECTION_LIMIT = 30

/** 单条知识注入 prompt 时的最大正文长度（避免 prompt 爆炸） */
export const KNOWLEDGE_ITEM_MAX_CHARS = 600

export class KnowledgeStore {
  private items: KnowledgeItem[] | null = null

  constructor(private readonly filePath: string) {}

  listItems(): KnowledgeItem[] {
    return [...this.load()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getEnabledItems(): KnowledgeItem[] {
    return this.load().filter((item) => item.enabled)
  }

  /** 运行时注入用的精简版知识（截断正文、限制条数） */
  getInjectionItems(limit = KNOWLEDGE_INJECTION_LIMIT): KnowledgeItem[] {
    return this.getEnabledItems()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((item) => ({
        ...item,
        content:
          item.content.length > KNOWLEDGE_ITEM_MAX_CHARS
            ? `${item.content.slice(0, KNOWLEDGE_ITEM_MAX_CHARS)}…`
            : item.content
      }))
  }

  addItem(input: NewKnowledgeItem): KnowledgeItem {
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) {
      throw new Error('知识条目标题和内容不能为空')
    }
    const now = Date.now()
    const item: KnowledgeItem = {
      itemId: randomUUID(),
      title,
      content,
      tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      source: input.source === 'import' ? 'import' : 'manual',
      enabled: true,
      createdAt: now,
      updatedAt: now
    }
    this.load().push(item)
    this.flush()
    return item
  }

  updateItem(
    itemId: string,
    patch: Partial<Pick<KnowledgeItem, 'title' | 'content' | 'tags' | 'enabled'>>
  ): boolean {
    const item = this.load().find((entry) => entry.itemId === itemId)
    if (!item) return false
    if (patch.title !== undefined) {
      const title = patch.title.trim()
      if (!title) return false
      item.title = title
    }
    if (patch.content !== undefined) {
      const content = patch.content.trim()
      if (!content) return false
      item.content = content
    }
    if (patch.tags !== undefined) {
      item.tags = patch.tags.map((tag) => tag.trim()).filter(Boolean)
    }
    if (patch.enabled !== undefined) item.enabled = patch.enabled
    item.updatedAt = Date.now()
    this.flush()
    return true
  }

  deleteItem(itemId: string): boolean {
    const items = this.load()
    const index = items.findIndex((entry) => entry.itemId === itemId)
    if (index === -1) return false
    items.splice(index, 1)
    this.flush()
    return true
  }

  setEnabled(itemId: string, enabled: boolean): boolean {
    return this.updateItem(itemId, { enabled })
  }

  /** 导入多条知识（批量添加），返回成功创建的条目 */
  importItems(inputs: NewKnowledgeItem[]): KnowledgeItem[] {
    const created: KnowledgeItem[] = []
    for (const input of inputs) {
      if (!input?.title?.trim() || !input?.content?.trim()) continue
      created.push(this.addItem({ ...input, source: 'import' }))
    }
    return created
  }

  /**
   * 关键词检索（供 UI 使用）：查询词按空白切分，
   * title 命中权重 3 / tags 命中权重 2 / content 命中权重 1，求和排序。
   */
  search(query: string, topK = 20): KnowledgeItem[] {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0)
    if (terms.length === 0) return this.listItems().slice(0, topK)

    const scored = this.load()
      .map((item) => {
        const title = item.title.toLowerCase()
        const content = item.content.toLowerCase()
        const tags = item.tags.join(' ').toLowerCase()
        let score = 0
        for (const term of terms) {
          if (title.includes(term)) score += 3
          if (tags.includes(term)) score += 2
          if (content.includes(term)) score += 1
        }
        return { item, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)

    return scored.slice(0, topK).map((entry) => entry.item)
  }

  private load(): KnowledgeItem[] {
    if (this.items) return this.items
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<KnowledgeFileShape>
      this.items = Array.isArray(raw?.items) ? (raw.items as KnowledgeItem[]) : []
    } catch {
      this.items = []
    }
    return this.items
  }

  private flush(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      writeFileSync(
        this.filePath,
        `${JSON.stringify({ version: 1, items: this.items ?? [] }, null, 2)}\n`,
        'utf8'
      )
    } catch (error) {
      console.error('[KnowledgeStore] 知识库写入失败:', error)
    }
  }
}
