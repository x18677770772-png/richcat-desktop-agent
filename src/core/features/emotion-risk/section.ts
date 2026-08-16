// src/core/features/emotion-risk/section.ts
// ── F5 情绪/风险识别：注入 prompt 段 ──
// 要求模型在同一次 getSmartReply 输出中附加 emotion 字段（零额外 VLM/LLM 调用）。
// 设计文档：docs/richcat-v2-design.md §3-F5（注入段原文）。
// 装配：本段文本由装配方在 f5.emotion_risk 开启时传给 PromptAssembler 的
// emotionSection 槽位（src/core/prompt/assembler.ts 已预留，flag+文本双条件控制）；
// flag 关闭或未注入时该段整段不出现（关闭零影响）。

/** 情绪识别规则注入段（F5 flag 开启时由 PromptAssembler 注入） */
export function buildEmotionSection(): string {
  return `## 情绪识别规则
- 分析最后一条客户消息的情绪，在输出 JSON 中附加 emotion 字段：
  {"sentiment": "positive|neutral|negative|angry", "risk": "refund_intent|complaint|urgent|none", "confidence": 0-1}
- 没有明显情绪倾向时输出 {"sentiment":"neutral","risk":"none","confidence":0.5}
- 情绪识别不影响 reply 生成，两者独立判断。`
}
