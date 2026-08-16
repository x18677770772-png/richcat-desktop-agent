// src/core/features/knowledge-v2/injection.ts
// ── F9 知识库深度优化：注入策略（替代"全量 30 条时间序"）──
// 设计文档：docs/richcat-v2-design.md §3-F9。
//
// 策略：上下文过滤（scope）→ 优先级排序（weight 降序，同权重新近优先）
//       → 可选关键词检索（f9.useKeywordMatch，OCR 接入后启用）→ 条数上限。
// 向后兼容：本模块仅 f9 开时被调用；f9 关时调用点回退旧 getInjectionItems()（V1 行为不变）。

import {
  KNOWLEDGE_INJECTION_LIMIT,
  KnowledgeItem,
  KnowledgeStore
} from '../../knowledge/knowledge-store'
import { KnowledgeInjectionContext, KnowledgeInjectionOptions } from './types'

/** 关键词匹配器接口（OCR 接入后启用；标题命中权重 3 / 标签 2 / 正文 1） */
export interface KeywordMatcher {
  match(items: KnowledgeItem[], keywords: string[], topK: number): KnowledgeItem[]
}

/** 默认关键词匹配器：与 KnowledgeStore.search 同款打分（title 3 / tags 2 / content 1） */
export function createKeywordMatcher(): KeywordMatcher {
  return {
    match(items, keywords, topK) {
      const terms = keywords
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length > 0)
      if (terms.length === 0) return items.slice(0, topK)

      return items
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
        .slice(0, topK)
        .map((entry) => entry.item)
    }
  }
}

/**
 * F9 注入策略。
 * - select(ctx)：按上下文挑选注入条目（scope 过滤 + weight 排序 + 上限）；
 * - 关键词检索开启且有原文关键词时优先关键词命中；无命中回退权重注入（避免空知识段）；
 * - 全程只读，不抛错：任何异常由调用方（FeatureModule）try/catch 兜底。
 */
export class InjectionStrategy {
  constructor(
    private readonly store: KnowledgeStore,
    private readonly options: KnowledgeInjectionOptions = {}
  ) {}

  select(ctx: KnowledgeInjectionContext = {}): KnowledgeItem[] {
    const limit = this.options.limit ?? KNOWLEDGE_INJECTION_LIMIT

    if (this.options.useKeywordMatch && ctx.keywords?.length) {
      const hits = createKeywordMatcher().match(this.store.getEnabledItems(), ctx.keywords, limit)
      if (hits.length > 0) return hits
      // 无命中 → 回退权重注入，保证知识段不空
    }

    return this.store.getInjectionItemsV2(ctx, limit)
  }
}
