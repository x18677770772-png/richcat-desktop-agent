// src/core/prompt/sections/knowledge.ts
// ── V2 提示词体系：知识库注入段（F9）──
// PromptAssembler 第 10 段（知识库），数据驱动：有条目才注入。
// 设计文档：docs/richcat-v2-design.md §3-F9（注入段格式）、§4.4（段 10）。
//
// 本文件是知识库段的唯一权威文本源（V2 紧凑格式）；features/knowledge-v2/section.ts
// 从这里 re-export，避免业务模块散写 prompt 文本（§4.1）。
// V1 旧格式（buildKnowledgeSection）仍在 ai-client.ts 供 f9 关闭时使用，F10 收尾统一。

/** V2 知识库段格式：条目按优先级排列，带分类标签，紧凑单行 */
export function buildKnowledgeV2Section(
  items: Array<{
    title: string
    content: string
    category?: string
    weight?: number
  }>
): string {
  if (!items || items.length === 0) return ''
  const lines = items.map((item) => {
    // 优先级系数 = weight/50（weight 0-100 → 0-2.0，默认 50 → 1.0），越大越优先
    const priority = ((item.weight ?? 50) / 50).toFixed(1)
    const category = item.category?.trim() ? `【${item.category.trim()}】` : ''
    return `[${priority} 优先级]${category}${item.title}：${item.content}`
  })
  return `## 知识库（按优先级排列，回答以此为准；知识库未覆盖时如实说明）
${lines.join('\n')}
（条目按优先级排列，靠前的优先参考；知识库未覆盖时如实说明，不编造。）`
}
