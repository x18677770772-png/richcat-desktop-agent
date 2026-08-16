// src/core/features/daily-report/section.ts
// ── F6 服务日报：中文 Markdown 模板（渲染 + 文件路径）──
// 设计文档：docs/richcat-v2-design.md §3-F6（输出 reports/YYYY-MM-DD.md）。
// 无数据当日也生成（各节显示 0/无）；节内名单超长时截断展示。

import { join } from 'node:path'
import { DailyReportData } from './report'
import { formatDayKey } from './report'

/** 名单展示上限（超出折叠为计数） */
const LIST_SHOW_LIMIT = 10

/** 日报文件路径：<worktraceBaseDir>/reports/YYYY-MM-DD.md */
export function dailyReportFilePath(baseDir: string, date: string): string {
  return join(baseDir, 'reports', `${date}.md`)
}

/** 把当日汇总渲染成中文 Markdown 日报 */
export function renderDailyReport(data: DailyReportData): string {
  const lines: string[] = []
  const dateLabel = data.date
  const dayLabel = new Date(data.dayStart).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })

  lines.push(`# 财听猫 RichCat 服务日报（${dateLabel}）`)
  lines.push('')
  lines.push(`> ${dayLabel}`)
  lines.push('')

  // 1. 服务概览
  lines.push('## 一、服务概览')
  lines.push('')
  lines.push(`- 服务客户数：**${data.servedCustomers.length}** 位`)
  lines.push(`- 服务轮次：**${data.traceSessionsToday.length}** 轮（今日轨迹会话数）`)
  lines.push(`- VIP 互动：**${data.vipServed.length}** 位`)
  lines.push(`- 情绪风险客户：**${data.riskCustomers.length}** 位`)
  lines.push('')

  // 2. 服务客户名单
  lines.push('## 二、服务客户')
  lines.push('')
  if (data.servedCustomers.length === 0) {
    lines.push('今日暂无服务记录。')
  } else {
    const names = data.servedCustomers.map((customer) => customer.name)
    lines.push(listNames(names))
  }
  lines.push('')

  // 3. VIP 动态（今日新增 / 今日互动）
  lines.push('## 三、VIP 动态')
  lines.push('')
  if (data.vipNewToday.length > 0) {
    lines.push(`- 今日新增 VIP：${data.vipNewToday.map((customer) => customer.name).join('、')}`)
  } else {
    lines.push('- 今日新增 VIP：无')
  }
  if (data.vipServed.length > 0) {
    lines.push(`- 今日互动 VIP：${listNames(data.vipServed.map((customer) => customer.name))}`)
  } else {
    lines.push('- 今日互动 VIP：无')
  }
  lines.push('')

  // 4. 情绪风险（F5 标签）
  lines.push('## 四、情绪/风险客户')
  lines.push('')
  if (data.riskCustomers.length === 0) {
    lines.push('今日无情绪风险标记（无负面/退款意向/投诉/紧急标签客户互动）。')
  } else {
    for (const customer of data.riskCustomers) {
      const riskTags = customer.tags.filter((tag) =>
        ['情绪负面', '退款意向', '投诉', '紧急'].includes(tag)
      )
      lines.push(`- ${customer.name}（${riskTags.join('、')}）`)
    }
  }
  lines.push('')

  // 5. 今日新增待跟进（F7）
  lines.push('## 五、待跟进（今日新增）')
  lines.push('')
  if (data.followUps.length === 0) {
    lines.push('今日无新增待跟进。')
  } else {
    for (const item of data.followUps) {
      const due = new Date(item.dueAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
      lines.push(`- [${item.contact ?? '未知'}] ${item.action}（到期 ${due}）`)
    }
  }
  lines.push('')

  // 6. 待处理接管（F2）
  lines.push('## 六、待处理人工接管')
  lines.push('')
  if (data.handoffs.length === 0) {
    lines.push('当前无待处理接管。')
  } else {
    for (const item of data.handoffs) {
      lines.push(`- [${item.contact ?? '未知'}] 原因：${item.reason}（置信度 ${item.confidence}）`)
    }
  }
  lines.push('')

  lines.push('---')
  lines.push('*由财听猫 RichCat 自动生成*')
  return lines.join('\n')
}

/** 名单展示：≤10 条全部列出，超过显示「前 10 等共 N 位」 */
function listNames(names: string[]): string {
  if (names.length === 0) return '无'
  if (names.length <= LIST_SHOW_LIMIT) return names.join('、')
  return `${names.slice(0, LIST_SHOW_LIMIT).join('、')} 等共 ${names.length} 位`
}

export { formatDayKey }
