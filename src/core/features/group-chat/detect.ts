// src/core/features/group-chat/detect.ts
// ── F1 群聊检测器（GroupChatDetector）──
// 设计文档：docs/richcat-v2-design.md §3-F1。
//
// 两种检测方式（配置选择）：
// 1. VLM 一次调用（默认）：ai.detectVision(GROUP_CHAT_PROMPT, screenshot) → JSON，容错解析；
// 2. 纯 @ 触发（mentionOnly=true，零检测成本）：跳过 VLM，默认 isGroup=true, isMentioned=true，
//    回复与否完全交给提示词规则（模型必须确认被 @ 或发送者是已知客户才回复）。
//
// 失败语义：任何异常/解析失败都返回 { isGroup:false, ... }（按单聊处理），
// 绝不抛错、绝不阻塞主链路（flag 关闭时装配方根本不调用 detect）。

import { AIClient } from '../../ai-client'
import { GroupChatContext } from '../../session-types'

export interface GroupChatDetectorOptions {
  /** 机器人昵称列表（用于 @ 匹配提示与自我消息判定） */
  botNames: string[]
  /** 纯 @ 触发模式：跳过 VLM 检测（零检测成本） */
  mentionOnly?: boolean
}

/** VLM 群聊检测 prompt（组装时注入机器人昵称列表） */
export const GROUP_CHAT_PROMPT = `分析这张聊天窗口截图，判断是否群聊，并识别最后一条消息的发送者。严格输出 JSON，不要输出其他内容：
{"isGroup": true或false, "groupName": "群聊名称，无法识别为null", "lastSender": "最后一条消息发送者的昵称/备注，无法识别为null", "isMentioned": true或false, "lastMessageKind": "text|image|system|red_packet|announcement|unknown"}

判定规则：
- isGroup：聊天窗口顶部标题显示群聊特征（群名、群成员数、群聊标识），或消息区内出现多个不同昵称的发言者 → true；单人聊天 → false。
- lastSender：消息区最底部（最后一条）对话气泡的发送者昵称；若最后一条是右侧自己发送的气泡，则填自己的昵称（机器人昵称）。
- isMentioned：最后一条消息是否 @ 了机器人（@后跟机器人昵称），或明确提到机器人昵称。机器人昵称列表：<BOT_NAMES>。消息不含 @ 且未提到机器人昵称 → false。
- lastMessageKind：最后一条消息的类型：普通文本→text；图片→image；系统提示/撤回/拍一拍→system；红包/转账→red_packet；群公告→announcement；无法判断→unknown。`

export class GroupChatDetector {
  constructor(
    private readonly ai: AIClient,
    private readonly opts: GroupChatDetectorOptions
  ) {}

  /**
   * 截图 → 群聊上下文；任何失败返回 { isGroup:false } 且不抛错（不阻塞主链路）。
   * flag 关闭时装配方不得调用本方法（零影响由装配方保证）。
   */
  async detect(screenshot: string): Promise<GroupChatContext> {
    try {
      // 纯 @ 触发模式：零 VLM 调用
      if (this.opts.mentionOnly) {
        return { isGroup: true, lastSender: null, isMentioned: true, lastMessageKind: 'unknown' }
      }

      const botNames = (this.opts.botNames ?? []).filter((name) => name.trim().length > 0)
      const prompt = GROUP_CHAT_PROMPT.replace(
        '<BOT_NAMES>',
        botNames.length > 0 ? botNames.join('、') : '（未配置，按"@我/提到机器人昵称"判断）'
      )
      const raw = await this.ai.detectVision(prompt, screenshot)
      const parsed = parseGroupChatJson(raw)
      if (parsed) {
        console.log(
          `[GroupChatDetector] isGroup=${parsed.isGroup}${parsed.isGroup ? ` group=${parsed.groupName ?? '?'} lastSender=${parsed.lastSender ?? '?'} mentioned=${parsed.isMentioned} kind=${parsed.lastMessageKind}` : ''}`
        )
        return parsed
      }
      console.warn('[GroupChatDetector] 检测输出无法解析，按单聊处理:', raw.slice(0, 200))
      return { isGroup: false, lastSender: null, isMentioned: false, lastMessageKind: 'unknown' }
    } catch (error: unknown) {
      console.error('[GroupChatDetector] 群聊检测失败（按单聊处理，不阻塞主链路）:', error)
      return { isGroup: false, lastSender: null, isMentioned: false, lastMessageKind: 'unknown' }
    }
  }
}

/**
 * 容错解析群聊检测 JSON（去掉 markdown 围栏、取第一个 {...} 块、字段级校验）。
 * - isGroup 缺失/非布尔 → null（由调用方按单聊处理）；
 * - 其余字段缺失/非法 → 各自默认值。
 * 导出以便单测。
 */
export function parseGroupChatJson(raw: string): GroupChatContext | null {
  if (!raw || typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const match = withoutFence.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    const obj = JSON.parse(match[0])
    if (!obj || typeof obj !== 'object') return null
    const rawObj = obj as Record<string, unknown>
    if (typeof rawObj.isGroup !== 'boolean') return null

    const kindValue = rawObj.lastMessageKind
    const lastMessageKind: GroupChatContext['lastMessageKind'] =
      kindValue === 'text' ||
      kindValue === 'image' ||
      kindValue === 'system' ||
      kindValue === 'red_packet' ||
      kindValue === 'announcement' ||
      kindValue === 'unknown'
        ? kindValue
        : 'unknown'

    return {
      isGroup: rawObj.isGroup,
      groupName:
        typeof rawObj.groupName === 'string' && rawObj.groupName.trim()
          ? rawObj.groupName.trim()
          : undefined,
      lastSender:
        typeof rawObj.lastSender === 'string' && rawObj.lastSender.trim()
          ? rawObj.lastSender.trim()
          : null,
      isMentioned: typeof rawObj.isMentioned === 'boolean' ? rawObj.isMentioned : false,
      lastMessageKind
    }
  } catch {
    return null
  }
}
