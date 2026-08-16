// src/core/features/human-handoff/index.ts
// ── F2 人工接管/升级：FeatureModule（消费 handoff + 多轮未解决计数 + 接管动作）──
// 设计文档：docs/richcat-v2-design.md §3-F2。
//
// 关键设计：
// - 触发链路（全部走 captureHandoffResult / openHandoff）：
//   ① 模型信号 result.handoff && confidence>=0.6 → openHandoff(reason)；
//   ② 多轮未解决：本轮 reply 为空 → 计数+1；>=maxUnresolvedTurns → openHandoff('multiple_unresolved')；
//      回复成功（reply 非空）→ 清零；计数存 HandoffStore 内存 Map（不持久化）；
//   ③ F5 升级：openHandoff('risk_escalation')（由装配方把 requestHandoff 接到本函数；F2 关时 no-op）。
// - openHandoff 动作：store.add（同 contact 去重）→ 桌面通知 + handoff:new 事件 + 客户打标「需人工」；
// - 会话级暂停：装配方把 contact 记入暂停集合，LocalProvider.shouldSkipContact 使该会话后续轮零调用直接跳过
//   （实现上替代设计中的 SessionEvent handoff_pause——同样的可观察行为，更小侵入面）；
// - flag 关闭零影响：captureHandoffResult 首行校验 f2 开关，关时零动作；
// - 回滚：本目录为 F2 独立 commit；revert 后接管不触发、不打标、不暂停，handoffs.json 残留无害。

import { CustomerStore } from '../../customers/customer-store'
import { SmartReplyResult } from '../../ai-client'
import { FeatureFlagKey } from '../flags'
import { HandoffStore } from './store'
import { HandoffReason, HandoffRequest } from './types'

export * from './types'
export { HandoffStore } from './store'
export { buildHandoffSection } from './section'

export const HANDOFF_FLAG_KEY: FeatureFlagKey = 'f2.human_handoff'

/** 模型 handoff 信号的最低置信度（docs §3-F2 触发链路 1） */
export const HANDOFF_CONFIDENCE_THRESHOLD = 0.6

/** 多轮未解决上限（featuresConfig.f2.maxUnresolvedTurns 缺省值） */
export const DEFAULT_MAX_UNRESOLVED_TURNS = 3

/** 接管原因的中文标签（通知/日志用） */
export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  explicit_human: '客户要求转人工',
  complaint: '投诉',
  price_sensitive: '价格敏感/砍价',
  multiple_unresolved: '多轮未解决',
  risk_escalation: '高风险情绪升级'
}

/** F2 装配方注入的上下文（与 f5 的 EmotionRiskHookContext 风格一致） */
export interface HandoffHookContext {
  getStore(): HandoffStore
  /** 推给所有 renderer 窗口（handoff:new 事件） */
  notify(payload: { type: string; data?: unknown }): void
  /** 桌面通知（主进程实现） */
  notifyDesktop?(title: string, body: string): void
  getCustomerStore(): CustomerStore
  /** 会话级暂停集合（contact → 暂停自动回复；resolve 时移除） */
  pausedContacts: Set<string>
  /** 多轮未解决上限（默认 3） */
  maxUnresolvedTurns?: number
}

/**
 * 打开一张接管单并执行动作：去重入店 → 暂停会话 → 通知 + 桌面通知 → 客户打标「需人工」。
 * 独立导出供 F5 升级（requestHandoff('risk_escalation')）与装配方直接调用。
 * 返回创建的接管单（去重命中返回 null）；全程 try/catch，失败不影响主链路。
 */
export function openHandoff(
  reason: HandoffReason,
  contact: string | null,
  confidence: number,
  ctx: HandoffHookContext
): HandoffRequest | null {
  try {
    const request = ctx.getStore().add({ contact, reason, confidence })
    if (!request) return null

    if (contact) ctx.pausedContacts.add(contact)

    try {
      ctx.notify({ type: 'handoff:new', data: { handoff: request } })
    } catch (error) {
      console.error('[Handoff] handoff:new 事件推送失败:', error)
    }

    try {
      ctx.notifyDesktop?.(
        `需人工介入${contact ? `：${contact}` : ''}`,
        HANDOFF_REASON_LABELS[reason] ?? reason
      )
    } catch (error) {
      console.error('[Handoff] 桌面通知失败:', error)
    }

    if (contact) {
      try {
        const customer =
          ctx.getCustomerStore().getCustomerByName(contact) ??
          ctx.getCustomerStore().getOrCreateCustomer(contact)
        ctx.getCustomerStore().addTags(customer.customerId, ['需人工'])
        console.log(
          `[Handoff] 客户「${contact}」已标记「需人工」（reason=${reason}, confidence=${confidence}）`
        )
      } catch (error) {
        console.error('[Handoff] 客户打标失败（不影响接管）:', error)
      }
    }

    console.log(
      `[Handoff] 已接管: ${contact ?? '未知客户'} reason=${reason} confidence=${confidence}`
    )
    return request
  } catch (error) {
    console.error('[Handoff] 打开接管单失败（不影响主链路）:', error)
    return null
  }
}

/**
 * 消费 SmartReplyResult（afterProvider 语义；由装配方在 transformResult 中调用）：
 * ① 模型 handoff 信号 → openHandoff；
 * ② 多轮未解决计数（reply 空 +1 / 非空清零）→ 达上限 openHandoff('multiple_unresolved')。
 * f2 flag 关闭 → 零动作（零影响）。
 */
export function captureHandoffResult(
  result: SmartReplyResult,
  ctx: HandoffHookContext,
  flags: { isEnabled(key: FeatureFlagKey): boolean }
): void {
  if (!flags.isEnabled('f2.human_handoff')) return

  // ① 模型信号（confidence 门槛）
  const handoff = result?.handoff
  if (
    handoff &&
    typeof handoff.confidence === 'number' &&
    handoff.confidence >= HANDOFF_CONFIDENCE_THRESHOLD
  ) {
    openHandoff(handoff.reason, result.contact, handoff.confidence, ctx)
  }

  // ② 多轮未解决计数（contact 为空不计数）
  const contact = result?.contact
  if (!contact) return
  try {
    const store = ctx.getStore()
    if (result.reply) {
      store.resetUnresolved(contact)
    } else {
      const count = store.incrementUnresolved(contact)
      const max = ctx.maxUnresolvedTurns ?? DEFAULT_MAX_UNRESOLVED_TURNS
      if (count >= max) {
        console.log(
          `[Handoff] 客户「${contact}」连续 ${count} 轮未解决，触发人工接管（max=${max}）`
        )
        store.resetUnresolved(contact)
        openHandoff('multiple_unresolved', contact, 1, ctx)
      }
    }
  } catch (error) {
    console.error('[Handoff] 多轮未解决计数失败（不影响主链路）:', error)
  }
}

/** F2 特征模块（形状与 f1/f5/f7 对齐） */
export interface HumanHandoffFeatureModule {
  flagKey: FeatureFlagKey
  capture(
    result: SmartReplyResult,
    ctx: HandoffHookContext,
    flags: { isEnabled(key: FeatureFlagKey): boolean }
  ): void
  /** F5 升级通道（F2 关闭时装配方不接线 → no-op） */
  escalate(
    reason: 'risk_escalation',
    contact: string | null,
    confidence: number,
    ctx: HandoffHookContext
  ): HandoffRequest | null
}

export function createHumanHandoffFeature(): HumanHandoffFeatureModule {
  return {
    flagKey: 'f2.human_handoff',
    capture: captureHandoffResult,
    escalate: (reason, contact, confidence, ctx) => openHandoff(reason, contact, confidence, ctx)
  }
}
