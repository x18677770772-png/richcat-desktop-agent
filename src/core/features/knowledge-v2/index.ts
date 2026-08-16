// src/core/features/knowledge-v2/index.ts
// ── F9 知识库深度优化：FeatureModule 装配 ──
// 设计文档：docs/richcat-v2-design.md §3-F9。
//
// 关键设计：
// - flag 关闭零影响：装配方（FeatureRegistry，C0 落地后）按 f9.knowledge_v2 控制是否调用
//   beforeProvider；本模块内再做防御性二次校验——f9 关时直接返回，不读不写任何东西；
// - 失败降级：注入失败/抛错 → 保留 input 原有知识段（V1 全量段），绝不影响主链路；
// - 向后兼容：仅 f9 开时把 input.knowledgeSection 替换为 V2 段；f9 关时输入不被触碰。
// - 回滚：本目录为 F9 独立 commit；revert 后注入回到 V1 全量 30 条（时间序）。

import { ProviderInput } from '../../session-types'
import { KNOWLEDGE_INJECTION_LIMIT, KnowledgeStore } from '../../knowledge/knowledge-store'
import { FeatureFlagKey, FeatureFlags } from '../flags'
import { KnowledgeInjectionContext } from './types'
import { InjectionStrategy } from './injection'
import { buildKnowledgeV2Section } from './section'

/** F9 消费的 ProviderHookContext 子集（与 docs §3.0 ProviderHookContext 字段对齐；
 *  hooks.ts（C0）落地后装配方直接传完整 ctx，本模块只读以下字段，结构兼容） */
export interface KnowledgeV2HookContext {
  input: ProviderInput
  stores: {
    knowledge: KnowledgeStore
  }
  /** 防御性 flag 校验（registry 已按 flag 装配，这里再兜底） */
  flags?: FeatureFlags
  /** F9 注入上下文（F3 填 isVip / F1 填 isGroup / OCR 后填 keywords） */
  injection?: KnowledgeInjectionContext
}

/** F9 特征模块（形状与 docs §3.0 FeatureModule 兼容：flagKey + beforeProvider） */
export interface KnowledgeV2FeatureModule {
  flagKey: FeatureFlagKey
  beforeProvider(ctx: KnowledgeV2HookContext): void
}

export function createKnowledgeV2Feature(): KnowledgeV2FeatureModule {
  return {
    flagKey: 'f9.knowledge_v2',
    beforeProvider(ctx) {
      // flag 关 → 零影响（不读不写）
      if (ctx.flags && !ctx.flags.isEnabled('f9.knowledge_v2')) return

      try {
        const strategy = new InjectionStrategy(ctx.stores.knowledge)
        const items = strategy.select(ctx.injection ?? {})
        if (items.length === 0) return // 无可用条目：保持原知识段（V1 空段即无注入）
        const section = buildKnowledgeV2Section(items)
        if (section.trim()) {
          ctx.input.knowledgeSection = section
          console.log(
            `[KnowledgeV2] 注入 ${items.length} 条知识（上限 ${KNOWLEDGE_INJECTION_LIMIT}）`
          )
        }
      } catch (error) {
        // 注入失败 → 保留原有知识段，不影响主链路
        console.error('[KnowledgeV2] 知识注入失败（保持原知识段）:', error)
      }
    }
  }
}
