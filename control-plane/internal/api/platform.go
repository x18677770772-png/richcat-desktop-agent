package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/model"
	"richcat/control-plane/internal/store"
)

// platformHandler 处理平台超管的计费管理接口(建账单/标记已付)。
type platformHandler struct {
	deps Deps
}

// newPlatformHandler 创建平台计费 handler。
func newPlatformHandler(deps Deps) *platformHandler {
	return &platformHandler{deps: deps}
}

// createBillRequest 建账单请求。
type createBillRequest struct {
	TenantID    string `json:"tenant_id" binding:"required"`
	Period      string `json:"period" binding:"required"` // YYYY-MM
	AmountCents int    `json:"amount_cents" binding:"required"`
	Note        string `json:"note"`
}

// createBill 处理 POST /api/v1/platform/bills:超管为某租户创建账单。
func (h *platformHandler) createBill(c *gin.Context) {
	var req createBillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误:tenant_id/period/amount_cents 必填"})
		return
	}
	if _, err := h.deps.Tenants.GetTenant(req.TenantID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "租户不存在"})
		return
	}
	bill := &model.Bill{
		TenantID:    req.TenantID,
		Period:      req.Period,
		AmountCents: req.AmountCents,
		Note:        req.Note,
	}
	if err := h.deps.Bills.CreateBill(bill); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建账单失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"bill": bill})
}

// markPaid 处理 POST /api/v1/platform/bills/:id/paid:标记账单已付。
func (h *platformHandler) markPaid(c *gin.Context) {
	id := c.Param("id")
	if err := h.deps.Bills.MarkPaid(id, time.Now()); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "账单不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "标记账单已付失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
