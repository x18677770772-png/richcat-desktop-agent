// src/core/features/daily-report/index.ts
// ── F6 服务日报：调度器（23:50 定时生成 + 手动生成 + 通知）──
// 设计文档：docs/richcat-v2-design.md §3-F6。
//
// 关键设计：
// - 定时器仅 f6.daily_report flag 开时注册（start() 内判定；flag 关 → 不挂任何定时器）；
// - 防重复：单定时器句柄，start() 前先 stop() 清旧句柄；每日触发后递归排下一次；
// - 生命周期：before-quit / stopEngineCore 调用 stop() 清理，重启不叠加（验收 3）；
// - 生成失败/通知失败全部 try/catch，绝不影响主进程其它逻辑；
// - 回滚：本目录为 F6 独立 commit；revert 后定时器与生成逻辑消失，reports/*.md 残留无害。

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { FeatureFlags } from '../flags'
import { DailyReportGenerator, DailyReportData } from './report'
import { dailyReportFilePath, renderDailyReport } from './section'

export { DailyReportGenerator } from './report'
export { renderDailyReport, dailyReportFilePath } from './section'

export interface DailyReportSchedulerOptions {
  flags: FeatureFlags
  generator: DailyReportGenerator
  /** reports 输出根目录（<worktraceBaseDir>/reports） */
  reportsBaseDir: () => string
  /** 推给所有 renderer 窗口（report:ready 事件） */
  notify(payload: { type: string; data?: unknown }): void
  /** 桌面通知（主进程实现；缺省则只发 renderer 事件） */
  notifyDesktop?(title: string, body: string): void
  /** 定时生成时刻（本地时区；默认 23:50） */
  scheduleTime?: { hour: number; minute: number }
}

export interface GenerateReportResult {
  ok: boolean
  path?: string
  date?: string
  error?: string
}

/** F6 特征模块（形状与 docs §3.0 FeatureModule 兼容；C0 hooks 落地后可并入注册表） */
export interface DailyReportFeatureModule {
  flagKey: 'f6.daily_report'
  /** 定时触发（每日校准；仅 flag 开时由调度器调用） */
  onTimer(kind: 'daily_report', now: Date): Promise<void>
}

export class DailyReportScheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly flags: FeatureFlags
  private readonly generator: DailyReportGenerator
  private readonly reportsBaseDir: () => string
  private readonly notify: (payload: { type: string; data?: unknown }) => void
  private readonly notifyDesktop?: (title: string, body: string) => void
  private readonly hour: number
  private readonly minute: number

  constructor(options: DailyReportSchedulerOptions) {
    this.flags = options.flags
    this.generator = options.generator
    this.reportsBaseDir = options.reportsBaseDir
    this.notify = options.notify
    this.notifyDesktop = options.notifyDesktop
    this.hour = options.scheduleTime?.hour ?? 23
    this.minute = options.scheduleTime?.minute ?? 50
  }

  /**
   * 注册每日定时器。仅 f6.daily_report 开启时挂载；已注册时先清理（防重复）。
   * flag 关闭 → 确保无定时器残留后直接返回（验收 1：无 setInterval/setTimeout 挂载）。
   */
  start(): void {
    this.stop()
    if (!this.flags.isEnabled('f6.daily_report')) {
      console.log('[DailyReport] f6.daily_report 关闭，不注册日报定时器（关闭零影响）')
      return
    }
    console.log(
      `[DailyReport] 日报定时器已注册（每日 ${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')} 生成）`
    )
    this.scheduleNext()
  }

  /** 清理定时器（before-quit / 引擎停止时调用，防止重复注册） */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 立即生成当日日报（IPC report:generate 手动触发；调用方控制 flag） */
  async generateNow(day: Date = new Date()): Promise<GenerateReportResult> {
    return this.generate(day)
  }

  /** FeatureModule.onTimer 委托（供将来 FeatureRegistry 接入） */
  onTimer = async (_kind: 'daily_report', now: Date): Promise<void> => {
    await this.generate(now)
  }

  private scheduleNext(): void {
    const now = new Date()
    const next = this.nextRunTime(now)
    const delayMs = Math.max(0, next.getTime() - now.getTime())
    this.timer = setTimeout(() => {
      this.timer = null
      // 触发时再次校验 flag（运行中用户可能关掉开关 → 停止后续排程）
      if (!this.flags.isEnabled('f6.daily_report')) {
        console.log('[DailyReport] 触发时 f6 已关闭，停止日报定时器')
        return
      }
      this.generate(next).catch((error) => {
        console.error('[DailyReport] 定时生成失败:', error)
      })
      this.scheduleNext()
    }, delayMs)
    // 长延时定时器不阻止进程退出
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** 下一个计划时刻（若今日时刻已过 → 明天同一时刻） */
  private nextRunTime(from: Date): Date {
    const next = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate(),
      this.hour,
      this.minute,
      0,
      0
    )
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1)
    }
    return next
  }

  private async generate(day: Date): Promise<GenerateReportResult> {
    try {
      const data: DailyReportData = await this.generator.generate(day)
      const markdown = renderDailyReport(data)
      const baseDir = this.reportsBaseDir()
      const filePath = dailyReportFilePath(baseDir, data.date)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${markdown}\n`, 'utf8')

      console.log(`[DailyReport] 日报已生成: ${filePath}`)
      this.notify({ type: 'report:ready', data: { path: filePath, date: data.date } })
      try {
        this.notifyDesktop?.(
          `服务日报（${data.date}）`,
          `服务 ${data.servedCustomers.length} 位客户 / VIP ${data.vipServed.length} 位 / 轮次 ${data.traceSessionsToday.length} 轮`
        )
      } catch (error) {
        console.error('[DailyReport] 桌面通知失败:', error)
      }
      return { ok: true, path: filePath, date: data.date }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[DailyReport] 生成日报失败:', error)
      return { ok: false, error: message }
    }
  }
}
