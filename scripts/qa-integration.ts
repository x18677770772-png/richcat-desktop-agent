// QA 独立验证 ⑤：联动测试
// F5→F2 升级链 / F2 多轮未解决 / F1+F4 群聊路由组合 / F1 后置过滤
// 运行：npx ts-node --transpile-only .qa/qa-integration.ts
import os from 'node:os'
import path from 'node:path'
import { FeatureFlags } from '../src/core/features/flags'
import { assembleSystemPrompt } from '../src/core/prompt'
import { CustomerStore } from '../src/core/customers/customer-store'
import { HandoffStore } from '../src/core/features/human-handoff/store'
import { openHandoff, captureHandoffResult, buildHandoffContext } from '../src/core/features/human-handoff'
import { handleEmotionResult } from '../src/core/features/emotion-risk'
import { createGroupChatFeature, applyGroupChatReplyFilter, applyNonConversationFilter } from '../src/core/features/group-chat'
import { buildGroupChatSection } from '../src/core/features/group-chat/section'
import { buildRoutingSection } from '../src/core/features/role-routing'
import { GroupChatContext } from '../src/core/session-types'
import { SmartReplyResult } from '../src/core/ai-client'

function flagsOf(overrides: Record<string, boolean> = {}): FeatureFlags {
  return new FeatureFlags(() => overrides)
}

let failures = 0
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures++
}

const dir = fsTmp()
function fsTmp(): string {
  const d = path.join(os.tmpdir(), `richcat-qa-int-${Date.now()}`)
  return d
}

// ── A) F5→F2 升级链：angry+0.8 → risk_escalation 接管 → 打标+暂停 ──
{
  const customerStore = new CustomerStore(path.join(dir, 'customers.json'))
  const handoffStore = new HandoffStore(path.join(dir, 'handoffs.json'))
  customerStore.getOrCreateCustomer('赵先生') // 先建档
  const paused = new Set<string>()
  const events: string[] = []
  let handoffReason: string | null = null

  const requestHandoff = (reason: string, contact: string | null, confidence: number): void => {
    handoffReason = reason
    const req = openHandoff(reason as never, contact, confidence, {
      getStore: () => handoffStore,
      notify: (p) => { events.push(p.type) },
      notifyDesktop: () => undefined,
      getCustomerStore: () => customerStore,
      pausedContacts: paused,
      maxUnresolvedTurns: 3
    })
    void req
  }

  // F5 消费 emotion（angry, confidence 0.8）→ requestHandoff('risk_escalation')
  handleEmotionResult({
    result: { contact: '赵先生', reply: '理解您的心情…', emotion: { sentiment: 'angry', risk: 'complaint', confidence: 0.8 } },
    stores: { customer: customerStore },
    notify: (p) => { events.push(p.type) },
    requestHandoff: (reason, confidence) => requestHandoff(reason, '赵先生', confidence)
  } as any)
  check('F5→F2: 高风险触发 requestHandoff(risk_escalation)', handoffReason === 'risk_escalation', handoffReason ?? '无')
  check('F5→F2: 客户被打标「情绪负面」', customerStore.getCustomerByName('赵先生')?.tags.includes('情绪负面') === true, customerStore.getCustomerByName('赵先生')?.tags.join(','))
  check('F5→F2: 客户被打标「投诉」', customerStore.getCustomerByName('赵先生')?.tags.includes('投诉') === true)
  check('F5→F2: 风险通知发出 risk:alert', events.includes('risk:alert'), events.join(','))
  check('F5→F2: 接管单写入（reason=risk_escalation, status=open）', handoffStore.listOpen().some((h) => h.reason === 'risk_escalation' && h.status === 'open'))
  check('F5→F2: 客户进入暂停集合', paused.has('赵先生'))

  // F2 关时 requestHandoff 为 no-op：装配方不接线 → 模拟不调用 openHandoff
  const paused2 = new Set<string>()
  const noOpCtx = { getStore: () => handoffStore, notify: () => undefined, getCustomerStore: () => customerStore, pausedContacts: paused2, maxUnresolvedTurns: 3 }
  captureHandoffResult({ contact: '赵先生', reply: 'x', handoff: { reason: 'explicit_human', confidence: 0.9 } }, noOpCtx, { isEnabled: () => false })
  check('F2 关: handoff 信号零消费', handoffStore.listOpen().length === 1 && paused2.size === 0, `open=${handoffStore.listOpen().length} paused=${paused2.size}`)
}

// ── B) F2 多轮未解决：3 轮空 reply → multiple_unresolved；有 reply 清零 ──
{
  const hf = new HandoffStore(path.join(dir, 'handoffs2.json'))
  const paused = new Set<string>()
  const ctx = {
    getStore: () => hf,
    notify: () => undefined,
    getCustomerStore: () => new CustomerStore(path.join(dir, 'customers2.json')),
    pausedContacts: paused,
    maxUnresolvedTurns: 3
  }
  const flagsOn = { isEnabled: (k: string) => k === 'f2.human_handoff' }
  captureHandoffResult({ contact: '钱女士', reply: null }, ctx, flagsOn) // 1
  captureHandoffResult({ contact: '钱女士', reply: null }, ctx, flagsOn) // 2
  check('F2 多轮: 第2轮未接管', hf.listOpen().length === 0)
  captureHandoffResult({ contact: '钱女士', reply: null }, ctx, flagsOn) // 3 → 触发
  check('F2 多轮: 第3轮触发 multiple_unresolved', hf.listOpen().some((h) => h.reason === 'multiple_unresolved' && h.contact === '钱女士'), hf.listOpen().map((h) => h.reason).join(','))
  check('F2 多轮: 会话被暂停', paused.has('钱女士'))
  // 清零：另一客户 1 轮 reply 后 2 轮空 → 不触发
  const hf3 = new HandoffStore(path.join(dir, 'handoffs3.json'))
  const paused3 = new Set<string>()
  const ctx3 = { getStore: () => hf3, notify: () => undefined, getCustomerStore: () => new CustomerStore(path.join(dir, 'customers3.json')), pausedContacts: paused3, maxUnresolvedTurns: 3 }
  captureHandoffResult({ contact: '孙先生', reply: '好的' }, ctx3, flagsOn) // 清零基线
  captureHandoffResult({ contact: '孙先生', reply: null }, ctx3, flagsOn) // 1
  captureHandoffResult({ contact: '孙先生', reply: null }, ctx3, flagsOn) // 2
  check('F2 多轮: reply 清零后重新计数（2 轮不触发）', hf3.listOpen().length === 0 && paused3.size === 0)
}

// ── C) F1+F4 组合：群聊场景注入群聊段+路由段，顺序正确；role_message 双保险 ──
{
  const gc: GroupChatContext = { isGroup: true, lastSender: '客户甲', isMentioned: true, lastMessageKind: 'text' }
  const p = assembleSystemPrompt({
    flags: flagsOf({ 'f1.group_chat': true, 'f4.role_routing': true, 'f10.prompt_system': true }),
    groupChatSection: buildGroupChatSection(gc),
    routingSection: buildRoutingSection([
      { personaId: 'p-sales', name: '销售顾问', description: 'x', systemPrompt: 'x', source: 'custom', enabled: true, createdAt: 1, updatedAt: 1, routingDomains: ['报价'] }
    ]),
    multiRole: true
  })
  const iGroup = p.indexOf('## 群聊规范')
  const iRoute = p.indexOf('## 多角色路由规则')
  check('F1+F4: 群聊段注入', iGroup !== -1)
  check('F1+F4: 路由段注入', iRoute !== -1)
  check('F1+F4: 顺序 群聊(4) < 路由(6)', iGroup !== -1 && iRoute !== -1 && iGroup < iRoute)

  // F1 后置过滤：messageKind=group_member 但 reply 非空 → 强制 null（验收 4）
  const f1 = createGroupChatFeature()
  const filtered = f1.filterResult({ contact: '路人', reply: '我来说一句', messageKind: 'group_member' }, gc)
  check('F1 后置: group_member 强制 reply=null', filtered.reply === null)
  const filteredRole = applyGroupChatReplyFilter({ contact: '甲', reply: 'x', messageKind: 'role_message' }, gc)
  check('F1 后置: role_message 强制 reply=null', filteredRole.reply === null)
  // 确定性过滤：群公告/红包不回复（验收 2d）
  const ann = applyNonConversationFilter({ contact: '甲', reply: 'x' }, { ...gc, lastMessageKind: 'announcement' })
  check('F1 后置: 群公告不回复', ann.reply === null)
  const rp = applyNonConversationFilter({ contact: '甲', reply: 'x' }, { ...gc, lastMessageKind: 'red_packet' })
  check('F1 后置: 红包不回复', rp.reply === null)
  // 客户本人消息：正常回复
  const own = applyGroupChatReplyFilter({ contact: '客户甲', reply: '好的' }, { ...gc, lastSender: '客户甲' })
  check('F1 后置: 客户本人消息正常回复', own.reply === '好的')
  // 单聊：原样（V1 一致）
  const single = f1.filterResult({ contact: '客户甲', reply: '好的', messageKind: 'group_member' }, undefined)
  check('F1 后置: 单聊/无群聊上下文原样返回', single.reply === '好的')
}

// ── D) F4 群聊路由完整链路（before 判定 + after 路由）已在 f4-routing-smoke 覆盖，这里补一个组装级断言：f4 开但单聊 → 无路由段 ──
{
  const p = assembleSystemPrompt({
    flags: flagsOf({ 'f4.role_routing': true }),
    routingSection: '## 多角色路由规则\nx',
    multiRole: false
  })
  check('F4: 单聊不注入路由段', !p.includes('多角色路由规则'))
}

console.log(failures === 0 ? '\nQA 联动全部通过 ✔' : `\n${failures} 项失败 ✘`)
process.exit(failures === 0 ? 0 : 1)
