package store

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"richcat/control-plane/internal/model"
)

// AlertStore 告警数据访问。
type AlertStore struct {
	db *gorm.DB
}

// NewAlertStore 创建 AlertStore。
func NewAlertStore(db *gorm.DB) *AlertStore {
	return &AlertStore{db: db}
}

// CreateAlert 创建一条告警记录。
func (s *AlertStore) CreateAlert(a *model.Alert) error {
	if a.AlertID == "" {
		a.AlertID = newID("al_")
	}
	if a.State == "" {
		a.State = "firing"
	}
	if a.AckStatus == "" {
		a.AckStatus = "unacked"
	}
	return s.db.Create(a).Error
}

// ResolveAlert 将指定告警标记为已解决。
func (s *AlertStore) ResolveAlert(alertID string) error {
	return s.db.Model(&model.Alert{}).
		Where("alert_id = ?", alertID).
		Updates(map[string]interface{}{
			"state":       "resolved",
			"resolved_at": time.Now(),
		}).Error
}

// ListByTenant 查询指定租户的告警列表。
// status 为空时返回所有状态,否则按 state 过滤。
func (s *AlertStore) ListByTenant(tenantID, status string) ([]model.Alert, error) {
	var alerts []model.Alert
	q := s.db.Where("tenant_id = ?", tenantID)
	if status != "" {
		q = q.Where("state = ?", status)
	}
	if err := q.Order("created_at DESC").Find(&alerts).Error; err != nil {
		return nil, err
	}
	return alerts, nil
}

// GetAlert 查询单条告警(用于租户隔离校验)。
func (s *AlertStore) GetAlert(alertID string) (*model.Alert, error) {
	var a model.Alert
	if err := s.db.Where("alert_id = ?", alertID).First(&a).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

// AckAlert 将告警标记为已确认(ack)。
func (s *AlertStore) AckAlert(alertID string) error {
	return s.db.Model(&model.Alert{}).
		Where("alert_id = ?", alertID).
		Update("ack_status", "acked").Error
}

// ListAll 查询所有告警(平台超管使用)。
// status 为空时返回所有状态,否则按 state 过滤。
func (s *AlertStore) ListAll(status string) ([]model.Alert, error) {
	var alerts []model.Alert
	q := s.db.Model(&model.Alert{})
	if status != "" {
		q = q.Where("state = ?", status)
	}
	if err := q.Order("created_at DESC").Find(&alerts).Error; err != nil {
		return nil, err
	}
	return alerts, nil
}

// CreateOfflineAlert 创建一条"Agent 离线"告警,并返回告警 ID。
func (s *AlertStore) CreateOfflineAlert(agentID, tenantID, title, detail string) (string, error) {
	a := &model.Alert{
		AlertID:    newID("al_"),
		AgentID:    agentID,
		TenantID:   tenantID,
		Severity:   "critical",
		Category:   "offline",
		TitleSafe:  title,
		DetailSafe: detail,
		State:      "firing",
		AckStatus:  "unacked",
	}
	if err := s.CreateAlert(a); err != nil {
		return "", err
	}
	return a.AlertID, nil
}

// ResolveOfflineByAgent 将某 Agent 所有 firing 的离线告警置为 resolved,返回处理条数。
func (s *AlertStore) ResolveOfflineByAgent(agentID string) (int64, error) {
	res := s.db.Model(&model.Alert{}).
		Where("agent_id = ? AND category = 'offline' AND state = 'firing'", agentID).
		Updates(map[string]interface{}{
			"state":       "resolved",
			"resolved_at": time.Now(),
		})
	return res.RowsAffected, res.Error
}
