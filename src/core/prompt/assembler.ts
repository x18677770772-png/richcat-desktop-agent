// src/core/prompt/assembler.ts
// ── V2 提示词体系：PromptAssembler（C1 / F10）──
// 统一按固定顺序拼接 system prompt，禁止在业务代码里散写 prompt 文本。
// 设计文档：docs/richcat-v2-design.md §4.5（拼接顺序）、§4.6（接口）。
//
// 拼接顺序（14 段，身份与边界在前 → 功能识别规则居中 → 事实材料在后 → 格式收尾）：
//   1 base → 2 persona → 3 emotion-value → 4 group-chat(F1) → 5 vip(F3)
//   → 6 routing(F4) → 7 handoff(F2) → 8 emotion(F5) → 9 follow-up(F7)
//   → 10 knowledge → 11 customer → 12 memory → 13 image → 14 output-format
//
// 注入规则：
// - 段 1/3/14 由 f10.prompt_system 整体控制：f10 关 → 退化输出旧 prompt（V1 等价）；
// - 功能段（4-9）由各自 flag + 场景判定双条件控制，缺一不注入（连空段标记也不出现）；
// - 数据段（10-13）数据驱动：有内容才注入；
// - 段间以空行分隔，全程无重复段（配合 getSmartReply 的 appendOutputFormat=false）。

import { FeatureFlags } from '../features/flags'
import { BASE_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPT } from './base'
import { EMOTION_VALUE_SECTION } from './emotion-value'
import { buildOutputFormatSection } from './sections/output-format'

export interface AssembleOptions {
  /** 角色文本（persona.systemPrompt，若有；作为「角色段」原样插入基础模板之上，
   *  内置角色数据不动——设计决策，见 docs §3-F10） */
  personaPrompt?: string | null
  /** 知识库注入段（已格式化 markdown；F9 开时由 V2 提供） */
  knowledgeSection?: string
  /** 客户长期记忆注入段（已格式化 markdown） */
  customerSection?: string
  /** 经验卡片注入段（已格式化 markdown） */
  memorySection?: string
  /** 对方发来的图片内容描述（已由设备点开大图读取） */
  imageContext?: string
  /** 功能注入段（C1 骨架期预留槽位：各功能落地时由 features/<功能>/section.ts 提供文本；
   *  槽位未填充或 flag 未开时整段不出现） */
  groupChatSection?: string // F1 群聊规范段
  vipSection?: string // F3 VIP 服务规范段
  routingSection?: string // F4 多角色路由段
  handoffSection?: string // F2 转人工规则段
  emotionSection?: string // F5 情绪识别段
  followUpSection?: string // F7 待跟进规则段
  /** F3 场景判定：当前客户是 VIP */
  isVip?: boolean
  /** F4 场景判定：当前为多角色场景 */
  multiRole?: boolean
  /** 功能开关（features/flags.ts） */
  flags: FeatureFlags
}

/**
 * 拼接完整 system prompt。返回的文本已含输出格式段（第 14 段），
 * 调用方（LocalProvider）传给 getSmartReply 时必须置 appendOutputFormat=false 防重复。
 */
export function assembleSystemPrompt(opts: AssembleOptions): string {
  const { flags } = opts

  // f10.prompt_system 关闭 → 整体回退旧 prompt：旧基础模板 + 旧输出格式，无任何注入段
  if (!flags.isEnabled('f10.prompt_system')) {
    return [LEGACY_SYSTEM_PROMPT, buildOutputFormatSection(flags)].join('\n\n')
  }

  const sections: Array<string | null> = [
    // 1 身份与边界
    BASE_SYSTEM_PROMPT,
    // 2 角色附加规则（若有）
    opts.personaPrompt?.trim() || null,
    // 3 情绪价值规范（f10 开时注入）
    EMOTION_VALUE_SECTION,
    // 4-9 功能识别规则（flag + 场景双条件）
    flags.isEnabled('f1.group_chat') && opts.groupChatSection?.trim()
      ? opts.groupChatSection.trim()
      : null,
    flags.isEnabled('f3.vip_service') && opts.isVip && opts.vipSection?.trim()
      ? opts.vipSection.trim()
      : null,
    flags.isEnabled('f4.role_routing') && opts.multiRole && opts.routingSection?.trim()
      ? opts.routingSection.trim()
      : null,
    flags.isEnabled('f2.human_handoff') && opts.handoffSection?.trim()
      ? opts.handoffSection.trim()
      : null,
    flags.isEnabled('f5.emotion_risk') && opts.emotionSection?.trim()
      ? opts.emotionSection.trim()
      : null,
    flags.isEnabled('f7.follow_up') && opts.followUpSection?.trim()
      ? opts.followUpSection.trim()
      : null,
    // 10-13 事实材料（数据驱动）
    opts.knowledgeSection?.trim() || null,
    opts.customerSection?.trim() || null,
    opts.memorySection?.trim() || null,
    opts.imageContext?.trim()
      ? `## 对方刚发来的图片内容（AI 已点开大图读取，请结合图片内容理解并回复）\n${opts.imageContext.trim()}`
      : null,
    // 14 输出格式要求（总是）
    buildOutputFormatSection(flags)
  ]

  return sections.filter((section): section is string => !!section?.trim()).join('\n\n')
}
