// scripts/f4-routing-smoke.ts
// F4 多角色消息路由 — 冒烟验证（docs §3-F4 验收标准前置检查）
// 运行：npx ts-node --transpile-only scripts/f4-routing-smoke.ts
// （Windows PowerShell 引号被吞时改用 env 方式，见 scripts/c1-prompt-smoke.ts 头注释）
//
// 断言：RoleRouter 校验链路、路由段生成、beforeProvider 场景判定（群聊+≥2 可路由角色）、
//       afterProvider 二次生成/回退、role_message 不掺和、flag 关零影响、assembler 槽位顺序。
import os from 'node:os'
import path from 'node:path'
import { FeatureFlags } from '../src/core/features/flags'
import { Persona, PersonaStore } from '../src/core/persona/persona-store'
import { SmartReplyResult } from '../src/core/ai-client'
import { ProviderInput } from '../src/core/session-types'
import {
  RoleRouter,
  buildRoutingSection,
  handleRoutingBeforeProvider,
  applyRoleRouting
} from '../src/core/features/role-routing'
import { assembleSystemPrompt } from '../src/core/prompt'

function flagsOf(overrides: Record<string, boolean> = {}): FeatureFlags {
  return new FeatureFlags(() => overrides)
}

let failures = 0
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures++
}

const SALES: Persona = {
  personaId: 'p-sales',
  name: '销售顾问',
  description: '产品顾问',
  systemPrompt: '你是一位销售顾问。\n## 规则\n回答要热情。',
  source: 'custom',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  routingDomains: ['产品咨询', '报价', '下单']
}
const AFTER_SALES: Persona = {
  personaId: 'p-aftersales',
  name: '售后客服',
  description: '退换货与物流',
  systemPrompt: '你是一位售后客服。\n## 规则\n先安抚再处理。',
  source: 'custom',
  enabled: true,
  createdAt: 2,
  updatedAt: 2,
  routingDomains: ['退换货', '物流', '售后']
}
const EXPERT: Persona = {
  personaId: 'p-expert',
  name: '专家',
  description: '专业咨询',
  systemPrompt: '你是一位专家。\n## 规则\n严谨回答。',
  source: 'custom',
  enabled: true,
  createdAt: 3,
  updatedAt: 3,
  routingDomains: ['专业咨询']
}
const NO_ROUTE: Persona = {
  personaId: 'p-no-route',
  name: '不参与路由',
  description: '内部角色',
  systemPrompt: '内部。',
  source: 'custom',
  enabled: true,
  createdAt: 4,
  updatedAt: 4,
  routable: false
}
const LEGACY: Persona = {
  personaId: 'p-legacy',
  name: '旧数据角色',
  description: '无新字段',
  systemPrompt: '旧。',
  source: 'custom',
  enabled: true,
  createdAt: 5,
  updatedAt: 5
}

// ── 1) RoleRouter 校验链路 ──
{
  const router = new RoleRouter([SALES, AFTER_SALES, EXPERT, NO_ROUTE, LEGACY])
  check('路由: 合法 personaId + 高置信度 → 命中', router.resolve({ personaId: 'p-aftersales', confidence: 0.9 })?.name === '售后客服')
  check('路由: 置信度低于 0.6 → 不路由', router.resolve({ personaId: 'p-sales', confidence: 0.5 }) === null)
  check('路由: 未知 personaId → 不路由', router.resolve({ personaId: 'p-none', confidence: 0.9 }) === null)
  check('路由: routable=false → 不路由', router.resolve({ personaId: 'p-no-route', confidence: 0.9 }) === null)
  check('路由: 缺失 confidence → 不路由（保守）', router.resolve({ personaId: 'p-sales' }) === null)
  check('路由: 旧数据（routable 缺省）→ 可路由', router.resolve({ personaId: 'p-legacy', confidence: 0.8 })?.personaId === 'p-legacy')
  const disabled = new RoleRouter([{ ...SALES, enabled: false }])
  check('路由: 禁用角色 → 不路由', disabled.resolve({ personaId: 'p-sales', confidence: 0.9 }) === null)
  const min8 = new RoleRouter([SALES], { minConfidence: 0.8 })
  check('路由: 自定义阈值 0.8 → 0.7 不路由', min8.resolve({ personaId: 'p-sales', confidence: 0.7 }) === null)
}

// ── 2) getRoutablePersonas / buildRoutingSection ──
{
  const router = new RoleRouter([SALES, NO_ROUTE, LEGACY])
  const routable = router.getRoutablePersonas()
  check('角色清单: 过滤 routable=false，保留旧数据', routable.length === 2 && !routable.some((p) => p.personaId === 'p-no-route'), routable.map((p) => p.personaId).join(','))
  const section = buildRoutingSection([SALES, AFTER_SALES, EXPERT, NO_ROUTE])
  check('路由段: 列出可用角色与问题域', section.includes('销售顾问（personaId=p-sales）') && section.includes('产品咨询、报价、下单') && !section.includes('p-no-route'))
  check('路由段: 含规则与交接话术', section.includes('confidence>=0.6') && section.includes('交接') && section.includes('messageKind="role_message"'))
  check('路由段: 无可路由角色返回空串', buildRoutingSection([NO_ROUTE]) === '')
}

// ── 3) beforeProvider 场景判定 ──
{
  const storePath = path.join(os.tmpdir(), `richcat-f4-store-${Date.now()}.json`)
  const store = new PersonaStore(storePath)
  const groupInput: ProviderInput = { screenshot: 'x', appType: 'wechat', groupChat: { isGroup: true, lastSender: null, isMentioned: false, lastMessageKind: 'text' } }
  const singleInput: ProviderInput = { screenshot: 'x', appType: 'wechat' }

  const ctxGroup: Parameters<typeof handleRoutingBeforeProvider>[0] = { input: groupInput, stores: { persona: store }, flags: flagsOf({ 'f4.role_routing': true }) }
  handleRoutingBeforeProvider(ctxGroup)
  check('场景: 群聊+5 内置可路由角色 → 注入路由段', ctxGroup.multiRole === true && !!ctxGroup.routingSection && ctxGroup.routingSection.includes('## 多角色路由规则'))

  const ctxSingle: Parameters<typeof handleRoutingBeforeProvider>[0] = { input: singleInput, stores: { persona: store }, flags: flagsOf({ 'f4.role_routing': true }) }
  handleRoutingBeforeProvider(ctxSingle)
  check('场景: 单聊 → 不注入（V1 行为）', ctxSingle.multiRole === undefined && ctxSingle.routingSection === undefined)

  const ctxOff: Parameters<typeof handleRoutingBeforeProvider>[0] = { input: groupInput, stores: { persona: store }, flags: flagsOf({ 'f4.role_routing': false }) }
  handleRoutingBeforeProvider(ctxOff)
  check('场景: f4 关 → 零影响（flag 关不注入）', ctxOff.multiRole === undefined && ctxOff.routingSection === undefined)

  // 禁用 4 个内置 → 仅 1 个可路由 → 不足 2 个不判定多角色
  const builtins = store.listPersonas().filter((p) => p.source === 'builtin')
  builtins.slice(0, 4).forEach((p) => store.updatePersona(p.personaId, { enabled: false }))
  const ctxFew: Parameters<typeof handleRoutingBeforeProvider>[0] = { input: groupInput, stores: { persona: store }, flags: flagsOf({ 'f4.role_routing': true }) }
  handleRoutingBeforeProvider(ctxFew)
  check('场景: 可路由角色<2 → 不判定多角色', ctxFew.multiRole === undefined && ctxFew.routingSection === undefined)
  builtins.forEach((p) => store.updatePersona(p.personaId, { enabled: true })) // 还原
}

// ── 4) afterProvider：二次生成 / 回退 / 不掺和（异步，IIFE 包裹）──
void (async () => {
  const storePath = path.join(os.tmpdir(), `richcat-f4-store2-${Date.now()}.json`)
  const store = new PersonaStore(storePath)
  const input: ProviderInput = { screenshot: 'x', appType: 'wechat' }
  const base: SmartReplyResult = { contact: '客户甲', reply: '通用客服口吻的回复。', summary: '客户问退货' }

  const noRoute = await applyRoleRouting({ ...base, routeTo: undefined }, { stores: { persona: store } })
  check('路由执行: 无 routeTo → 原样', noRoute?.reply === base.reply)

  const roleMsg = await applyRoleRouting({ ...base, messageKind: 'role_message', routeTo: { personaId: 'p-sales', confidence: 0.9 } }, { stores: { persona: store }, input })
  check('路由执行: role_message 不掺和（不二次生成）', roleMsg?.reply === base.reply && roleMsg?.routeTo !== undefined)

  const lowConf = await applyRoleRouting({ ...base, routeTo: { personaId: 'p-sales', confidence: 0.3 } }, { stores: { persona: store }, input })
  check('路由执行: 低置信度 → 原样', lowConf?.reply === base.reply)

  const noRegen = await applyRoleRouting({ ...base, routeTo: { personaId: 'builtin-sales', confidence: 0.9 } }, { stores: { persona: store }, input })
  check('路由执行: 未注入 regenerate → 采用第一段', noRegen?.reply === base.reply)

  // 注入 regenerate mock：用内置销售顾问（系统 prompt 含"销售"）
  const mockRegen = async (): Promise<SmartReplyResult> => ({ contact: null, reply: '按目标角色重写：销售顾问回复', summary: '售后转销售' })
  const routed = await applyRoleRouting(
    { ...base, routeTo: { personaId: 'builtin-sales', reason: '价格咨询', confidence: 0.95 } },
    { stores: { persona: store }, input, regenerate: mockRegen }
  )
  check('路由执行: 二次生成成功 → 替换 reply', routed?.reply === '按目标角色重写：销售顾问回复')
  check('路由执行: 保留原 contact', routed?.contact === '客户甲')
  check('路由执行: 清除 routeTo 防重复路由', routed?.routeTo === undefined)

  const failRegen = async (): Promise<SmartReplyResult | null> => null
  const fallback = await applyRoleRouting(
    { ...base, routeTo: { personaId: 'builtin-sales', confidence: 0.9 } },
    { stores: { persona: store }, input, regenerate: failRegen }
  )
  check('路由执行: 二次生成返回 null → 回退第一段（不报错）', fallback?.reply === base.reply)

  const throwRegen = async (): Promise<SmartReplyResult> => {
    throw new Error('mock 调用失败')
  }
  const fallback2 = await applyRoleRouting(
    { ...base, routeTo: { personaId: 'builtin-sales', confidence: 0.9 } },
    { stores: { persona: store }, input, regenerate: throwRegen }
  )
  check('路由执行: 二次生成抛错 → 回退第一段（不报错）', fallback2?.reply === base.reply)

  const f4off = await applyRoleRouting(
    { ...base, routeTo: { personaId: 'builtin-sales', confidence: 0.9 } },
    { stores: { persona: store }, input, regenerate: mockRegen, flags: flagsOf({ 'f4.role_routing': false }) }
  )
  check('路由执行: f4 关 → 原样返回（零影响）', f4off?.reply === base.reply)
})().then(() => {

// ── 5) assembler 槽位：f4+multiRole 注入路由段，顺序在 vip 之后 ──
{
  const routable = new RoleRouter([SALES, AFTER_SALES]).getRoutablePersonas()
  const routingSection = buildRoutingSection(routable)
  const p = assembleSystemPrompt({
    flags: flagsOf({
      'f3.vip_service': true,
      'f4.role_routing': true,
      'f5.emotion_risk': true,
      'f10.prompt_system': true
    }),
    isVip: true,
    multiRole: true,
    routingSection,
    vipSection: '## VIP 专属服务规范\n- 尊称。',
    emotionSection: '## 情绪识别规则\n- 识别。'
  })
  const idxVip = p.indexOf('## VIP 专属服务规范')
  const idxRoute = p.indexOf('## 多角色路由规则')
  const idxEmo = p.indexOf('## 情绪识别规则')
  check('assembler: 路由段注入（槽位 6）', idxRoute !== -1)
  check('assembler: 顺序 VIP(5) < 路由(6) < 情绪(8)', idxVip !== -1 && idxVip < idxRoute && idxRoute < idxEmo)

  const pOff = assembleSystemPrompt({ flags: flagsOf({ 'f4.role_routing': false }), multiRole: true, routingSection })
  check('assembler: f4 关 → 路由段不注入（零影响）', !pOff.includes('## 多角色路由规则'))
  const pNoScene = assembleSystemPrompt({ flags: flagsOf({ 'f4.role_routing': true }), multiRole: false, routingSection })
  check('assembler: 非多角色场景 → 不注入', !pNoScene.includes('## 多角色路由规则'))
}

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`)
process.exit(failures === 0 ? 0 : 1)
})
