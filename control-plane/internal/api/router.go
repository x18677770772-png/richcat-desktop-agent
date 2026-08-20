package api

import (
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/middleware"
	"richcat/control-plane/internal/model"
)

// NewRouter 构建 Gin 路由。
// 依赖注入 deps;限流/黑名单在 Redis 不可用时自动降级。
func NewRouter(deps Deps) *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Tenant-Id"},
		ExposeHeaders:    []string{"X-Tenant-Id"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	// 健康检查(供 docker healthcheck / nginx 探活)。
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	v1 := r.Group("/api/v1")

	// ---- 认证 ----
	authH := newAuthHandler(deps)
	authGroup := v1.Group("/auth")
	authGroup.POST("/login", middleware.RateLimit(deps.rateLimiter(), "login:", 5, time.Minute.Nanoseconds()), authH.login)
	authGroup.POST("/refresh", authH.refresh)
	authGroup.POST("/logout", authH.logout)

	// ---- Agent 遥测上报(站点 Token 鉴权) ----
	telemetryH := newTelemetryHandler(deps)
	v1.POST("/telemetry", siteTokenAuth(deps.Tenants, deps.Config.JWTSecret), telemetryH.handle)

	// ---- 管理后台(JWT 认证 + 租户上下文) ----
	adminGroup := v1.Group("/admin", middleware.JWTAuth(deps.JWT), middleware.RequireTenant())
	{
		adminH := newAdminHandler(deps)
		adminGroup.GET("/fleet", adminH.fleet)
		adminGroup.GET("/agents/:id", adminH.agentDetail)
		adminGroup.GET("/usage", adminH.usage)
		adminGroup.GET("/alerts", adminH.alerts)
		adminGroup.POST("/alerts/:id/ack", adminH.ackAlert)

		billingH := newBillingHandler(deps)
		adminGroup.GET("/billing/subscription", billingH.subscription)
		adminGroup.GET("/billing/bills", billingH.bills)
	}

	// ---- 平台超管 ----
	platformGroup := v1.Group("/platform",
		middleware.JWTAuth(deps.JWT),
		middleware.RequireRole(model.RolePlatformAdmin),
	)
	{
		billingH := newBillingHandler(deps)
		platformGroup.POST("/tenants", billingH.createTenant)
		platformGroup.GET("/tenants", billingH.listTenants)

		platformH := newPlatformHandler(deps)
		platformGroup.POST("/bills", platformH.createBill)
		platformGroup.POST("/bills/:id/paid", platformH.markPaid)
	}

	return r
}
