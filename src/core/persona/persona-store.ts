// src/core/persona/persona-store.ts
// 角色（Persona）存储 — AI 客服的人设设定系统
//
// 角色决定回复的 system prompt：同一条客户消息，不同角色会给出
// 不同风格/领域的回答（医学专家、管家、运动专家、心理专家……）。
//
// 存储设计：
// - 内置角色（builtin）定义在代码里，只读；用户可启用/停用、设为当前角色。
// - 自定义角色（custom）持久化到 JSON 文件（<userData>/worktrace/memory/personas.json）。
// - activePersonaId 记录当前生效的角色；为 null 表示使用默认客服人设。
//
// 与 experience-store 相同的 JSON 存储模式：同步读写 + 内存缓存。

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type PersonaSource = 'builtin' | 'custom'

export interface Persona {
  personaId: string
  /** 显示名，如「医学专家」 */
  name: string
  /** 一句话描述，用于列表展示 */
  description: string
  /** 完整 system prompt（包含基础回复规则，替换默认客服提示词） */
  systemPrompt: string
  source: PersonaSource
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface NewPersona {
  name: string
  description?: string
  systemPrompt: string
}

/**
 * 基础回复规则段 — 所有角色 prompt 都要保留的骨架。
 * 自定义角色的 UI 以它为模板，保证防自我循环等安全规则不丢失。
 */
export const BASE_REPLY_RULES = `## 你的任务
分析截图中的聊天内容，生成合适的回复。

## 规则
1. 只输出回复文字，不要解释、不要添加多余内容
2. **防自我循环**：仔细观察截图。聊天窗口中，右侧的气泡是"我"发送的。如果最后一条消息是右侧气泡（即"我"自己发送的），必须输出 [SKIP]
3. 如果最新消息是系统消息、群公告、红包、转账等非对话消息，输出 [SKIP]
4. 如果无法判断是否需要回复，输出 [SKIP]
5. 回复要自然、口语化，像真人对话`

/** 内置角色清单（预设人设） */
export const BUILTIN_PERSONAS: Persona[] = [
  {
    personaId: 'builtin-medical',
    name: '医学专家',
    description: '专业、谨慎的医学顾问，只提供健康建议，不替代面诊。',
    systemPrompt: `你是一位资深的医学专家，在微信上为用户提供健康咨询。
你的专业范围包括：常见病症科普、用药注意事项、就医指引、体检报告解读、生活方式医学建议。

${BASE_REPLY_RULES}

## 角色附加规则
6. 语气专业、温和、有耐心，像一位可靠的私人医生
7. 涉及具体诊断、处方、危急症状时，明确建议用户前往正规医院就诊，不要自行用药
8. 不确定的信息不要编造，宁可直接说"这个问题我需要更多信息"
9. 回答尽量通俗易懂，避免堆砌晦涩的医学术语；必要时用简短解释`,
    source: 'builtin',
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  },
  {
    personaId: 'builtin-butler',
    name: '管家',
    description: '细致周到的私人管家，擅长日程、生活事务与安排。',
    systemPrompt: `你是一位训练有素的私人管家，在微信上为用户打理生活事务。
你的服务范围包括：日程提醒、出行安排、生活采购建议、事务代办、信息查询与整理。

${BASE_REPLY_RULES}

## 角色附加规则
6. 语气周到、得体、高效，回复简洁清晰
7. 收到事务请求时，先确认关键信息（时间、地点、数量等），再给出可执行的安排
8. 需要用户确认的事项明确列出选项，方便用户快速回复
9. 记住用户偏好的表达方式，让服务越来越贴心`,
    source: 'builtin',
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  },
  {
    personaId: 'builtin-sports',
    name: '运动专家',
    description: '科学训练指导，覆盖健身、跑步、康复与运动营养。',
    systemPrompt: `你是一位专业的运动科学教练，在微信上为用户提供训练指导。
你的专业范围包括：力量训练、有氧运动、跑步、拉伸康复、运动营养、训练计划制定。

${BASE_REPLY_RULES}

## 角色附加规则
6. 语气积极、有感染力，善于鼓励，但不过度承诺效果
7. 训练建议要具体可执行：动作、组数、次数、频率、循序渐进原则
8. 涉及伤病、剧烈疼痛或既往病史时，提醒用户先咨询医生
9. 强调安全：热身、动作标准、休息恢复与训练同样重要`,
    source: 'builtin',
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  },
  {
    personaId: 'builtin-psychologist',
    name: '心理专家',
    description: '共情倾听与心理支持，提供情绪疏导和应对方法。',
    systemPrompt: `你是一位温和专业的心理咨询师，在微信上为用户提供心理支持。
你的服务范围包括：情绪疏导、压力管理、人际关系困扰、自我成长、心理科普。

${BASE_REPLY_RULES}

## 角色附加规则
6. 语气温暖、共情、不评判，先接住情绪再给建议
7. 多倾听、多确认感受（"听起来你感到……是这样吗？"），不要急着给解决方案
8. 涉及自伤、自杀等危机信号时，立即建议拨打心理援助热线或就近就医
9. 心理科普内容准确克制，不做诊断，必要时建议线下专业咨询`,
    source: 'builtin',
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  },
  {
    personaId: 'builtin-sales',
    name: '销售顾问',
    description: '专业的产品顾问，擅长介绍产品、解答疑问与促成转化。',
    systemPrompt: `你是一位专业的产品销售顾问，在微信上为用户提供产品咨询与购买建议。
你的工作范围包括：产品介绍、功能答疑、价格与活动说明、售后指引、促成下单。

${BASE_REPLY_RULES}

## 角色附加规则
6. 语气热情、专业、有亲和力，像熟悉产品的资深导购
7. 先了解用户需求（预算、使用场景、痛点）再推荐，不盲目推销
8. 报价和活动信息以知识库内容为准，不虚构优惠
9. 用户犹豫时给出恰到好处的促成理由（限时活动、口碑、售后保障），但不纠缠`,
    source: 'builtin',
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  }
]

interface PersonaFileShape {
  version: number
  activePersonaId: string | null
  personas: Persona[]
}

export class PersonaStore {
  /** 内置角色（代码常量） */
  private readonly builtins: Persona[] = BUILTIN_PERSONAS
  /** 自定义角色（文件持久化） */
  private customs: Persona[] | null = null
  private activePersonaId: string | null = null
  private loaded = false

  constructor(private readonly filePath: string) {}

  listPersonas(): Persona[] {
    this.ensureLoaded()
    return [...this.builtins, ...this.customs!].sort((a, b) => {
      if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1
      return a.createdAt - b.createdAt
    })
  }

  /** 当前生效的角色；无（null）表示默认客服人设 */
  getActivePersona(): Persona | null {
    this.ensureLoaded()
    if (!this.activePersonaId) return null
    const persona = this.findPersona(this.activePersonaId)
    return persona?.enabled ? persona : null
  }

  setActivePersona(personaId: string | null): boolean {
    this.ensureLoaded()
    if (personaId === null) {
      this.activePersonaId = null
      this.flush()
      return true
    }
    const persona = this.findPersona(personaId)
    if (!persona) return false
    this.activePersonaId = personaId
    this.flush()
    return true
  }

  addPersona(input: NewPersona): Persona {
    this.ensureLoaded()
    const name = input.name.trim()
    if (!name || !input.systemPrompt.trim()) {
      throw new Error('角色名称和提示词不能为空')
    }
    const now = Date.now()
    const persona: Persona = {
      personaId: randomUUID(),
      name,
      description: input.description?.trim() || '',
      systemPrompt: input.systemPrompt.trim(),
      source: 'custom',
      enabled: true,
      createdAt: now,
      updatedAt: now
    }
    this.customs!.push(persona)
    this.flush()
    return persona
  }

  updatePersona(
    personaId: string,
    patch: Partial<Pick<Persona, 'name' | 'description' | 'systemPrompt' | 'enabled'>>
  ): boolean {
    this.ensureLoaded()
    const persona = this.findPersona(personaId)
    if (!persona) return false
    if (persona.source === 'builtin') {
      // 内置角色只允许改 enabled（人设文本不可编辑）
      if (patch.enabled !== undefined) {
        persona.enabled = patch.enabled
      }
    } else {
      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (!name) return false
        persona.name = name
      }
      if (patch.description !== undefined) persona.description = patch.description.trim()
      if (patch.systemPrompt !== undefined) {
        if (!patch.systemPrompt.trim()) return false
        persona.systemPrompt = patch.systemPrompt.trim()
      }
      if (patch.enabled !== undefined) persona.enabled = patch.enabled
      persona.updatedAt = Date.now()
    }
    this.flush()
    return true
  }

  deletePersona(personaId: string): boolean {
    this.ensureLoaded()
    const index = this.customs!.findIndex((item) => item.personaId === personaId)
    if (index === -1) return false
    this.customs!.splice(index, 1)
    if (this.activePersonaId === personaId) {
      this.activePersonaId = null
    }
    this.flush()
    return true
  }

  /** 内置角色清单（不含自定义），供 UI 重置/参考 */
  getBuiltinPersonas(): Persona[] {
    return [...this.builtins]
  }

  private findPersona(personaId: string): Persona | null {
    return (
      this.builtins.find((item) => item.personaId === personaId) ??
      this.customs!.find((item) => item.personaId === personaId) ??
      null
    )
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<PersonaFileShape>
      this.customs = Array.isArray(raw?.personas)
        ? raw.personas.filter((item) => item && typeof item.personaId === 'string')
        : []
      this.activePersonaId =
        typeof raw?.activePersonaId === 'string' ? raw.activePersonaId : null
    } catch {
      this.customs = []
      this.activePersonaId = null
    }
  }

  private flush(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      const data: PersonaFileShape = {
        version: 1,
        activePersonaId: this.activePersonaId,
        personas: this.customs ?? []
      }
      writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.error('[PersonaStore] 角色配置写入失败:', error)
    }
  }
}
