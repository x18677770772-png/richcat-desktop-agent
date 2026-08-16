// src/core/features/knowledge-v2/types.ts
// ── F9 知识库深度优化：类型定义 ──
// 设计文档：docs/richcat-v2-design.md §3-F9。
// KnowledgeItem 的 V2 扩展字段（category/weight/scope）在 knowledge-store.ts 定义（可选、旧数据兼容），
// 本文件只定义注入策略相关的上下文类型。

/** F9 注入上下文：由各功能场景填充（F3 填 isVip；F1 填 isGroup）；未填充=undefined → 不触发对应 scope 过滤 */
export interface KnowledgeInjectionContext {
  /** 当前客户是 VIP（F3 判定结果） */
  isVip?: boolean
  /** 当前会话是群聊（F1 判定结果） */
  isGroup?: boolean
  /**
   * 消息原文关键词（可选增强 f9.useKeywordMatch）。
   * 当前截图链路无消息原文，OCR 接入前保持 undefined → 不走关键词检索；
   * 提供后按标题/标签/正文白名单打分挑选。
   */
  keywords?: string[]
}

/** F9 注入策略选项 */
export interface KnowledgeInjectionOptions {
  /** 条数上限（默认 KNOWLEDGE_INJECTION_LIMIT=30） */
  limit?: number
  /** f9.useKeywordMatch：启用关键词检索（默认 false；OCR 接入后启用） */
  useKeywordMatch?: boolean
}
