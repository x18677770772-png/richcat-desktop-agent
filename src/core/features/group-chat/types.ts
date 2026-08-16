// src/core/features/group-chat/types.ts
// ── F1 群聊支持：类型定义（模块边界，见 docs §3-F1）──
// GroupChatContext 的唯一事实来源在 src/core/session-types.ts（C2 独立 commit 定义），
// 此处 re-export 以保持模块目录形状与设计文档一致，避免重复定义导致漂移。
export type { GroupChatContext } from '../../session-types'
