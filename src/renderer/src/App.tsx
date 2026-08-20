import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { t } from './i18n'
import richcatIconUrl from './assets/richcat-icon.png'
import MemoryWindow from './MemoryWindow'
import KnowledgeWindow from './KnowledgeWindow'
import CustomerWindow from './CustomerWindow'
import PersonaPanel from './PersonaPanel'
import FeaturePanel from './FeaturePanel'
import EnterprisePanel from './EnterprisePanel'
import './index.css'

interface LogEntry {
  time: string
  type: 'thinking' | 'reply' | 'skip' | 'error'
  content: string
}

type EngineStatus = 'idle' | 'running' | 'error'
type SettingsSection = 'base' | 'agent' | 'persona' | 'features' | 'enterprise'
type AppType = 'wechat' | 'wework' | 'dingtalk' | 'lark' | 'slack' | 'telegram' | 'generic'

type CaptureStrategy = 'auto' | 'vlm' | 'box-select'

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

interface BoxRegions {
  contactList: ScreenRect
  chatMain: ScreenRect
  inputBox: ScreenRect
  unreadIndicator: ScreenRect | null
  displayId?: number
  scaleFactor?: number
  capturedAt: number
}

const APP_TYPE_LABELS: Record<AppType, string> = {
  wechat: '微信',
  wework: '企业微信',
  dingtalk: '钉钉',
  lark: '飞书 / Lark',
  slack: 'Slack',
  telegram: 'Telegram',
  generic: '其他桌面应用'
}

const VLM_SUPPORTED_APPS: AppType[] = ['wechat', 'wework']

function isVlmSupported(appType: AppType): boolean {
  return VLM_SUPPORTED_APPS.includes(appType)
}

interface ProviderSchemaField {
  type: 'string' | 'password' | 'select' | 'boolean'
  title: string
  default?: string | boolean
  enum?: string[]
}

interface ProviderManifest {
  apiVersion: 1
  id: string
  name: string
  version: string
  entry: string
  capabilities: ['chat']
  configSchema: {
    type: 'object'
    properties: Record<string, ProviderSchemaField>
    required?: string[]
  }
}

interface InstalledProviderInfo {
  id: string
  name: string
  version: string
  entryFile: string
  installedAt: string
}

type ProviderConfigFieldType = 'text' | 'password' | 'url' | 'select' | 'textarea'

interface ProviderConfigField {
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

interface ProviderCatalogItem {
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

interface ProviderHubCache {
  sourceUrl: string
  fetchedAt: string
  providers: ProviderCatalogItem[]
}

interface ProviderHubResult {
  success: boolean
  error?: string
  catalog?: ProviderHubCache | null
}

interface PerAppCapture {
  strategy: CaptureStrategy
  regions: BoxRegions | null
}

interface AppSettings {
  locale: 'zh' | 'en'
  appType: AppType
  vision: {
    apiKey: string
    baseURL?: string
    model?: string
  }
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    config: Record<string, any>
  }
  defaultCaptureStrategy: CaptureStrategy
  capture: Partial<Record<AppType, PerAppCapture>>
}

const BUILTIN_PROVIDER_CATALOG: ProviderCatalogItem[] = [
  {
    id: 'doubao',
    name: '豆包 Seed',
    description: '本地内置聊天 Provider，默认使用基础配置中的火山方舟密钥。',
    version: '1.0.0',
    manifestUrl: 'builtin://doubao',
    capabilities: ['chat'],
    configSchema: {
      fields: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'password',
          placeholder: '留空则使用基础配置中的视觉密钥'
        },
        {
          key: 'baseURL',
          label: 'Base URL',
          type: 'url',
          placeholder: 'https://ark.cn-beijing.volces.com/api/v3'
        },
        {
          key: 'model',
          label: '模型',
          type: 'text',
          required: true,
          defaultValue: 'doubao-seed-2-0-lite-260428'
        },
        {
          key: 'systemPrompt',
          label: '系统提示词',
          type: 'textarea',
          placeholder: '留空则使用默认客服提示词（角色设定优先于此）'
        }
      ]
    }
  }
]

/** 常用多模态（支持图片输入）服务商预设，一键填充 Base URL / 模型 */
const PROVIDER_PRESETS: Array<{
  id: string
  label: string
  baseURL: string
  model: string
  hint?: string
}> = [
  {
    id: 'ark',
    label: '火山方舟 · 豆包',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-lite-260215'
  },
  {
    id: 'ark-plan',
    label: '火山方舟 · Agent Plan',
    baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    model: 'doubao-seed-2.1-turbo',
    hint: '需已订阅 Agent Plan，并填写其专属 API Key（方舟控制台 → 开通管理 → Agent Plan → API Key 管理）'
  },
  {
    id: 'openai',
    label: 'OpenAI · GPT-4o',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  {
    id: 'zhipu',
    label: '智谱 · GLM-4V',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash'
  },
  {
    id: 'dashscope',
    label: '通义 · Qwen-VL',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-plus'
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    baseURL: '',
    model: '',
    hint: '任何 OpenAI 兼容 /chat/completions 端点；模型需支持图片输入（VLM）'
  }
]

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.14v14l11-7-11-7z" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

const GearIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

// 工作记忆 — 时钟+轨迹点图标
const MemoryIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l3 3" />
  </svg>
)

const RefreshIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 0 1-15.1 6.6" />
    <path d="M3 12A9 9 0 0 1 18.1 5.4" />
    <path d="M18 2v4h-4" />
    <path d="M6 22v-4h4" />
  </svg>
)

function App() {
  const windowKind = new URLSearchParams(window.location.search).get('window')
  const [status, setStatus] = useState<EngineStatus>('idle')

  // Sync UI status with engine state changes triggered out-of-band
  // (e.g. remote OpenClaw start/pause via the local skill HTTP server).
  useEffect(() => {
    const cleanup = window.electron?.on('engine:state', (data: { status: 'running' | 'idle' }) => {
      setStatus(data.status === 'running' ? 'running' : 'idle')
    })
    return cleanup
  }, [])

  if (windowKind === 'settings') {
    return (
      <div className="app settings-window">
        <SettingsWindow />
        <Toast />
      </div>
    )
  }

  if (windowKind === 'memory') {
    return (
      <div className="app settings-window">
        <MemoryWindow />
        <Toast />
      </div>
    )
  }

  if (windowKind === 'knowledge') {
    return (
      <div className="app settings-window">
        <KnowledgeWindow />
        <Toast />
      </div>
    )
  }

  if (windowKind === 'customer') {
    return (
      <div className="app settings-window">
        <CustomerWindow />
        <Toast />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-lockup">
          <img src={richcatIconUrl} alt="财听猫" className="app-logo" />
          <span className="brand-wordmark">RichCat</span>
        </div>
        <span className="version">{t('app.version')}</span>
      </header>

      <div className="app-content">
        <ControlPanel status={status} setStatus={setStatus} />
      </div>

      <BottomBar status={status} setStatus={setStatus} />

      <Toast />
    </div>
  )
}

function ControlPanel({
  status,
  setStatus
}: {
  status: EngineStatus
  setStatus: (s: EngineStatus) => void
}) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  // 首屏目标应用 + 框选状态：直接读 / 写 settings，让用户上手第一步就能完成。
  const [appType, setAppType] = useState<AppType>('wechat')
  const [regions, setRegions] = useState<BoxRegions | null>(null)
  const [openingWizard, setOpeningWizard] = useState(false)

  const reloadRegionsForApp = useCallback(async (type: AppType) => {
    const r = (await window.electron?.invoke('capture:getRegions', type)) as BoxRegions | null
    setRegions(r ?? null)
  }, [])

  // 初次加载：读出当前 appType + 对应的框选区域
  useEffect(() => {
    void (async () => {
      const settings = (await window.electron?.invoke('settings:getAll')) as
        | AppSettings
        | undefined
      const initial = settings?.appType || 'wechat'
      setAppType(initial)
      await reloadRegionsForApp(initial)
    })()
  }, [reloadRegionsForApp])

  // 监听 main 进程的"区域已更新"事件——比如向导刚跑完
  useEffect(() => {
    const cleanup = window.electron?.on(
      'capture:regions-updated',
      (data: { appType: AppType; regions: BoxRegions | null }) => {
        if (data.appType === appType) setRegions(data.regions)
      }
    )
    return cleanup
  }, [appType])

  const handleAppTypeChange = useCallback(
    async (next: AppType) => {
      if (status === 'running') return
      setAppType(next)
      await window.electron?.invoke('settings:set', { appType: next })
      await window.electron?.invoke('engine:updateConfig', {
        ...((await window.electron?.invoke('settings:getAll')) as AppSettings),
        appType: next
      })
      await reloadRegionsForApp(next)
    },
    [reloadRegionsForApp, status]
  )

  const handleOpenWizard = useCallback(async () => {
    if (status === 'running') return
    setOpeningWizard(true)
    try {
      const result = (await window.electron?.invoke('capture:openSetupWizard', {
        appType
      })) as { success: boolean; reason?: string; regions?: BoxRegions } | undefined
      if (result?.success && result.regions) {
        setRegions(result.regions)
        showToast('已保存框选区域', 'success')
      } else if (result?.reason === 'cancelled' || result?.reason === 'closed') {
        showToast('框选已取消', 'error')
      } else {
        showToast('框选失败', 'error')
      }
    } finally {
      setOpeningWizard(false)
    }
  }, [appType, status])

  const addLog = useCallback((type: LogEntry['type'], content: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs((prev) => [...prev.slice(-99), { time, type, content }])
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    const cleanup = window.electron?.on('engine:log', (data: { type: string; content: string }) => {
      addLog(data.type as LogEntry['type'], data.content)

      if (data.type === 'error' && data.content.includes('引擎无法启动')) {
        setStatus('error')
      }
    })
    return cleanup
  }, [addLog, setStatus])

  const statusLabel =
    status === 'running'
      ? t('status.running')
      : status === 'error'
        ? t('status.error')
        : t('status.idle')

  const isVlm = isVlmSupported(appType)
  const captureReady = isVlm || regions !== null

  return (
    <div className="fade-in fade-in-up">
      <div className={`status-indicator glass-card-highlight ${status}`}>
        <div className={`status-dot ${status}`} />
        <span className="status-text">{statusLabel}</span>
      </div>

      <TargetAppQuickCard
        appType={appType}
        regions={regions}
        captureReady={captureReady}
        isVlm={isVlm}
        openingWizard={openingWizard}
        running={status === 'running'}
        onAppTypeChange={handleAppTypeChange}
        onOpenWizard={handleOpenWizard}
      />

      <div className="card glass-card">
        <div className="card-title">{t('control.log')}</div>
        <div className="message-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="message-log-empty">{t('control.log.empty')}</div>
          ) : (
            logs.map((entry, i) => (
              <div className="log-entry" key={i}>
                <span className="log-time">{entry.time}</span>
                <span className={`log-type ${entry.type}`}>
                  {t(`control.log.${entry.type}` as never)}
                </span>
                <span>{entry.content}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

interface TargetAppQuickCardProps {
  appType: AppType
  regions: BoxRegions | null
  captureReady: boolean
  isVlm: boolean
  openingWizard: boolean
  running: boolean
  onAppTypeChange: (t: AppType) => void
  onOpenWizard: () => void
}

// 首屏的"目标应用 + 框选"快捷卡片：让新用户开箱即用，不用先翻设置。
function TargetAppQuickCard({
  appType,
  regions,
  captureReady,
  isVlm,
  openingWizard,
  running,
  onAppTypeChange,
  onOpenWizard
}: TargetAppQuickCardProps): React.JSX.Element {
  const statusText = isVlm
    ? '自动识别（VLM）'
    : regions
      ? '已框选 3 / 3 个区域'
      : '尚未框选'

  return (
    <div className="card glass-card" style={{ marginBottom: 12 }}>
      <div className="card-title">目标应用</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <select
          className="form-input"
          value={appType}
          onChange={(e) => onAppTypeChange(e.target.value as AppType)}
          disabled={running || openingWizard}
          style={{ flex: 1 }}
        >
          {(Object.keys(APP_TYPE_LABELS) as AppType[]).map((type) => (
            <option key={type} value={type}>
              {APP_TYPE_LABELS[type]}
              {!isVlmSupported(type) ? '（框选）' : ''}
            </option>
          ))}
        </select>

        {!isVlm && (
          <button
            className="btn btn-primary"
            onClick={onOpenWizard}
            disabled={running || openingWizard}
            style={{
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {regions ? (
                // 重新框选 — 旋转刷新图标
                <>
                  <path d="M21 12a9 9 0 1 1-3-6.7" />
                  <path d="M21 4v5h-5" />
                </>
              ) : (
                // 开始框选 — 矩形 + 十字
                <>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </>
              )}
            </svg>
            {openingWizard ? '打开中...' : regions ? '重新框选' : '开始框选'}
          </button>
        )}
      </div>

      <div
        className={`form-hint capture-status-text ${captureReady ? 'ready' : 'notready'}`}
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        <span
          className={`capture-status-dot ${captureReady ? 'ready' : 'notready'}`}
        />
        {statusText}
        {!isVlm && !regions ? '：点右侧按钮先把 3 个关键区域圈出来' : ''}
      </div>
    </div>
  )
}

function BottomBar({
  status,
  setStatus
}: {
  status: EngineStatus
  setStatus: (s: EngineStatus) => void
}) {
  const handleStart = useCallback(async () => {
    const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
    if (!settings?.vision?.apiKey) {
      showToast(t('control.start.novisionkey'), 'error')
      return
    }
    // 没装自定义 provider → 走内置 doubao（getInstalled 会返回 isBuiltinDefault: true）
    const providerInfo = (await window.electron?.invoke('provider:getInstalled')) as {
      manifest: ProviderManifest | null
      isBuiltinDefault?: boolean
    }
    // doubao 默认共享视觉密钥，required 已剥离 apiKey
    const required = providerInfo?.manifest?.configSchema?.required || []
    const missing = required.find((key) => {
      const value = settings.chatProvider.config?.[key]
      return value === undefined || value === null || value === ''
    })
    if (missing) {
      showToast(`${t('control.start.missingProviderField')}: ${missing}`, 'error')
      return
    }

    const result = await window.electron?.invoke('engine:start', settings)
    if (result?.success) {
      setStatus('running')
      showToast(t('toast.engineStarted'), 'success')
    } else {
      setStatus('error')
      showToast(result?.error || t('toast.startFailed'), 'error')
    }
  }, [setStatus])

  const handleStop = useCallback(async () => {
    await window.electron?.invoke('engine:stop')
    setStatus('idle')
    showToast(t('toast.engineStopped'), 'success')
  }, [setStatus])

  const running = status === 'running'

  return (
    <div className="bottom-bar">
      {running ? (
        <button className="bottom-btn bottom-btn-stop" onClick={handleStop}>
          <StopIcon />
          {t('control.stop')}
        </button>
      ) : (
        <button className="bottom-btn bottom-btn-play" onClick={handleStart}>
          <PlayIcon />
          {t('control.start')}
        </button>
      )}
      <button
        className="bottom-btn bottom-btn-settings"
        onClick={() => window.electron?.invoke('memory:open')}
        title="工作记忆"
      >
        <MemoryIcon />
      </button>
      <button
        className="bottom-btn bottom-btn-settings"
        onClick={() => window.electron?.invoke('knowledge:open')}
        title="知识库"
      >
        <BookIcon />
      </button>
      <button
        className="bottom-btn bottom-btn-settings"
        onClick={() => window.electron?.invoke('customer:open')}
        title="客户管理"
      >
        <UsersIcon />
      </button>
      <button
        className="bottom-btn bottom-btn-settings"
        onClick={() => window.electron?.invoke('settings:open')}
        title="设置"
      >
        <GearIcon />
      </button>
    </div>
  )
}

function BookIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function UsersIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function SettingsWindow(): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('base')

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="sidebar-brand">
          <img src={richcatIconUrl} alt="财听猫" className="app-logo" />
          <span className="brand-wordmark">RichCat</span>
        </div>
        <button
          className={`settings-nav-item ${section === 'base' ? 'active' : ''}`}
          onClick={() => setSection('base')}
        >
          基础配置
        </button>
        <button
          className={`settings-nav-item ${section === 'agent' ? 'active' : ''}`}
          onClick={() => setSection('agent')}
        >
          智能体
        </button>
        <button
          className={`settings-nav-item ${section === 'persona' ? 'active' : ''}`}
          onClick={() => setSection('persona')}
        >
          角色设定
        </button>
        <button
          className={`settings-nav-item ${section === 'features' ? 'active' : ''}`}
          onClick={() => setSection('features')}
        >
          功能开关
        </button>
        <button
          className={`settings-nav-item ${section === 'enterprise' ? 'active' : ''}`}
          onClick={() => setSection('enterprise')}
        >
          企业版
        </button>
      </aside>

      <main className="settings-main">
        {section === 'base' ? (
          <SettingsPanel />
        ) : section === 'persona' ? (
          <PersonaPanel />
        ) : section === 'features' ? (
          <FeaturePanel />
        ) : section === 'enterprise' ? (
          <EnterprisePanel />
        ) : (
          <AgentPanel />
        )}
      </main>
    </div>
  )
}

/** 视觉模型（VLM）服务商预设，一键填充 Base URL / 模型 */
const VISION_PRESETS: Array<{
  id: string
  label: string
  baseURL: string
  model: string
  hint?: string
}> = [
  {
    id: 'ark',
    label: '火山方舟 · 标准',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-lite-260215'
  },
  {
    id: 'ark-plan',
    label: '火山方舟 · Agent Plan',
    baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    model: 'doubao-seed-2.1-turbo',
    hint: '需已订阅 Agent Plan 并填写其专属 API Key（方舟控制台 → 开通管理 → Agent Plan → API Key 管理），普通 ark-xxx 密钥会 401'
  },
  {
    id: 'openai',
    label: 'OpenAI · GPT-4o',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  {
    id: 'zhipu',
    label: '智谱 · GLM-4V',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash'
  },
  {
    id: 'dashscope',
    label: '通义 · Qwen-VL',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-plus'
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    baseURL: '',
    model: '',
    hint: '任何 OpenAI 兼容 /chat/completions 端点；模型需支持图片输入（VLM）'
  }
]

function SettingsPanel() {
  const [visionApiKey, setVisionApiKey] = useState('')
  const [visionBaseUrl, setVisionBaseUrl] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [testing, setTesting] = useState(false)
  // F8 多开：当前实例 profile 信息（app:getProfile）
  const [profile, setProfile] = useState<{ profile: string; isMultiInstance: boolean } | null>(null)

  useEffect(() => {
    const load = async () => {
      const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
      if (settings) {
        setVisionApiKey(settings.vision?.apiKey || '')
        setVisionBaseUrl(settings.vision?.baseURL || '')
        setVisionModel(settings.vision?.model || '')
      }
      const profileInfo = (await window.electron?.invoke('app:getProfile')) as
        | { profile: string; isMultiInstance: boolean }
        | undefined
      if (profileInfo) setProfile(profileInfo)
    }

    void load()
  }, [])

  const handleSaveVision = useCallback(async () => {
    const payload: Partial<AppSettings> = {
      vision: {
        apiKey: visionApiKey,
        baseURL: visionBaseUrl.trim(),
        model: visionModel.trim()
      }
    }
    await window.electron?.invoke('settings:set', payload)
    await window.electron?.invoke('engine:updateConfig', {
      ...((await window.electron?.invoke('settings:getAll')) as AppSettings),
      ...payload,
      vision: { apiKey: visionApiKey, baseURL: visionBaseUrl.trim(), model: visionModel.trim() }
    })
    showToast(t('settings.saved'), 'success')
  }, [visionApiKey, visionBaseUrl, visionModel])

  const handleTestConnection = useCallback(async () => {
    if (!visionApiKey) return
    setTesting(true)
    try {
      const result = await window.electron?.invoke('engine:testConnection', {
        apiKey: visionApiKey,
        baseURL: visionBaseUrl.trim() || undefined,
        model: visionModel.trim() || undefined
      })
      if (result?.success) {
        showToast(t('settings.testConnection.success'), 'success')
      } else {
        showToast(`${t('settings.testConnection.fail')}: ${result?.error || ''}`, 'error')
      }
    } catch (e: any) {
      showToast(`${t('settings.testConnection.fail')}: ${e.message}`, 'error')
    } finally {
      setTesting(false)
    }
  }, [visionApiKey, visionBaseUrl, visionModel])

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <h1>基础配置</h1>
          <p>维护桌面端运行所需的基础参数。</p>
        </div>
      </div>

      {/* F8 多开：当前实例标识（--profile） */}
      <div className="card base-settings-card">
        <div className="card-title">多开（Profile）</div>
        <div className="form-group">
          <div className="profile-info-row">
            <span className="profile-info-label">当前实例</span>
            <span className="profile-info-value">
              {profile?.isMultiInstance
                ? `profile · ${profile.profile}`
                : '默认实例（未多开）'}
            </span>
          </div>
          <div className="form-hint">
            使用 --profile=&lt;name&gt; 启动可同时运行多个独立实例；不同 profile 的数据
            （设置 / 客户 / 知识库 / 日报）互不干扰，Skill 端口自动错开。详见 docs/multi-instance.md。
          </div>
        </div>
      </div>

      <div className="card base-settings-card">
        <div className="card-title">{t('settings.vision')}</div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionApiKey')}</label>
          <input
            className="form-input"
            type="password"
            value={visionApiKey}
            onChange={(e) => setVisionApiKey(e.target.value)}
            placeholder={t('settings.visionApiKey.placeholder')}
            autoComplete="off"
          />
          <div className="form-hint">{t('settings.visionApiKey.hint')}</div>
        </div>

        <div className="form-group">
          <label className="form-label">视觉模型预设</label>
          <select
            className="form-input"
            defaultValue=""
            onChange={(event) => {
              const preset = VISION_PRESETS.find((p) => p.id === event.target.value)
              if (!preset) return
              setVisionBaseUrl(preset.baseURL)
              setVisionModel(preset.model)
            }}
          >
            <option value="" disabled>
              选择预设自动填充 Base URL 与模型…
            </option>
            {VISION_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <div className="form-hint">{buildVisionHint(visionBaseUrl)}</div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionModel')}</label>
          <input
            className="form-input"
            value={visionModel}
            onChange={(e) => setVisionModel(e.target.value)}
            placeholder="doubao-seed-2-0-lite-260215"
          />
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionBaseUrl')}</label>
          <input
            className="form-input"
            type="url"
            value={visionBaseUrl}
            onChange={(e) => setVisionBaseUrl(e.target.value)}
            placeholder="https://ark.cn-beijing.volces.com/api/v3"
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={!visionApiKey || testing}
          >
            {testing ? t('settings.testConnection.testing') : t('settings.testConnection')}
          </button>
          <button className="btn btn-primary" onClick={handleSaveVision} style={{ flex: 1 }}>
            {t('settings.saveVision')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 根据 Base URL 动态给出视觉模型配置提示（Agent Plan 端点需专属 Key） */
function buildVisionHint(baseUrl: string): string {
  const url = (baseUrl || '').trim().replace(/\/+$/, '')
  if (url.includes('/api/plan/')) {
    return '⚠️ Agent Plan 专属端点：API Key 必须填 Agent Plan 专属 Key（方舟控制台 → 开通管理 → Agent Plan → API Key 管理），普通 ark-xxx 密钥会 401；模型需支持图片输入（VLM）。'
  }
  if (url.includes('/api/coding/')) {
    return '⚠️ Coding Plan 专属端点：需 Coding Plan 专属 Key；如无订阅请改用标准 /api/v3 端点。'
  }
  if (url.includes('volces.com')) {
    return '火山方舟标准端点：使用上方 API Key 调用。'
  }
  if (!url) {
    return '留空则使用默认火山方舟端点（/api/v3）。视觉模型负责布局检测、未读识别与图片读取，必须支持图片输入（VLM）。'
  }
  return '自定义 OpenAI 兼容端点：请填写对应服务商的 API Key；模型必须支持图片输入（VLM）。'
}

function AgentPanel(): React.JSX.Element {
  const [catalog, setCatalog] = useState<ProviderCatalogItem[]>(BUILTIN_PROVIDER_CATALOG)
  const [selectedId, setSelectedId] = useState(BUILTIN_PROVIDER_CATALOG[0]?.id || '')
  const [activeId, setActiveId] = useState('doubao')
  const [providerDrafts, setProviderDrafts] = useState<Record<string, Record<string, string>>>({})
  const [currentSettings, setCurrentSettings] = useState<AppSettings | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [updatingCatalog, setUpdatingCatalog] = useState(false)
  const selectedProvider = catalog.find((provider) => provider.id === selectedId) || catalog[0]

  const loadSettingsAndCatalog = useCallback(async (forceUpdate: boolean) => {
    setLoadingCatalog(!forceUpdate)
    setUpdatingCatalog(forceUpdate)
    try {
      const [settings, result] = await Promise.all([
        window.electron?.invoke('settings:getAll') as Promise<AppSettings | undefined>,
        window.electron?.invoke(forceUpdate ? 'providerHub:update' : 'providerHub:getCatalog') as Promise<ProviderHubResult>
      ])

      const nextCatalog = mergeProviderCatalog(result?.catalog?.providers || [])
      const nextActiveId = settings?.chatProvider?.installed?.id || 'doubao'
      setCatalog(nextCatalog)
      setCurrentSettings(settings || null)
      setActiveId(nextActiveId)
      setSelectedId((current) => current || nextActiveId || BUILTIN_PROVIDER_CATALOG[0]?.id || nextCatalog[0]?.id || '')
      setProviderDrafts((prev) => {
        const savedConfig = !settings?.chatProvider?.installed
          ? settings?.chatProvider?.config || {}
          : {}
        const savedBaseUrl = String(savedConfig.baseURL || '').trim().replace(/\/+$/, '')
        // 标准 /api/v3 端点共享视觉密钥；Agent Plan / Coding Plan / 第三方端点使用独立密钥
        const sharesVisionKey = !savedBaseUrl || savedBaseUrl.endsWith('/api/v3')
        return {
          ...prev,
          doubao: {
            ...getProviderDefaults(BUILTIN_PROVIDER_CATALOG[0]),
            ...(prev.doubao || {}),
            ...savedConfig,
            apiKey:
              prev.doubao?.apiKey ??
              (sharesVisionKey
                ? settings?.vision?.apiKey || ''
                : String(savedConfig.apiKey || ''))
          },
          [nextActiveId]: {
            ...getProviderDefaults(nextCatalog.find((provider) => provider.id === nextActiveId)),
            ...(prev[nextActiveId] || {}),
            ...(settings?.chatProvider?.config || {})
          }
        }
      })

      if (result && !result.success) {
        showToast(`智能体列表加载失败: ${result.error || ''}`, 'error')
      } else if (forceUpdate) {
        showToast('智能体列表已更新', 'success')
      }
    } finally {
      setLoadingCatalog(false)
      setUpdatingCatalog(false)
    }
  }, [])

  useEffect(() => {
    void loadSettingsAndCatalog(false)
  }, [loadSettingsAndCatalog])

  const selectedValues = useMemo(
    () => getProviderValues(providerDrafts, selectedProvider, currentSettings),
    [currentSettings, providerDrafts, selectedProvider]
  )

  const setProviderValue = useCallback(
    (fieldKey: string, value: string) => {
      if (!selectedProvider) return
      setProviderDrafts((prev) => ({
        ...prev,
        [selectedProvider.id]: {
          ...getProviderValues(prev, selectedProvider, currentSettings),
          [fieldKey]: value
        }
      }))
    },
    [currentSettings, selectedProvider]
  )

  const persistProvider = useCallback(
    async (provider: ProviderCatalogItem, values: Record<string, string>) => {
      const missing = getMissingRequiredFields(provider, values)
      if (missing.length > 0) {
        showToast(`缺少必填项: ${missing.join('、')}`, 'error')
        return false
      }

      if (provider.id === 'doubao') {
        const { apiKey, ...providerConfig } = values
        // 只有标准 OpenAI 兼容端点（/api/v3 或留空）才与视觉共享密钥；
        // Agent Plan（/api/plan/v3）、Coding Plan（/api/coding/v3）等专属端点
        // 必须使用独立密钥（专属 Key），否则会 401 鉴权失败
        const baseUrl = (providerConfig.baseURL || '').trim().replace(/\/+$/, '')
        const isStandardArk = !baseUrl || baseUrl.endsWith('/api/v3')

        if (isStandardArk) {
          // 标准方舟端点：仅当视觉模型也是标准方舟端点时才共享密钥（写入 vision.apiKey）；
          // 若视觉模型用了 Agent Plan 等专属端点（vision.apiKey 是专属 Key），
          // 聊天密钥改为独立存放，避免覆盖视觉专属 Key
          const current = (await window.electron?.invoke('settings:getAll')) as AppSettings
          const visionBaseUrl = String(current?.vision?.baseURL || '').trim().replace(/\/+$/, '')
          const visionIsStandard = !visionBaseUrl || visionBaseUrl.endsWith('/api/v3')

          if (visionIsStandard) {
            await window.electron?.invoke('settings:set', {
              vision: { apiKey },
              chatProvider: {
                manifestUrl: '',
                installed: null,
                config: providerConfig
              }
            })
          } else {
            const config = { ...providerConfig }
            if (apiKey?.trim()) {
              config.apiKey = apiKey.trim()
            } else {
              delete config.apiKey
            }
            await window.electron?.invoke('settings:set', {
              chatProvider: {
                manifestUrl: '',
                installed: null,
                config
              }
            })
          }
        } else {
          // 专属端点（Agent Plan / Coding Plan / 第三方）：独立密钥存 config，视觉密钥不动
          const config = { ...providerConfig }
          if (apiKey?.trim()) {
            config.apiKey = apiKey.trim()
          } else {
            delete config.apiKey
          }
          await window.electron?.invoke('settings:set', {
            chatProvider: {
              manifestUrl: '',
              installed: null,
              config
            }
          })
        }

        const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings
        await window.electron?.invoke('engine:updateConfig', settings)
        setCurrentSettings(settings)
        setActiveId('doubao')
        return true
      }

      const installResult = await window.electron?.invoke('provider:installFromUrl', provider.manifestUrl)
      if (!installResult?.success) {
        showToast(installResult?.error || '智能体安装失败', 'error')
        return false
      }

      await window.electron?.invoke('settings:set', {
        chatProvider: {
          manifestUrl: provider.manifestUrl,
          installed: installResult.installed,
          config: values
        }
      })
      const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings
      await window.electron?.invoke('engine:updateConfig', settings)
      setCurrentSettings(settings)
      setActiveId(provider.id)
      return true
    },
    []
  )

  const handleSaveConfig = useCallback(async () => {
    if (!selectedProvider) return
    const ok = await persistProvider(selectedProvider, selectedValues)
    if (ok) showToast('智能体配置已保存', 'success')
  }, [persistProvider, selectedProvider, selectedValues])

  const handleActivate = useCallback(async () => {
    if (!selectedProvider) return
    const ok = await persistProvider(selectedProvider, selectedValues)
    if (ok) showToast('已切换当前智能体', 'success')
  }, [persistProvider, selectedProvider, selectedValues])

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <div className="settings-title-row">
            <h1>智能体</h1>
            <button
              className="icon-action refresh-action"
              onClick={() => loadSettingsAndCatalog(true)}
              disabled={updatingCatalog}
              title={updatingCatalog ? '更新中...' : '更新列表'}
              aria-label={updatingCatalog ? '更新中' : '更新智能体列表'}
            >
              <span className={updatingCatalog ? 'refresh-icon spinning' : 'refresh-icon'}>
                <RefreshIcon />
              </span>
            </button>
            {updatingCatalog ? <span className="inline-status">更新中...</span> : null}
          </div>
          <p>选择负责聊天分析和内容生成的智能体，并维护各自配置。</p>
        </div>
      </div>

      {loadingCatalog ? (
        <div className="provider-hub-meta">
          <span className="spinner" />
          正在加载远端智能体列表
        </div>
      ) : null}

      <div className="provider-layout">
        <div className="provider-list">
          {!loadingCatalog && catalog.length === 0 ? (
            <div className="provider-empty">暂无可用智能体，请点击更新列表。</div>
          ) : null}
          {catalog.map((provider) => {
            const description = provider.description || provider.name
            const active = activeId === provider.id

            return (
              <button
                key={provider.id}
                className={`provider-card ${selectedId === provider.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(provider.id)}
              >
                <div className="provider-card-top">
                  <span className="provider-name">{provider.name}</span>
                  {active ? (
                    <span className="provider-status" title="当前启用" aria-label="当前启用">
                      <span className="provider-status-dot" />
                      启用中
                    </span>
                  ) : null}
                </div>
                <div className="provider-desc" title={description}>
                  {description}
                </div>
                <div className="provider-version">v{provider.version}</div>
              </button>
            )
          })}
        </div>

        <div className="card provider-config-card">
          {selectedProvider ? (
            <>
              <div className="provider-config-header">
                <div>
                  <div className="card-title">智能体配置</div>
                  <h2>{selectedProvider.name}</h2>
                </div>
                <span className="provider-version">v{selectedProvider.version}</span>
              </div>

              {selectedProvider.id === 'doubao' && (
                <div className="form-group">
                  <label className="form-label">常用服务商预设</label>
                  <select
                    className="form-input"
                    defaultValue=""
                    onChange={(event) => {
                      const preset = PROVIDER_PRESETS.find((p) => p.id === event.target.value)
                      if (!preset) return
                      setProviderValue('baseURL', preset.baseURL)
                      setProviderValue('model', preset.model)
                    }}
                  >
                    <option value="" disabled>
                      选择预设自动填充 Base URL 与模型…
                    </option>
                    {PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <p className="form-hint">{buildChatProviderHint(selectedValues.baseURL || '')}</p>
                </div>
              )}

              {selectedProvider.configSchema.fields.map((field) => (
                <ProviderFieldInput
                  key={field.key}
                  field={field}
                  value={selectedValues[field.key] || ''}
                  onChange={(value) => setProviderValue(field.key, value)}
                />
              ))}

              <div className="provider-actions">
                <button className="btn btn-secondary" onClick={handleSaveConfig}>
                  保存配置
                </button>
                <button className="btn btn-primary" onClick={handleActivate}>
                  启用此智能体
                </button>
              </div>
            </>
          ) : (
            <div className="provider-empty">没有选中的智能体。</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProviderFieldInput({
  field,
  value,
  onChange
}: {
  field: ProviderConfigField
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="form-group">
      <label className="form-label">
        {field.label}
        {field.required ? <span className="required-mark"> *</span> : null}
      </label>
      {field.type === 'textarea' ? (
        <textarea
          className="form-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          rows={4}
          readOnly={field.readonly}
        />
      ) : field.type === 'select' ? (
        <select
          className="form-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={field.readonly}
        >
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="form-input"
          type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          autoComplete="off"
          readOnly={field.readonly}
        />
      )}
      {field.hint ? <div className="form-hint">{field.hint}</div> : null}
    </div>
  )
}

function mergeProviderCatalog(remoteProviders: ProviderCatalogItem[]): ProviderCatalogItem[] {
  const remoteOnly = remoteProviders.filter(
    (provider) => !BUILTIN_PROVIDER_CATALOG.some((builtin) => builtin.id === provider.id)
  )
  return [...BUILTIN_PROVIDER_CATALOG, ...remoteOnly]
}

function getProviderDefaults(provider: ProviderCatalogItem | undefined): Record<string, string> {
  if (!provider) return {}
  return provider.configSchema.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = field.defaultValue || ''
    return acc
  }, {})
}

function getProviderValues(
  drafts: Record<string, Record<string, string>>,
  provider: ProviderCatalogItem | undefined,
  settings: AppSettings | null
): Record<string, string> {
  if (!provider) return {}
  const defaults = getProviderDefaults(provider)
  if (provider.id === 'doubao') {
    const savedConfig = settings?.chatProvider.installed ? {} : settings?.chatProvider.config || {}
    const savedBaseUrl = String(savedConfig.baseURL || '').trim().replace(/\/+$/, '')
    // 标准 /api/v3 端点共享视觉密钥；Agent Plan / Coding Plan / 第三方端点使用独立密钥
    const sharesVisionKey = !savedBaseUrl || savedBaseUrl.endsWith('/api/v3')
    return {
      ...defaults,
      ...savedConfig,
      apiKey:
        drafts.doubao?.apiKey ??
        (sharesVisionKey ? settings?.vision.apiKey || '' : String(savedConfig.apiKey || '')),
      ...(drafts.doubao || {})
    }
  }
  return {
    ...defaults,
    ...(settings?.chatProvider.installed?.id === provider.id ? settings.chatProvider.config : {}),
    ...(drafts[provider.id] || {})
  }
}

function getMissingRequiredFields(
  provider: ProviderCatalogItem,
  values: Record<string, string>
): string[] {
  return provider.configSchema.fields
    .filter((field) => field.required && !values[field.key]?.trim())
    .map((field) => field.label)
}

/** 根据 Base URL 动态给出智能体配置提示（尤其是 Agent Plan 专属端点） */
function buildChatProviderHint(baseUrl: string): string {
  const url = (baseUrl || '').trim().replace(/\/+$/, '')
  if (url.includes('/api/plan/')) {
    return '⚠️ Agent Plan 专属端点：模型需填套餐支持的模型名（如 doubao-seed-2.1-turbo）；API Key 必须填 Agent Plan 专属 Key（方舟控制台 → 开通管理 → Agent Plan → API Key 管理），普通 ark-xxx 密钥会返回 401。'
  }
  if (url.includes('/api/coding/')) {
    return '⚠️ Coding Plan 专属端点：需填 Coding Plan 专属 API Key，且官方仅允许在支持的编程工具中使用，直接调用可能被判违规；建议改用标准 /api/v3 端点。'
  }
  if (url.includes('volces.com')) {
    return '火山方舟标准端点：API Key 留空则复用基础配置中的视觉密钥。'
  }
  if (!url) {
    return 'Base URL 留空时使用默认火山方舟端点（/api/v3）。模型需支持图片输入（VLM）。'
  }
  return '第三方 OpenAI 兼容端点：请填写对应服务商的 API Key（独立密钥，不影响视觉密钥）；模型需支持图片输入（VLM）。'
}

let _showToast: ((msg: string, type: 'success' | 'error') => void) | null = null

export function showToast(msg: string, type: 'success' | 'error') {
  _showToast?.(msg, type)
}

function Toast() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [type, setType] = useState<'success' | 'error'>('success')
  const timerRef = useRef<number | undefined>(undefined)

  _showToast = useCallback((msg: string, t: 'success' | 'error') => {
    setMessage(msg)
    setType(t)
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(false), 2500)
  }, [])

  return <div className={`toast ${type} ${visible ? 'show' : ''}`}>{message}</div>
}

export default App
