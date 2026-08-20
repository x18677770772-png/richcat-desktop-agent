package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/middleware"
	"richcat/control-plane/internal/model"
	"richcat/control-plane/internal/sitetoken"
)

// 遥测事件类型。
const (
	EventHeartbeat = "heartbeat"
	EventUsage     = "usage"
	EventError     = "error"
)

// 告警集:错误码 → (severity, category)。
// 仅这些错误码会上报告警,其余错误静默忽略(减少噪音)。
var alertCodeMap = map[string]struct {
	Severity string
	Category string
}{
	"AGENT_CRASH":         {Severity: "critical", Category: "offline"},
	"WECHAT_SESSION_LOST": {Severity: "major", Category: "security"},
}

// TelemetryEvent 遥测事件信封,对齐设计文档 §四 C1 事件信封。
type TelemetryEvent struct {
	SchemaVersion string             `json:"schema_version"`
	EventID       string             `json:"event_id"`
	EventType     string             `json:"event_type" binding:"required"`
	Producer      TelemetryProducer  `json:"producer"`
	Payload       json.RawMessage    `json:"payload"`
	ReportedAt    *time.Time         `json:"reported_at,omitempty"`
	Timestamp     int64              `json:"timestamp,omitempty"`
}

// TelemetryProducer 事件生产方(Agent)元数据。
type TelemetryProducer struct {
	TenantID      string                 `json:"tenant_id"`
	AgentID       string                 `json:"agent_id"`
	SiteID        string                 `json:"site_id"`
	MachineIDHmac string                 `json:"machine_id_hmac"`
	AgentVersion  string                 `json:"agent_version"`
	Runtime       map[string]interface{} `json:"runtime,omitempty"`
}

// heartbeatPayload 心跳负载(仅元数据)。
type heartbeatPayload struct {
	Status      string  `json:"status"`
	CPUPct      float64 `json:"cpu_pct"`
	MemPct      float64 `json:"mem_pct"`
	DiskFreeGb  float64 `json:"disk_free_gb"`
	WechatState string  `json:"wechat_state"`
}

// usagePayload 用量负载(日桶累计值)。
type usagePayload struct {
	Day      string `json:"day"` // YYYY-MM-DD,缺省为上报当天
	Sessions int    `json:"sessions"`
	Messages int    `json:"messages"`
	Replies  int    `json:"replies"`
	Handoffs int    `json:"handoffs"`
	APICalls int    `json:"api_calls"`
}

// errorPayload 错误上报负载(已脱敏)。
type errorPayload struct {
	Code       string `json:"code"`
	TitleSafe  string `json:"title_safe"`
	DetailSafe string `json:"detail_safe"`
}

// telemetryHandler 处理 Agent 遥测上报。
type telemetryHandler struct {
	deps Deps
}

// newTelemetryHandler 创建遥测 handler。
func newTelemetryHandler(deps Deps) *telemetryHandler {
	return &telemetryHandler{deps: deps}
}

// siteTokenAuth 校验 Authorization Bearer 站点 Token:
// 计算 HMAC-SHA256 与 tenants.site_token_hash 比对,并将租户注入 context。
func siteTokenAuth(tenants TenantStore, secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := middleware.BearerToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "缺少站点 Token"})
			return
		}
		hash := sitetoken.Hash(token, secret)
		tenant, err := tenants.GetBySiteTokenHash(hash)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "站点 Token 无效"})
			return
		}
		c.Set(middleware.CtxTenantID, tenant.ID)
		c.Next()
	}
}

// handle 处理 POST /api/v1/telemetry,按 event_type 分发。
func (h *telemetryHandler) handle(c *gin.Context) {
	tenantID := middleware.TenantIDFrom(c)
	if tenantID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "缺少租户上下文"})
		return
	}

	var ev TelemetryEvent
	if err := c.ShouldBindJSON(&ev); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "遥测事件格式错误"})
		return
	}
	if ev.Producer.AgentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 producer.agent_id"})
		return
	}

	reportedAt := time.Now()
	if ev.ReportedAt != nil {
		reportedAt = *ev.ReportedAt
	}

	switch ev.EventType {
	case EventHeartbeat:
		if err := h.handleHeartbeat(c, tenantID, ev, reportedAt); err != nil {
			h.replyError(c, err)
			return
		}
	case EventUsage:
		if err := h.handleUsage(c, tenantID, ev, reportedAt); err != nil {
			h.replyError(c, err)
			return
		}
	case EventError:
		if err := h.handleError(c, tenantID, ev); err != nil {
			h.replyError(c, err)
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "未知的 event_type: " + ev.EventType})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleHeartbeat 心跳:新 Agent 用 UpsertAgent 创建,已存在则仅更新状态与资源(保留 runtime)。
func (h *telemetryHandler) handleHeartbeat(c *gin.Context, tenantID string, ev TelemetryEvent, reportedAt time.Time) error {
	var p heartbeatPayload
	if len(ev.Payload) > 0 {
		if err := json.Unmarshal(ev.Payload, &p); err != nil {
			return errBadRequest("心跳 payload 解析失败")
		}
	}
	if p.Status == "" {
		p.Status = "online"
	}

	// 已存在的 Agent:仅更新心跳状态,不覆盖 runtime 等静态信息。
	if _, err := h.deps.Agents.GetAgent(ev.Producer.AgentID); err == nil {
		res := model.ResourceSnapshot{
			CPUPct:       p.CPUPct,
			MemPct:       p.MemPct,
			DiskFreeGb:   p.DiskFreeGb,
			WechatState:  p.WechatState,
			AgentVersion: ev.Producer.AgentVersion,
		}
		if err := h.deps.Agents.UpdateLastSeen(ev.Producer.AgentID, p.Status, reportedAt, res); err != nil {
			return errInternal("心跳状态更新失败")
		}
		return nil
	}

	// 新 Agent:创建完整记录。
	agent := &model.Agent{
		AgentID:       ev.Producer.AgentID,
		TenantID:      tenantID,
		SiteID:        ev.Producer.SiteID,
		MachineIDHmac: ev.Producer.MachineIDHmac,
		AgentVersion:  ev.Producer.AgentVersion,
		Status:        p.Status,
		LastSeen:      &reportedAt,
		CPUPct:        p.CPUPct,
		MemPct:        p.MemPct,
		DiskFreeGb:    p.DiskFreeGb,
		WechatState:   p.WechatState,
		FirstSeen:     reportedAt,
	}
	if ev.Producer.Runtime != nil {
		raw, err := json.Marshal(ev.Producer.Runtime)
		if err != nil {
			return errBadRequest("runtime 字段序列化失败")
		}
		agent.Runtime = raw
	}
	if err := h.deps.Agents.UpsertAgent(agent); err != nil {
		return errInternal("心跳写入失败")
	}
	return nil
}

// handleUsage 用量:按 (agent_id, day) 复合主键 upsert。
func (h *telemetryHandler) handleUsage(c *gin.Context, tenantID string, ev TelemetryEvent, reportedAt time.Time) error {
	var p usagePayload
	if len(ev.Payload) > 0 {
		if err := json.Unmarshal(ev.Payload, &p); err != nil {
			return errBadRequest("usage payload 解析失败")
		}
	}
	day := truncateToDay(reportedAt)
	if p.Day != "" {
		parsed, err := time.Parse("2006-01-02", p.Day)
		if err != nil {
			return errBadRequest("day 格式应为 YYYY-MM-DD")
		}
		day = truncateToDay(parsed)
	}

	u := &model.UsageDaily{
		AgentID:  ev.Producer.AgentID,
		TenantID: tenantID,
		Day:      day,
		Sessions: p.Sessions,
		Messages: p.Messages,
		Replies:  p.Replies,
		Handoffs: p.Handoffs,
		APICalls: p.APICalls,
	}
	if err := h.deps.Usage.UpsertUsageDaily(u); err != nil {
		return errInternal("用量写入失败")
	}
	return nil
}

// handleError 错误:错误码在告警集内时创建告警。
func (h *telemetryHandler) handleError(c *gin.Context, tenantID string, ev TelemetryEvent) error {
	var p errorPayload
	if len(ev.Payload) > 0 {
		if err := json.Unmarshal(ev.Payload, &p); err != nil {
			return errBadRequest("error payload 解析失败")
		}
	}
	meta, ok := alertCodeMap[p.Code]
	if !ok {
		// 不在告警集的错误码:记录但不产生告警,返回 ok。
		return nil
	}
	alert := &model.Alert{
		AlertID:    "",
		AgentID:    ev.Producer.AgentID,
		TenantID:   tenantID,
		Severity:   meta.Severity,
		Category:   meta.Category,
		TitleSafe:  p.TitleSafe,
		DetailSafe: p.DetailSafe,
		State:      "firing",
		AckStatus:  "unacked",
	}
	if err := h.deps.Alerts.CreateAlert(alert); err != nil {
		return errInternal("告警写入失败")
	}
	return nil
}

// replyError 将业务错误映射为 HTTP 状态。
func (h *telemetryHandler) replyError(c *gin.Context, err error) {
	var be *apiError
	if errorsAs(err, &be) {
		c.JSON(be.Status, gin.H{"error": be.Message})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "内部错误"})
}

// truncateToDay 将时间截断到当天零点(与 usage_daily.day 对齐)。
func truncateToDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}
