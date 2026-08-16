// src/core/features/human-handoff/section.ts
// ── F2 转人工规则注入段（docs §3-F2 注入 prompt 段原文）──
// 由装配方在 f2 flag 开启时经 assembler 槽位 handoffSection 注入。

/** 转人工规则段（f2 开时插入） */
export function buildHandoffSection(): string {
  return `## 转人工规则
- 当客户出现以下任一情形时，在输出 JSON 中附加 handoff 字段（不要直接回复拒绝话术）：
  a) 明确要求"转人工/找真人/人工客服"
  b) 投诉、威胁差评/曝光
  c) 价格敏感：反复砍价、质疑报价、要求不可能的低价
  d) 情绪激烈升级（结合 emotion 字段）
- handoff 格式：{"reason": "explicit_human|complaint|price_sensitive", "confidence": 0.0-1.0}
- 触发 handoff 时 reply 可给出安抚过渡语（如"我马上为您转接人工，请稍等"），但不得继续承诺解决方案。`
}
