package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/middleware"
	"richcat/control-plane/internal/model"
	"richcat/control-plane/internal/store"
)

// adminHandler 处理管理后台查询类接口(本租户或平台超管全量)。
type adminHandler struct {
	deps Deps
}

// newAdminHandler 创建管理后台 handler。
func newAdminHandler(deps Deps) *adminHandler {
	return &adminHandler{deps: deps}
}

// fleet 处理 GET /api/v1/admin/fleet:本租户全部 Agent。
func (h *adminHandler) fleet(c *gin.Context) {
	tenantID := middleware.TenantIDFrom(c)
	var agents []model.Agent
	var err error
	if tenantID == "" {
		agents, err = h.deps.Agents.ListAll()
	} else {
		agents, err = h.deps.Agents.ListByTenant(tenantID)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询舰队失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": agents, "total": len(agents)})
}

// agentDetail 处理 GET /api/v1/admin/agents/:id:单机详情 + 近 7 天用量。
func (h *adminHandler) agentDetail(c *gin.Context) {
	id := c.Param("id")
	agent, err := h.deps.Agents.GetAgent(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Agent 不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询 Agent 失败"})
		return
	}
	if !h.canAccess(c, agent.TenantID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该 Agent"})
		return
	}

	now := time.Now()
	from := truncateToDay(now.AddDate(0, 0, -6))
	to := truncateToDay(now.AddDate(0, 0, 1))
	usage, err := h.deps.Usage.ListByAgentAndDayRange(id, from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用量失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"agent": agent, "usage_last_7d": usage})
}

// usage 处理 GET /api/v1/admin/usage?from&to:本租户用量汇总。
func (h *adminHandler) usage(c *gin.Context) {
	now := time.Now()
	from := parseDateQuery(c.Query("from"), truncateToDay(now.AddDate(0, 0, -29)))
	to := parseDateQuery(c.Query("to"), truncateToDay(now.AddDate(0, 0, 1)))

	tenantID := middleware.TenantIDFrom(c)
	var sum *store.UsageSum
	var err error
	if tenantID == "" {
		sum, err = h.deps.Usage.SumAllByDayRange(from, to)
	} else {
		sum, err = h.deps.Usage.SumByTenantAndDayRange(tenantID, from, to)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用量失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"from":    from.Format("2006-01-02"),
		"to":      to.Format("2006-01-02"),
		"summary": sum,
	})
}

// alerts 处理 GET /api/v1/admin/alerts?status:告警列表。
func (h *adminHandler) alerts(c *gin.Context) {
	status := c.Query("status")
	tenantID := middleware.TenantIDFrom(c)
	var alerts []model.Alert
	var err error
	if tenantID == "" {
		alerts, err = h.deps.Alerts.ListAll(status)
	} else {
		alerts, err = h.deps.Alerts.ListByTenant(tenantID, status)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询告警失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": alerts, "total": len(alerts)})
}

// ackAlert 处理 POST /api/v1/admin/alerts/:id/ack:确认告警。
func (h *adminHandler) ackAlert(c *gin.Context) {
	id := c.Param("id")
	alert, err := h.deps.Alerts.GetAlert(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "告警不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询告警失败"})
		return
	}
	if !h.canAccess(c, alert.TenantID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权操作该告警"})
		return
	}
	if err := h.deps.Alerts.AckAlert(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "确认告警失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// canAccess 判断当前用户是否有权访问属于 resourceTenantID 的资源。
// 平台超管可访问全部;其余用户仅限本租户。
func (h *adminHandler) canAccess(c *gin.Context, resourceTenantID string) bool {
	if middleware.RoleFrom(c) == model.RolePlatformAdmin {
		return true
	}
	return middleware.TenantIDFrom(c) == resourceTenantID
}

// parseDateQuery 解析 YYYY-MM-DD 日期,解析失败返回缺省值。
func parseDateQuery(s string, def time.Time) time.Time {
	if s == "" {
		return def
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return def
	}
	return truncateToDay(t)
}
