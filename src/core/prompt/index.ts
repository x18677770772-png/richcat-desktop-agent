// src/core/prompt/index.ts
// ── V2 提示词体系：统一导出（C1 / F10）──
// 业务代码一律从本入口引用 prompt 常量/函数，禁止散写 prompt 文本。
// 设计文档：docs/richcat-v2-design.md §4 / §5 阶段 0（C1）。

export { assembleSystemPrompt, type AssembleOptions } from './assembler'
export { BASE_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPT } from './base'
export { EMOTION_VALUE_SECTION } from './emotion-value'
export { OUTPUT_FORMAT_SECTION, buildOutputFormatSection } from './sections/output-format'
