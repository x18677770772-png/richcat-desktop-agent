// src/core/features/human-handoff/types.ts
// ── F2 人工接管/升级：类型定义（docs §3-F2）──

export type HandoffReason =
  | 'explicit_human' // 客户明确要求转人工
  | 'complaint' // 投诉
  | 'price_sensitive' // 价格敏感/砍价纠缠
  | 'multiple_unresolved' // 多轮未解决（由 F2 计数，非模型输出）
  | 'risk_escalation' // 由 F5 高风险升级

export type HandoffStatus = 'open' | 'resolved'

export interface HandoffRequest {
  handoffId: string
  /** 关联客户名（模型识别的 contact；无法识别为 null） */
  contact: string | null
  reason: HandoffReason
  confidence: number
  createdAt: number
  status: HandoffStatus
  resolvedAt?: number
}
