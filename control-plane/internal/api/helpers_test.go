package api

// 测试共用辅助函数与依赖装配。

import (
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/auth"
	"richcat/control-plane/internal/config"
)

// newTestDeps 创建测试用 Deps,所有 store 自动替换为内存 fake。
// 返回 Deps 和 jwtMgr 供测试直接签发令牌。
func newTestDeps(t *testing.T) (Deps, *auth.JWTManager) {
	t.Helper()
	cfg := &config.Config{
		HTTPAddr:      ":8080",
		JWTSecret:     "test-secret-must-be-32bytes",
		AdminEmail:    "admin@richcat.ai",
		AdminPassword: "AdminPass123",
		AccessTTL:     15 * time.Minute,
		RefreshTTL:    7 * 24 * time.Hour,
		PGDSN:         "",
		RedisAddr:     "",
	}
	jwtMgr := auth.NewJWTManager(cfg.JWTSecret, cfg.AccessTTL, cfg.RefreshTTL)
	bl := auth.NewMemoryBlacklist()
	jwtMgr.SetBlacklist(bl)

	deps := Deps{
		Config:      cfg,
		JWT:         jwtMgr,
		Agents:      newFakeAgentStore(),
		Usage:       newFakeUsageStore(),
		Alerts:      newFakeAlertStore(),
		Tenants:     newFakeTenantStore(),
		Users:       newFakeUserStore(),
		Bills:       newFakeBillStore(),
		LoginAudits: newFakeLoginAuditStore(),
		Blacklist:   bl,
		RateLimiter: nil, // 测试禁用限流
	}
	return deps, jwtMgr
}

// newTestRouter 创建测试用路由,自动应用测试 Deps。
func newTestRouter(t *testing.T) (*gin.Engine, Deps, *auth.JWTManager) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	deps, jwtMgr := newTestDeps(t)
	return NewRouter(deps), deps, jwtMgr
}

// bearerHeader 构建 Authorization: Bearer <token> 请求头。
func bearerHeader(token string) string {
	return "Bearer " + token
}
