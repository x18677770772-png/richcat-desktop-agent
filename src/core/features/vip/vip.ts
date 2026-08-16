// src/core/features/vip/vip.ts
// ── F3 VIP 差异化服务：VIP 判定与专属知识解析（纯函数，可单测）──
// 设计文档：docs/richcat-v2-design.md §3-F3。
// 回滚说明：本文件属于 F3 独立 commit；revert 后 VIP 段不注入、差异化失效，
// 客户档案无结构改动、零数据残留。

import { CustomerProfile } from '../../customers/customer-store'
import { KnowledgeItem } from '../../knowledge/knowledge-store'

/** VIP 判定常量：category 精确值（文档 §3-F3） */
export const VIP_CATEGORY = 'VIP'
/** VIP 判定常量：tags 包含值（文档 §3-F3） */
export const VIP_TAG = 'VIP'

/**
 * VIP 判定：customer.category === 'VIP' || customer.tags 含 'VIP'
 * （复用现有 CustomerStore 字段，零新存储；无档案/档案缺字段 → 非 VIP）。
 */
export function isVip(customer?: CustomerProfile | null): boolean {
  if (!customer) return false
  return customer.category === VIP_CATEGORY || customer.tags.includes(VIP_TAG)
}

/**
 * VIP 专属知识解析：F9 提供 getVipInjectionItems?.() 时取用专属条目；
 * F9 未实现 / 方法缺失 / 调用失败 → 返回 null，由调用方回退全量注入
 * （文档：F3 不直接依赖 F9 实现，通过可选方法接口解耦；F9 落地后自动受益）。
 * 参数用 unknown 以完全解耦 F9 类型（F9 未实现时 KnowledgeStore 上无该方法）。
 */
export function resolveVipKnowledge(knowledge?: unknown): KnowledgeItem[] | null {
  if (!knowledge || typeof knowledge !== 'object') return null
  try {
    const fn = (knowledge as { getVipInjectionItems?: unknown }).getVipInjectionItems
    if (typeof fn !== 'function') return null
    const items = (fn as () => unknown)()
    return Array.isArray(items) ? (items as KnowledgeItem[]) : null
  } catch {
    return null
  }
}
