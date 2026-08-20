import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { tokenStore } from '../api/client'

interface Props {
  children: React.ReactNode
}

/** 路由守卫：未登录 → 重定向 /login */
export function AuthGuard({ children }: Props) {
  const loc = useLocation()
  const user = tokenStore.user
  if (!user || !tokenStore.access) {
    return <Navigate to="/login" state={{ from: loc }} replace />
  }
  return <>{children}</>
}

/** 角色守卫：platform_admin 专用 */
export function AdminGuard({ children }: Props) {
  const user = tokenStore.user
  if (!user || user.role !== 'platform_admin') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}