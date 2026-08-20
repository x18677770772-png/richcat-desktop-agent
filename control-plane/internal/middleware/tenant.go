package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/model"
)

// RequireTenant 强制租户上下文:非平台超管必须携带 tenant_id。
// 同时将 X-Tenant-Id 响应头注入,便于调试与前端读取。
// 平台超管 tenant_id 为空,允许跨租户访问(由各 handler 自行处理全量逻辑)。
func RequireTenant() gin.HandlerFunc {
	return func(c *gin.Context) {
		role := RoleFrom(c)
		tenantID := TenantIDFrom(c)
		if role != model.RolePlatformAdmin && tenantID == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "缺少租户上下文"})
			return
		}
		if tenantID != "" {
			c.Header("X-Tenant-Id", tenantID)
		}
		c.Next()
	}
}
