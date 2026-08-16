// src/core/features/group-chat/index.ts
// ── F1 群聊支持：FeatureModule 装配（后置过滤 + 段构建）──
// 设计文档：docs/richcat-v2-design.md §3-F1。
//
// 关键设计：
// - 回复策略双保险：① 提示词要求（section.ts 注入段，f1 开且 isGroup 时注入）；
//   ② 后置过滤（本文件纯函数，模型漏判兜底——messageKind 或检测结果明确非对话时强制 reply=null）。
// - flag 关闭零影响：本模块只定义逻辑与工厂；是否调用由装配方按 f1.group_chat 开关控制。
//   过滤函数在 groupChat 为 undefined（flag 关 → 装配方不注入）时原样返回 result（V1 行为）。
// - 回滚：本目录为 F1 独立 commit；revert 后 groupChat 不再注入、过滤不再生效，
//   C2 的 groupChat/messageKind 字段（类型+解析）仍保留，行为退化为 V1。
// - 纯函数可单测：applyGroupChatReplyFilter / applyNonConversationFilter / createGroupChatFeature。

import { SmartReplyResult } from '../../ai-client'
import { GroupChatContext } from '../../session-types'
import { FeatureFlagKey } from '../flags'
import { buildGroupChatSection } from './section'

export { buildGroupChatSection } from './section'
export { GroupChatDetector, GROUP_CHAT_PROMPT, parseGroupChatJson } from './detect'
export type { GroupChatDetectorOptions } from './detect'
export type { GroupChatContext } from '../../session-types'

export const GROUP_CHAT_FLAG_KEY: FeatureFlagKey = 'f1.group_chat'

/**
 * 后置过滤（docs §3-F1 回复策略 2）：群聊中模型判定本条消息归属为
 * 其他群成员/角色消息/系统消息 → 强制将 reply 置 null（不发送）。
 * 单聊或 groupChat 缺失（flag 关）→ 原样返回，行为与 V1 一致。
 */
export function applyGroupChatReplyFilter(
  result: SmartReplyResult,
  groupChat: GroupChatContext | undefined
): SmartReplyResult {
  if (!groupChat?.isGroup) return result
  const kind = result.messageKind
  if (kind === 'group_member' || kind === 'role_message' || kind === 'system') {
    return { ...result, reply: null }
  }
  return result
}

/**
 * 确定性过滤：群聊中检测器识别到最后一条消息为非对话类型
 * （群公告 / 红包 / 系统消息）→ 一律不回复（docs §3-F1 目标与验收 2d）。
 * 该规则不依赖模型输出，作为提示词之外的硬性兜底。
 */
export function applyNonConversationFilter(
  result: SmartReplyResult,
  groupChat: GroupChatContext | undefined
): SmartReplyResult {
  if (!groupChat?.isGroup) return result
  const kind = groupChat.lastMessageKind
  if (kind === 'announcement' || kind === 'red_packet' || kind === 'system') {
    return { ...result, reply: null }
  }
  return result
}

/** F1 特征模块（形状与 f5 的 EmotionRiskFeatureModule 对齐：flagKey + 动作函数集合） */
export interface GroupChatFeatureModule {
  flagKey: FeatureFlagKey
  /** 群聊规范注入段（非群聊返回空串） */
  buildSection(ctx: GroupChatContext | undefined): string
  /** 后置过滤：模型漏判/非对话消息兜底（groupChat 缺失时原样返回） */
  filterResult(result: SmartReplyResult, groupChat: GroupChatContext | undefined): SmartReplyResult
}

export function createGroupChatFeature(): GroupChatFeatureModule {
  return {
    flagKey: 'f1.group_chat',
    buildSection: buildGroupChatSection,
    filterResult(result, groupChat) {
      // 先确定性过滤（非对话类型），再按 messageKind 过滤（模型漏判兜底）
      return applyGroupChatReplyFilter(applyNonConversationFilter(result, groupChat), groupChat)
    }
  }
}
