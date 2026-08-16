// src/core/features/follow-up/types.ts
// ── F7 待跟进提醒：类型定义（docs §3-F7）──

export interface FollowUpItem {
  followUpId: string
  /** 关联客户名（模型识别的 contact；无法识别为 null） */
  contact: string | null
  /** 承诺内容，如"明天上午回复退款进度" */
  action: string
  /** 到期时间（epoch ms） */
  dueAt: number
  status: 'open' | 'done' | 'cancelled'
  createdAt: number
  doneAt?: number
  /** ai=模型承诺生成；manual=UI 手动添加 */
  source: 'ai' | 'manual'
}
