// src/core/prompt/index.ts
// ── V2 提示词体系：统一导出（C1 / F10）──
// 业务代码一律从本入口引用 prompt 常量/函数，禁止散写 prompt 文本。
// 设计文档：docs/richcat-v2-design.md §4 / §5（C1 骨架 + F9/F10 深化）。

export { assembleSystemPrompt, type AssembleOptions } from './assembler'
export { BASE_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPT } from './base'
export { EMOTION_VALUE_SECTION } from './emotion-value'
export { OUTPUT_FORMAT_SECTION, buildOutputFormatSection } from './sections/output-format'
export { VIP_SERVICE_SECTION, buildVipSection } from './sections/vip'
export { buildKnowledgeV2Section } from './sections/knowledge'
