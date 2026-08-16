// src/core/features/flags.ts
// ── V2 Feature Flags 框架（阶段 0 / C0）──
// 每个功能独立开关，关闭零影响（不注入 prompt / 不改变行为 / 无性能损失 / 不阻塞主链路）。
// 设计文档：docs/richcat-v2-design.md §2。

/** 功能开关键（F1-F10，与 docs/richcat-v2-design.md §2.1 一一对应） */
export type FeatureFlagKey =
  | 'f1.group_chat' // 群聊支持
  | 'f2.human_handoff' // 人工接管/升级
  | 'f3.vip_service' // VIP 差异化服务
  | 'f4.role_routing' // 多角色消息路由
  | 'f5.emotion_risk' // 情绪/风险识别
  | 'f6.daily_report' // 服务日报
  | 'f7.follow_up' // 待跟进提醒
  | 'f8.multi_instance' // 多实例协同（文档/配置，开关为占位）
  | 'f9.knowledge_v2' // 知识库深度优化
  | 'f10.prompt_system' // 提示词体系（默认开，可整体回退旧 prompt）

/** 全部开关键（固定顺序：用于遍历 / 白名单校验 / 默认值合并） */
export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  'f1.group_chat',
  'f2.human_handoff',
  'f3.vip_service',
  'f4.role_routing',
  'f5.emotion_risk',
  'f6.daily_report',
  'f7.follow_up',
  'f8.multi_instance',
  'f9.knowledge_v2',
  'f10.prompt_system'
]

/** 每个开关的默认值（缺失 key 时生效） */
export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  'f1.group_chat': false,
  'f2.human_handoff': true,
  'f3.vip_service': true,
  'f4.role_routing': false,
  'f5.emotion_risk': true,
  'f6.daily_report': true,
  'f7.follow_up': true,
  'f8.multi_instance': true, // 占位：仅影响文档/UI 提示
  'f9.knowledge_v2': false, // 默认关闭：知识注入策略保持现状（全量 30 条）
  'f10.prompt_system': true // 默认开；关闭时 PromptAssembler 退化输出旧 prompt
}

/** 类型守卫：判断未知值是否为合法的开关键（IPC 入参校验用） */
export function isFeatureFlagKey(key: unknown): key is FeatureFlagKey {
  return typeof key === 'string' && (FEATURE_FLAG_KEYS as readonly string[]).includes(key)
}

/**
 * 白名单归一化：非法 key 丢弃，非布尔值丢弃，缺失 key 不补默认值
 * （默认值在读取时（getAll/isEnabled）合并，保证旧 settings 文件缺字段时行为正确）。
 */
export function normalizeFeatures(raw: unknown): Partial<Record<FeatureFlagKey, boolean>> {
  const out: Partial<Record<FeatureFlagKey, boolean>> = {}
  if (!raw || typeof raw !== 'object') return out
  const rec = raw as Record<string, unknown>
  for (const key of FEATURE_FLAG_KEYS) {
    const value = rec[key]
    if (typeof value === 'boolean') out[key] = value
  }
  return out
}

/**
 * 功能开关访问器。
 * - 构造时注入"读取当前 settings.features"的函数（主进程传 normalizeSettings(...).features）。
 * - 可选注入"持久化"函数（主进程写回 settingsStore）；未注入时 set() 仅影响内存视图。
 * - isEnabled(key) 缺省值回退 FEATURE_FLAG_DEFAULTS —— 旧数据 / 新 key 永不 undefined。
 */
export class FeatureFlags {
  constructor(
    private readonly get: () => Partial<Record<FeatureFlagKey, boolean>>,
    private readonly persist?: (flags: Record<FeatureFlagKey, boolean>) => void
  ) {}

  isEnabled(key: FeatureFlagKey): boolean {
    const value = this.get()[key]
    return typeof value === 'boolean' ? value : FEATURE_FLAG_DEFAULTS[key]
  }

  /** 合并默认值后的完整开关表（UI / IPC 用） */
  getAll(): Record<FeatureFlagKey, boolean> {
    const out = { ...FEATURE_FLAG_DEFAULTS }
    const raw = this.get()
    for (const key of FEATURE_FLAG_KEYS) {
      const value = raw[key]
      if (typeof value === 'boolean') out[key] = value
    }
    return out
  }

  /** 写入单个开关并持久化（若注入 persist）；写失败不抛错，仅记日志 */
  set(key: FeatureFlagKey, value: boolean): void {
    if (this.persist) {
      try {
        const next = this.getAll()
        next[key] = value
        this.persist(next)
      } catch (error) {
        console.error(`[FeatureFlags] 持久化 ${key}=${value} 失败:`, error)
      }
    } else {
      console.warn(`[FeatureFlags] 未配置持久化，忽略 set(${key}=${value})`)
    }
  }
}
