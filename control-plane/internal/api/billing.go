package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/middleware"
	"richcat/control-plane/internal/model"
	"richcat/control-plane/internal/sitetoken"
)

// billingHandler 处理计费相关:本企业订阅/账单,以及超管建企业与租户列表。
type billingHandler struct {
	deps Deps
}

// newBillingHandler 创建计费 handler。
func newBillingHandler(deps Deps) *billingHandler {
	return &billingHandler{deps: deps}
}

// subscription 处理 GET /api/v1/admin/billing/subscription:本企业套餐/到期。
// 本期精简实现:直接读取 tenants 表的套餐字段(与 subscriptions 表可后续拆分)。
func (h *billingHandler) subscription(c *gin.Context) {
	tenantID := middleware.TenantIDFrom(c)
	if tenantID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少租户上下文"})
		return
	}
	tenant, err := h.deps.Tenants.GetTenant(tenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "租户不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"tenant_id":           tenant.ID,
		"plan":                tenant.Plan,
		"seats":               tenant.Seats,
		"subscription_start":  tenant.SubscriptionStart,
		"subscription_end":    tenant.SubscriptionEnd,
		"status":              tenant.Status,
	})
}

// bills 处理 GET /api/v1/admin/billing/bills:本租户账单记录。
func (h *billingHandler) bills(c *gin.Context) {
	tenantID := middleware.TenantIDFrom(c)
	var bills []model.Bill
	var err error
	if tenantID == "" {
		bills, err = h.deps.Bills.ListAll()
	} else {
		bills, err = h.deps.Bills.ListByTenant(tenantID)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询账单失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": bills, "total": len(bills)})
}

// createTenantRequest 超管建企业请求。
type createTenantRequest struct {
	Name              string     `json:"name" binding:"required"`
	SiteToken         string     `json:"site_token"`
	Plan              string     `json:"plan"`
	Seats             int        `json:"seats"`
	SubscriptionStart *time.Time `json:"subscription_start"`
	SubscriptionEnd   *time.Time `json:"subscription_end"`
}

// createTenant 处理 POST /api/v1/platform/tenants:超管创建企业。
// 站点 Token 可由调用方提供,缺省自动生成;返回明文仅此一次。
func (h *billingHandler) createTenant(c *gin.Context) {
	var req createTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误:企业名称(name)必填"})
		return
	}

	token := req.SiteToken
	if token == "" {
		generated, err := sitetoken.Generate()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成站点 Token 失败"})
			return
		}
		token = generated
	}
	hash := sitetoken.Hash(token, h.deps.Config.JWTSecret)

	tenant, err := h.deps.Tenants.CreateTenant(req.Name, hash, req.Plan, req.Seats)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建租户失败"})
		return
	}
	if req.SubscriptionStart != nil || req.SubscriptionEnd != nil {
		_ = h.deps.Tenants.UpdateSubscription(tenant.ID, req.Plan, req.Seats, req.SubscriptionStart, req.SubscriptionEnd)
	}

	c.JSON(http.StatusCreated, gin.H{"tenant": tenant, "site_token": token})
}

// listTenants 处理 GET /api/v1/platform/tenants:超管查询所有企业。
func (h *billingHandler) listTenants(c *gin.Context) {
	tenants, err := h.deps.Tenants.ListTenants()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询租户列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tenants, "total": len(tenants)})
}
