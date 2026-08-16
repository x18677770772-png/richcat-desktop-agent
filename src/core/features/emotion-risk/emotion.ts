// src/core/features/emotion-risk/emotion.ts
// ── F5 情绪/风险识别：情绪标签映射（纯函数，可单测）──
// sentiment/risk → 打标/通知/接管 决策表。
// 设计文档：docs/richcat-v2-design.md §3-F5。
// 回滚说明：本文件属于 F5 独立 commit；revert 后 emotion 字段不再被消费（C2 的解析仍保留）。

import { SmartReplyResult } from '../../ai-client'

export type EmotionInfo = NonNullable<SmartReplyResult['emotion']>

/** F5 对一条 emotion 分析结果的动作决策 */
export interface EmotionActionDecision {
  /** 需要打到客户档案的标签（按文档规则映射，顺序固定） */
  tags: string[]
  /** 高优先级风险（risk=urgent）：通知时标记 urgent */
  urgent: boolean
  /** 是否触发 risk:alert 通知（有标签即通知） */
  notify: boolean
  /** 是否请求人工接管（sentiment=angry 且 confidence>=0.7；F2 开启才生效） */
  handoff: boolean
}

/**
 * 情绪/风险 → 动作映射表：
 * - sentiment=negative|angry  → 打标「情绪负面」
 * - risk=refund_intent        → 打标「退款意向」
 * - risk=complaint            → 打标「投诉」
 * - risk=urgent               → 打标「紧急」+ 高优先级通知
 * - sentiment=angry && confidence>=0.7 → 请求人工接管（risk_escalation）
 * - neutral/positive / risk=none → 不打标、不通知（V1 行为）
 */
export function decideEmotionActions(emotion: EmotionInfo): EmotionActionDecision {
  const tags: string[] = []
  if (emotion.sentiment === 'negative' || emotion.sentiment === 'angry') {
    tags.push('情绪负面')
  }
  if (emotion.risk === 'refund_intent') tags.push('退款意向')
  if (emotion.risk === 'complaint') tags.push('投诉')
  if (emotion.risk === 'urgent') tags.push('紧急')

  const urgent = emotion.risk === 'urgent'
  const handoff = emotion.sentiment === 'angry' && emotion.confidence >= 0.7
  return { tags, urgent, notify: tags.length > 0, handoff }
}
