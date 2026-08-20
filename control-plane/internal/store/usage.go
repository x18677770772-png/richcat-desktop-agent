package store

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"richcat/control-plane/internal/model"
)

// UsageStore 用量日桶数据访问。
type UsageStore struct {
	db *gorm.DB
}

// NewUsageStore 创建 UsageStore。
func NewUsageStore(db *gorm.DB) *UsageStore {
	return &UsageStore{db: db}
}

// UpsertUsageDaily 按 (agent_id, day) 复合主键 upsert 用量记录。
// 记录已存在时累加各计数,避免重复上报导致翻倍。
func (s *UsageStore) UpsertUsageDaily(u *model.UsageDaily) error {
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "agent_id"},
			{Name: "day"},
		},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"sessions":  gorm.Expr("usage_daily.sessions + EXCLUDED.sessions"),
			"messages":  gorm.Expr("usage_daily.messages + EXCLUDED.messages"),
			"replies":   gorm.Expr("usage_daily.replies + EXCLUDED.replies"),
			"handoffs":  gorm.Expr("usage_daily.handoffs + EXCLUDED.handoffs"),
			"api_calls": gorm.Expr("usage_daily.api_calls + EXCLUDED.api_calls"),
		}),
	}).Create(u).Error
}

// UsageSum 用量汇总结果。
type UsageSum struct {
	TotalSessions int `json:"total_sessions"`
	TotalMessages int `json:"total_messages"`
	TotalReplies  int `json:"total_replies"`
	TotalHandoffs int `json:"total_handoffs"`
	TotalAPICalls int `json:"total_api_calls"`
}

// SumByTenantAndDayRange 汇总指定租户在 [from, to) 日期范围内的用量。
func (s *UsageStore) SumByTenantAndDayRange(tenantID string, from, to time.Time) (*UsageSum, error) {
	var sum UsageSum
	err := s.db.Model(&model.UsageDaily{}).
		Select("COALESCE(SUM(sessions),0) AS total_sessions",
			"COALESCE(SUM(messages),0) AS total_messages",
			"COALESCE(SUM(replies),0) AS total_replies",
			"COALESCE(SUM(handoffs),0) AS total_handoffs",
			"COALESCE(SUM(api_calls),0) AS total_api_calls").
		Where("tenant_id = ? AND day >= ? AND day < ?", tenantID, from, to).
		Scan(&sum).Error
	if err != nil {
		return nil, err
	}
	return &sum, nil
}

// ListUsageByDay 返回指定租户在日期范围内的逐日用量明细。
func (s *UsageStore) ListUsageByDay(tenantID string, from, to time.Time) ([]model.UsageDaily, error) {
	var rows []model.UsageDaily
	if err := s.db.Where("tenant_id = ? AND day >= ? AND day < ?", tenantID, from, to).
		Order("day ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// ListByAgentAndDayRange 返回单台 Agent 在日期范围内的逐日用量明细。
func (s *UsageStore) ListByAgentAndDayRange(agentID string, from, to time.Time) ([]model.UsageDaily, error) {
	var rows []model.UsageDaily
	if err := s.db.Where("agent_id = ? AND day >= ? AND day < ?", agentID, from, to).
		Order("day ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// SumAllByDayRange 汇总所有租户在日期范围内的用量(平台超管使用)。
func (s *UsageStore) SumAllByDayRange(from, to time.Time) (*UsageSum, error) {
	var sum UsageSum
	err := s.db.Model(&model.UsageDaily{}).
		Select("COALESCE(SUM(sessions),0) AS total_sessions",
			"COALESCE(SUM(messages),0) AS total_messages",
			"COALESCE(SUM(replies),0) AS total_replies",
			"COALESCE(SUM(handoffs),0) AS total_handoffs",
			"COALESCE(SUM(api_calls),0) AS total_api_calls").
		Where("day >= ? AND day < ?", from, to).
		Scan(&sum).Error
	if err != nil {
		return nil, err
	}
	return &sum, nil
}
