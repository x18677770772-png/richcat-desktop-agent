// 登录页
import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiLogin, tokenStore } from '../api/client'
import { ApiClientError } from '../api/client'

export default function LoginPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('请输入邮箱与密码')
      return
    }
    setLoading(true)
    try {
      const data = await apiLogin(email.trim(), password)
      tokenStore.setTokens(data.access, data.refresh)
      tokenStore.setUser(data.user)
      // 按角色跳转：超管 → 企业管理页；owner/agent → 舰队工作台
      const defaultTarget = data.user.role === 'platform_admin' ? '/platform' : '/'
      const requested =
        (loc.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? defaultTarget
      nav(requested, { replace: true })
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 423) {
          setError('账号已锁定，请 15 分钟后再试')
        } else if (err.status === 401) {
          setError('账号或密码错误')
        } else {
          setError(err.message || '登录失败')
        }
      } else {
        setError('网络异常，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `radial-gradient(1000px 600px at 20% 10%, rgba(22,50,79,0.9), transparent),
                   radial-gradient(800px 500px at 80% 90%, rgba(27,166,158,0.15), transparent),
                   var(--bg-body)`,
      padding: '16px',
    }}>
      <div style={{ width: 400, maxWidth: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 4 }}>
            <span style={{
              background: 'linear-gradient(135deg, #1ba69e, #10b981)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>财听猫</span>
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>
            RichCat 中央管理后台
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="card"
          style={{ padding: '28px 26px' }}
        >
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label className="form-label">邮箱</label>
            <input
              className="input"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">密码</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
          >
            {loading ? '登录中…' : '登 录'}
          </button>

          <div className="hint" style={{ textAlign: 'center' }}>
            登录失败 5 次将锁定 15 分钟
          </div>
        </form>
      </div>
    </div>
  )
}