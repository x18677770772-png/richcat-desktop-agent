// scripts/c1-prompt-smoke.ts
// C1 Prompt 体系骨架 — PromptAssembler 冒烟验证（docs §5 阶段 0 / F10 验收前置检查）
// 运行：npx ts-node --transpile-only scripts/c1-prompt-smoke.ts
// （Windows PowerShell 下如遇引号被吞，改用：
//   $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true}'
//   npx ts-node scripts/c1-prompt-smoke.ts）
//
// 断言：14 段拼接顺序、flag 控制（关闭零注入）、f10 关闭退化为 V1 旧 prompt、
//       output-format V2 可选字段随各自 flag 出现、无重复段、无空段残留。
import { FeatureFlags } from '../src/core/features/flags'
import { assembleSystemPrompt, OUTPUT_FORMAT_SECTION } from '../src/core/prompt'

function flagsOf(overrides: Record<string, boolean> = {}): FeatureFlags {
  return new FeatureFlags(() => overrides)
}

let failures = 0
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures++
}

function sectionNames(prompt: string): string[] {
  return prompt
    .split('\n\n')
    .map((b) => b.split('\n')[0])
    .filter((l) => l.startsWith('## '))
}

// 1) 全功能 flag 关（f10 开）：base → emotion-value → output-format，无 V2 可选字段
{
  const p = assembleSystemPrompt({
    flags: flagsOf({
      'f1.group_chat': false,
      'f2.human_handoff': false,
      'f3.vip_service': false,
      'f4.role_routing': false,
      'f5.emotion_risk': false,
      'f6.daily_report': false,
      'f7.follow_up': false,
      'f8.multi_instance': false,
      'f9.knowledge_v2': false,
      'f10.prompt_system': true
    })
  })
  const names = sectionNames(p)
  check('全关: 含财听猫基础模板', p.includes('你是「财听猫」智能客服'))
  check('全关: 含情绪价值规范', p.includes('先共情，再解决'))
  check('全关: 含输出格式', p.includes('## 输出格式（必须严格遵守）'))
  check(
    '全关: 顺序 base→emotion→output',
    names.indexOf('## 回复原则（专业感 + 人感 + 情绪价值）') <
      names.indexOf('## 情绪价值规范（重要）') &&
      names.indexOf('## 情绪价值规范（重要）') < names.indexOf('## 输出格式（必须严格遵守）'),
    JSON.stringify(names)
  )
  check('全关: 无 V2 可选字段', !p.includes('messageKind') && !p.includes('followUp') && !p.includes('routeTo'), '')
  check('全关: 无知识/客户/记忆段', !p.includes('## 知识库') && !p.includes('## 客户'), '')
}

// 1b) 默认 flag（f2/f5/f7 默认开）：output-format 含 emotion/handoff/followUp，f1/f4 字段名不出现
{
  const p = assembleSystemPrompt({ flags: flagsOf() })
  check('默认: V2 字段随各自 flag 出现', p.includes('emotion') && p.includes('handoff') && p.includes('followUp'), '')
  check('默认: f1/f4 关闭时无 messageKind/routeTo', !p.includes('messageKind') && !p.includes('routeTo'), '')
}

// 2) f10 关：退化旧 prompt（LEGACY + V1 输出格式），无情绪价值段
{
  const p = assembleSystemPrompt({ flags: flagsOf({ 'f10.prompt_system': false }) })
  check('f10关: 用 V1 旧模板', p.includes('你是一个微信自动回复助手'))
  check('f10关: 无财听猫新模板', !p.includes('你是「财听猫」'))
  check('f10关: 无情绪价值段', !p.includes('先共情，再解决'))
  check('f10关: 输出格式与 V1 一致', p.includes(OUTPUT_FORMAT_SECTION))
  check('f10关: 无 V2 可选字段', !p.includes('messageKind') && !p.includes('emotion'), '')
}

// 3) 全功能开 + 全部数据段：14 段顺序正确、无重复
{
  const p = assembleSystemPrompt({
    flags: flagsOf({
      'f1.group_chat': true,
      'f2.human_handoff': true,
      'f3.vip_service': true,
      'f4.role_routing': true,
      'f5.emotion_risk': true,
      'f7.follow_up': true
    }),
    personaPrompt: '## 角色附加规则\n你是一位资深医学专家。',
    knowledgeSection: '## 知识库\n1. 【产品】支持 7 天无理由退换。',
    customerSection: '## 客户记忆\n客户王女士，VIP，偏好下午联系。',
    memorySection: '## 团队经验\n1. 【退款】优先安抚再核实。',
    imageContext: '图片中是商品外包装破损。',
    groupChatSection: '## 群聊规范\n- 仅 @ 机器人时回复。',
    vipSection: '## VIP 专属服务规范\n- 称呼「王总」。',
    routingSection: '## 多角色路由规则\n- 医学问题转医学专家。',
    handoffSection: '## 转人工规则\n- 投诉时输出 handoff。',
    emotionSection: '## 情绪识别规则\n- 愤怒时输出 emotion。',
    followUpSection: '## 待跟进承诺规则\n- 承诺时输出 followUp。',
    isVip: true,
    multiRole: true
  })
  const names = sectionNames(p)
  const order = [
    '## 回复原则（专业感 + 人感 + 情绪价值）', // base 内段
    '## 角色附加规则',
    '## 情绪价值规范（重要）',
    '## 群聊规范',
    '## VIP 专属服务规范',
    '## 多角色路由规则',
    '## 转人工规则',
    '## 情绪识别规则',
    '## 待跟进承诺规则',
    '## 知识库',
    '## 客户记忆',
    '## 团队经验',
    '## 对方刚发来的图片内容（AI 已点开大图读取，请结合图片内容理解并回复）',
    '## 输出格式（必须严格遵守）'
  ]
  const idx = order.map((s) => names.indexOf(s))
  const strictlyOrdered = idx.every((v, i) => v !== -1 && (i === 0 || v > idx[i - 1]))
  check('全开: 14 段全部出现且顺序正确', strictlyOrdered, JSON.stringify(names))
  check('全开: 段无重复', new Set(names).size === names.length)
  check(
    '全开: 输出格式含 V2 可选字段',
    p.includes('messageKind') && p.includes('handoff') && p.includes('routeTo') && p.includes('followUp') && p.includes('emotion'),
    ''
  )
  check('全开: 图片段含上下文', p.includes('商品外包装破损'))
}

// 4) 功能 flag + 场景双条件：vip 段仅在 isVip 时出现；群聊段仅在 flag 开时出现
{
  const p1 = assembleSystemPrompt({
    flags: flagsOf({ 'f3.vip_service': true }),
    vipSection: '## VIP 专属服务规范\n- 专属。',
    isVip: false
  })
  check('非VIP: 不注入 vip 段', !p1.includes('## VIP 专属服务规范'))
  const p2 = assembleSystemPrompt({
    flags: flagsOf({ 'f3.vip_service': true }),
    vipSection: '## VIP 专属服务规范\n- 专属。',
    isVip: true
  })
  check('VIP: 注入 vip 段', p2.includes('## VIP 专属服务规范'))
  const p3 = assembleSystemPrompt({
    flags: flagsOf({ 'f1.group_chat': false }),
    groupChatSection: '## 群聊规范\n- 群聊。'
  })
  check('f1关: 不注入群聊段', !p3.includes('## 群聊规范'))
}

// 5) 双条件：flag 开但未提供 section 文本 → 整段不出现（连空行也没有）
{
  const p = assembleSystemPrompt({ flags: flagsOf({ 'f1.group_chat': true }) })
  check('f1开无文本: 无空段残留', !p.includes('\n\n\n'))
  // base 内部有 3 个 ## 标题（任务/回复原则/防自我循环）+ 情绪价值 + 输出格式 = 5
  check('f1开无文本: 仅 base+emotion+output 三段', sectionNames(p).length === 5, JSON.stringify(sectionNames(p)))
}

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`)
process.exit(failures === 0 ? 0 : 1)
