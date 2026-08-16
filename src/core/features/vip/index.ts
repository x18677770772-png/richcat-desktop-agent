// src/core/features/vip/index.ts
// ── F3 VIP 差异化服务：FeatureModule 装配（VIP 判定 → 注入语气段 → VIP 服务日志）──
// 设计文档：docs/richcat-v2-design.md §3-F3。
//
// 关键设计：
// - VIP 判定：category='VIP' || tags 含 'VIP'（复用 CustomerStore，零新存储）；
// - 专属知识片段：F9 提供 getVipInjectionItems?.() 时取用（自动受益）；未实现时
//   vipItems=null，知识段回退全量注入（F9 关闭时 VIP 也使用全量，prompt 强调优先参考）；
// - 零额外调用：不发起任何额外 VLM/LLM 调用，仅注入 prompt 段与记录日志；
// - flag 关闭零影响：本模块只定义动作逻辑，是否调用由装配方（FeatureRegistry）按
//   f3.vip_service 控制；flag 关时 beforeProvider/afterReply 永不被调用，不注入 VIP 段、
//   不判定、无日志；
// - 回滚：本目录为 F3 独立 commit；revert 后 VIP 段不注入、差异化失效，零数据残留。
//
// 范围说明（可独立回滚的后续增量）：f3.confirmBeforeReply 回复前人工确认流程
// （SessionEvent vip_confirm_pending + generic-channel-session 分支 + IPC + UI 弹窗）
// 依赖 session 状态机与主进程装配，按文档「V2 先做最小可用版」另行 commit，
// 本 commit 只在其 ctx 中预留 confirmBeforeReply 配置位。

import { CustomerProfile, CustomerStore } from '../../customers/customer-store'
import { KnowledgeStore, KnowledgeItem } from '../../knowledge/knowledge-store'
import { ProviderInput } from '../../session-types'
import { FeatureFlagKey } from '../flags'
import { isVip, resolveVipKnowledge } from './vip'
import { buildVipSection } from './section'

/**
 * F3 消费的 ProviderHookContext 子集（与 docs §3.0 ProviderHookContext 字段对齐；
 * hooks.ts（C0）落地后装配方直接传完整 ctx（可变对象），本模块只读写以下字段）。
 */
export interface VipHookContext {
  /** provider 调用输入（取 currentContact 判定当前客户） */
  input?: ProviderInput
  stores: {
    customer: CustomerStore
    knowledge?: KnowledgeStore
  }
  /** ── beforeProvider 输出槽（装配方在 assembleSystemPrompt 时读取）── */
  /** VIP 服务规范段文本（仅当前客户是 VIP 且 F3 开时非空；装配方传入 assembler.vipSection） */
  vipSection?: string
  /** 当前客户是否为 VIP（装配方传入 assembler.isVip 场景判定） */
  isVip?: boolean
  /** 专属知识条目（F9 提供时非空；null = 回退全量注入） */
  vipItems?: KnowledgeItem[] | null
  /** f3.confirmBeforeReply 配置位（装配方从 settings.featuresConfig.f3 读取传入；
   *  确认拦截流程为 F3 后续增量，本模块暂不消费） */
  confirmBeforeReply?: boolean
}

/** F3 特征模块（形状与 docs §3.0 FeatureModule 兼容：flagKey + beforeProvider + afterReply） */
export interface VipFeatureModule {
  flagKey: FeatureFlagKey
  beforeProvider(ctx: VipHookContext): void
  afterReply?(ctx: VipHookContext, replyText: string): void
}

export function createVipFeature(): VipFeatureModule {
  return {
    flagKey: 'f3.vip_service',
    beforeProvider(ctx) {
      handleVipBeforeProvider(ctx)
    },
    afterReply(ctx, replyText) {
      handleVipAfterReply(ctx, replyText)
    }
  }
}

/**
 * beforeProvider：判定当前客户是否 VIP → 是则注入 vipSection / isVip / vipItems。
 * - 无 currentContact / 查无档案 / 非 VIP → 零动作（V1 行为，不注入任何段）；
 * - 全部 try/catch：查询/解析失败不影响 provider 主链路。
 */
export function handleVipBeforeProvider(ctx: VipHookContext): void {
  const contact = ctx.input?.currentContact?.trim()
  if (!contact) return

  let customer: CustomerProfile | null = null
  try {
    customer = ctx.stores.customer.getCustomerByName(contact)
  } catch (error) {
    console.error('[VipService] 查询客户档案失败（不影响主链路）:', error)
    return
  }
  if (!isVip(customer)) return

  // VIP 专属知识：F9 提供则取用；否则 null（知识段回退全量注入 + prompt 强调优先参考）
  ctx.vipItems = resolveVipKnowledge(ctx.stores.knowledge)
  ctx.isVip = true
  ctx.vipSection = buildVipSection()
  console.log(
    `[VipService] VIP 客户「${contact}」差异化服务生效` +
      (ctx.vipItems?.length ? `（专属知识 ${ctx.vipItems.length} 条）` : '（回退全量知识注入）')
  )
}

/**
 * afterReply：VIP 服务日志（可选增强，文档 §3-F3 验收 3）。
 * 仅当本轮判定为 VIP 时记录；记录失败仅记日志，不影响回复发送。
 */
export function handleVipAfterReply(ctx: VipHookContext, replyText: string): void {
  if (!ctx.isVip) return
  try {
    const contact = ctx.input?.currentContact?.trim() ?? '未知'
    console.log(
      `[VipService] VIP 服务日志 | 客户=${contact} | ${new Date().toISOString()} | 回复=${(replyText ?? '').slice(0, 80)}`
    )
  } catch (error) {
    console.error('[VipService] VIP 服务日志记录失败（不影响回复发送）:', error)
  }
}
