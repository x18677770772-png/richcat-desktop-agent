/**
 * src/core/enterprise/index.ts
 * 企业版门面层 — 把 license / audit / usage / crypto 四模块装配为单例服务。
 *
 * 职责：
 * - 统一初始化（设备指纹、主密钥、License/审计/用量持久化路径）。
 * - 提供文件版 IO 适配（license/usage 落盘），供主进程与测试共用。
 * - 不依赖 Electron（node:fs / node:crypto），可单测。
 *
 * 主进程只负责：① 构造时传入 baseDir 与 settings 回调；② 注册 IPC；③ 在引擎钩子调用。
 * 设计文档：docs/plan/enterprise-v2-dev-plan.md §E6。
 */

import { join, dirname } from 'path'
import * as fs from 'fs'
import { randomUUID } from 'node:crypto'
import { LicenseManager, LicenseIO, LicenseState } from './license'
import { AuditLogger } from './audit'
import { UsageMeter, UsageIO, UsageSnapshot } from './usage'
import { SecretBox, generateMasterKey } from './crypto'

/** 企业版设置项（主进程存进 electron-store；本模块只通过回调读写） */
export interface EnterpriseSettingsPatch {
  deviceId?: string
  masterKey?: string
}

export interface EnterpriseServicesOptions {
  /** 数据根目录（<userData>/worktrace），audit/usage/license 均在其下 */
  baseDir: string
  /** 读取当前主密钥（settings 持久化；空则生成并回调写入） */
  getMasterKey: () => string
  /** 写入主密钥（settings 持久化） */
  setMasterKey: (key: string) => void
  /** 读取设备指纹（settings 持久化；空则生成并回调写入） */
  getDeviceId: () => string
  /** 写入设备指纹（settings 持久化） */
  setDeviceId: (id: string) => void
  /** 注入当前时间（测试用） */
  now?: number
}

/** 企业版服务集合（主进程持有单例） */
export interface EnterpriseServices {
  license: LicenseManager
  audit: AuditLogger
  usage: UsageMeter
  secretBox: SecretBox
  deviceId: string
  /** 当前主密钥（供主进程加密 API Key 使用） */
  masterKey: string
}

/** 构造 license 的 LicenseIO：持久化到 <baseDir>/enterprise/license.json */
function createLicenseIO(baseDir: string): LicenseIO {
  const filePath = join(baseDir, 'enterprise', 'license.json')
  return {
    read(): Partial<LicenseState> {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<LicenseState>
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    },
    write(state: LicenseState): void {
      try {
        fs.mkdirSync(dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
      } catch (error) {
        // 持久化失败不阻断主链路（与 audit 一致）
        console.error('[Enterprise] license 持久化失败:', error)
      }
    }
  }
}

/** 构造 usage 的 UsageIO：持久化到 <baseDir>/usage/<day>.json（单日单文件） */
function createUsageIO(baseDir: string): UsageIO {
  return {
    read(day: string): UsageSnapshot | null {
      const filePath = join(baseDir, 'usage', `${day}.json`)
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw) as UsageSnapshot
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    },
    write(snapshot: UsageSnapshot): void {
      try {
        fs.mkdirSync(join(baseDir, 'usage'), { recursive: true })
        fs.writeFileSync(join(baseDir, 'usage', `${snapshot.date}.json`), JSON.stringify(snapshot), 'utf-8')
      } catch (error) {
        console.error('[Enterprise] usage 持久化失败:', error)
      }
    }
  }
}

/** 统一初始化企业版服务；设备指纹与主密钥缺失时自动生成并回调写入。 */
export function createEnterpriseServices(opts: EnterpriseServicesOptions): EnterpriseServices {
  const baseDir = opts.baseDir

  // 设备指纹：settings 已有则复用，否则生成 UUID 并回写
  let deviceId = opts.getDeviceId().trim()
  if (!deviceId) {
    deviceId = randomUUID()
    opts.setDeviceId(deviceId)
  }

  // 主密钥：settings 已有则复用（校验 64 hex 格式，非法则重新生成并回写），否则生成并回写
  let masterKey = opts.getMasterKey().trim()
  if (!/^[0-9a-f]{64}$/i.test(masterKey)) {
    if (masterKey) {
      console.error('[Enterprise] 检测到非法主密钥，重新生成（原密钥对应密文将无法解密）')
    }
    masterKey = generateMasterKey()
    opts.setMasterKey(masterKey)
  }

  const license = new LicenseManager(
    { deviceId, now: opts.now },
    createLicenseIO(baseDir)
  )
  const audit = new AuditLogger(join(baseDir, 'audit', 'audit.jsonl'))
  const usage = new UsageMeter(createUsageIO(baseDir))
  const secretBox = new SecretBox(masterKey)

  return { license, audit, usage, secretBox, deviceId, masterKey }
}
