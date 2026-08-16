// QA 独立验证 ④：flag 关闭零影响 / 单开单生效 / 抛错不阻塞
// 运行：npx ts-node --transpile-only .qa/qa-flag-impact.ts
import os from 'node:os'
import path from 'node:path'
import { FeatureFlags } from '../src/core/features/flags'
import { FeatureRegistry } from '../src/core/features/hooks'
import { assembleSystemPrompt } from '../src/core/prompt'
import { DailyReportScheduler } from '../src/core/features/daily-report'
import { FollowUpScheduler } from '../src/core/features/follow-up'
import { DailyReportGenerator, DailyReportData } from '../src/core/features/daily-report/report'
import { FollowUpStore } from '../src/core/features/follow-up/store'
import { HandoffStore } from '../src/core/features/human-handoff/store'
import { renderDailyReport } from '../src/core/features/daily-report/section'

function flagsOf(overrides: Record<string, boolean> = {}): FeatureFlags {
  return new FeatureFlags(() => overrides)
}

let failures = 0
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures++
}

// ── 1) 全关：registry 零调用（不注入、不消费、无动作）──
{
  const ALL_OFF = {
    'f1.group_chat': false, 'f2.human_handoff': false, 'f3.vip_service': false,
    'f4.role_routing': false, 'f5.emotion_risk': false, 'f6.daily_report': false,
    'f7.follow_up': false, 'f9.knowledge_v2': false, 'f10.prompt_system': true
  }
  const registry = new FeatureRegistry(flagsOf(ALL_OFF))
  const calls: string[] = []
  const spy = (name: string) => () => { calls.push(name) }
  registry.registerAll([
    { flagKey: 'f1.group_chat', beforeProvider: spy('f1.before') },
    { flagKey: 'f2.human_handoff', afterProvider: spy('f2.after') },
    { flagKey: 'f3.vip_service', beforeProvider: spy('f3.before'), afterReply: spy('f3.afterReply') },
    { flagKey: 'f4.role_routing', beforeProvider: spy('f4.before'), afterProvider: spy('f4.after') },
    { flagKey: 'f5.emotion_risk', afterProvider: spy('f5.after') },
    { flagKey: 'f6.daily_report', onTimer: spy('f6.onTimer') },
    { flagKey: 'f7.follow_up', afterProvider: spy('f7.after'), onTimer: spy('f7.onTimer') },
    { flagKey: 'f9.knowledge_v2', beforeProvider: spy('f9.before') }
  ])
  const ctx: any = { input: {}, flags: flagsOf(ALL_OFF), stores: {} }
  void registry.runBeforeProvider(ctx)
  void registry.runAfterProvider(ctx)
  void registry.runAfterReply(ctx, 'hi')
  void registry.runOnTimer('daily_report', new Date())
  void registry.runOnTimer('follow_up', new Date())
  check('全关: enabled() 为空', registry.enabled().length === 0, `enabled=${registry.enabled().length}`)
  check('全关: 所有钩子零调用', calls.length === 0, calls.join(',') || '无调用')
}

// ── 2) 单开 f5：只调 f5（单开单生效）──
{
  const ONLY_F5 = {
    'f1.group_chat': false, 'f2.human_handoff': false, 'f4.role_routing': false,
    'f5.emotion_risk': true, 'f7.follow_up': false
  }
  const registry = new FeatureRegistry(flagsOf(ONLY_F5))
  const calls: string[] = []
  registry.registerAll([
    { flagKey: 'f1.group_chat', beforeProvider: () => { calls.push('f1') } },
    { flagKey: 'f2.human_handoff', afterProvider: () => { calls.push('f2') } },
    { flagKey: 'f5.emotion_risk', afterProvider: () => { calls.push('f5') } },
    { flagKey: 'f7.follow_up', afterProvider: () => { calls.push('f7') } }
  ])
  const ctx: any = { input: {}, flags: flagsOf(ONLY_F5), stores: {} }
  void registry.runAfterProvider(ctx)
  check('单开 f5: 仅 f5 被调用', calls.length === 1 && calls[0] === 'f5', calls.join(',') || '无')
}

// ── 3) 抛错模块被吞掉，后续模块继续（不阻塞主链路）──
{
  const registry = new FeatureRegistry(flagsOf({ 'f5.emotion_risk': true, 'f7.follow_up': true }))
  const calls: string[] = []
  registry.registerAll([
    { flagKey: 'f5.emotion_risk', afterProvider: () => { calls.push('f5'); throw new Error('boom') } },
    { flagKey: 'f7.follow_up', afterProvider: () => { calls.push('f7') } }
  ])
  const ctx: any = { input: {}, flags: flagsOf({ 'f5.emotion_risk': true, 'f7.follow_up': true }), stores: {} }
  void registry.runAfterProvider(ctx)
  check('抛错: f5 抛错被吞，f7 继续执行', calls.length === 2 && calls[1] === 'f7', calls.join(','))
}

// ── 4) 全关 assembler：无 V2 字段、无功能段（只 base+情绪价值+输出格式）──
{
  const p = assembleSystemPrompt({
    flags: flagsOf({
      'f1.group_chat': false, 'f2.human_handoff': false, 'f3.vip_service': false,
      'f4.role_routing': false, 'f5.emotion_risk': false, 'f7.follow_up': false,
      'f9.knowledge_v2': false, 'f10.prompt_system': true
    }),
    groupChatSection: '## 群聊规范\nx', vipSection: '## VIP 专属服务规范\nx', isVip: true,
    routingSection: '## 多角色路由规则\nx', multiRole: true,
    handoffSection: '## 转人工规则\nx', emotionSection: '## 情绪识别规则\nx',
    followUpSection: '## 待跟进承诺规则\nx'
  })
  // 注意：知识/客户/记忆/图片段是「数据驱动」（§4.4），有内容即注入（f9 只改知识段内容）；
  // 匹配段标题（## 前缀），避免情绪价值段正文的交叉引用字样（如「VIP 专属服务规范」）误伤
  check('全关: 无功能注入段（群聊/VIP/路由/转人工/情绪/待跟进）', !p.includes('## 群聊规范') && !p.includes('## VIP 专属服务规范') && !p.includes('## 多角色路由规则') && !p.includes('## 转人工规则') && !p.includes('## 情绪识别规则') && !p.includes('## 待跟进承诺规则'))
  check('全关: 无 V2 可选字段', !p.includes('messageKind') && !p.includes('emotion') && !p.includes('handoff') && !p.includes('routeTo') && !p.includes('followUp'))
  check('全关: 有基础模板+情绪价值+输出格式', p.includes('你是「财听猫」') && p.includes('先共情，再解决') && p.includes('## 输出格式（必须严格遵守）'))
}

// ── 5) 定时器：f6 关 → 不挂定时器；f6 开 → 挂一个且 start 前 stop 防重复 ──
{
  const origSetTimeout = globalThis.setTimeout
  const origClearTimeout = globalThis.clearTimeout
  let setTimeoutCalls = 0
  const created: Array<{ cb: () => void; ms: number }> = []
  ;(globalThis as any).setTimeout = ((cb: () => void, ms: number, ...rest: unknown[]) => {
    setTimeoutCalls++
    created.push({ cb, ms })
    return { _t: true, unref: () => undefined } as unknown as NodeJS.Timeout
  }) as typeof setTimeout
  ;(globalThis as any).clearTimeout = (() => undefined) as typeof clearTimeout

  try {
    const noopGen = new DailyReportGenerator({
      customerStore: () => ({ listCustomers: () => [] } as any),
      worktraceBaseDir: () => 'x'
    })
    const sOff = new DailyReportScheduler({
      flags: flagsOf({ 'f6.daily_report': false }),
      generator: noopGen,
      reportsBaseDir: () => 'x',
      notify: () => undefined
    })
    const before = setTimeoutCalls
    sOff.start()
    check('f6 关: start() 不挂定时器', setTimeoutCalls === before, `setTimeout calls ${before}→${setTimeoutCalls}`)
    sOff.stop()

    const sOn = new DailyReportScheduler({
      flags: flagsOf({ 'f6.daily_report': true }),
      generator: noopGen,
      reportsBaseDir: () => 'x',
      notify: () => undefined
    })
    sOn.start()
    const afterOn = setTimeoutCalls
    check('f6 开: 挂 1 个定时器', afterOn - before === 1, `${before}→${afterOn}`)
    sOn.start() // 二次 start → 先 stop 再挂（不叠加）
    check('f6 开: 二次 start 不叠加（仍 1 个）', setTimeoutCalls - afterOn === 1, `${afterOn}→${setTimeoutCalls}`)
    sOn.stop()
  } finally {
    ;(globalThis as any).setTimeout = origSetTimeout
    ;(globalThis as any).clearTimeout = origClearTimeout
  }
}

// ── 6) F7 定时器同理：f7 关不挂 / 开挂 1 个防重复 ──
{
  const origSetInterval = globalThis.setInterval
  const origClearInterval = globalThis.clearInterval
  let setIntervalCalls = 0
  ;(globalThis as any).setInterval = ((cb: () => void, ms: number, ...rest: unknown[]) => {
    setIntervalCalls++
    return { _i: true, unref: () => undefined } as unknown as NodeJS.Timeout
  }) as typeof setInterval
  ;(globalThis as any).clearInterval = (() => undefined) as typeof clearInterval
  try {
    const store = new FollowUpStore('') // 不落盘
    const s = new FollowUpScheduler({ store })
    s.start()
    const after = setIntervalCalls
    check('f7: start() 挂 1 个 interval', after === 1, `calls=${after}`)
    s.start()
    check('f7: 二次 start 不叠加', setIntervalCalls - after === 1, `${after}→${setIntervalCalls}`)
    s.stop()
  } finally {
    ;(globalThis as any).setInterval = origSetInterval
    ;(globalThis as any).clearInterval = origClearInterval
  }
}

// ── 7) F6 日报含 F2/F7 数据（联动⑤的一部分：数据源注入生效）──
void (async () => {
  const now = Date.now()
  const tmpDir = path.join(os.tmpdir(), `richcat-qa-f6-${Date.now()}`)
  const fuStore = new FollowUpStore(path.join(tmpDir, 'followups.json'))
  const item = fuStore.add({ contact: '张先生', action: '明天回复退款进度', dueAt: now + 3600e3 })
  const hfStore = new HandoffStore(path.join(tmpDir, 'handoffs.json'))
  hfStore.add({ contact: '李女士', reason: 'complaint', confidence: 0.9 })
  const gen = new DailyReportGenerator({
    customerStore: () => ({
      listCustomers: () => [
        { customerId: 'c1', name: '张先生', tags: [], category: '普通', lastSeenAt: now, firstSeenAt: now - 86400e3, note: '', memory: [] },
        { customerId: 'c2', name: '王总', tags: ['VIP'], category: 'VIP', lastSeenAt: now, firstSeenAt: now, note: '', memory: [] }
      ]
    } as any),
    worktraceBaseDir: () => 'x',
    listFollowUps: () => fuStore.list(),
    listHandoffs: () => hfStore.listOpen(),
    listTraceSessions: async () => [{ sessionId: 's1', startedAt: now, endedAt: now, eventCount: 3 }] as any
  })
  const data: DailyReportData = await gen.generate(new Date())
  check('F6: 服务客户=2（张先生+王总）', data.servedCustomers.length === 2, `got ${data.servedCustomers.length}`)
  check('F6: VIP 动态含王总', data.vipServed.some((c) => c.name === '王总'))
  check('F6: 待跟进含张先生待办', data.followUps.some((f) => f.action.includes('退款进度')))
  check('F6: 待处理接管含李女士', data.handoffs.some((h) => h.contact === '李女士' && h.status === 'open'))
  check('F6: 轮次=1', data.traceSessionsToday.length === 1)
  const md = renderDailyReport(data)
  check('F6: Markdown 含各节', md.includes('服务客户') && md.includes('VIP') && md.includes('待跟进') && md.includes('接管') && md.includes('轮次'), md.slice(0, 120).replace(/\n/g, ' | '))
})().then(() => {
  console.log(failures === 0 ? '\nQA-④⑤ 全部通过 ✔' : `\n${failures} 项失败 ✘`)
  process.exit(failures === 0 ? 0 : 1)
})
