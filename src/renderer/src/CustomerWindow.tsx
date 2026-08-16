// src/renderer/src/CustomerWindow.tsx
// 客户管理窗口 — AI 客服的客户关系管理（CRM）
//
// 左侧：客户列表（搜索 / 标签筛选 / 分类统计）
// 右侧：客户详情（标签增删、分类设置、备注、长期记忆时间线）
//
// 客户档案由引擎运行时自动建档：识别到联系人后自动创建档案并记录对话记忆，
// 本窗口用于人工管理（打标签、分类、备注）与查看记忆。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { showToast } from './App'

interface CustomerMemoryEntry {
  ts: number
  summary: string
  lastReply?: string
}

interface CustomerProfile {
  customerId: string
  name: string
  tags: string[]
  category: string
  notes: string
  memory: CustomerMemoryEntry[]
  conversationCount: number
  firstSeenAt: number
  lastSeenAt: number
}

interface CustomerStats {
  total: number
  byCategory: Record<string, number>
  byTag: Record<string, number>
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

const CATEGORY_PRESETS = ['未分类', '潜在客户', '意向客户', '老客户', 'VIP', '代理', '已流失']

export default function CustomerWindow(): React.JSX.Element {
  const [customers, setCustomers] = useState<CustomerProfile[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [stats, setStats] = useState<CustomerStats | null>(null)
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const [list, tags, statsData] = await Promise.all([
        window.electron?.invoke('customer:list'),
        window.electron?.invoke('customer:listTags'),
        window.electron?.invoke('customer:getStats')
      ])
      setCustomers((list as CustomerProfile[]) ?? [])
      setAllTags((tags as string[]) ?? [])
      setStats((statsData as CustomerStats) ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const selected = useMemo(
    () => customers.find((c) => c.customerId === selectedId) ?? null,
    [customers, selectedId]
  )

  // 选中客户变化时同步备注草稿
  useEffect(() => {
    setNotesDraft(selected?.notes ?? '')
  }, [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customers.filter((c) => {
      if (activeTag && !c.tags.includes(activeTag)) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        c.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        c.category.toLowerCase().includes(q)
      )
    })
  }, [customers, query, activeTag])

  const handleUpdate = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!selected) return
      const result = await window.electron?.invoke('customer:update', selected.customerId, patch)
      if (result?.success) {
        await reload()
      } else {
        showToast('保存失败', 'error')
      }
    },
    [selected, reload]
  )

  const handleAddTag = useCallback(
    async (tag: string) => {
      if (!selected) return
      const trimmed = tag.trim()
      if (!trimmed) return
      const result = await window.electron?.invoke('customer:addTags', selected.customerId, [trimmed])
      if (result?.success) await reload()
    },
    [selected, reload]
  )

  const handleRemoveTag = useCallback(
    async (tag: string) => {
      if (!selected) return
      await window.electron?.invoke('customer:removeTag', selected.customerId, tag)
      await reload()
    },
    [selected, reload]
  )

  const handleDelete = useCallback(async () => {
    if (!selected) return
    await window.electron?.invoke('customer:delete', selected.customerId)
    setSelectedId(null)
    showToast('客户档案已删除', 'success')
    await reload()
  }, [selected, reload])

  const handleSaveNotes = useCallback(async () => {
    await handleUpdate({ notes: notesDraft })
    showToast('备注已保存', 'success')
  }, [handleUpdate, notesDraft])

  const [newTag, setNewTag] = useState('')

  return (
    <div className="crm-window">
      <aside className="crm-sidebar">
        <div className="crm-sidebar-header">
          <h3>客户</h3>
          <span className="crm-count">{stats?.total ?? 0} 位</span>
        </div>
        <input
          className="input crm-search"
          placeholder="搜索客户 / 标签 / 分类…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="crm-tag-filter">
          <button
            className={`crm-tag-filter-item ${activeTag === null ? 'active' : ''}`}
            onClick={() => setActiveTag(null)}
          >
            全部
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`crm-tag-filter-item ${activeTag === tag ? 'active' : ''}`}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              {tag}
            </button>
          ))}
          {allTags.length === 0 && <span className="crm-tag-filter-empty">暂无标签</span>}
        </div>
        <div className="crm-customer-list">
          {filtered.map((customer) => (
            <button
              key={customer.customerId}
              className={`crm-customer-item ${selectedId === customer.customerId ? 'active' : ''}`}
              onClick={() => setSelectedId(customer.customerId)}
            >
              <span className="crm-customer-name">{customer.name}</span>
              <span className="crm-customer-meta">
                {customer.category !== '未分类' && (
                  <span className="crm-customer-category">{customer.category}</span>
                )}
                {customer.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="kb-tag">
                    {tag}
                  </span>
                ))}
              </span>
            </button>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="crm-empty">没有匹配的客户</div>
          )}
        </div>
      </aside>

      <main className="crm-main">
        {!selected ? (
          <div className="crm-detail-empty">
            <h4>客户档案</h4>
            <p>
              选择左侧客户查看详情。引擎运行时会自动为联系人建档，
              并记录每轮对话的长期记忆。
            </p>
          </div>
        ) : (
          <div className="crm-detail">
            <div className="crm-detail-header">
              <h3>{selected.name}</h3>
              <div className="crm-detail-actions">
                <span className="crm-detail-stat">
                  对话 {selected.conversationCount} 次
                </span>
                <span className="crm-detail-stat">
                  最近 {formatTime(selected.lastSeenAt)}
                </span>
                <button className="btn-danger btn-sm" onClick={() => void handleDelete()}>
                  删除档案
                </button>
              </div>
            </div>

            <section className="crm-section">
              <h4>分类</h4>
              <div className="crm-category-picker">
                {CATEGORY_PRESETS.map((category) => (
                  <button
                    key={category}
                    className={`crm-category-item ${
                      selected.category === category ? 'active' : ''
                    }`}
                    onClick={() => void handleUpdate({ category })}
                  >
                    {category}
                    {stats?.byCategory[category] ? ` (${stats.byCategory[category]})` : ''}
                  </button>
                ))}
              </div>
            </section>

            <section className="crm-section">
              <h4>标签</h4>
              <div className="crm-tags">
                {selected.tags.map((tag) => (
                  <span key={tag} className="kb-tag crm-tag-removable">
                    {tag}
                    <button
                      className="crm-tag-remove"
                      onClick={() => void handleRemoveTag(tag)}
                      title="移除标签"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {selected.tags.length === 0 && (
                  <span className="crm-no-tags">暂无标签</span>
                )}
              </div>
              <div className="crm-tag-input-row">
                <input
                  className="input"
                  placeholder="添加标签（如：VIP、咨询中）"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTag.trim()) {
                      void handleAddTag(newTag)
                      setNewTag('')
                    }
                  }}
                />
                <button
                  className="btn-primary btn-sm"
                  onClick={() => {
                    void handleAddTag(newTag)
                    setNewTag('')
                  }}
                >
                  添加
                </button>
              </div>
            </section>

            <section className="crm-section">
              <h4>备注</h4>
              <textarea
                className="textarea crm-notes"
                placeholder="客户偏好、历史往来、注意事项…（仅本地保存）"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
              <div className="crm-notes-actions">
                <button className="btn-primary btn-sm" onClick={() => void handleSaveNotes()}>
                  保存备注
                </button>
              </div>
            </section>

            <section className="crm-section">
              <h4>长期记忆（最近 {selected.memory.length} 条）</h4>
              {selected.memory.length === 0 ? (
                <p className="crm-no-memory">
                  暂无对话记忆。引擎运行时每轮对话会自动记录摘要。
                </p>
              ) : (
                <div className="crm-memory-list">
                  {selected.memory.map((entry, index) => (
                    <div key={`${entry.ts}-${index}`} className="crm-memory-item">
                      <span className="crm-memory-time">{formatTime(entry.ts)}</span>
                      <p className="crm-memory-summary">{entry.summary}</p>
                      {entry.lastReply && (
                        <p className="crm-memory-reply">回复：{entry.lastReply}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
