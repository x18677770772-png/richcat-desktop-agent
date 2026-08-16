// src/core/features/vip/section.ts
// ── F3 VIP 差异化服务：注入 prompt 段（专属语气/尊称）──
// 设计文档：docs/richcat-v2-design.md §3-F3（注入段原文）。
// 装配：装配方在 f3.vip_service 开启且当前客户是 VIP 时，把本段文本传入
// PromptAssembler 的 vipSection 槽位（src/core/prompt/assembler.ts 已预留
// f3 flag + isVip 场景双条件控制）；flag 关闭/非 VIP 时整段不出现（关闭零影响）。

/** VIP 专属服务规范注入段（F3 flag 开 + 当前客户是 VIP 时由 PromptAssembler 注入） */
export function buildVipSection(): string {
  return `## VIP 专属服务规范（当前客户是 VIP）
- 语气：热情、尊重、多用敬称（您/X总/X老师），体现专属感；不机械道歉，先共情再解决。
- 优先调用 VIP 专属知识（若有）；知识未覆盖时如实说明并承诺跟进，不搪塞。
- 主动服务：在合适时机询问是否需要额外帮助、告知专属权益（以知识库为准，不虚构）。
- 回复前请给出一句话的服务总结（summary），便于人工复核。`
}
