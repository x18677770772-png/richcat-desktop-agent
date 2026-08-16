// src/core/features/daily-report/install.ts
// ── F6 服务日报：主进程装配层（IPC + 定时器 + 通知）──
// main/index.ts 只需一行调用 installDailyReport({...})；before-quit 清理在内部注册。
// 设计文档：docs/richcat-v2-design.md §3-F6（改动文件清单中 main/index.ts 的装配部分）。
//
// 回滚：本文件与 daily-report 模块同属 F6；revert 后定时器与 report:* IPC 消失，
// reports/*.md 残留无害。独立成文件使 main/index.ts 的改动面最小（1 import + 1 调用）。

import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'node:path'
import * as fs from 'node:fs'
import { FeatureFlags } from '../flags'
import { DailyReportGenerator, DailyReportScheduler, GenerateReportResult } from './index'
import { FollowUpLike, HandoffLike } from './report'
import { TraceSessionMeta } from '../../trace/trace-types'
import { CustomerStore } from '../../customers/customer-store'

export interface InstallDailyReportOptions {
  flags: FeatureFlags
  getCustomerStore: () => CustomerStore
  worktraceBaseDir: () => string
  listTraceSessions: (baseDir: string) => Promise<TraceSessionMeta[]>
  /** F7 落地后注入（缺省 → 日报「待跟进」节显示 0/无） */
  listFollowUps?: () => FollowUpLike[]
  /** F2 落地后注入（缺省 → 日报「接管」节显示 0/无） */
  listHandoffs?: () => HandoffLike[]
}

/** installDailyReport 返回句柄（main 保存引用供统一 onTimer 与显式清理） */
export interface DailyReportHandle {
  stop(): void
  generateNow(day?: Date): Promise<GenerateReportResult>
}

/**
 * 装配 F6 服务日报：创建调度器（定时器仅 f6 flag 开时注册，防重复）、
 * 注册 report:generate / report:read IPC、挂 before-quit 清理。
 * 返回 { stop, generateNow } 供 main 统一 onTimer 与显式清理（可选；before-quit 已自动注册）。
 */
export function installDailyReport(options: InstallDailyReportOptions): DailyReportHandle {
  const scheduler = new DailyReportScheduler({
    flags: options.flags,
    generator: new DailyReportGenerator({
      customerStore: options.getCustomerStore,
      worktraceBaseDir: options.worktraceBaseDir,
      listTraceSessions: options.listTraceSessions,
      listFollowUps: options.listFollowUps,
      listHandoffs: options.listHandoffs
    }),
    reportsBaseDir: options.worktraceBaseDir,
    notify: (payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('engine:event', payload)
      }
    },
    notifyDesktop: (title, body) => {
      try {
        if (Notification.isSupported()) {
          new Notification({ title, body }).show()
        }
      } catch (error) {
        console.error('[DailyReport] 桌面通知失败:', error)
      }
    }
  })
  scheduler.start()

  ipcMain.handle('report:generate', async () => {
    if (!options.flags.isEnabled('f6.daily_report')) {
      return { ok: false, error: 'f6_disabled', message: '服务日报功能未开启' }
    }
    return scheduler.generateNow()
  })

  ipcMain.handle('report:read', async (_event, date: unknown) => {
    if (!options.flags.isEnabled('f6.daily_report')) return null
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
    try {
      return await fs.promises.readFile(
        join(options.worktraceBaseDir(), 'reports', `${date}.md`),
        'utf8'
      )
    } catch {
      return null
    }
  })

  const stop = (): void => scheduler.stop()
  app.on('before-quit', stop)
  return { stop, generateNow: (day?: Date) => scheduler.generateNow(day) }
}
