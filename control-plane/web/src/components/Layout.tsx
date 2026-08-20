// 主布局：左侧栏 + 顶部栏 + 内容区
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { tokenStore, apiLogout } from '../api/client'
import { roleName } from '../lib/format'

const navItems = [
  { to: '/', label: '舰队视图', icon: '⊞', end: true },
  { to: '/usage', label: '用量看板', icon: '▦' },
  { to: '/alerts', label: '告警中心', icon: '⚡' },
  { to: '/billing', label: '计费', icon: '¥' },
  { to: '/platform', label: '企业管理', icon: '⛭', adminOnly: true },
]

export default function Layout() {
  const user = tokenStore.user
  const [loggingOut, setLoggingOut] = useState(false)

  // apiLogout 会清空令牌并广播 AUTH_EXPIRED_EVENT，App 层统一跳转 /login
  const handleLogout = async () => {
    setLoggingOut(true)
    await apiLogout()
  }

  if (!user) return null

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--bg-body)',
    }}>
      {/* 左侧栏 */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-weak)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0 0 12px',
      }}>
        {/* 品牌 */}
        <div style={{
          padding: '20px 18px 16px',
          borderBottom: '1px solid var(--border-weak)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--color-teal)',
              background: 'linear-gradient(135deg, #1ba69e, #10b981)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              财听猫
            </span>
            <span style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              padding: '1px 6px',
              border: '1px solid var(--border-weak)',
              borderRadius: 'var(--radius-full)',
            }}>
              管理后台
            </span>
          </div>
        </div>

        {/* 导航 */}
        <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
          {navItems
            .filter(item => !item.adminOnly || user.role === 'platform_admin')
            .map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  marginBottom: 2,
                  borderRadius: 'var(--radius-md)',
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--bg-glass)' : 'transparent',
                  border: isActive ? '1px solid var(--border-teal)' : '1px solid transparent',
                  textDecoration: 'none',
                  transition: 'all var(--transition-fast)',
                })}
              >
                <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
        </nav>
      </aside>

      {/* 主区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 顶部栏 */}
        <header style={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 14,
          padding: '0 24px',
          borderBottom: '1px solid var(--border-weak)',
          background: 'rgba(11, 21, 32, 0.8)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {user.email}
          </span>
          <span style={{
            fontSize: 11,
            padding: '2px 8px',
            background: 'rgba(27, 166, 158, 0.1)',
            color: 'var(--color-teal)',
            borderRadius: 'var(--radius-full)',
          }}>
            {roleName(user.role)}
          </span>
          <button
            className="btn btn-sm"
            onClick={handleLogout}
            disabled={loggingOut}
            style={{ background: 'transparent' }}
          >
            退出
          </button>
        </header>

        {/* 内容区 */}
        <main style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px',
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}