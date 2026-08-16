// src/core/features/multi-instance/index.ts
// ── F8 多实例协同：占位 FeatureModule + profile 帮助函数（docs §3-F8）──
// 设计文档：docs/richcat-v2-design.md §3-F8。
//
// 多开能力（--profile=<name>）已由主进程实现（数据目录隔离 / 窗口标题标识 /
// skill 端口错开 12680+hash%100 / 旧数据迁移仅在无 profile 时执行），
// 本模块只提供：帮助函数（供装配方与 UI 使用）+ 占位 FeatureModule
// （flagKey='f8.multi_instance'，无 hook——开关仅影响文档/UI 提示）。
//
// 注意：主进程的 PROFILE 解析（src/main/index.ts 顶部）是本模块 parseProfileArg
// 的权威实现；两者规则保持一致（白名单字符 [a-zA-Z0-9_-]，非法字符替换为 _）。

import { FeatureFlagKey } from '../flags'

export const MULTI_INSTANCE_FLAG_KEY: FeatureFlagKey = 'f8.multi_instance'

/** 与主进程一致的 profile 参数白名单字符 */
const PROFILE_SAFE_CHARS = /[^a-zA-Z0-9_-]/g

/**
 * 从 argv 中解析 --profile=<name>（与主进程规则一致：白名单字符，非法字符替换为 _）。
 * 未找到返回空串（= 默认实例）。
 */
export function parseProfileArg(argv: string[]): string {
  const arg = argv.find((a) => a.startsWith('--profile='))
  if (!arg) return ''
  return arg.slice('--profile='.length).trim().replace(PROFILE_SAFE_CHARS, '_')
}

/** 是否处于 profile（多开）模式 */
export function isProfileMode(argv: string[] = process.argv): boolean {
  return parseProfileArg(argv).length > 0
}

/** 当前 profile 名（未多开返回空串） */
export function getProfileName(argv: string[] = process.argv): string {
  return parseProfileArg(argv)
}

/**
 * 实例标识后缀：用于日志/通知中区分多开实例。
 * - 无 profile → 空串（不改变现有文案）；
 * - 有 profile → ' · <name>'（与窗口标题风格一致，如「财听猫 RichCat · a」）。
 * 用法示例：`new Notification({ title: '服务日报' + profileTag(profile), ... })`。
 */
export function profileTag(profile: string): string {
  return profile ? ` · ${profile}` : ''
}

/** F8 占位 FeatureModule（形状与 f1/f5 对齐；无 hook，flag 仅影响 UI 提示与文档） */
export interface MultiInstanceFeatureModule {
  flagKey: FeatureFlagKey
  /** 当前实例的 profile 名（空串 = 默认实例） */
  profileName: string
  /** 是否多开模式 */
  isMultiInstance: boolean
}

export function createMultiInstanceFeature(
  profile: string = getProfileName()
): MultiInstanceFeatureModule {
  return {
    flagKey: 'f8.multi_instance',
    profileName: profile,
    isMultiInstance: profile.length > 0
  }
}
