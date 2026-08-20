// Package middleware 提供 Gin 中间件:JWT 认证、租户上下文、角色校验与 Redis 限流。
package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/auth"
)

// context 中注入的键。
const (
	// CtxUserID JWT 用户 ID。
	CtxUserID = "ctx_user_id"
	// CtxTenantID JWT/站点 Token 解析出的租户 ID(平台超管可能为空)。
	CtxTenantID = "ctx_tenant_id"
	// CtxRole 用户角色。
	CtxRole = "ctx_role"
)

// BearerToken 从 Authorization 请求头提取 Bearer Token,无则返回空串。
func BearerToken(c *gin.Context) string {
	h := c.GetHeader("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return ""
}

// UserIDFrom 从 context 读取用户 ID。
func UserIDFrom(c *gin.Context) string {
	v, _ := c.Get(CtxUserID)
	s, _ := v.(string)
	return s
}

// TenantIDFrom 从 context 读取租户 ID。
func TenantIDFrom(c *gin.Context) string {
	v, _ := c.Get(CtxTenantID)
	s, _ := v.(string)
	return s
}

// RoleFrom 从 context 读取用户角色。
func RoleFrom(c *gin.Context) string {
	v, _ := c.Get(CtxRole)
	s, _ := v.(string)
	return s
}

// JWTAuth 解析并校验 Bearer access token,将 UserID/TenantID/Role 注入 context。
// 失败返回 401。
func JWTAuth(jwtMgr *auth.JWTManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr := BearerToken(c)
		if tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "缺少访问令牌"})
			return
		}
		claims, err := jwtMgr.Verify(tokenStr)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "令牌无效或已过期"})
			return
		}
		c.Set(CtxUserID, claims.UserID)
		c.Set(CtxTenantID, claims.TenantID)
		c.Set(CtxRole, claims.Role)
		c.Next()
	}
}

// RequireRole 要求当前用户角色在允许列表中,否则返回 403。
func RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role := RoleFrom(c)
		for _, r := range roles {
			if role == r {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "权限不足"})
	}
}
