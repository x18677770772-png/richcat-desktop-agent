import { app, shell, BrowserWindow, ipcMain, desktopCapturer } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { checkAndRequestPermissions } from './permission'
import Store from 'electron-store'
import { AIClient, buildKnowledgeSection, SmartReplyResult } from '../core/ai-client'
import { LocalProvider } from '../core/local-provider'
import { DesktopDevice } from '../core/device'
import { RPADevice } from '../core/rpa-device'
import { BoxSelectDevice } from '../core/box-select-device'
import { RuntimeHost } from '../core/runtime-host'
import {
  createInitialGenericChannelState,
  GenericChannelSession
} from '../core/generic-channel-session'
import { AppType, BoxRegions, CaptureStrategy, isWechatLike } from '../core/rpa/types'
import { runBoxSelectWizard, type WizardStepKey } from './overlay-window'
import {
  BUILTIN_DOUBAO_PROVIDER_ID,
  getBuiltinDoubaoInstalledInfo,
  getBuiltinDoubaoManifestForUi,
  getInstalledProviderManifest,
  installProviderFromUrl,
  InstalledProviderInfo,
  loadInstalledProvider
} from './provider-bundle'
import {
  SkillEngineController,
  SkillPauseResult,
  SkillStartResult,
  startSkillServer,
  stopSkillServer
} from './skill-server'
import {
  listTraceSessions,
  readTraceScreenshot,
  readTraceSession,
  TraceRecorder
} from '../core/trace/trace-recorder'
import { TraceStepInput } from '../core/trace/trace-types'
import { ProviderAdapter, ProviderInput, GroupChatContext } from '../core/session-types'
import { ExperienceStore, NewExperienceCard } from '../core/memory/experience-store'
import { induceCardsFromSession } from '../core/memory/learn-from-session'
import { PersonaStore, NewPersona } from '../core/persona/persona-store'
import { KnowledgeStore, NewKnowledgeItem } from '../core/knowledge/knowledge-store'
import { CustomerStore, CustomerPatch } from '../core/customers/customer-store'
// ── V2 功能开关（Feature Flags，阶段 0 / C0）──
import {
  FeatureFlags,
  FeatureFlagKey,
  isFeatureFlagKey,
  normalizeFeatures
} from '../core/features/flags'
// ── F1 群聊支持（阶段 1）──
import { createGroupChatFeature, GroupChatDetector } from '../core/features/group-chat'
// ── F6 服务日报（阶段 2；装配层在 features/daily-report/install.ts，本文件仅两行接线）──
import { installDailyReport } from '../core/features/daily-report/install'
const StoreClass = typeof Store === 'function' ? Store : ((Store as any).default as typeof Store)

// ── 多开支持：--profile=<name> 数据隔离 ──
// 每个 profile 使用独立的 userData 子目录（%APPDATA%/RichCat/profile-<name>），
// 各自拥有独立的 settings / 客户档案 / 知识库 / 角色 / 轨迹，互不干扰。
// 典型用法：同时服务多个微信账号 —— 每个微信实例配一个 profile。
const PROFILE = (() => {
  const arg = process.argv.find((a) => a.startsWith('--profile='))
  if (!arg) return ''
  // 白名单字符，防止路径注入
  return arg.slice('--profile='.length).trim().replace(/[^a-zA-Z0-9_-]/g, '_')
})()
if (PROFILE) {
  app.setPath('userData', join(app.getPath('userData'), `profile-${PROFILE}`))
  console.log(`[RichCat] 多开模式：profile=${PROFILE}，数据目录=${app.getPath('userData')}`)
}

// ── 品牌升级：SightFlow → 财听猫 RichCat ──
// 应用改名后 userData 目录（%APPDATA%/RichCat）与旧目录（%APPDATA%/sightflow-desktop-agent）
// 不再相同。首次启动时把旧目录里的 settings / 客户档案 / 知识库 / 角色 / 轨迹等
// 整体迁移到新目录，避免用户数据丢失。只迁移一次（新目录不存在时）。
// 注意：app.getPath('userData') 被调用时 Electron 会立即创建该目录（含 app name 子路径），
// 因此必须先按 appData + app.getName() 推算新目录名，再判断“新目录是否已存在”，
// 否则 existsSync 恒为 true，迁移永远不会执行。
// 多开 profile 实例不做旧数据迁移（各自全新开始）。
const OLD_USER_DATA_DIR = join(app.getPath('appData'), 'sightflow-desktop-agent')
const NEW_USER_DATA_DIR = join(app.getPath('appData'), app.getName())
if (!PROFILE && OLD_USER_DATA_DIR !== NEW_USER_DATA_DIR) {
  try {
    if (fs.existsSync(OLD_USER_DATA_DIR) && !fs.existsSync(NEW_USER_DATA_DIR)) {
      fs.cpSync(OLD_USER_DATA_DIR, NEW_USER_DATA_DIR, { recursive: true })
      console.log('[RichCat] 已从旧数据目录迁移用户数据:', OLD_USER_DATA_DIR, '→', NEW_USER_DATA_DIR)
    }
  } catch (error) {
    console.error('[RichCat] 用户数据迁移失败（不影响启动，后续可手动复制）:', error)
  }
}

const FIXED_ARK_MODEL = 'doubao-seed-2-0-lite-260215'
const FIXED_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

interface PerAppCapture {
  strategy: CaptureStrategy
  regions: BoxRegions | null
}

interface AppSettings {
  locale: 'zh' | 'en'
  appType: AppType
  vision: {
    apiKey: string
    /** 视觉模型 Base URL（OpenAI 兼容端点）；留空用默认方舟 /api/v3 */
    baseURL?: string
    /** 视觉模型名；留空用默认 doubao-seed */
    model?: string
  }
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    config: Record<string, any>
  }
  // 默认抓取策略（仅当 appType 没有 per-app 覆盖时生效）
  defaultCaptureStrategy: CaptureStrategy
  // 每个 appType 独立保存的策略 + 框选区域
  capture: Partial<Record<AppType, PerAppCapture>>
  // V2 功能开关（白名单校验，见 src/core/features/flags.ts；缺失 key 用默认值）
  features: Partial<Record<FeatureFlagKey, boolean>>
  // V2 功能专属配置（白名单归一化见 normalizeFeaturesConfig；缺失用默认值）
  featuresConfig?: {
    /** F1 群聊支持：机器人昵称列表 + 纯 @ 触发模式 */
    f1?: { botNames?: string[]; mentionOnly?: boolean }
  }
}

type ProviderConfigFieldType = 'text' | 'password' | 'url' | 'select' | 'textarea'

type ProviderConfigField = {
  key: string
  label: string
  type: ProviderConfigFieldType
  required?: boolean
  readonly?: boolean
  placeholder?: string
  hint?: string
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
}

type ProviderCatalogItem = {
  id: string
  name: string
  description?: string
  version: string
  manifestUrl: string
  capabilities?: string[]
  configSchema: {
    fields: ProviderConfigField[]
  }
}

type ProviderHubCache = {
  sourceUrl: string
  fetchedAt: string
  providers: ProviderCatalogItem[]
}

type ProviderHubEntry = {
  id?: unknown
  enabled?: unknown
  manifestUrl?: unknown
}

type ProviderHubManifest = {
  id?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
  capabilities?: unknown
  configSchema?: unknown
}

const DEFAULT_PROVIDER_HUB_URL =
  process.env.SIGHTFLOW_PROVIDER_HUB_URL || 'https://sightflow.dev/provider-hub.json'
const PROVIDER_HUB_CACHE_KEY = 'providerHubCache'

const settingsStore = new StoreClass({
  name: 'settings',
  defaults: {
    locale: 'zh',
    appType: 'wechat',
    vision: { apiKey: '', baseURL: '', model: '' },
    chatProvider: {
      manifestUrl: '',
      installed: null,
      config: {}
    },
    defaultCaptureStrategy: 'auto',
    capture: {},
    featuresConfig: {}
  }
})

// ── V2 功能开关单例：读取归一化后的 settings.features，写入回 settingsStore ──
const featureFlags = new FeatureFlags(
  () => normalizeSettings(settingsStore.store).features,
  (flags) => {
    // 用 key-path 写入，避免整对象合并时的类型强转
    settingsStore.set('features', flags)
  }
)

// ── F1 群聊检测器单例（懒创建；flag 关闭时不会被调用）──
let groupChatDetectorInstance: GroupChatDetector | null = null
function getGroupChatDetector(): GroupChatDetector {
  if (!groupChatDetectorInstance) {
    const settings = normalizeSettings(settingsStore.store)
    const vision = resolveVisionConfig(settings)
    const ai = new AIClient({
      apiKey: vision.apiKey,
      model: vision.model || FIXED_ARK_MODEL,
      baseURL: vision.baseURL || FIXED_ARK_BASE_URL
    })
    groupChatDetectorInstance = new GroupChatDetector(ai, {
      botNames: settings.featuresConfig?.f1?.botNames ?? [],
      mentionOnly: settings.featuresConfig?.f1?.mentionOnly ?? false
    })
    console.log(
      `[Main] GroupChatDetector 已创建（botNames=${(settings.featuresConfig?.f1?.botNames ?? []).join('、') || '无'}, mentionOnly=${settings.featuresConfig?.f1?.mentionOnly ?? false}）`
    )
  }
  return groupChatDetectorInstance
}

/**
 * F1 群聊上下文提供者：f1 flag 关闭 → 立即返回 undefined（零 VLM 调用、零影响）；
 * 开启 → 调用检测器（失败由检测器内部兜底为 isGroup=false，不抛错）。
 */
function getGroupChatContextForSession(screenshot: string): Promise<GroupChatContext | undefined> {
  if (!featureFlags.isEnabled('f1.group_chat')) {
    return Promise.resolve(undefined)
  }
  return getGroupChatDetector().detect(screenshot)
}

/** F1 后置过滤（LocalProvider.transformResult 注入点）：仅 f1 开且为群聊时生效 */
function filterF1GroupChatResult(result: SmartReplyResult, input: ProviderInput): SmartReplyResult {
  const groupChat = input.groupChat
  if (!featureFlags.isEnabled('f1.group_chat') || !groupChat?.isGroup) return result
  return createGroupChatFeature().filterResult(result, groupChat)
}

let runtime: RuntimeHost<ReturnType<typeof createInitialGenericChannelState>> | null = null
let runtimeDevice: DesktopDevice | null = null
let runtimeProvider: ProviderAdapter | null = null
let settingsWindow: BrowserWindow | null = null
let memoryWindow: BrowserWindow | null = null
let knowledgeWindow: BrowserWindow | null = null
let customerWindow: BrowserWindow | null = null

// ── 工作记忆（work-trace + 经验卡片）单例，首次使用时初始化 ──
let traceRecorderInstance: TraceRecorder | null = null
let experienceStoreInstance: ExperienceStore | null = null

// ── AI 客服工作台（角色 / 知识库 / 客户档案）单例 ──
let personaStoreInstance: PersonaStore | null = null
let knowledgeStoreInstance: KnowledgeStore | null = null
let customerStoreInstance: CustomerStore | null = null

function worktraceBaseDir(): string {
  return join(app.getPath('userData'), 'worktrace')
}

function getTraceRecorder(): TraceRecorder {
  if (!traceRecorderInstance) {
    traceRecorderInstance = new TraceRecorder(worktraceBaseDir())
  }
  return traceRecorderInstance
}

function getExperienceStore(): ExperienceStore {
  if (!experienceStoreInstance) {
    experienceStoreInstance = new ExperienceStore(join(worktraceBaseDir(), 'memory', 'cards.json'))
  }
  return experienceStoreInstance
}

function getPersonaStore(): PersonaStore {
  if (!personaStoreInstance) {
    personaStoreInstance = new PersonaStore(join(worktraceBaseDir(), 'memory', 'personas.json'))
  }
  return personaStoreInstance
}

function getKnowledgeStore(): KnowledgeStore {
  if (!knowledgeStoreInstance) {
    knowledgeStoreInstance = new KnowledgeStore(join(worktraceBaseDir(), 'memory', 'knowledge.json'))
  }
  return knowledgeStoreInstance
}

function getCustomerStore(): CustomerStore {
  if (!customerStoreInstance) {
    customerStoreInstance = new CustomerStore(
      join(worktraceBaseDir(), 'customers', 'customers.json')
    )
  }
  return customerStoreInstance
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 360,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#0a0b10',
    title: PROFILE ? `财听猫 RichCat · ${PROFILE}` : '财听猫 RichCat',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 860,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0a0b10',
    title: PROFILE ? `财听猫 RichCat · ${PROFILE} · 设置` : '财听猫 RichCat · 设置',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  settingsWindow.on('ready-to-show', () => {
    settingsWindow?.show()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  settingsWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?window=settings`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'settings' }
    })
  }
}

function createMemoryWindow(): void {
  if (memoryWindow && !memoryWindow.isDestroyed()) {
    memoryWindow.show()
    memoryWindow.focus()
    return
  }

  memoryWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    title: PROFILE ? `财听猫 RichCat · ${PROFILE} · 工作记忆` : '财听猫 RichCat · 工作记忆',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0a0b10',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  memoryWindow.on('ready-to-show', () => {
    memoryWindow?.show()
  })

  memoryWindow.on('closed', () => {
    memoryWindow = null
  })

  memoryWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    memoryWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?window=memory`)
  } else {
    memoryWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'memory' }
    })
  }
}

function createKnowledgeWindow(): void {
  if (knowledgeWindow && !knowledgeWindow.isDestroyed()) {
    knowledgeWindow.show()
    knowledgeWindow.focus()
    return
  }

  knowledgeWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0a0b10',
    title: PROFILE ? `财听猫 RichCat · ${PROFILE} · 知识库` : '财听猫 RichCat · 知识库',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  knowledgeWindow.on('ready-to-show', () => {
    knowledgeWindow?.show()
  })

  knowledgeWindow.on('closed', () => {
    knowledgeWindow = null
  })

  knowledgeWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    knowledgeWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?window=knowledge`)
  } else {
    knowledgeWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'knowledge' }
    })
  }
}

function createCustomerWindow(): void {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.show()
    customerWindow.focus()
    return
  }

  customerWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 920,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0a0b10',
    title: PROFILE ? `财听猫 RichCat · ${PROFILE} · 客户管理` : '财听猫 RichCat · 客户管理',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  customerWindow.on('ready-to-show', () => {
    customerWindow?.show()
  })

  customerWindow.on('closed', () => {
    customerWindow = null
  })

  customerWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    customerWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?window=customer`)
  } else {
    customerWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'customer' }
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeFieldType(value: unknown, format?: unknown): ProviderConfigFieldType {
  if (value === 'password' || value === 'url' || value === 'select' || value === 'textarea') {
    return value
  }
  if (format === 'password') return 'password'
  if (format === 'uri' || format === 'url') return 'url'
  return 'text'
}

function normalizeOptions(value: unknown): Array<{ label: string; value: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const options = value
    .map((item) => {
      if (typeof item === 'string') return { label: item, value: item }
      if (!isRecord(item)) return null
      const label = typeof item.label === 'string' ? item.label : String(item.value || '')
      const optionValue = typeof item.value === 'string' ? item.value : ''
      return optionValue ? { label, value: optionValue } : null
    })
    .filter(Boolean) as Array<{ label: string; value: string }>
  return options.length ? options : undefined
}

function normalizeManifestConfigFields(configSchema: unknown): ProviderConfigField[] {
  if (!isRecord(configSchema)) return []

  const required = Array.isArray(configSchema.required)
    ? configSchema.required.filter((key): key is string => typeof key === 'string')
    : []

  if (Array.isArray(configSchema.fields)) {
    return configSchema.fields
      .map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null
        return {
          key: field.key,
          label: typeof field.label === 'string' ? field.label : field.key,
          type: normalizeFieldType(field.type),
          required: field.required === true || required.includes(field.key),
          readonly: field.readonly === true,
          placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
          hint: typeof field.hint === 'string' ? field.hint : undefined,
          defaultValue: typeof field.defaultValue === 'string' ? field.defaultValue : undefined,
          options: normalizeOptions(field.options)
        }
      })
      .filter(Boolean) as ProviderConfigField[]
  }

  if (!isRecord(configSchema.properties)) return []

  return Object.entries(configSchema.properties).map(([key, property]) => {
    const schema = isRecord(property) ? property : {}
    const title = typeof schema.title === 'string' ? schema.title : key
    return {
      key,
      label: title,
      type: normalizeFieldType(schema.type, schema.format),
      required: required.includes(key),
      readonly: schema.readonly === true || schema.readOnly === true,
      placeholder: typeof schema.placeholder === 'string' ? schema.placeholder : undefined,
      hint: typeof schema.description === 'string' ? schema.description : undefined,
      defaultValue: typeof schema.default === 'string' ? schema.default : undefined,
      options: normalizeOptions(schema.enum)
    }
  })
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  return response.json()
}

function getCachedProviderHub(): ProviderHubCache | null {
  const cached = settingsStore.get(PROVIDER_HUB_CACHE_KEY)
  if (!isRecord(cached) || !Array.isArray(cached.providers)) return null
  return cached as ProviderHubCache
}

async function fetchProviderHub(url = DEFAULT_PROVIDER_HUB_URL): Promise<ProviderHubCache> {
  const hub = await fetchJson(url)
  if (!isRecord(hub) || !Array.isArray(hub.providers)) {
    throw new Error('Provider hub JSON must contain a providers array')
  }

  const providers = await Promise.all(
    (hub.providers as ProviderHubEntry[])
      .filter((entry) => entry?.enabled !== false && typeof entry?.manifestUrl === 'string')
      .map(async (entry) => {
        const manifestUrl = entry.manifestUrl as string
        const manifest = (await fetchJson(manifestUrl)) as ProviderHubManifest
        const id =
          typeof manifest.id === 'string'
            ? manifest.id
            : typeof entry.id === 'string'
              ? entry.id
              : manifestUrl
        const name = typeof manifest.name === 'string' ? manifest.name : id
        const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
        const capabilities = Array.isArray(manifest.capabilities)
          ? manifest.capabilities.filter((item): item is string => typeof item === 'string')
          : undefined
        const description =
          typeof manifest.description === 'string' ? manifest.description : undefined

        return {
          id,
          name,
          description,
          version,
          manifestUrl,
          capabilities,
          configSchema: {
            fields: normalizeManifestConfigFields(manifest.configSchema)
          }
        }
      })
  )

  const cache = {
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    providers
  }
  settingsStore.set(PROVIDER_HUB_CACHE_KEY, cache)
  return cache
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.richcat.desktop')

  // 检查和请求 macOS 需要的权限
  await checkAndRequestPermissions()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // ── Settings 持久化 ──
  ipcMain.handle('settings:getAll', async () => {
    return normalizeSettings(settingsStore.store)
  })

  ipcMain.handle('settings:get', async (_event, key: string) => {
    const settings = normalizeSettings(settingsStore.store)
    return (settings as Record<string, any>)[key]
  })

  ipcMain.handle('settings:set', async (_event, data: Record<string, any>) => {
    const current = normalizeSettings(settingsStore.store)
    const next = {
      ...current,
      ...data,
      vision: {
        ...current.vision,
        ...(data.vision || {})
      },
      chatProvider: {
        ...current.chatProvider,
        ...(data.chatProvider || {}),
        config: {
          ...current.chatProvider.config,
          ...(data.chatProvider?.config || {})
        }
      },
      capture: {
        ...current.capture,
        ...(data.capture || {})
      }
    } satisfies AppSettings

    settingsStore.set(next as any)
    return { success: true }
  })

  // ── V2 功能开关 IPC（features:*；值合并默认值，非法 key 一律拒绝） ──
  ipcMain.handle('features:getAll', async () => {
    return featureFlags.getAll()
  })

  ipcMain.handle('features:get', async (_event, key: unknown) => {
    if (!isFeatureFlagKey(key)) return false
    return featureFlags.isEnabled(key)
  })

  ipcMain.handle('features:set', async (_event, payload: { key?: unknown; value?: unknown }) => {
    if (!payload || !isFeatureFlagKey(payload.key) || typeof payload.value !== 'boolean') {
      return { success: false, error: 'invalid_feature_flag_payload' }
    }
    featureFlags.set(payload.key, payload.value)
    return { success: true }
  })

  ipcMain.handle('provider:installFromUrl', async (_event, manifestUrl: string) => {
    try {
      const result = await installProviderFromUrl(manifestUrl)
      const current = normalizeSettings(settingsStore.store)
      settingsStore.set({
        ...current,
        chatProvider: {
          ...current.chatProvider,
          manifestUrl,
          installed: result.installed,
          config: withSchemaDefaults(result.manifest.configSchema, current.chatProvider.config)
        }
      } as any)

      return {
        success: true,
        installed: result.installed,
        manifest: result.manifest
      }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('provider:getInstalled', async () => {
    const settings = normalizeSettings(settingsStore.store)

    // 用户安装过自定义 provider：原样返回
    if (settings.chatProvider.installed) {
      const manifest = await getInstalledProviderManifest(settings.chatProvider.installed)
      return {
        installed: settings.chatProvider.installed,
        manifest,
        isBuiltinDefault: false
      }
    }

    // 没装过 → 回退到内置 doubao（apiKey 字段已剥离，使用视觉密钥）
    const installed = await getBuiltinDoubaoInstalledInfo()
    const manifest = await getBuiltinDoubaoManifestForUi()
    return {
      installed,
      manifest,
      isBuiltinDefault: true
    }
  })

  ipcMain.handle('providerHub:getCatalog', async () => {
    const cached = getCachedProviderHub()
    if (cached) return { success: true, catalog: cached }

    try {
      const catalog = await fetchProviderHub()
      return { success: true, catalog }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message, catalog: null }
    }
  })

  ipcMain.handle('providerHub:update', async () => {
    try {
      const catalog = await fetchProviderHub()
      return { success: true, catalog }
    } catch (error: unknown) {
      const cached = getCachedProviderHub()
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message, catalog: cached }
    }
  })

  ipcMain.handle('settings:open', async () => {
    createSettingsWindow()
    return { success: true }
  })

  // ── F8 多实例：返回当前实例的 profile 信息（设置页展示用） ──
  ipcMain.handle('app:getProfile', async () => {
    return { profile: PROFILE, isMultiInstance: PROFILE.length > 0 }
  })

  // ── 工作记忆：轨迹查询 / 回放 ──
  ipcMain.handle('memory:open', async () => {
    createMemoryWindow()
    return { success: true }
  })

  ipcMain.handle('trace:listSessions', async () => {
    return listTraceSessions(worktraceBaseDir())
  })

  ipcMain.handle('trace:getSession', async (_event, sessionId: string) => {
    if (typeof sessionId !== 'string' || !sessionId) return null
    return readTraceSession(worktraceBaseDir(), sessionId)
  })

  ipcMain.handle(
    'trace:getScreenshot',
    async (_event, sessionId: string, screenshotPath: string) => {
      if (typeof sessionId !== 'string' || typeof screenshotPath !== 'string') return null
      return readTraceScreenshot(worktraceBaseDir(), sessionId, screenshotPath)
    }
  )

  // ── 工作记忆：经验卡片 ──
  ipcMain.handle('memory:listCards', async () => {
    return getExperienceStore().listCards()
  })

  ipcMain.handle('memory:learnFromSession', async (_event, sessionId: string) => {
    try {
      const vision = resolveVisionConfig(normalizeSettings(settingsStore.store))
      if (!vision.apiKey) {
        return { success: false, error: '请先在设置中填写视觉接口密钥' }
      }
      const data = await readTraceSession(worktraceBaseDir(), sessionId)
      if (!data || data.steps.length === 0) {
        return { success: false, error: '该轨迹暂无可学习的步骤' }
      }

      const client = new AIClient({
        apiKey: vision.apiKey,
        model: vision.model || FIXED_ARK_MODEL,
        baseURL: vision.baseURL || FIXED_ARK_BASE_URL
      })
      const induced = await induceCardsFromSession(client, data.session, data.steps)
      if (induced.length === 0) {
        return { success: true, cards: [] }
      }

      const cards = getExperienceStore().addCards(
        induced.map((item) => ({
          scenario: item.scenario,
          guidance: item.guidance,
          rationale: item.rationale,
          source: 'agent_summary' as const,
          evidence: { sessionId, stepIds: item.stepIds }
        }))
      )
      return { success: true, cards }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('memory:addCard', async (_event, input: NewExperienceCard) => {
    if (!input?.scenario?.trim() || !input?.guidance?.trim()) {
      return { success: false, error: '场景和做法不能为空' }
    }
    const source: NewExperienceCard['source'] =
      input.source === 'human_takeover' || input.source === 'manual' ? input.source : 'manual'
    const cards = getExperienceStore().addCards([
      {
        scenario: input.scenario,
        guidance: input.guidance,
        rationale: input.rationale,
        source,
        evidence: input.evidence
      }
    ])
    return { success: true, cards }
  })

  ipcMain.handle('memory:deleteCard', async (_event, cardId: string) => {
    return { success: getExperienceStore().deleteCard(cardId) }
  })

  ipcMain.handle('memory:setCardEnabled', async (_event, cardId: string, enabled: boolean) => {
    return { success: getExperienceStore().setEnabled(cardId, enabled === true) }
  })

  // ── 角色设定（Persona） ──
  ipcMain.handle('persona:list', async () => {
    return getPersonaStore().listPersonas()
  })

  ipcMain.handle('persona:getActive', async () => {
    return getPersonaStore().getActivePersona()
  })

  ipcMain.handle('persona:setActive', async (_event, personaId: string | null) => {
    const ok = getPersonaStore().setActivePersona(personaId === null ? null : String(personaId))
    return { success: ok }
  })

  ipcMain.handle('persona:add', async (_event, input: NewPersona) => {
    try {
      const persona = getPersonaStore().addPersona(input)
      return { success: true, persona }
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('persona:update', async (_event, personaId: string, patch) => {
    const ok = getPersonaStore().updatePersona(String(personaId), patch)
    return { success: ok }
  })

  ipcMain.handle('persona:delete', async (_event, personaId: string) => {
    return { success: getPersonaStore().deletePersona(String(personaId)) }
  })

  // ── 知识库 ──
  ipcMain.handle('knowledge:list', async () => {
    return getKnowledgeStore().listItems()
  })

  ipcMain.handle('knowledge:search', async (_event, query: string) => {
    return getKnowledgeStore().search(typeof query === 'string' ? query : '')
  })

  ipcMain.handle('knowledge:add', async (_event, input: NewKnowledgeItem) => {
    try {
      const item = getKnowledgeStore().addItem(input)
      return { success: true, item }
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('knowledge:update', async (_event, itemId: string, patch) => {
    const ok = getKnowledgeStore().updateItem(String(itemId), patch)
    return { success: ok }
  })

  ipcMain.handle('knowledge:delete', async (_event, itemId: string) => {
    return { success: getKnowledgeStore().deleteItem(String(itemId)) }
  })

  ipcMain.handle('knowledge:setEnabled', async (_event, itemId: string, enabled: boolean) => {
    return { success: getKnowledgeStore().setEnabled(String(itemId), enabled === true) }
  })

  ipcMain.handle('knowledge:importText', async (_event, text: string) => {
    if (typeof text !== 'string' || !text.trim()) {
      return { success: false, error: '导入内容不能为空' }
    }
    // 按「标题：内容」或「标题\n内容」分块导入
    const created = getKnowledgeStore().importItems(parseKnowledgeImportText(text))
    return { success: created.length > 0, items: created }
  })

  // ── 客户档案（CRM） ──
  ipcMain.handle('customer:list', async () => {
    return getCustomerStore().listCustomers()
  })

  ipcMain.handle('customer:update', async (_event, customerId: string, patch: CustomerPatch) => {
    return { success: getCustomerStore().updateCustomer(String(customerId), patch) }
  })

  ipcMain.handle('customer:delete', async (_event, customerId: string) => {
    return { success: getCustomerStore().deleteCustomer(String(customerId)) }
  })

  ipcMain.handle('customer:addTags', async (_event, customerId: string, tags: string[]) => {
    return { success: getCustomerStore().addTags(String(customerId), Array.isArray(tags) ? tags : []) }
  })

  ipcMain.handle('customer:removeTag', async (_event, customerId: string, tag: string) => {
    return { success: getCustomerStore().removeTag(String(customerId), String(tag)) }
  })

  ipcMain.handle('customer:setCategory', async (_event, customerId: string, category: string) => {
    return { success: getCustomerStore().setCategory(String(customerId), String(category)) }
  })

  ipcMain.handle('customer:getStats', async () => {
    return getCustomerStore().getStats()
  })

  ipcMain.handle('customer:listTags', async () => {
    return getCustomerStore().listAllTags()
  })

  ipcMain.handle('customer:listCategories', async () => {
    return getCustomerStore().listAllCategories()
  })

  ipcMain.handle('knowledge:open', async () => {
    createKnowledgeWindow()
    return { success: true }
  })

  ipcMain.handle('customer:open', async () => {
    createCustomerWindow()
    return { success: true }
  })

  // ── Runtime / Session IPC（沿用 legacy engine:* 通道名） ──
  ipcMain.handle('engine:start', async (_event, config) => {
    const result = await startEngineCore(config)
    if (result.ok) return { success: true }
    return { success: false, error: result.message || result.reason }
  })

  ipcMain.handle('engine:stop', async (_event, reason?: string) => {
    const result = await stopEngineCore(reason || 'ipc_stop')
    if (result.ok) return { success: true }
    return { success: false, error: result.message || result.reason }
  })

  ipcMain.handle('engine:status', async () => {
    return { running: runtime?.isRunning() ?? false }
  })

  ipcMain.handle('engine:updateConfig', async (_event, config) => {
    const settings = normalizeSettings(config || settingsStore.store)
    if (runtimeDevice) {
      // setVisionConfig 在 BoxSelectDevice 上是 no-op，对 RPADevice 才生效。
      runtimeDevice.setVisionConfig?.(resolveVisionConfig(settings))
      runtimeDevice.setApiKey(settings.vision.apiKey)
      runtimeDevice.setAppType(settings.appType)
    }
    if (runtimeProvider instanceof LocalProvider) {
      runtimeProvider.updateConfig({
        apiKey: settings.chatProvider.config?.apiKey || settings.vision.apiKey,
        model: settings.chatProvider.config?.model || FIXED_ARK_MODEL,
        baseURL: settings.chatProvider.config?.baseURL || FIXED_ARK_BASE_URL,
        systemPrompt: settings.chatProvider.config?.systemPrompt || undefined
      })
    }
    if (runtime) {
      runtime.updateAppType(settings.appType)
    }
    return { success: true }
  })

  ipcMain.handle('engine:testConnection', async (_event, config) => {
    const settings = normalizeSettings(settingsStore.store)
    const vision = resolveVisionConfig(settings)
    const client = new AIClient({
      apiKey: config?.apiKey || vision.apiKey,
      model: config?.model || vision.model || FIXED_ARK_MODEL,
      baseURL: config?.baseURL || vision.baseURL || FIXED_ARK_BASE_URL
    })
    return client.testConnection()
  })

  // ── Capture / 框选向导 IPC ──

  ipcMain.handle(
    'capture:openSetupWizard',
    async (_event, args: { appType: AppType; steps?: WizardStepKey[] }) => {
      const settings = normalizeSettings(settingsStore.store)
      const appType = coerceAppType(args?.appType)
      const prefill = settings.capture[appType]?.regions ?? null

      const result = await runBoxSelectWizard({ appType, steps: args?.steps, prefill })
      if (!result.ok || !result.regions) {
        return { success: false, reason: result.reason || 'cancelled' }
      }

      // 持久化区域到 settings.capture[appType]，但保留已有 strategy（默认 'auto'）
      const current = normalizeSettings(settingsStore.store)
      const next: AppSettings = {
        ...current,
        capture: {
          ...current.capture,
          [appType]: {
            strategy: current.capture[appType]?.strategy ?? 'auto',
            regions: result.regions
          }
        }
      }
      settingsStore.set(next as any)
      notifyCaptureRegionsUpdated(appType, result.regions)
      return { success: true, regions: result.regions }
    }
  )

  ipcMain.handle('capture:getRegions', async (_event, appType: AppType) => {
    const settings = normalizeSettings(settingsStore.store)
    return settings.capture[coerceAppType(appType)]?.regions ?? null
  })

  ipcMain.handle('capture:resetRegions', async (_event, appType: AppType) => {
    const current = normalizeSettings(settingsStore.store)
    const key = coerceAppType(appType)
    const next: AppSettings = {
      ...current,
      capture: {
        ...current.capture,
        [key]: { strategy: current.capture[key]?.strategy ?? 'auto', regions: null }
      }
    }
    settingsStore.set(next as any)
    notifyCaptureRegionsUpdated(key, null)
    return { success: true }
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('capture-screen', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      if (sources && sources.length > 0) {
        return sources[0].thumbnail.toDataURL()
      }
      return null
    } catch (error) {
      console.error('Screen capture failed:', error)
      return null
    }
  })

  // ── 测试入口：VLM 并行 vs 串行 ──
  ipcMain.handle('test:vlm-parallel', async () => {
    const apiKey = normalizeSettings(settingsStore.store).vision.apiKey
    if (!apiKey) return { error: '请先在设置中填写视觉接口密钥' }
    const { runVlmParallelTest } = await import('../core/rpa/tests/test-vlm-parallel')
    return await runVlmParallelTest(apiKey, 'wechat')
  })

  // ── Skill HTTP Server（OpenClaw 远程启动 / 暂停接入点） ──
  startSkillServer(skillEngineController, PROFILE)

  // ── F6 服务日报装配（定时器仅 f6 flag 开时注册；before-quit 清理在 install 内部）──
  installDailyReport({
    flags: featureFlags,
    getCustomerStore,
    worktraceBaseDir,
    listTraceSessions
    // listFollowUps: () => getFollowUpStore().list({ status: 'open' }),  // F7 落地后接线
    // listHandoffs: () => getHandoffStore().list({ status: 'open' }),    // F2 落地后接线
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopSkillServer()
})

// ── 引擎启动 / 暂停核心逻辑（IPC 与 Skill HTTP Server 共用） ──

async function startEngineCore(rawConfig?: any): Promise<SkillStartResult> {
  if (runtime?.isRunning()) {
    return { ok: false, reason: 'already_running', message: '引擎已在运行中' }
  }

  try {
    const settings = normalizeSettings(rawConfig || settingsStore.store)
    const appType: AppType = settings.appType || 'wechat'
    const startupStrategy = resolveSettingsStrategy(appType, settings)
    const hasChatKey = Boolean(settings.chatProvider.config?.apiKey?.trim())
    const providerNeedsVisionKey =
      !settings.chatProvider.installed ||
      settings.chatProvider.installed.id === BUILTIN_DOUBAO_PROVIDER_ID
    // VLM 布局检测始终需要视觉密钥；聊天 key 独立配置时不再强制视觉密钥
    const needsVisionKey = startupStrategy === 'vlm' || (providerNeedsVisionKey && !hasChatKey)

    if (needsVisionKey && !settings.vision.apiKey) {
      return { ok: false, reason: 'no_vision_key', message: '请先填写视觉接口密钥' }
    }

    // 没有自定义 provider → 走内置本地智能 provider（支持角色 / 知识库 / 客户记忆）
    let provider
    if (!settings.chatProvider.installed) {
      provider = new LocalProvider({
        ai: {
          apiKey: settings.chatProvider.config?.apiKey || settings.vision.apiKey,
          model: settings.chatProvider.config?.model || FIXED_ARK_MODEL,
          baseURL: settings.chatProvider.config?.baseURL || FIXED_ARK_BASE_URL,
          systemPrompt: settings.chatProvider.config?.systemPrompt || undefined
        },
        context: {
          getPersonaPrompt: () => getPersonaStore().getActivePersona()?.systemPrompt ?? null,
          getKnowledgeSection: () => buildKnowledgeSection(getKnowledgeStore().getInjectionItems()),
          getCustomerSection: (contact: string) => {
            const customer = getCustomerStore().getCustomerByName(contact)
            return customer ? getCustomerStore().buildMemorySection(customer) : ''
          },
          recordCustomerMemory: (contact: string, summary: string, reply: string | null) => {
            try {
              const customer = getCustomerStore().getOrCreateCustomer(contact)
              getCustomerStore().appendMemory(customer.customerId, {
                summary,
                lastReply: reply ?? undefined
              })
            } catch (error) {
              console.error('[Main] 客户记忆回写失败:', error)
            }
          },
          // ── F1 群聊后置过滤（f1 关 → 原样返回，零影响）──
          transformResult: filterF1GroupChatResult
        }
      })
    } else {
      const installedManifest = await getInstalledProviderManifest(settings.chatProvider.installed)
      // doubao（无论是用户主动装的还是内置的）apiKey 由视觉密钥共享提供，不强校验
      const isDoubao = settings.chatProvider.installed.id === BUILTIN_DOUBAO_PROVIDER_ID
      const required = (installedManifest?.configSchema?.required || []).filter(
        (key) => !(isDoubao && key === 'apiKey')
      )
      const missing = required.find((key) => {
        const value = settings.chatProvider.config?.[key]
        return value === undefined || value === null || value === ''
      })
      if (missing) {
        return {
          ok: false,
          reason: 'missing_required_field',
          message: `缺少必填配置: ${missing}`
        }
      }

      const effectiveConfig = isDoubao
        ? { ...settings.chatProvider.config, apiKey: settings.vision.apiKey }
        : settings.chatProvider.config

      const loaded = await loadInstalledProvider(settings.chatProvider.installed, effectiveConfig)
      provider = loaded.provider
    }

    const mainWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
    const log = (type: 'thinking' | 'reply' | 'skip' | 'error', content: string): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine:log', { type, content })
      }
    }

    let device: DesktopDevice
    let strategy: CaptureStrategy
    try {
      const built = await buildDevice(appType, settings, resolveVisionConfig(settings), log)
      device = built.device
      strategy = built.strategy
    } catch (err: any) {
      const message = err?.message || String(err)
      if (message === 'user_cancelled_box_select_wizard') {
        return { ok: false, reason: 'wizard_cancelled', message: '已取消框选，引擎未启动' }
      }
      throw err
    }
    log('thinking', `已选用抓取策略：${strategy}`)
    runtimeDevice = device
    runtimeProvider = provider

    // ── 工作记忆：本次执行的所有步骤落成 work-trace 会话 ──
    const recorder = getTraceRecorder()
    recorder.startSession({
      appType,
      engineVersion: app.getVersion(),
      providerId: settings.chatProvider.installed?.id ?? BUILTIN_DOUBAO_PROVIDER_ID,
      model: settings.chatProvider.config?.model || FIXED_ARK_MODEL
    })

    const onTrace = (input: TraceStepInput): void => {
      const step = recorder.record(input)
      if (!step) return

      // 继承闭环：带经验引用的回复成功发送 → 卡片 used/success 计数
      const refs = step.reasoning?.memoryRefs
      if (step.phase === 'act' && step.action?.kind === 'send' && refs?.length) {
        getExperienceStore().recordUsage(refs, step.outcome?.status === 'ok')
      }

      // 实时推给工作记忆窗口
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('trace:step', { sessionId: step.sessionId, step })
        }
      }
    }

    const channel = new GenericChannelSession(device)
    runtime = new RuntimeHost({
      appType,
      channel,
      provider,
      initialState: createInitialGenericChannelState(),
      onLog: log,
      onTrace,
      getMemoryCards: () => getExperienceStore().getActiveCardBriefs(),
      getPersonaPrompt: () => getPersonaStore().getActivePersona()?.systemPrompt ?? null,
      getKnowledgeSection: () => buildKnowledgeSection(getKnowledgeStore().getInjectionItems()),
      // ── F1 群聊检测（f1 关 → 立即返回 undefined，零 VLM 调用）──
      getGroupChatContext: getGroupChatContextForSession,
      onSessionEnd: () => recorder.endSession()
    })

    runtime.startSession().catch((err: any) => {
      console.error('[Main] Runtime session error:', err)
    })

    notifyEngineStateChanged('running')

    return { ok: true }
  } catch (error: any) {
    return {
      ok: false,
      reason: 'engine_failed',
      message: error?.message || String(error)
    }
  }
}

async function stopEngineCore(stopReason: string): Promise<SkillPauseResult> {
  if (!runtime?.isRunning()) {
    return { ok: false, reason: 'not_running', message: '引擎未运行' }
  }
  try {
    await runtime.stopSession(stopReason)
    runtimeProvider = null
    notifyEngineStateChanged('idle')
    return { ok: true }
  } catch (error: any) {
    return {
      ok: false,
      reason: 'pause_failed',
      message: error?.message || String(error)
    }
  }
}

/** 通知 Renderer 引擎状态变化（让 UI 在远程启停时同步切换） */
function notifyEngineStateChanged(status: 'running' | 'idle'): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('engine:state', { status })
    }
  }
}

/** 通知 Renderer：某个 appType 的框选区域被向导/重置更新了，UI 上的 chip 立即重渲染。 */
function notifyCaptureRegionsUpdated(appType: AppType, regions: BoxRegions | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('capture:regions-updated', { appType, regions })
    }
  }
}

/**
 * 选取实际生效的 capture strategy。
 * 用户在 settings 里给 appType 显式设置过策略，就用它；否则用全局默认；
 * 全局默认是 'auto' 时，wechat/wework 优先 VLM，其它直接 box-select。
 */
function resolveEffectiveStrategy(
  appType: AppType,
  perAppStrategy: CaptureStrategy,
  defaultStrategy: CaptureStrategy
): CaptureStrategy {
  const effective = perAppStrategy === 'auto' ? defaultStrategy : perAppStrategy
  if (effective === 'auto') {
    return isWechatLike(appType) ? 'vlm' : 'box-select'
  }
  return effective
}

function resolveSettingsStrategy(appType: AppType, settings: AppSettings): CaptureStrategy {
  const perApp = settings.capture[appType] ?? { strategy: 'auto' as CaptureStrategy, regions: null }
  return resolveEffectiveStrategy(appType, perApp.strategy, settings.defaultCaptureStrategy)
}

/**
 * 把 capture 配置 + strategy 解析成具体设备实例。
 * VLM 和 box-select 只决定"如何测量 LayoutCache"，后续运行统一消费 LayoutCache。
 * 本轮不做 VLM 失败自动 fallback；VLM 测量失败由 session bootstrap 报错停止。
 */
async function buildDevice(
  appType: AppType,
  settings: AppSettings,
  vision: { apiKey: string; baseURL?: string; model?: string },
  log: (type: 'thinking' | 'reply' | 'skip' | 'error', content: string) => void
): Promise<{ device: DesktopDevice; strategy: CaptureStrategy }> {
  const perApp = settings.capture[appType] ?? { strategy: 'auto' as CaptureStrategy, regions: null }
  const effective = resolveSettingsStrategy(appType, settings)

  if (effective === 'vlm') {
    const rpa = new RPADevice()
    rpa.setAppType(appType)
    rpa.setVisionConfig(vision)
    return { device: rpa, strategy: 'vlm' }
  }

  // box-select 路线：缺区域则拉向导
  let regions = perApp.regions
  if (!regions) {
    log('thinking', `首次配置 ${appType}：请框选 3 个关键区域`)
    const wizardResult = await runBoxSelectWizard({ appType, prefill: null })
    if (!wizardResult.ok || !wizardResult.regions) {
      throw new Error('user_cancelled_box_select_wizard')
    }
    regions = wizardResult.regions
    persistRegionsAndStickyStrategy(appType, regions, perApp.strategy)
  }
  return { device: new BoxSelectDevice(regions), strategy: 'box-select' }
}

/** 把向导产出的 regions 写回 settings，并保留当前策略配置。 */
function persistRegionsAndStickyStrategy(
  appType: AppType,
  regions: BoxRegions,
  strategy: CaptureStrategy
): void {
  const current = normalizeSettings(settingsStore.store)
  const next: AppSettings = {
    ...current,
    capture: {
      ...current.capture,
      [appType]: { strategy, regions }
    }
  }
  settingsStore.set(next as any)
  notifyCaptureRegionsUpdated(appType, regions)
}

const skillEngineController: SkillEngineController = {
  start: () => startEngineCore(),
  pause: () => stopEngineCore('skill_pause'),
  isRunning: () => runtime?.isRunning() ?? false
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

const VALID_APP_TYPES: AppType[] = [
  'wechat',
  'wework',
  'dingtalk',
  'lark',
  'slack',
  'telegram',
  'generic'
]
const VALID_CAPTURE_STRATEGIES: CaptureStrategy[] = ['auto', 'vlm', 'box-select']

function coerceAppType(raw: unknown): AppType {
  return typeof raw === 'string' && (VALID_APP_TYPES as string[]).includes(raw)
    ? (raw as AppType)
    : 'wechat'
}

function coerceStrategy(raw: unknown, fallback: CaptureStrategy = 'auto'): CaptureStrategy {
  return typeof raw === 'string' && (VALID_CAPTURE_STRATEGIES as string[]).includes(raw)
    ? (raw as CaptureStrategy)
    : fallback
}

function coerceRect(raw: unknown): BoxRegions['contactList'] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const x = Number(r.x),
    y = Number(r.y),
    w = Number(r.width),
    h = Number(r.height)
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null
  return { x, y, width: w, height: h }
}

function coerceRegions(raw: unknown): BoxRegions | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const contactList = coerceRect(r.contactList)
  const chatMain = coerceRect(r.chatMain)
  const inputBox = coerceRect(r.inputBox)
  if (!contactList || !chatMain || !inputBox) return null
  return {
    contactList,
    chatMain,
    inputBox,
    unreadIndicator: coerceRect(r.unreadIndicator),
    displayId: typeof r.displayId === 'number' ? r.displayId : undefined,
    scaleFactor: typeof r.scaleFactor === 'number' ? r.scaleFactor : undefined,
    capturedAt: typeof r.capturedAt === 'number' ? r.capturedAt : Date.now()
  }
}

function normalizeCapture(raw: unknown): Partial<Record<AppType, PerAppCapture>> {
  const out: Partial<Record<AppType, PerAppCapture>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of VALID_APP_TYPES) {
    const value = (raw as Record<string, unknown>)[key]
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    out[key] = {
      strategy: coerceStrategy(v.strategy),
      regions: coerceRegions(v.regions)
    }
  }
  return out
}

/** 解析当前视觉模型配置（含 Agent Plan 等自定义端点）；空值回退默认方舟 */
function resolveVisionConfig(
  settings: AppSettings
): { apiKey: string; baseURL?: string; model?: string } {
  return {
    apiKey: settings.vision.apiKey,
    baseURL: settings.vision.baseURL?.trim() || undefined,
    model: settings.vision.model?.trim() || undefined
  }
}

/** V2 功能专属配置白名单归一化：未知功能丢弃，字段类型不符回退默认值 */
function normalizeFeaturesConfig(raw: unknown): NonNullable<AppSettings['featuresConfig']> {
  const out: NonNullable<AppSettings['featuresConfig']> = {}
  if (!raw || typeof raw !== 'object') return out
  const rec = raw as Record<string, unknown>

  // F1 群聊支持：botNames 字符串数组（去空白/空项）+ mentionOnly 布尔
  const f1Raw = rec.f1
  if (f1Raw && typeof f1Raw === 'object') {
    const f1 = f1Raw as Record<string, unknown>
    const botNames = Array.isArray(f1.botNames)
      ? f1.botNames
          .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
          .map((name) => name.trim())
      : []
    out.f1 = {
      botNames,
      mentionOnly: typeof f1.mentionOnly === 'boolean' ? f1.mentionOnly : false
    }
  }
  return out
}

function normalizeSettings(raw: any): AppSettings {  const oldApiKey = typeof raw?.apiKey === 'string' ? raw.apiKey : ''
  const oldModel = typeof raw?.model === 'string' && raw.model ? raw.model : FIXED_ARK_MODEL
  const oldSystemPrompt = typeof raw?.systemPrompt === 'string' ? raw.systemPrompt : ''
  const rawProviderConfig =
    raw?.chatProvider?.config && typeof raw.chatProvider.config === 'object'
      ? { ...raw.chatProvider.config }
      : {}

  // Keep arbitrary provider config keys, and only backfill legacy volcengine fields for old persisted settings.
  if (rawProviderConfig.apiKey === undefined && oldApiKey) {
    rawProviderConfig.apiKey = oldApiKey
  }
  if (rawProviderConfig.model === undefined && oldModel) {
    rawProviderConfig.model = oldModel
  }
  if (rawProviderConfig.systemPrompt === undefined && oldSystemPrompt) {
    rawProviderConfig.systemPrompt = oldSystemPrompt
  }

  return {
    locale: raw?.locale === 'en' ? 'en' : 'zh',
    appType: coerceAppType(raw?.appType),
    vision: {
      apiKey: raw?.vision?.apiKey || oldApiKey || '',
      baseURL:
        typeof raw?.vision?.baseURL === 'string' && raw.vision.baseURL.trim()
          ? raw.vision.baseURL.trim()
          : '',
      model:
        typeof raw?.vision?.model === 'string' && raw.vision.model.trim()
          ? raw.vision.model.trim()
          : ''
    },
    chatProvider: {
      manifestUrl: raw?.chatProvider?.manifestUrl || raw?.providerManifestUrl || '',
      installed: raw?.chatProvider?.installed || null,
      config: rawProviderConfig
    },
    defaultCaptureStrategy: coerceStrategy(raw?.defaultCaptureStrategy, 'auto'),
    capture: normalizeCapture(raw?.capture),
    features: normalizeFeatures(raw?.features),
    featuresConfig: normalizeFeaturesConfig(raw?.featuresConfig)
  }
}

function withSchemaDefaults(
  schema: { properties: Record<string, { default?: unknown }> },
  current: Record<string, any>
): Record<string, any> {
  const next = { ...current }
  for (const [key, field] of Object.entries(schema.properties || {})) {
    if (next[key] === undefined && field.default !== undefined) {
      next[key] = field.default
    }
  }
  return next
}

/**
 * 把自由文本解析成知识条目（批量导入）。
 * 规则：按空行分段；每段第一行为标题（含「：」时冒号前为标题），其余为内容。
 * 例：
 *   运费政策：满 99 元包邮，偏远地区除外。
 *
 *   退货流程
 *   7 天内无理由退货，联系客服获取退货地址。
 */
function parseKnowledgeImportText(text: string): NewKnowledgeItem[] {
  const sections = text
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter((section) => section.length > 0)

  const items: NewKnowledgeItem[] = []
  for (const section of sections) {
    const lines = section.split('\n').map((line) => line.trim())
    const first = lines[0] || ''
    const colonIndex = first.indexOf('：')
    const hasColon = colonIndex > 0 && colonIndex < first.length - 1
    const title = (hasColon ? first.slice(0, colonIndex) : first).trim()
    const rest = hasColon ? [first.slice(colonIndex + 1).trim(), ...lines.slice(1)] : lines.slice(1)
    const content = rest.filter(Boolean).join('\n').trim()
    if (title && content) {
      items.push({ title, content, source: 'import' })
    } else if (title) {
      items.push({ title, content: title, source: 'import' })
    }
  }
  return items
}
