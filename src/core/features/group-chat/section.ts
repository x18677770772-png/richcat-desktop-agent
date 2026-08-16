// src/core/features/group-chat/section.ts
// ── F1 群聊规范注入段（docs §3-F1 注入 prompt 段原文）──
// 仅当群聊场景（isGroup=true）且 f1 flag 开启时由装配方注入（assembler 槽位 groupChatSection）。

import { GroupChatContext } from '../../session-types'

/** 生成群聊规范段；非群聊返回空串（装配方据此跳过注入，连空段标记也不出现） */
export function buildGroupChatSection(ctx: GroupChatContext | undefined): string {
  if (!ctx?.isGroup) return ''
  return `## 群聊规范（当前是群聊）
- 你只服务"客户本人"（群主/提问者/客户档案中存在的联系人）。
- 仅当：① 最后一条消息 @ 了你（机器人昵称），或 ② 发送者是客户档案中的联系人，才回复。
- 其他群成员消息、成员之间对话、群公告、红包、转账、系统消息一律输出 reply:null（不回复）。
- 回复时称呼对方群昵称，语气保持群聊场景的自然口语。`
}
