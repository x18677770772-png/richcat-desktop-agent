// src/core/customers/customer-store.ts
// 客户档案存储 — AI 客服的客户关系管理（CRM）数据层
//
// 每个联系人（微信昵称/备注名）对应一份档案：
// - tags: 标签（如「VIP」「咨询中」「已成交」），支持多标签
// - category: 分类（如「潜在客户」「老客户」「代理」），单选
// - memory: 长期记忆——每轮对话的 LLM 摘要，按时间倒序保留（上限可配）
//
// 运行时链路（在 LocalProvider 内完成，不侵入 session 层）：
//   截图 → 识别当前联系人 → getOrCreateCustomer → 注入记忆摘要
//   → 生成回复 → appendMemory 回写本轮摘要
//
// 存储：JSON 文件（<userData>/worktrace/customers/customers.json），
// 与 experience-store 相同的同步读写 + 内存缓存模式。

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 单条长期记忆：一轮对话的摘要 */
export interface CustomerMemoryEntry {
  ts: number
  /** LLM 生成的对话摘要（谁、聊了什么、关键诉求/偏好/承诺） */
  summary: string
  /** 本轮的回复文本（便于回溯） */
  lastReply?: string
}

export interface CustomerProfile {
  customerId: string
  /** 联系人名（微信昵称或备注名，识别键） */
  name: string
  /** 标签，如 ["VIP", "咨询中"] */
  tags: string[]
  /** 分类，如 "潜在客户"、"老客户"、"代理"、"未分类" */
  category: string
  /** 人工备注 */
  notes: string
  /** 长期记忆：按时间倒序（最新在前） */
  memory: CustomerMemoryEntry[]
  conversationCount: number
  firstSeenAt: number
  lastSeenAt: number
}

export interface CustomerPatch {
  name?: string
  tags?: string[]
  category?: string
  notes?: string
}

export interface NewCustomerMemory {
  summary: string
  lastReply?: string
}

/** 单个客户长期记忆保留的最大条数 */
export const CUSTOMER_MEMORY_LIMIT = 20

/** 注入 prompt 时单客户记忆的最大条数 */
export const CUSTOMER_MEMORY_INJECT_LIMIT = 8

/** 默认分类 */
export const DEFAULT_CATEGORY = '未分类'

interface CustomerFileShape {
  version: number
  customers: CustomerProfile[]
}

export class CustomerStore {
  private customers: CustomerProfile[] | null = null
  /** name → customer 索引（精确匹配，name 归一化为小写） */
  private byName: Map<string, CustomerProfile> | null = null

  constructor(private readonly filePath: string) {}

  listCustomers(): CustomerProfile[] {
    return [...this.load()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  getCustomerByName(name: string): CustomerProfile | null {
    const key = this.normalizeName(name)
    if (!key) return null
    this.ensureIndex()
    return this.byName!.get(key) ?? null
  }

  /** 取或建客户档案（联系人首次出现时自动建档） */
  getOrCreateCustomer(name: string): CustomerProfile {
    const existing = this.getCustomerByName(name)
    if (existing) {
      existing.lastSeenAt = Date.now()
      return existing
    }

    const now = Date.now()
    const customer: CustomerProfile = {
      customerId: randomUUID(),
      name: name.trim(),
      tags: [],
      category: DEFAULT_CATEGORY,
      notes: '',
      memory: [],
      conversationCount: 0,
      firstSeenAt: now,
      lastSeenAt: now
    }
    this.load().push(customer)
    this.byName?.set(this.normalizeName(customer.name), customer)
    this.flush()
    return customer
  }

  updateCustomer(customerId: string, patch: CustomerPatch): boolean {
    const customer = this.load().find((entry) => entry.customerId === customerId)
    if (!customer) return false

    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) return false
      this.byName?.delete(this.normalizeName(customer.name))
      customer.name = name
      this.byName?.set(this.normalizeName(customer.name), customer)
    }
    if (patch.tags !== undefined) {
      customer.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))]
    }
    if (patch.category !== undefined) customer.category = patch.category.trim() || DEFAULT_CATEGORY
    if (patch.notes !== undefined) customer.notes = patch.notes.trim()
    this.flush()
    return true
  }

  deleteCustomer(customerId: string): boolean {
    const customers = this.load()
    const index = customers.findIndex((entry) => entry.customerId === customerId)
    if (index === -1) return false
    const [removed] = customers.splice(index, 1)
    this.byName?.delete(this.normalizeName(removed.name))
    this.flush()
    return true
  }

  addTags(customerId: string, tags: string[]): boolean {
    const customer = this.load().find((entry) => entry.customerId === customerId)
    if (!customer) return false
    const merged = [...new Set([...customer.tags, ...tags.map((tag) => tag.trim()).filter(Boolean)])]
    if (merged.length === customer.tags.length) return true
    customer.tags = merged
    this.flush()
    return true
  }

  removeTag(customerId: string, tag: string): boolean {
    const customer = this.load().find((entry) => entry.customerId === customerId)
    if (!customer) return false
    const index = customer.tags.indexOf(tag)
    if (index === -1) return false
    customer.tags.splice(index, 1)
    this.flush()
    return true
  }

  setCategory(customerId: string, category: string): boolean {
    const customer = this.load().find((entry) => entry.customerId === customerId)
    if (!customer) return false
    customer.category = category.trim() || DEFAULT_CATEGORY
    this.flush()
    return true
  }

  /** 追加一条长期记忆；超过上限时丢弃最旧的 */
  appendMemory(customerId: string, entry: NewCustomerMemory): boolean {
    const customer = this.load().find((item) => item.customerId === customerId)
    if (!customer) return false
    const summary = entry.summary?.trim()
    if (!summary) return false
    customer.memory.unshift({
      ts: Date.now(),
      summary,
      lastReply: entry.lastReply?.trim() || undefined
    })
    if (customer.memory.length > CUSTOMER_MEMORY_LIMIT) {
      customer.memory = customer.memory.slice(0, CUSTOMER_MEMORY_LIMIT)
    }
    customer.conversationCount += 1
    customer.lastSeenAt = Date.now()
    this.flush()
    return true
  }

  /** 把客户长期记忆压缩成 prompt 注入段 */
  buildMemorySection(customer: CustomerProfile, limit = CUSTOMER_MEMORY_INJECT_LIMIT): string {
    if (!customer || customer.memory.length === 0) return ''
    const lines = customer.memory
      .slice(0, limit)
      .map((entry, index) => {
        const time = new Date(entry.ts).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
        return `${index + 1}. [${time}] ${entry.summary}`
      })
    return `\n\n## 该客户的历史对话记忆（请结合上下文自然衔接，不要机械复述）\n${lines.join('\n')}`
  }

  /** 客户维度统计：总数 / 按分类 / 按标签 */
  getStats(): {
    total: number
    byCategory: Record<string, number>
    byTag: Record<string, number>
  } {
    const customers = this.load()
    const byCategory: Record<string, number> = {}
    const byTag: Record<string, number> = {}
    for (const customer of customers) {
      byCategory[customer.category] = (byCategory[customer.category] ?? 0) + 1
      for (const tag of customer.tags) {
        byTag[tag] = (byTag[tag] ?? 0) + 1
      }
    }
    return { total: customers.length, byCategory, byTag }
  }

  /** 全部标签（去重，按使用频率排序），供 UI 标签筛选 */
  listAllTags(): string[] {
    const counts = new Map<string, number>()
    for (const customer of this.load()) {
      for (const tag of customer.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag)
  }

  /** 全部分类（去重） */
  listAllCategories(): string[] {
    return [...new Set(this.load().map((customer) => customer.category))].sort()
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase()
  }

  private ensureIndex(): void {
    if (this.byName) return
    this.byName = new Map()
    for (const customer of this.load()) {
      this.byName.set(this.normalizeName(customer.name), customer)
    }
  }

  private load(): CustomerProfile[] {
    if (this.customers) return this.customers
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<CustomerFileShape>
      this.customers = Array.isArray(raw?.customers) ? (raw.customers as CustomerProfile[]) : []
    } catch {
      this.customers = []
    }
    return this.customers
  }

  private flush(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      writeFileSync(
        this.filePath,
        `${JSON.stringify({ version: 1, customers: this.customers ?? [] }, null, 2)}\n`,
        'utf8'
      )
    } catch (error) {
      console.error('[CustomerStore] 客户档案写入失败:', error)
    }
  }
}
