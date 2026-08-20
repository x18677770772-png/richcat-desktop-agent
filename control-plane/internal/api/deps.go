// Package api 实现 Gin 路由与 HTTP handler。
// handler 只做 HTTP 解析与响应,业务逻辑通过 store 接口注入,便于测试用内存 fake。
package api

import (
	"time"

	"github.com/redis/go-redis/v9"

	"richcat/control-plane/internal/auth"
	"richcat/control-plane/internal/config"
	"richcat/control-plane/internal/middleware"
	"richcat/control-plane/internal/model"
	"richcat/control-plane/internal/store"
)

// AgentStore 值守机数据访问接口。
type AgentStore interface {
	UpsertAgent(a *model.Agent) error
	UpdateLastSeen(agentID, status string, lastSeen time.Time, res model.ResourceSnapshot) error
	GetAgent(id string) (*model.Agent, error)
	ListByTenant(tenantID string) ([]model.Agent, error)
	ListAll() ([]model.Agent, error)
}

// UsageStore 用量数据访问接口。
type UsageStore interface {
	UpsertUsageDaily(u *model.UsageDaily) error
	SumByTenantAndDayRange(tenantID string, from, to time.Time) (*store.UsageSum, error)
	SumAllByDayRange(from, to time.Time) (*store.UsageSum, error)
	ListUsageByDay(tenantID string, from, to time.Time) ([]model.UsageDaily, error)
	ListByAgentAndDayRange(agentID string, from, to time.Time) ([]model.UsageDaily, error)
}

// AlertStore 告警数据访问接口。
type AlertStore interface {
	CreateAlert(a *model.Alert) error
	ResolveAlert(alertID string) error
	ListByTenant(tenantID, status string) ([]model.Alert, error)
	ListAll(status string) ([]model.Alert, error)
	GetAlert(alertID string) (*model.Alert, error)
	AckAlert(alertID string) error
}

// TenantStore 租户数据访问接口。
type TenantStore interface {
	CreateTenant(name, siteTokenHash, plan string, seats int) (*model.Tenant, error)
	UpdateSubscription(tenantID string, plan string, seats int, start, end *time.Time) error
	GetTenant(id string) (*model.Tenant, error)
	ListTenants() ([]model.Tenant, error)
	GetBySiteTokenHash(hash string) (*model.Tenant, error)
}

// UserStore 用户数据访问接口。
type UserStore interface {
	FindByEmail(email string) (*model.User, error)
	FindByID(id string) (*model.User, error)
	CreateUser(u *model.User) error
	UpdateLoginState(userID string, failedLogins int, lockedUntil *time.Time) error
	UpdateLastLogin(userID string, t time.Time) error
	ListByTenant(tenantID string) ([]model.User, error)
}

// BillStore 账单数据访问接口。
type BillStore interface {
	CreateBill(b *model.Bill) error
	ListByTenant(tenantID string) ([]model.Bill, error)
	ListAll() ([]model.Bill, error)
	MarkPaid(billID string, paidAt time.Time) error
}

// LoginAuditStore 登录审计接口。
type LoginAuditStore interface {
	RecordLoginAudit(email string, success bool, ip, userAgent string) error
}

// Deps 汇聚路由所需依赖,测试时替换为内存 fake。
type Deps struct {
	Config *config.Config
	JWT    *auth.JWTManager

	Agents      AgentStore
	Usage       UsageStore
	Alerts      AlertStore
	Tenants     TenantStore
	Users       UserStore
	Bills       BillStore
	LoginAudits LoginAuditStore

	// Redis 可为空(限流降级)。
	Redis *redis.Client
	// Blacklist 可为空(登出时跳过黑名单)。
	Blacklist auth.TokenBlacklist
	// RateLimiter 用于登录限流;为 nil 时自动禁用。
	RateLimiter middleware.Limiter
}

// rateLimiter 返回实际使用的限流器;未配置时使用禁用实现。
func (d Deps) rateLimiter() middleware.Limiter {
	if d.RateLimiter != nil {
		return d.RateLimiter
	}
	return noopLimiter{}
}

// noopLimiter 恒放行的限流实现。
type noopLimiter struct{}

// Allow 恒放行。
func (noopLimiter) Allow(string, int, int64) (bool, error) { return true, nil }
