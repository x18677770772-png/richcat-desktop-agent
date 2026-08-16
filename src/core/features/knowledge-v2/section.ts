// src/core/features/knowledge-v2/section.ts
// ── F9 知识库深度优化：注入段（复用 prompt/ 的权威文本源）──
// 设计文档：docs/richcat-v2-design.md §3-F9（注入 prompt 段）。
// 文本唯一权威源：src/core/prompt/sections/knowledge.ts（§4.1 禁止散写 prompt 文本）。

export { buildKnowledgeV2Section } from '../../prompt/sections/knowledge'
