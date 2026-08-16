// src/renderer/src/KnowledgeWindow.tsx
// 知识库窗口 — AI 客服的专业知识管理
//
// 功能：
// - 知识条目列表（标题/内容/标签/启用状态）
// - 关键词搜索（标题/内容/标签）
// - 新增 / 编辑 / 删除 / 启用停用
// - 批量导入（「标题：内容」按空行分段）

import { useCallback, useEffect, useState } from 'react'
import { showToast } from './App'

interface KnowledgeItem {
  itemId: string
  title: string
  content: string
  tags: string[]
  source: 'manual' | 'import'
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface ItemEditor {
  itemId: string | null
  title: string
  content: string
  tags: string
}

const EMPTY_EDITOR: ItemEditor = { itemId: null, title: '', content: '', tags: '' }

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export default function KnowledgeWindow(): React.JSX.Element {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<ItemEditor | null>(null)
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async (q = query) => {
    try {
      const list = q.trim()
        ? ((await window.electron?.invoke('knowledge:search', q)) as KnowledgeItem[])
        : ((await window.electron?.invoke('knowledge:list')) as KnowledgeItem[])
      setItems(list ?? [])
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void reload('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q)
      void reload(q)
    },
    [reload]
  )

  const handleSave = useCallback(async () => {
    if (!editor) return
    if (!editor.title.trim() || !editor.content.trim()) {
      showToast('标题和内容不能为空', 'error')
      return
    }
    const payload = {
      title: editor.title,
      content: editor.content,
      tags: editor.tags
        .split(/[,，、\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    }
    if (editor.itemId) {
      const result = await window.electron?.invoke('knowledge:update', editor.itemId, payload)
      if (result?.success) {
        showToast('知识已更新', 'success')
      } else {
        showToast('更新失败', 'error')
        return
      }
    } else {
      const result = await window.electron?.invoke('knowledge:add', payload)
      if (result?.success) {
        showToast('知识已添加', 'success')
      } else {
        showToast(result?.error || '添加失败', 'error')
        return
      }
    }
    setEditor(null)
    await reload()
  }, [editor, reload])

  const handleDelete = useCallback(
    async (item: KnowledgeItem) => {
      const result = await window.electron?.invoke('knowledge:delete', item.itemId)
      if (result?.success) {
        showToast('已删除', 'success')
        await reload()
      }
    },
    [reload]
  )

  const handleToggleEnabled = useCallback(
    async (item: KnowledgeItem) => {
      await window.electron?.invoke('knowledge:setEnabled', item.itemId, !item.enabled)
      await reload()
    },
    [reload]
  )

  const handleImport = useCallback(async () => {
    const result = await window.electron?.invoke('knowledge:importText', importText)
    if (result?.success) {
      showToast(`成功导入 ${result.items?.length ?? 0} 条知识`, 'success')
      setImportText('')
      setShowImport(false)
      await reload()
    } else {
      showToast(result?.error || '导入失败', 'error')
    }
  }, [importText, reload])

  return (
    <div className="kb-window">
      <header className="kb-header">
        <div>
          <h3>知识库</h3>
          <p className="kb-hint">
            运行时注入客服回复 prompt（最多 {items.filter((i) => i.enabled).length} 条启用中，上限 30 条）
          </p>
        </div>
        <div className="kb-header-actions">
          <button className="btn-secondary" onClick={() => setShowImport((v) => !v)}>
            批量导入
          </button>
          <button className="btn-primary" onClick={() => setEditor({ ...EMPTY_EDITOR })}>
            ＋ 新增知识
          </button>
        </div>
      </header>

      <div className="kb-toolbar">
        <input
          className="input kb-search"
          placeholder="搜索标题 / 内容 / 标签…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {showImport && (
        <div className="kb-import">
          <textarea
            className="textarea kb-import-textarea"
            placeholder={
              '批量导入：按空行分段，每段第一行为标题（可含「：」）\n\n运费政策：满 99 元包邮，偏远地区除外。\n\n退货流程\n7 天内无理由退货，联系客服获取退货地址。'
            }
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="kb-import-actions">
            <button className="btn-secondary" onClick={() => setShowImport(false)}>
              取消
            </button>
            <button className="btn-primary" onClick={() => void handleImport()}>
              导入
            </button>
          </div>
        </div>
      )}

      {editor && (
        <div className="kb-editor">
          <input
            className="input"
            placeholder="标题（如：运费政策）"
            value={editor.title}
            onChange={(e) => setEditor({ ...editor, title: e.target.value })}
          />
          <textarea
            className="textarea kb-editor-content"
            placeholder="内容（客服回答以此为准）"
            value={editor.content}
            onChange={(e) => setEditor({ ...editor, content: e.target.value })}
          />
          <input
            className="input"
            placeholder="标签，逗号分隔（如：售后, 物流）"
            value={editor.tags}
            onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
          />
          <div className="kb-editor-actions">
            <button className="btn-secondary" onClick={() => setEditor(null)}>
              取消
            </button>
            <button className="btn-primary" onClick={() => void handleSave()}>
              {editor.itemId ? '保存修改' : '添加'}
            </button>
          </div>
        </div>
      )}

      <div className="kb-list">
        {items.map((item) => (
          <div key={item.itemId} className={`kb-item ${item.enabled ? '' : 'disabled'}`}>
            <div className="kb-item-main">
              <div className="kb-item-title-row">
                <span className="kb-item-title">{item.title}</span>
                <span className={`kb-item-source badge-${item.source}`}>
                  {item.source === 'import' ? '导入' : '手动'}
                </span>
                {!item.enabled && <span className="kb-item-off">已停用</span>}
              </div>
              <p className="kb-item-content">{item.content}</p>
              {item.tags.length > 0 && (
                <div className="kb-item-tags">
                  {item.tags.map((tag) => (
                    <span key={tag} className="kb-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <p className="kb-item-time">更新于 {formatTime(item.updatedAt)}</p>
            </div>
            <div className="kb-item-actions">
              <button className="btn-secondary btn-sm" onClick={() => void handleToggleEnabled(item)}>
                {item.enabled ? '停用' : '启用'}
              </button>
              <button
                className="btn-secondary btn-sm"
                onClick={() =>
                  setEditor({
                    itemId: item.itemId,
                    title: item.title,
                    content: item.content,
                    tags: item.tags.join(', ')
                  })
                }
              >
                编辑
              </button>
              <button className="btn-danger btn-sm" onClick={() => void handleDelete(item)}>
                删除
              </button>
            </div>
          </div>
        ))}
        {!loading && items.length === 0 && (
          <div className="kb-empty">
            {query ? '没有匹配的知识条目' : '知识库为空，点击「新增知识」或「批量导入」开始'}
          </div>
        )}
      </div>
    </div>
  )
}
