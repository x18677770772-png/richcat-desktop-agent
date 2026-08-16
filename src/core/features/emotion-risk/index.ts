// src/core/features/emotion-risk/index.ts
// ── F5 情绪/风险识别：FeatureModule 装配（打标 + 通知 + 可选人工接管）──
// 设计文档：docs/richcat-v2-design.md §3-F5。
//
// 关键设计：
// - 零额外调用：emotion 字段由 getSmartReply 同一次调用输出，F5 不新增 VLM 调用；
// - 打标为写操作：afterProvider 内全部 try/catch，打标/通知/接管失败绝不影响回复发送；
// - flag 关闭零影响：本模块只定义动作逻辑，是否调用由装配方（FeatureRegistry）按
//   f5.emotion_risk 开关控制；flag 关时 afterProvider 永不被调用，不注入 prompt 段、
//   不解析消费 emotion 字段、无额外调用。
// - 回滚：本目录为 F5 独立 commit；revert 后 emotion 字段不再被消费（C2 解析仍保留）。

import { CustomerStore } from '../../customers/customer-store'
import { SmartReplyResult } from '../../ai-client'
import { FeatureFlagKey } from '../flags'
import { decideEmotionActions } from './emotion'

/**
 * F5 消费的 ProviderHookContext 子集（与 docs §3.0 ProviderHookContext 字段对齐；
 * hooks.ts（C0）落地后装配方直接传完整 ctx，本模块只读以下字段，结构兼容）。
 */
export interface EmotionRiskHookContext {
  result?: SmartReplyResult
  stores: {
    customer: CustomerStore
  }
  /** 推给所有 renderer 窗口（主进程实现）；F5 发出 risk:alert 事件 */
  notify(payload: { type: string; data?: unknown }): void
  /** F2 注册的人工接管实现；F2 未注册/关闭时为 no-op */
  requestHandoff(reason: 'risk_escalation', confidence: number): void
}

/** F5 特征模块（形状与 docs §3.0 FeatureModule 兼容：flagKey + afterProvider） */
export interface EmotionRiskFeatureModule {
  flagKey: FeatureFlagKey
  afterProvider(ctx: EmotionRiskHookContext): void
}

export function createEmotionRiskFeature(): EmotionRiskFeatureModule {
  return {
    flagKey: 'f5.emotion_risk',
    afterProvider(ctx) {
      handleEmotionResult(ctx)
    }
  }
}

/**
 * 消费 SmartReplyResult.emotion → 打标 + 通知 + 可选接管。
 * - emotion 缺失/无效 → 零动作（与 V1 一致）；
 * - 打标：customerId 由 contact 查得；查不到时自动建档（与 LocalProvider 建档语义一致）；
 * - 每一步独立 try/catch，任何失败仅记日志，不影响 provider/session 主链路。
 */
export function handleEmotionResult(ctx: EmotionRiskHookContext): void {
  const emotion = ctx.result?.emotion
  if (!emotion) return

  let decision
  try {
    decision = decideEmotionActions(emotion)
  } catch (error) {
    console.error('[EmotionRisk] 情绪动作决策失败:', error)
    return
  }

  // 打标（写操作：失败不影响发送）
  if (decision.tags.length > 0 && ctx.result?.contact) {
    try {
      const contact = ctx.result.contact
      const customer =
        ctx.stores.customer.getCustomerByName(contact) ??
        ctx.stores.customer.getOrCreateCustomer(contact)
      ctx.stores.customer.addTags(customer.customerId, decision.tags)
      console.log(
        `[EmotionRisk] 客户「${contact}」打标: ${decision.tags.join('、')}（sentiment=${emotion.sentiment}, risk=${emotion.risk ?? 'none'}, confidence=${emotion.confidence}）`
      )
    } catch (error) {
      console.error('[EmotionRisk] 客户打标失败（不影响回复发送）:', error)
    }
  }

  // 通知（有标签才通知；risk:alert 事件，urgent 为高优先级）
  if (decision.notify) {
    try {
      ctx.notify({
        type: 'risk:alert',
        data: {
          contact: ctx.result?.contact ?? null,
          emotion,
          tags: decision.tags,
          urgent: decision.urgent
        }
      })
    } catch (error) {
      console.error('[EmotionRisk] 风险通知失败（不影响回复发送）:', error)
    }
  }

  // 可选人工接管（sentiment=angry && confidence>=0.7；F2 关闭时 requestHandoff 为 no-op）
  if (decision.handoff) {
    try {
      ctx.requestHandoff('risk_escalation', emotion.confidence)
    } catch (error) {
      console.error('[EmotionRisk] 请求人工接管失败（不影响回复发送）:', error)
    }
  }
}
