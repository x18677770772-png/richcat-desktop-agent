// src/core/rpa/image-reading.ts
// 图片消息读取 — 点开聊天中的图片，读取大图内容
//
// 聊天区里的图片缩略图太小，VLM 无法识别内容。流程：
//   1. 检测当前对话中对方最新发来的图片消息（VLM 定位气泡）
//   2. 点击缩略图 → 微信打开图片查看器（大图）
//   3. 全屏截图 → VLM 读取图片内容
//   4. Esc 关闭查看器，恢复聊天窗口
//
// 只处理「对方发来的图片/表情包」；文件卡片不点击（会触发下载）。

import { AIClient } from '../ai-client'
import { BBox } from './vision-utils'
import { captureScreenRegion } from './screenshot-utils'
import { getRobot, delay } from './util'
import { screen } from 'electron'

/** 检测图片气泡的 VLM prompt（输出归一化 bbox 或 none） */
const DETECT_IMAGE_PROMPT = `你是一个微信聊天记录分析专家。这是一张微信 PC 客户端窗口截图（左侧是联系人列表，右侧是对话区）。
请判断对话区中**最新一条消息**是否是对面联系人发来的**图片或表情包**消息。
- 如果是：输出该图片缩略图的位置，格式：<bbox>x1,y1,x2,y2</bbox>，坐标为 0-1000 的归一化坐标（相对整张截图）
- **bbox 必须紧贴图片缩略图本身的四条边**：只框图片矩形，不要包含头像、不要包含消息气泡的白色背景、不要包含任何文字或空白区域
- 如果不是（最新消息是文字、语音、或是我方发送的图片/文字）：输出 none
- 文件卡片、小程序卡片、转账红包等**不要点击**，输出 none
只输出 <bbox>...</bbox> 或 none，不要输出任何其他内容。`

/** 读取大图内容的 VLM prompt */
const READ_IMAGE_PROMPT = `这是一张从微信聊天中打开的图片（画面里可能包含图片本身和微信图片查看器的界面）。
请忽略查看器工具栏、按钮等界面元素，专注描述图片**主体内容**：
- 如果是照片：描述画面中的人物、场景、物品、可见文字
- 如果是截图或文档：尽量完整读出其中的文字内容
- 如果是表情包：描述表情的含义和配文
用中文简洁描述，150 字以内。`

/**
 * 检测截图中对方最新发来的图片消息气泡。
 * 返回归一化 bbox（相对整张截图，0-1000）；没有图片返回 null。
 */
export async function detectIncomingImage(
  aiClient: AIClient,
  screenshotBase64: string
): Promise<BBox | null> {
  try {
    const raw = await aiClient.detectVision(DETECT_IMAGE_PROMPT, screenshotBase64)
    const match = raw.match(/<bbox>\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*<\/bbox>/i)
    if (!match) return null
    const values = match.slice(1).map(Number)
    if (!values.every((v) => Number.isFinite(v))) return null
    const [x1, y1, x2, y2] = values
    // 基本合法性校验：坐标在 0-1000 内，宽高合理
    if (x1 < 0 || y1 < 0 || x2 > 1000 || y2 > 1000) return null
    if (Math.abs(x2 - x1) < 5 || Math.abs(y2 - y1) < 5) return null
    return [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]
  } catch (error) {
    console.error('[image-reading] 图片气泡检测失败:', error)
    return null
  }
}

/** 读取大图内容（中文描述） */
export async function readImageContent(
  aiClient: AIClient,
  imageBase64: string
): Promise<string> {
  const raw = await aiClient.detectVision(READ_IMAGE_PROMPT, imageBase64)
  return raw?.trim() || ''
}

/** 归一化 bbox（相对窗口 0-1000）→ 屏幕物理像素坐标（中心点）。
 *  注意：与 vision-utils.bboxToScreenCoords 保持一致，必须乘 scaleFactor——
 *  robotjs 的鼠标坐标是物理像素，不乘会在非 100% 缩放下产生点击偏移。 */
export function bboxToScreenCoords(
  bbox: BBox,
  windowBounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): [number, number] {
  const [x1, y1, x2, y2] = bbox
  const logicalX = ((x1 + x2) / 2 / 1000) * windowBounds.width
  const logicalY = ((y1 + y2) / 2 / 1000) * windowBounds.height
  return [
    Math.round((windowBounds.x + logicalX) * scaleFactor),
    Math.round((windowBounds.y + logicalY) * scaleFactor)
  ]
}

/** 全屏截图（微信图片查看器所在屏幕），返回 base64 */
export async function captureFullScreenImage(): Promise<string | null> {
  try {
    const primary = screen.getPrimaryDisplay()
    const bounds = primary.bounds
    const result = await captureScreenRegion({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    })
    if (!result.success || !result.screenshotBase64) {
      console.error('[image-reading] 全屏截图失败:', result.error)
      return null
    }
    return result.screenshotBase64
  } catch (error) {
    console.error('[image-reading] 全屏截图异常:', error)
    return null
  }
}

/** 按 Esc 关闭微信图片查看器（无查看器时按下无害） */
export async function pressEscape(): Promise<void> {
  const robot = getRobot()
  if (!robot) return
  try {
    robot.keyTap('escape')
  } catch (error) {
    console.error('[image-reading] Esc 失败:', error)
  }
}

/** 点击图片后等待查看器打开的延迟 */
export async function waitForImageViewer(): Promise<void> {
  await delay(1200 + Math.random() * 400)
}
