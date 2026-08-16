// src/core/features/role-routing/section.ts
// ── F4 多角色消息路由：路由提示段（问题分类 → 角色 + 交接话术）──
// 设计文档：docs/richcat-v2-design.md §3-F4（注入 prompt 段原文打磨）。
// PromptAssembler 第 6 段（routing），条件：f4.role_routing 开 && multiRole 场景
// （群聊且有 ≥2 个可路由角色）；无可路由角色时返回空串（装配方据此跳过，连空段标记也不出现）。
//
// 分类维度（销售/售后/专家/普通）：由各 persona 的 routingDomains 声明问题域；
// "普通"= 不属于任何角色域/模糊问题 → 不输出 routeTo（归当前默认角色）。

import { Persona } from '../../persona/persona-store'

/** 生成多角色路由规则段；无可路由角色返回空串 */
export function buildRoutingSection(personas: Persona[]): string {
  const routable = personas.filter((p) => p.enabled && p.routable !== false)
  if (routable.length === 0) return ''

  const roles = routable
    .map((p) => {
      const domains = p.routingDomains?.length
        ? p.routingDomains.join('、')
        : p.description || '通用咨询'
      return `- ${p.name}（personaId=${p.personaId}）：${domains}`
    })
    .join('\n')

  return `## 多角色路由规则
本会话由多个服务角色共同服务，当前可用角色：
${roles}
规则：
1. 先判断本条消息属于哪个角色的问题域，在输出 JSON 中附加 routeTo：{"personaId":"...","reason":"...","confidence":0-1}
2. 只有 confidence>=0.6 才给 routeTo；不属于任何角色域/模糊问题归当前默认角色（不输出 routeTo）
3. 角色间对话（member→member）输出 messageKind="role_message" 且 reply:null
4. routeTo 与 reply 可同时输出：reply 先按"通用客服"口吻写，路由成功后按目标角色重写
5. 路由成功后的正式回复，可带一句自然的交接说明（如"这个问题我请${routable[0].name}为您详细解答"），随后以目标角色口吻作答；交接句要自然，不机械。`
}
