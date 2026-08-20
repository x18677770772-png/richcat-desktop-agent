#!/usr/bin/env ts-node
/**
 * scripts/e-enterprise-smoke.ts
 * 企业版核心模块冒烟测试（E8）—— 纯逻辑，不依赖 Electron，可在服务器直接运行。
 *
 * 运行方式：
 *   TS_NODE_COMPILER_OPTIONS='{"target":"esnext"}' npx ts-node --transpile-only scripts/e-enterprise-smoke.ts
 *
 * 覆盖：License 状态机全流转 / Audit append-only / Usage 配额熔断 / Crypto 加解密。
 * 全部通过输出 `[e-enterprise-smoke] ALL PASS`，任一失败 exit 1。
 */
import { LicenseManager } from '../src/core/enterprise/license'
import { AuditLogger } from '../src/core/enterprise/audit'
import { UsageMeter } from '../src/core/enterprise/usage'
import { SecretBox, generateMasterKey } from '../src/core/enterprise/crypto'
import { createEnterpriseServices } from '../src/core/enterprise'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let failures = 0
function check(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    console.error(`  ✗ ${label}`)
    failures++
  }
}

// ── 1. License 状态机 ──
function testLicense(): void {
  console.log('[License] 状态机')
  const DAY = 86400000
  const t0 = 1_700_000_000_000
  const io = (() => {
    let s: Record<string, unknown> = {}
    return { read: () => s as Partial<LicenseState>, write: (x: Partial<LicenseState>) => (s = { ...x }) }
  })()
  const lic = new LicenseManager({ deviceId: 'dev-1', now: t0 }, io)

  check(lic.getState().status === 'invalid', '初始为 invalid')
  lic.startTrial()
  check(lic.getState().status === 'trial', 'startTrial → trial')
  check(lic.canRun(), 'trial 可运行')

  // trial 过期 → expired
  const expired = new LicenseManager({ deviceId: 'dev-1', now: t0 + 15 * DAY }, io)
  check(expired.getState().status === 'expired', 'trial 超期 → expired')
  check(!expired.canRun(), 'expired 不可运行')

  // 激活 → active
  const okKey = 'RC-AAAA-BBBB-CCCC-1A2B' // 末段第3位 '2' charCode=50 偶数 → 伪校验通过
  const act = expired.activate(okKey)
  check(act.ok === true, '激活有效码成功')
  check(expired.getState().status === 'active', '激活后 → active')
  check(expired.canRun(), 'active 可运行')
  check(expired.getState().licenseKey?.endsWith('1A2B') === true, '授权码已脱敏存末4位')

  // active 到期 → grace → expired
  // 激活发生在 now=t0+15D → expiresAt = t0+380D；宽限期 380D~387D，388D 后过期
  const grace = new LicenseManager({ deviceId: 'dev-1', now: t0 + 381 * DAY, graceDays: 7 }, io)
  check(grace.getState().status === 'grace', 'active 到期宽限期内 → grace')
  check(grace.canRun(), 'grace 可运行')
  const hardExpired = new LicenseManager({ deviceId: 'dev-1', now: t0 + 388 * DAY, graceDays: 7 }, io)
  check(hardExpired.getState().status === 'expired', 'grace 超期 → expired')

  const badKey = lic.activate('RC-XXXX-XXXX-XXXX-1234')
  check(badKey.ok === false, '格式正确但伪校验失败 → 拒绝')
  const badFmt = lic.activate('not-a-key')
  check(badFmt.ok === false, '格式错误 → 拒绝')
}

// ── 2. Audit append-only ──
function testAudit(): void {
  console.log('[Audit] append-only 日志')
  const dir = mkdtempSync(join(tmpdir(), 'richcat-audit-'))
  const file = join(dir, 'audit.jsonl')
  const a = new AuditLogger(file)
  a.record('engine.start', 'user', '引擎启动')
  a.record('license.activate', 'user', '授权激活', { plan: 'standard' })
  a.record('engine.stop', 'system', '引擎停止')
  check(a.count() === 3, 'count = 3')
  const list = a.list()
  // 同一毫秒写入时 ts 可能相同 → 断言改为：3 条齐全 + 按 ts 非增排序（验证排序逻辑而非同毫秒次序）
  const actions = new Set(list.map((e) => e.action))
  const descSorted = list.every((e, i, arr) => i === 0 || arr[i - 1].ts >= e.ts)
  check(list.length === 3 && descSorted, 'list 返回 3 条且按 ts 非增排序')
  check(actions.has('engine.start') && actions.has('engine.stop') && actions.has('license.activate'), '三条 action 齐全')
  const filtered = a.list({ action: 'engine.start' })
  check(filtered.length === 1, '按 action 过滤')
  const exported = a.export()
  check(exported.split('\n').length >= 3, 'export 含全部行')
  check(existsSync(file), '文件已落盘')
  rmSync(dir, { recursive: true, force: true })
}

// ── 3. Usage 配额熔断 ──
function testUsage(): void {
  console.log('[Usage] 配额熔断')
  const dir = mkdtempSync(join(tmpdir(), 'richcat-usage-'))
  const io = (() => {
    const m = new Map<string, UsageSnapshot>()
    return {
      read: (day: string) => m.get(day) ?? null,
      write: (snap: UsageSnapshot) => m.set(snap.date, { ...snap })
    }
  })()
  // 5 坐席 → quotaLimit=ceil(50000/365)=137；hardCap=ceil(137*1.2)=165
  const u = new UsageMeter(io, { seats: 5 })
  const today = u.getToday()
  check(today.quotaLimit === 137, `quotaLimit=${today.quotaLimit} (期望137)`)
  for (let i = 0; i < 165; i++) u.recordMessage('reply')
  check(u.isQuotaExceeded(), '达 hardCap → 熔断')
  const after = u.recordMessage('reply')
  check(after === false, '超限后 recordMessage 返回 false')
  check(u.getToday().messages === 166, '超限仍继续计数')
  check(typeof u.overageMessage() === 'string' && u.overageMessage().length > 0, '超限提示文案存在')
  // 跨日切桶：注入时钟验证 day1 → day2 自动重建桶且计数归零
  const io2 = (() => {
    const m = new Map<string, UsageSnapshot>()
    return {
      read: (day: string) => m.get(day) ?? null,
      write: (snap: UsageSnapshot) => m.set(snap.date, { ...snap })
    }
  })()
  let fakeDate = new Date('2026-08-20T12:00:00')
  const u2 = new UsageMeter(
    io2,
    { seats: 5 },
    { now: () => fakeDate }
  )
  u2.recordMessage('reply')
  check(u2.getToday().date === '2026-08-20', 'day1 日期正确')
  check(u2.getToday().messages === 1, 'day1 计数=1')
  fakeDate = new Date('2026-08-21T00:30:00')
  u2.recordMessage('reply')
  check(u2.getToday().date === '2026-08-21', '跨日自动切新桶')
  check(u2.getToday().messages === 1, 'day2 计数从 0 重建')
  const day1Stored = io2.read('2026-08-20')
  check(day1Stored !== null && day1Stored.messages === 1, 'day1 数据已落盘保留')
  rmSync(dir, { recursive: true, force: true })
}

// ── 4. Crypto 加解密 ──
function testCrypto(): void {
  console.log('[Crypto] AES-256-GCM 加解密')
  const box = new SecretBox(generateMasterKey())
  const enc = box.encrypt('sk-test-12345')
  check(box.decrypt(enc) === 'sk-test-12345', 'encrypt→decrypt 往返一致')
  check(enc.includes('.'), '密文为 iv.cipher.tag 三段格式')
  const box2 = new SecretBox(generateMasterKey())
  let threw = false
  try {
    box2.decrypt(enc)
  } catch {
    threw = true
  }
  check(threw, '错误密钥解密抛错')
  let threwFmt = false
  try {
    box.decrypt('plaintext-no-dots')
  } catch {
    threwFmt = true
  }
  check(threwFmt, '非密文格式抛 invalid_secret_format')
}

// ── 5. 门面集成 ──
function testFacade(): void {
  console.log('[Enterprise] 门面集成')
  const dir = mkdtempSync(join(tmpdir(), 'richcat-ent-'))
  let mk = ''
  let did = ''
  const svc = createEnterpriseServices({
    baseDir: dir,
    getMasterKey: () => mk,
    setMasterKey: (k) => (mk = k),
    getDeviceId: () => did,
    setDeviceId: (id) => (did = id)
  })
  check(did.length > 0, '设备指纹自动生成')
  check(mk.length === 64, '主密钥自动生成(64 hex)')
  const enc = svc.secretBox.encrypt('key-abc')
  check(svc.secretBox.decrypt(enc) === 'key-abc', '门面加解密可用')
  svc.audit.record('engine.start', 'user', '门面冒烟')
  check(svc.audit.count() >= 1, '审计可用')
  svc.usage.recordMessage('reply')
  check(svc.usage.getToday().replies >= 1, '用量可用')
  check(svc.license.getState().status === 'invalid', 'License 初始 invalid')
  rmSync(dir, { recursive: true, force: true })
}

testLicense()
testAudit()
testUsage()
testCrypto()
testFacade()

console.log('')
if (failures > 0) {
  console.error(`[e-enterprise-smoke] FAILED: ${failures} 项未通过`)
  process.exit(1)
}
console.log('[e-enterprise-smoke] ALL PASS')
