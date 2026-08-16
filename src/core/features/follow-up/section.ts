// src/core/features/follow-up/section.ts
// ── F7 待跟进承诺规则注入段（docs §3-F7 注入 prompt 段原文）──
// 由装配方在 f7 flag 开启时经 assembler 槽位 followUpSection 注入。

/** 待跟进承诺规则段（f7 开时插入） */
export function buildFollowUpSection(): string {
  return `## 待跟进承诺规则
- 当你承诺了后续动作（如"明天给您答复""稍后确认后回复"），在输出 JSON 中附加 followUp 字段：
  {"action": "具体承诺内容（含时间点）", "dueAt": "ISO 时间，缺省表示 24 小时内"}
- 仅当确实需要后续动作时才输出；一般咨询不需要。
- 输出 followUp 后，reply 中要明确告知客户会在何时回复（让客户安心）。`
}
