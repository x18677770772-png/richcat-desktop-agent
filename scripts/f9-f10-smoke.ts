// scripts/f9-f10-smoke.ts
// F9 知识库深度优化 + F10 情绪价值深化 — 冒烟验证（docs §3-F9 / §3-F10 / §4 验收标准前置检查）
// 运行：npx ts-node --transpile-only scripts/f9-f10-smoke.ts
// （Windows PowerShell 引号被吞时改用 env 方式，见 scripts/c1-prompt-smoke.ts 头注释）
//
// 断言：
// - F9：scope 过滤（vip/group/all）、weight 排序、旧数据默认值、V1 getInjectionItems 不变、
//       关键词检索接口、FeatureModule flag 关零影响；
// - F10：VIP 尊称体系段注入条件（f3 开 && isVip）、emotion-value 8 条 + 表达对照、
//        f10 关退化 V1、拼接顺序无重复。
import os from 'node:os'
import path from 'node:path'
import { FeatureFlags } from '../src/core/features/flags'
import { KnowledgeStore } from '../src/core/knowledge/knowledge-store'
import { ProviderInput } from '../src/core/session-types'
import { createKnowledgeV2Feature } from '../src/core/features/knowledge-v2'
import { InjectionStrategy, createKeywordMatcher } from '../src/core/features/knowledge-v2/injection'
import { buildKnowledgeV2Section } from '../src/core/prompt'
import { assembleSystemPrompt, buildVipSection } from '../src/core/prompt'

function flagsOf(overrides: Record<string, boolean> = {}): FeatureFlags {
  return new FeatureFlags(() => overrides)
}

let failures = 0
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures++
}

// ── 准备：临时 KnowledgeStore ──
const storePath = path.join(os.tmpdir(), `richcat-f9-smoke-${Date.now()}.json`)
const store = new KnowledgeStore(storePath)
const itemA = store.addItem({
  title: '退货流程',
  content: '7 天内无理由退货，运费由买家承担。',
  tags: ['售后'],
  category: '售后',
  weight: 100,
  scope: 'vip'
})
const itemB = store.addItem({
  title: '运费政策',
  content: '满 99 元包邮，偏远地区除外。',
  tags: ['物流'],
  category: '物流',
  weight: 75,
  scope: 'group'
})
const itemC = store.addItem({
  title: '会员权益',
  content: '会员享 95 折与专属客服。',
  tags: ['产品'],
  category: '产品',
  weight: 90,
  scope: 'all'
})
const itemD = store.addItem({ title: '旧条目', content: '无新字段的历史数据。' }) // weight=50/scope=all
store.addItem({ title: '已停用', content: '不应出现。', weight: 100, scope: 'all' })
store.setEnabled(store.listItems().find((i) => i.title === '已停用')!.itemId, false)

// ── F9 验收 2a/2b：scope 过滤 + weight 排序 ──
{
  const titles = (items: { title: string }[]): string[] => items.map((i) => i.title)
  const plain = store.getInjectionItemsV2({})
  check('F9 普通会话: 不注入 vip/group 条目', !titles(plain).includes('退货流程') && !titles(plain).includes('运费政策'), titles(plain).join(','))
  check('F9 普通会话: 权重排序（会员90 前于 旧条目50）', titles(plain)[0] === '会员权益' && titles(plain)[titles(plain).length - 1] === '旧条目', titles(plain).join(','))
  check('F9 普通会话: 不含已停用', !titles(plain).includes('已停用'))

  const vip = store.getInjectionItemsV2({ isVip: true })
  check('F9 VIP 会话: 注入 vip 条目且排最前', titles(vip)[0] === '退货流程', titles(vip).join(','))
  check('F9 VIP 会话: 不注入 group 条目', !titles(vip).includes('运费政策'))

  const group = store.getInjectionItemsV2({ isGroup: true })
  check('F9 群聊会话: 注入 group 条目', titles(group).includes('运费政策'))
  check('F9 群聊会话: 不注入 vip 条目', !titles(group).includes('退货流程'))

  const both = store.getInjectionItemsV2({ isVip: true, isGroup: true })
  check('F9 双场景: 全部注入且按权重排序', titles(both).join(',') === '退货流程,会员权益,运费政策,旧条目', titles(both).join(','))
}

// ── F9 验收 2c：旧数据默认值不报错 ──
{
  const d = store.listItems().find((i) => i.title === '旧条目')!
  check('F9 旧数据: 无新字段不报错且按默认 weight=50', d.weight === undefined && d.scope === undefined, '')
}

// ── F9 验收 1：flag 关 → V1 注入不变（时间序、无 scope 过滤）──
{
  const v1 = store.getInjectionItems()
  const titles = v1.map((i) => i.title)
  check('F9 V1 路径: 时间序（最近添加的启用条目在前）', titles[0] === '旧条目', titles.join(','))
  check('F9 V1 路径: 不含已停用（enabled 过滤）', !titles.includes('已停用'))
  check('F9 V1 路径: 含全部启用条目（不过滤 scope）', titles.includes('退货流程') && titles.includes('运费政策') && titles.includes('会员权益') && titles.includes('旧条目'))
}

// ── F9：权重裁剪与非法 scope ──
{
  const clamped = store.addItem({ title: '超界权重', content: 'x', weight: 150 })
  check('F9 权重越界: 150 裁剪为 100', clamped.weight === 100)
  store.deleteItem(clamped.itemId)
  const badScope = store.addItem({ title: '非法作用域', content: 'x', scope: 'evil' as never })
  check('F9 非法 scope: 忽略保持 undefined', badScope.scope === undefined)
  store.deleteItem(badScope.itemId)
}

// ── F9：注入段格式（紧凑 + 优先级 + 分类）──
{
  const section = buildKnowledgeV2Section([
    { title: '退货流程', content: '7 天内无理由退货。', category: '售后', weight: 100 },
    { title: '旧条目', content: '历史数据。' }
  ])
  check('F9 段格式: 优先级系数 weight/50', section.includes('[2.0 优先级]【售后】退货流程') && section.includes('[1.0 优先级]旧条目'), section.split('\n')[1])
  check('F9 段格式: 头尾说明齐全', section.startsWith('## 知识库（按优先级排列') && section.includes('不编造'))
}

// ── F9：关键词检索接口（OCR 后启用）──
{
  const matcher = createKeywordMatcher()
  const hits = matcher.match(store.getEnabledItems(), ['运费'], 10)
  // 「运费政策」标题命中（权重 3）排最前；「退货流程」正文含"运费"（权重 1）次之
  check('F9 关键词: 标题命中排最前', hits[0]?.title === '运费政策' && hits.length >= 1, hits.map((h) => h.title).join(','))
  const strategy = new InjectionStrategy(store, { useKeywordMatch: true })
  const withKw = strategy.select({ keywords: ['会员'] })
  check('F9 策略: 关键词优先', withKw[0]?.title === '会员权益')
  const noKw = strategy.select({})
  check('F9 策略: 无关键词回退权重注入', noKw[0]?.title === '退货流程' || noKw[0]?.title === '会员权益', noKw[0]?.title)
}

// ── F9：FeatureModule flag 关零影响 / 开时注入 ──
{
  const feature = createKnowledgeV2Feature()
  const input: ProviderInput = { screenshot: 'x', appType: 'wechat' }
  feature.beforeProvider({ input, stores: { knowledge: store }, flags: flagsOf({ 'f9.knowledge_v2': false }) })
  check('F9 模块: flag 关不触碰 input', input.knowledgeSection === undefined)
  feature.beforeProvider({ input, stores: { knowledge: store }, flags: flagsOf({ 'f9.knowledge_v2': true }) })
  check('F9 模块: flag 开注入 V2 段', !!input.knowledgeSection && input.knowledgeSection.includes('优先级'))
}

// ── F10：VIP 段注入条件与文案 ──
{
  const f3on = { 'f3.vip_service': true, 'f10.prompt_system': true }
  const pVip = assembleSystemPrompt({ flags: flagsOf(f3on), isVip: true })
  check('F10 VIP: f3开+isVip 注入尊称体系段', pVip.includes('## VIP 专属服务规范') && pVip.includes('尊称') && pVip.includes('话术参考'), '')
  const pNotVip = assembleSystemPrompt({ flags: flagsOf(f3on), isVip: false })
  check('F10 VIP: 非 VIP 不注入', !pNotVip.includes('## VIP 专属服务规范'))
  const pF3Off = assembleSystemPrompt({ flags: flagsOf({ 'f3.vip_service': false }), isVip: true })
  check('F10 VIP: f3 关不注入（关闭零影响）', !pF3Off.includes('## VIP 专属服务规范'))
  const pF10Off = assembleSystemPrompt({ flags: flagsOf({ 'f3.vip_service': true, 'f10.prompt_system': false }), isVip: true })
  check('F10 VIP: f10 关整体退化 V1（无 VIP 段）', !pF10Off.includes('VIP 专属服务规范') && pF10Off.includes('你是一个微信自动回复助手'))
  const withName = buildVipSection({ customerName: '王总' })
  check('F10 VIP: 动态 header 嵌入客户名', withName.includes('当前客户「王总」是 VIP'))
}

// ── F10：情绪价值规范深化（8 条 + 表达对照）──
{
  const p = assembleSystemPrompt({ flags: flagsOf() })
  check('F10 情绪价值: 8 条齐全', ['先共情，再解决', '不机械道歉', '让人感到被重视', '给确定性与安全感', '不敷衍、不甩锅', '克制热情', '人感自然口语', 'VIP 客户'].every((r) => p.includes(r)))
  check('F10 情绪价值: 表达对照示例', p.includes('表达对照') && p.includes('选"人感"说法') && p.includes('客服腔'))
  check('F10 情绪价值: 人感规则含微信场景', p.includes('像真人在微信上聊天') && p.includes('不堆砌表情符号'))
}

// ── F10：拼接顺序（VIP 在知识库之前，无重复）──
{
  const p = assembleSystemPrompt({
    flags: flagsOf({ 'f3.vip_service': true, 'f9.knowledge_v2': true }),
    isVip: true,
    knowledgeSection: buildKnowledgeV2Section([{ title: '运费政策', content: '满 99 包邮。' }])
  })
  const idxVip = p.indexOf('## VIP 专属服务规范')
  const idxKw = p.indexOf('## 知识库（按优先级排列')
  const idxOutput = p.indexOf('## 输出格式（必须严格遵守）')
  check('F10 顺序: VIP(5) < 知识(10) < 输出格式(14)', idxVip !== -1 && idxVip < idxKw && idxKw < idxOutput)
  check('F10 顺序: 无重复段', p.split('## ').filter((s) => s.startsWith('VIP')).length === 1)
}

try {
  store.deleteItem(itemA.itemId)
  store.deleteItem(itemB.itemId)
  store.deleteItem(itemC.itemId)
  store.deleteItem(itemD.itemId)
} catch {
  /* 清理失败无碍 */
}

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`)
process.exit(failures === 0 ? 0 : 1)
