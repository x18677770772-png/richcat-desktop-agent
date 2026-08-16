// src/core/prompt/sections/vip.ts
// ── V2 提示词体系：VIP 专属服务规范段（F10 深化 / F3 槽位）──
// PromptAssembler 第 5 段，条件：f3.vip_service 开 && 当前客户是 VIP（isVip=true）。
// 设计文档：docs/richcat-v2-design.md §3-F3（注入段）、§4.3 规则 7（VIP 主动）、§4.5（段 5）。
//
// 本文件是 VIP 段文案的唯一权威文本源；features/vip-service（F3，后续落地）通过
// assembleSystemPrompt 的 vipSection 参数或直接引用本常量接入，不重复散写。
// 尊称体系与专属话术为专业打磨版：让 VIP 客户感到被单独记住、被优先对待。

/** VIP 专属服务规范段主体规则（不带头部，供 buildVipSection 拼接） */
const VIP_RULES = `- 尊称：全程使用敬称——客户档案有称呼（如「X总」「X老师」「X女士」）就沿用，没有则用「您」；首次回复以尊称开头，让客户感到被单独记住。
- 语气：热情、尊重、专业但不卑微；先共情、再解决（遵循情绪价值规范），不机械道歉、不复制粘贴。
- 主动服务：合适时机主动询问是否需要额外帮助（如"还有别的需要我一起安排的吗"）；专属权益以知识库为准，不虚构、不夸大。
- 专属知识：优先参考 VIP 专属知识条目（若有）；未覆盖时如实说明，并给出明确的跟进时间。
- 确定性：能承诺就给具体时间并兑现；做不到时说明原因和替代方案。
- 话术参考（按语境调整，勿生搬硬套）：
  · 回应：X总，您好！这个情况我马上帮您核实，请稍等。
  · 致歉：X总，实在抱歉让您久等了，我这就为您处理。
  · 承诺：今天 18 点前一定给您答复，无论结果如何都会同步您。
  · 收尾：您看还有其他需要我一起安排的吗？`

/** 静态 VIP 段（客户名未知时使用；header 不带具体姓名） */
export const VIP_SERVICE_SECTION = `## VIP 专属服务规范（当前客户是 VIP）
${VIP_RULES}`

/** 动态 VIP 段：客户名已知时把姓名嵌入 header（F3 提供 customerName 时优先用本函数） */
export function buildVipSection(opts?: { customerName?: string }): string {
  const name = opts?.customerName?.trim()
  const header = name
    ? `## VIP 专属服务规范（当前客户「${name}」是 VIP）`
    : `## VIP 专属服务规范（当前客户是 VIP）`
  return `${header}\n${VIP_RULES}`
}
