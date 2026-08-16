// src/core/features/role-routing/index.ts
// ── F4 多角色消息路由：FeatureModule 装配 ──
// 设计文档：docs/richcat-v2-design.md §3-F4。
//
// 关键设计：
// - 只通过 ProviderInput.groupChat 接口读取群聊场景（与 F1 解耦，文档 §3-F4 目标）；
// - 两段式降成本：模型同一次输出 routeTo + reply；仅当 routeTo 有效（confidence>=0.6 且
//   目标角色可路由）时，才用目标 persona 重新生成一次（此时多一次调用）；失败回退第一段
//   reply（文档 §3-F4 决策 V2.1 + 验收 2d）；
// - 角色消息不掺和：messageKind='role_message' 时无论路由结果都保持原结果
//   （F1 后置过滤已兜底，此处双保险，避免对成员间对话做无谓二次生成）；
// - flag 关闭零影响：本模块只定义逻辑与工厂；是否调用由装配方按 f4.role_routing 控制，
//   本模块内再做防御性校验——f4 关时 beforeProvider/afterProvider 直接返回；
// - 回滚：本目录为 F4 独立 commit；revert 后 routeTo 不消费、路由段不注入，
//   persona 的 routingDomains/routable 可选字段残留但无害（不参与任何逻辑）。

import { SmartReplyResult } from '../../ai-client'
import { Persona, PersonaStore } from '../../persona/persona-store'
import { ProviderInput } from '../../session-types'
import { FeatureFlagKey, FeatureFlags } from '../flags'
import { RoleRouter, RoleRoutingConfig, RouteToSignal } from './route'
import { buildRoutingSection } from './section'

export { RoleRouter, ROUTING_MIN_CONFIDENCE, type RoleRoutingConfig, type RouteToSignal } from './route'
export { buildRoutingSection } from './section'

/**
 * F4 消费的 ProviderHookContext 子集（与 docs §3.0 ProviderHookContext 字段对齐；
 * hooks.ts（C0）落地后装配方直接传完整 ctx（可变对象），本模块只读写以下字段）。
 */
export interface RoleRoutingHookContext {
  input?: ProviderInput
  /** provider 调用结果（可变对象；afterProvider 可能替换 reply） */
  result?: SmartReplyResult
  stores: {
    persona: PersonaStore
  }
  /** 防御性 flag 校验（registry 已按 flag 装配，这里再兜底） */
  flags?: FeatureFlags
  /** ── beforeProvider 输出槽（装配方在 assembleSystemPrompt 时读取）── */
  /** 多角色路由提示段（仅 f4 开 && 群聊 && ≥2 可路由角色时非空；传给 assembler.routingSection） */
  routingSection?: string
  /** 是否多角色场景（传给 assembler.multiRole 场景判定） */
  multiRole?: boolean
  /**
   * 二次生成能力（装配方注入；未注入时 routeTo 仅记录日志，不重生成，直接采用第一段 reply）：
   * 用目标 persona 的 systemPrompt 重跑一次 provider 链路，返回新结果；失败返回 null（回退第一段）。
   */
  regenerate?: (input: ProviderInput, personaPrompt: string) => Promise<SmartReplyResult | null>
  config?: RoleRoutingConfig
}

/** F4 特征模块（形状与 docs §3.0 FeatureModule 兼容：flagKey + beforeProvider + afterProvider） */
export interface RoleRoutingFeatureModule {
  flagKey: FeatureFlagKey
  beforeProvider(ctx: RoleRoutingHookContext): void
  afterProvider(ctx: RoleRoutingHookContext): Promise<void>
}

export function createRoleRoutingFeature(): RoleRoutingFeatureModule {
  return {
    flagKey: 'f4.role_routing',
    beforeProvider(ctx) {
      handleRoutingBeforeProvider(ctx)
    },
    async afterProvider(ctx) {
      ctx.result = await applyRoleRouting(ctx.result, ctx)
    }
  }
}

/** 参与路由的角色清单（enabled 且 routable !== false；从 store 取全部后过滤） */
export function getRoutablePersonas(store: PersonaStore): Persona[] {
  try {
    return store.listPersonas().filter((p) => p.enabled && p.routable !== false)
  } catch (error) {
    console.error('[RoleRouting] 读取角色列表失败（视为无路由角色）:', error)
    return []
  }
}

/**
 * beforeProvider：群聊且 ≥2 个可路由角色 → 判定多角色场景，注入路由提示段。
 * - 非群聊 / 可路由角色 <2 / f4 关 → 零动作（不注入任何段，V1 行为）；
 * - 全部 try/catch：失败仅记日志，不影响 provider 主链路。
 */
export function handleRoutingBeforeProvider(ctx: RoleRoutingHookContext): void {
  if (ctx.flags && !ctx.flags.isEnabled('f4.role_routing')) return
  if (!ctx.input?.groupChat?.isGroup) return

  const routable = getRoutablePersonas(ctx.stores.persona)
  if (routable.length < 2) return

  ctx.multiRole = true
  ctx.routingSection = buildRoutingSection(routable)
  console.log(
    `[RoleRouting] 多角色场景生效：${routable.length} 个可路由角色（${routable.map((p) => p.name).join('、')}）`
  )
}

/**
 * afterProvider：应用 routeTo → 目标角色二次生成；失败/不满足条件回退第一段 reply。
 * 纯函数式实现（可单测）：输入 result + ctx，返回新 result；模块层负责写回 ctx.result。
 * 分支：
 * - 无 routeTo / messageKind='role_message' → 原样返回（零开销）；
 * - routeTo 不可路由（非法 personaId / routable=false / confidence<0.6）→ 原样返回；
 * - 未注入 regenerate → 记录日志，原样返回（采用第一段 reply）；
 * - 二次生成成功 → 替换 reply/summary/扩展字段（保留原 contact；清除 routeTo 防同轮重复路由）；
 * - 二次生成失败/返回 null → 回退第一段 reply，记警告（不抛错）。
 */
export async function applyRoleRouting(
  result: SmartReplyResult | undefined,
  ctx: Pick<RoleRoutingHookContext, 'stores' | 'regenerate' | 'input' | 'config'> & { flags?: FeatureFlags }
): Promise<SmartReplyResult | undefined> {
  if (!result) return result
  if (ctx.flags && !ctx.flags.isEnabled('f4.role_routing')) return result

  const signal: RouteToSignal | undefined = result.routeTo
  if (!signal) return result
  // 角色间对话不掺和：不路由、不二次生成（F1 后置过滤已置 reply=null，此处双保险）
  if (result.messageKind === 'role_message') return result

  const router = new RoleRouter(getRoutablePersonas(ctx.stores.persona), ctx.config)
  const target = router.resolve(signal)
  if (!target) {
    console.log(
      `[RoleRouting] routeTo 未命中可用角色（personaId=${signal.personaId}, confidence=${signal.confidence ?? 0}），采用第一段 reply`
    )
    return result
  }

  if (!ctx.regenerate || !ctx.input) {
    console.log(`[RoleRouting] 目标角色「${target.name}」命中，但未注入 regenerate/input，采用第一段 reply`)
    return result
  }

  try {
    const regenerated = await ctx.regenerate(ctx.input, target.systemPrompt)
    if (!regenerated) {
      console.warn('[RoleRouting] 二次生成返回 null，回退第一段 reply（不报错）')
      return result
    }
    const merged: SmartReplyResult = {
      ...regenerated,
      // 保留原 contact（第一次识别更可靠）；清除 routeTo 避免同轮重复路由
      contact: regenerated.contact ?? result.contact,
      routeTo: undefined
    }
    console.log(
      `[RoleRouting] 路由成功：→「${target.name}」| reason=${signal.reason ?? ''} | confidence=${(signal.confidence ?? 0).toFixed(2)}`
    )
    return merged
  } catch (error) {
    // 二次调用失败 → 回退第一段 reply（docs §3-F4 验收 2d：不报错）
    console.warn('[RoleRouting] 二次生成失败，回退第一段 reply:', error instanceof Error ? error.message : error)
    return result
  }
}
