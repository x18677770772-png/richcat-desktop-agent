// src/core/features/hooks.ts
// ── V2 统一功能注册骨架：FeatureModule / FeatureHookContext / FeatureRegistry ──
// 设计文档：docs/richcat-v2-design.md §3.0（ProviderHookContext/FeatureModule）与 §2.3（关闭零影响）。
//
// 用途：把所有 feature 的钩子（beforeProvider/afterProvider/afterReply/onTimer）收拢到
// 一个注册表，由装配方（src/main/index.ts installFeatures）按 flag 注册；运行时
// FeatureRegistry 只调用「该 flag 开启」的模块，且每个钩子独立 try/catch——
// 任何 feature 抛错都被吞掉并记日志，绝不影响 provider/session 主链路（§2.3-4）。
//
// 各 feature 模块自带更窄的 HookContext 子集（如 EmotionRiskHookContext）；装配方在
// 注册适配器中把 FeatureHookContext 映射到模块子集（见 main/index.ts installFeatures）。
//
// 回滚说明：本文件属于装配集成（install-features）独立 commit；revert 后各 feature
// 模块文件仍在但不再被统一注册（功能随各自 install* 装配保留或按 revert 面失效）。

import { FeatureFlagKey, FeatureFlags } from './flags'
import { ProviderInput } from '../session-types'
import { SmartReplyResult } from '../ai-client'
import { CustomerStore } from '../customers/customer-store'
import { KnowledgeStore, KnowledgeItem } from '../knowledge/knowledge-store'
import { PersonaStore } from '../persona/persona-store'

/** 统一 feature 钩子上下文（装配方构造的可变对象；各 feature 只读写自己的子集） */
export interface FeatureHookContext {
  /** provider 调用输入（beforeProvider 可改写：如 F9 替换 knowledgeSection） */
  input: ProviderInput
  /** provider 调用结果（afterProvider 可改写：如 F4 二次生成替换 reply） */
  result?: SmartReplyResult
  flags: FeatureFlags
  stores: {
    customer?: CustomerStore
    knowledge?: KnowledgeStore
    persona?: PersonaStore
  }
  /** ── beforeProvider 输出槽（装配方在 assembleSystemPrompt 时读取）── */
  /** F3：VIP 服务规范段（传给 assembler.vipSection） */
  vipSection?: string
  /** F4：多角色路由段（传给 assembler.routingSection） */
  routingSection?: string
  /** F3：当前客户是否 VIP（传给 assembler.isVip 场景判定） */
  isVip?: boolean
  /** F4：是否多角色场景（传给 assembler.multiRole 场景判定） */
  multiRole?: boolean
  /** F3：专属知识条目（F9 提供时非空；null = 回退全量注入） */
  vipItems?: KnowledgeItem[] | null
  /** ── 装配方注入的能力 ── */
  /** 推给所有 renderer 窗口（F5 通知 / F2 接管事件） */
  notify?(payload: { type: string; data?: unknown }): void
  /** F2 注册的接管实现（F5 高风险升级用；f2 关时 no-op） */
  requestHandoff?(reason: string, contact: string | null, confidence: number): void
  /** F4 二次生成能力（用目标 persona 重跑一次 provider；失败返回 null 回退第一段） */
  regenerate?(input: ProviderInput, personaPrompt: string): Promise<SmartReplyResult | null>
}

/** 统一 feature 模块形状（与 docs §3.0 FeatureModule 对齐；全部钩子可选） */
export interface FeatureModule {
  flagKey: FeatureFlagKey
  beforeProvider?(ctx: FeatureHookContext): void | Promise<void>
  afterProvider?(ctx: FeatureHookContext): void | Promise<void>
  afterReply?(ctx: FeatureHookContext, replyText: string): void | Promise<void>
  onTimer?(kind: 'daily_report' | 'follow_up', now: Date): void | Promise<void>
}

/**
 * 功能注册表：按 flag 装配 FeatureModule，统一驱动各钩子。
 * - enabled()：只返回 flag 开启的模块（关闭零影响：不注入段、不消费、无额外调用）；
 * - run* 每个模块独立 try/catch：单模块抛错只记日志，继续执行后续模块（§2.3-4 不阻塞主链路）。
 */
export class FeatureRegistry {
  private readonly modules: FeatureModule[] = []

  constructor(private readonly flags: FeatureFlags) {}

  register(module: FeatureModule): void {
    this.modules.push(module)
  }

  registerAll(modules: FeatureModule[]): void {
    for (const module of modules) this.register(module)
  }

  /** 当前 flag 开启的模块（保持注册顺序；F8 等无钩子模块也列出便于观察） */
  enabled(): FeatureModule[] {
    return this.modules.filter((module) => this.flags.isEnabled(module.flagKey))
  }

  async runBeforeProvider(ctx: FeatureHookContext): Promise<void> {
    await this.runEach('beforeProvider', ctx)
  }

  async runAfterProvider(ctx: FeatureHookContext): Promise<void> {
    await this.runEach('afterProvider', ctx)
  }

  async runAfterReply(ctx: FeatureHookContext, replyText: string): Promise<void> {
    for (const module of this.enabled()) {
      const fn = module.afterReply
      if (!fn) continue
      try {
        await fn(ctx, replyText)
      } catch (error) {
        console.error(`[FeatureRegistry] ${module.flagKey}.afterReply 失败（已吞掉）:`, error)
      }
    }
  }

  async runOnTimer(kind: 'daily_report' | 'follow_up', now: Date): Promise<void> {
    for (const module of this.enabled()) {
      const fn = module.onTimer
      if (!fn) continue
      try {
        await fn(kind, now)
      } catch (error) {
        console.error(`[FeatureRegistry] ${module.flagKey}.onTimer(${kind}) 失败（已吞掉）:`, error)
      }
    }
  }

  private async runEach(
    hook: 'beforeProvider' | 'afterProvider',
    ctx: FeatureHookContext
  ): Promise<void> {
    for (const module of this.enabled()) {
      const fn = module[hook]
      if (!fn) continue
      try {
        await fn(ctx)
      } catch (error) {
        console.error(`[FeatureRegistry] ${module.flagKey}.${hook} 失败（已吞掉）:`, error)
      }
    }
  }
}
