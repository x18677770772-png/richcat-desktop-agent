// src/renderer/src/PersonaPanel.tsx
// 角色设定面板 — AI 客服人设管理（嵌入设置窗口）
//
// 功能：
// - 选择当前生效角色（决定回复的 system prompt）
// - 内置角色（医学专家/管家/运动专家/心理专家/销售顾问）启用/停用
// - 自定义角色增删改，支持一键插入基础规则模板

import { useCallback, useEffect, useState } from 'react'
import { showToast } from './App'

interface Persona {
  personaId: string
  name: string
  description: string
  systemPrompt: string
  source: 'builtin' | 'custom'
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** 与 src/core/persona/persona-store.ts 的基础规则模板保持一致 */
const BASE_REPLY_RULES = `## 你的任务
分析截图中的聊天内容，生成合适的回复。

## 规则
1. 只输出回复文字，不要解释、不要添加多余内容
2. **防自我循环**：仔细观察截图。聊天窗口中，右侧的气泡是"我"发送的。如果最后一条消息是右侧气泡（即"我"自己发送的），必须输出 [SKIP]
3. 如果最新消息是系统消息、群公告、红包、转账等非对话消息，输出 [SKIP]
4. 如果无法判断是否需要回复，输出 [SKIP]
5. 回复要自然、口语化，像真人对话`

interface PersonaEditorState {
  personaId: string | null
  name: string
  description: string
  systemPrompt: string
}

const EMPTY_EDITOR: PersonaEditorState = {
  personaId: null,
  name: '',
  description: '',
  systemPrompt: ''
}

export default function PersonaPanel(): React.JSX.Element {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editor, setEditor] = useState<PersonaEditorState | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([
        window.electron?.invoke('persona:list'),
        window.electron?.invoke('persona:getActive')
      ])
      setPersonas((list as Persona[]) ?? [])
      setActiveId((active as Persona | null)?.personaId ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleSetActive = useCallback(
    async (personaId: string | null) => {
      const result = await window.electron?.invoke('persona:setActive', personaId)
      if (result?.success) {
        setActiveId(personaId)
        showToast(personaId ? '角色已切换' : '已恢复默认客服人设', 'success')
      }
    },
    []
  )

  const handleToggleEnabled = useCallback(
    async (persona: Persona) => {
      const result = await window.electron?.invoke('persona:update', persona.personaId, {
        enabled: !persona.enabled
      })
      if (result?.success) {
        await reload()
      }
    },
    [reload]
  )

  const handleSave = useCallback(async () => {
    if (!editor) return
    if (!editor.name.trim() || !editor.systemPrompt.trim()) {
      showToast('角色名称和提示词不能为空', 'error')
      return
    }
    if (editor.personaId) {
      const result = await window.electron?.invoke('persona:update', editor.personaId, {
        name: editor.name,
        description: editor.description,
        systemPrompt: editor.systemPrompt
      })
      if (result?.success) {
        showToast('角色已更新', 'success')
      } else {
        showToast('角色更新失败', 'error')
        return
      }
    } else {
      const result = await window.electron?.invoke('persona:add', {
        name: editor.name,
        description: editor.description,
        systemPrompt: editor.systemPrompt
      })
      if (result?.success) {
        showToast('角色已创建', 'success')
      } else {
        showToast(result?.error || '角色创建失败', 'error')
        return
      }
    }
    setEditor(null)
    await reload()
  }, [editor, reload])

  const handleDelete = useCallback(
    async (persona: Persona) => {
      const result = await window.electron?.invoke('persona:delete', persona.personaId)
      if (result?.success) {
        showToast('角色已删除', 'success')
        await reload()
      }
    },
    [reload]
  )

  const insertTemplate = useCallback(() => {
    setEditor((prev) =>
      prev
        ? {
            ...prev,
            systemPrompt: prev.systemPrompt.trim()
              ? `${prev.systemPrompt.trim()}\n\n${BASE_REPLY_RULES}`
              : `你是一位${prev.name || '你的角色'}，在微信上为用户提供服务。\n\n${BASE_REPLY_RULES}`
          }
        : prev
    )
  }, [])

  if (loading) {
    return <div className="persona-panel-empty">加载中…</div>
  }

  return (
    <div className="persona-panel">
      <div className="persona-panel-header">
        <div>
          <h3>角色设定</h3>
          <p className="persona-panel-hint">
            角色决定客服的回复人设。当前生效：{activeId ? '已选择角色' : '默认客服'}
          </p>
        </div>
        <div className="persona-header-actions">
          <button
            className="btn-secondary"
            onClick={() => void handleSetActive(null)}
            disabled={!activeId}
          >
            恢复默认客服
          </button>
          <button
            className="btn-primary"
            onClick={() => setEditor({ ...EMPTY_EDITOR })}
          >
            ＋ 新建角色
          </button>
        </div>
      </div>

      {editor && (
        <div className="persona-editor">
          <div className="persona-editor-row">
            <input
              className="input"
              placeholder="角色名称（如：营养师）"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />
            <input
              className="input"
              placeholder="一句话描述（如：专业的膳食与营养建议）"
              value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
            />
          </div>
          <textarea
            className="textarea persona-prompt-textarea"
            placeholder="角色的完整 system prompt（决定回复风格与规则）"
            value={editor.systemPrompt}
            onChange={(e) => setEditor({ ...editor, systemPrompt: e.target.value })}
          />
          <div className="persona-editor-actions">
            <button className="btn-secondary" onClick={insertTemplate}>
              插入基础规则模板
            </button>
            <div className="persona-editor-actions-right">
              <button className="btn-secondary" onClick={() => setEditor(null)}>
                取消
              </button>
              <button className="btn-primary" onClick={() => void handleSave()}>
                {editor.personaId ? '保存修改' : '创建角色'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="persona-list">
        {personas.map((persona) => {
          const isActive = persona.personaId === activeId
          return (
            <div
              key={persona.personaId}
              className={`persona-card ${isActive ? 'active' : ''} ${
                persona.enabled ? '' : 'disabled'
              }`}
            >
              <div className="persona-card-main">
                <div className="persona-card-title-row">
                  <span className="persona-card-name">{persona.name}</span>
                  <span
                    className={`persona-badge ${
                      persona.source === 'builtin' ? 'badge-builtin' : 'badge-custom'
                    }`}
                  >
                    {persona.source === 'builtin' ? '内置' : '自定义'}
                  </span>
                  {isActive && <span className="persona-badge badge-active">当前</span>}
                  {!persona.enabled && <span className="persona-badge badge-off">已停用</span>}
                </div>
                {persona.description && (
                  <p className="persona-card-desc">{persona.description}</p>
                )}
                <p className="persona-card-prompt">{persona.systemPrompt.slice(0, 200)}</p>
              </div>
              <div className="persona-card-actions">
                {!isActive && persona.enabled && (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => void handleSetActive(persona.personaId)}
                  >
                    设为当前
                  </button>
                )}
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => void handleToggleEnabled(persona)}
                >
                  {persona.enabled ? '停用' : '启用'}
                </button>
                {persona.source === 'custom' && (
                  <>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() =>
                        setEditor({
                          personaId: persona.personaId,
                          name: persona.name,
                          description: persona.description,
                          systemPrompt: persona.systemPrompt
                        })
                      }
                    >
                      编辑
                    </button>
                    <button
                      className="btn-danger btn-sm"
                      onClick={() => void handleDelete(persona)}
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
        {personas.length === 0 && (
          <div className="persona-panel-empty">暂无角色，点击「新建角色」创建</div>
        )}
      </div>
    </div>
  )
}
