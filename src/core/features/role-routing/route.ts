// src/core/features/role-routing/route.ts
// ── F4 多角色消息路由：RoleRouter（routeTo → 目标 persona 选择）──
// 设计文档：docs/richcat-v2-design.md §3-F4。
//
// 职责：把模型输出的 routeTo.personaId 解析为可用的目标角色；
// 校验链路：personaId 存在 → 角色 enabled → routable !== false → confidence >= minConfidence。
// 任何一步不满足 → null（保持当前角色/通用客服，不路由）。
// 纯逻辑无副作用，便于单测。

import { Persona } from '../../persona/persona-store'

/** 路由触发的最低置信度（docs §3-F4 规则 2：只有 confidence>=0.6 才给 routeTo） */
export const ROUTING_MIN_CONFIDENCE = 0.6

export interface RoleRoutingConfig {
  minConfidence?: number
}

/** 模型输出的路由信号（SmartReplyResult.routeTo 子集） */
export interface RouteToSignal {
  personaId: string
  reason?: string
  confidence?: number
}

export class RoleRouter {
  constructor(
    private readonly personas: Persona[],
    private readonly config: RoleRoutingConfig = {}
  ) {}

  /** 参与路由的角色（enabled 且 routable !== false）；F4 场景判定与路由段共用 */
  getRoutablePersonas(): Persona[] {
    return this.personas.filter((persona) => persona.enabled && persona.routable !== false)
  }

  /**
   * 解析路由目标：personaId 存在且该角色可路由、置信度达标 → 返回该角色；否则 null。
   * - personaId 未命中 / 角色禁用 / routable=false / confidence < 阈值 → null（不路由）；
   * - confidence 缺失按 0 处理（模型未给置信度时不路由，保持默认角色——保守策略）。
   */
  resolve(signal: RouteToSignal | null | undefined): Persona | null {
    if (!signal || typeof signal.personaId !== 'string' || !signal.personaId.trim()) {
      return null
    }
    const confidence = typeof signal.confidence === 'number' ? signal.confidence : 0
    const min = this.config.minConfidence ?? ROUTING_MIN_CONFIDENCE
    if (confidence < min) return null

    const persona = this.personas.find(
      (p) => p.personaId === signal.personaId && p.enabled && p.routable !== false
    )
    return persona ?? null
  }
}
