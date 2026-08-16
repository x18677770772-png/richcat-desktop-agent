// src/core/prompt/sections/output-format.ts
// ── V2 提示词体系：JSON 输出格式段（C1 / F10）──
// PromptAssembler 第 14 段（收尾），总是注入。
// 设计文档：docs/richcat-v2-design.md §4.4 / §4.5（行 894、912）。
//
// V1 兼容保证：
// - OUTPUT_FORMAT_SECTION 与 ai-client.ts getSmartReply 内联的输出格式段逐字一致；
// - buildOutputFormatSection(flags) 在 f10 关闭（或对应功能 flag 关闭）时不输出任何
//   V2 可选字段描述 —— flag 关 = 输出与 V1 完全一致（docs §2.3「关闭时零影响」）。

import { FeatureFlags } from '../../features/flags'

/** V1 输出格式段（与 ai-client.ts getSmartReply 内联文本一致；f10 关或功能关时原样使用） */
export const OUTPUT_FORMAT_SECTION = `## 输出格式（必须严格遵守）
以 JSON 格式输出，不要输出任何其他内容：
{"contact": "当前对话的联系人名称", "reply": "你的回复内容", "summary": "本轮对话一句话摘要"}
- contact：从截图顶部（对话窗口标题栏 / 联系人名称区域，通常在消息区上方）识别当前对话的联系人名称（昵称或备注名）；无法识别时填 null
- reply：你的回复；如果按规则不需要回复，填 null（等价于 [SKIP]）
- summary：本轮对话的一句话摘要（客户说了什么、你如何处理），用于客户长期记忆；reply 为 null 时也尽量填写，实在无法判断可填 null`

/**
 * 按功能开关生成输出格式段：
 * - f10 关闭 → 仅 V1 文本（整体回退旧 prompt）；
 * - f10 开启 → V1 文本 + V2 可选字段说明，每个字段由对应功能 flag 独立控制
 *   （F1→messageKind、F5→emotion、F2→handoff、F4→routeTo、F7→followUp）。
 * 全部 V2 字段均为可选（"无法判断可不输出"），旧模型照常只输出三字段，兼容不变。
 */
export function buildOutputFormatSection(flags: FeatureFlags): string {
  if (!flags.isEnabled('f10.prompt_system')) {
    return OUTPUT_FORMAT_SECTION
  }

  // 每个 V2 可选字段由对应功能 flag 独立控制；关闭的功能连字段名都不出现
  // （docs §2.3「关闭时零影响」：不注入 prompt，连空段标记也不出现）。
  const enabled: Array<{ name: string; line: string }> = []
  if (flags.isEnabled('f1.group_chat')) {
    enabled.push({
      name: 'messageKind',
      line: '- （可选）messageKind：本条消息的归属，仅群聊时输出：customer=客户本人 / group_member=其他群成员 / role_message=群内角色消息 / system=系统消息'
    })
  }
  if (flags.isEnabled('f5.emotion_risk')) {
    enabled.push({
      name: 'emotion',
      line: '- （可选）emotion：客户情绪，格式 {"sentiment": "positive|neutral|negative|angry", "risk": "refund_intent|complaint|urgent|none", "confidence": 0-1}；情绪明显时输出，平静或无法判断可不输出'
    })
  }
  if (flags.isEnabled('f2.human_handoff')) {
    enabled.push({
      name: 'handoff',
      line: '- （可选）handoff：出现转人工/投诉/价格敏感情形时输出，格式 {"reason": "explicit_human|complaint|price_sensitive", "confidence": 0-1}；未触发不输出'
    })
  }
  if (flags.isEnabled('f4.role_routing')) {
    enabled.push({
      name: 'routeTo',
      line: '- （可选）routeTo：本条消息明显更适合其他角色回答时输出，格式 {"personaId": "目标角色id", "reason": "原因", "confidence": 0-1}；普通消息不输出'
    })
  }
  if (flags.isEnabled('f7.follow_up')) {
    enabled.push({
      name: 'followUp',
      line: '- （可选）followUp：做出具体时间承诺时输出，格式 {"action": "承诺要做的事", "dueAt": "ISO时间，如 2025-01-01T18:00:00+08:00"}；未承诺不输出'
    })
  }

  if (enabled.length === 0) {
    return OUTPUT_FORMAT_SECTION
  }

  const names = enabled.map((item) => item.name).join('/')
  return `${OUTPUT_FORMAT_SECTION}
- （说明）以上 contact/reply/summary 为必填；${names} 均为可选字段，无法判断就省略，绝不要编造。
${enabled.map((item) => item.line).join('\n')}`
}
