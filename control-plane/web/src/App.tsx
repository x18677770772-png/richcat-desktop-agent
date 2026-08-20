// 路由与全局配置
import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AuthGuard, AdminGuard } from './components/Guards'
import { AUTH_EXPIRED_EVENT } from './api/client'
import Layout from './components/Layout'
import LoginPage from './pages/Login'
import FleetPage from './pages/Fleet'
import AgentDetailPage from './pages/AgentDetail'
import UsagePage from './pages/Usage'
import AlertsPage from './pages/Alerts'
import BillingPage from './pages/Billing'
import PlatformPage from './pages/Platform'

/** 全局监听登录失效事件，统一跳转 /login */
function AuthExpiredListener() {
  const nav = useNavigate()
  useEffect(() => {
    const onExpired = () => nav('/login', { replace: true })
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [nav])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthExpiredListener />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route path="/" element={<FleetPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route
            path="/platform"
            element={
              <AdminGuard>
                <PlatformPage />
              </AdminGuard>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}