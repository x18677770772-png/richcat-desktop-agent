package store

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"richcat/control-plane/internal/model"
)

// AgentStore 值守机数据访问。
type AgentStore struct {
	db *gorm.DB
}

// NewAgentStore 创建 AgentStore。
func NewAgentStore(db *gorm.DB) *AgentStore {
	return &AgentStore{db: db}
}

// UpsertAgent 插入或更新 Agent 记录(按 agent_id 主键)。
func (s *AgentStore) UpsertAgent(a *model.Agent) error {
	return s.db.Save(a).Error
}

// UpdateLastSeen 更新 Agent 最后心跳时间、状态与资源指标。
func (s *AgentStore) UpdateLastSeen(agentID, status string, lastSeen time.Time, res model.ResourceSnapshot) error {
	return s.db.Model(&model.Agent{}).
		Where("agent_id = ?", agentID).
		Updates(map[string]interface{}{
			"status":        status,
			"last_seen":     lastSeen,
			"cpu_pct":       res.CPUPct,
			"mem_pct":       res.MemPct,
			"disk_free_gb":  res.DiskFreeGb,
			"wechat_state":  res.WechatState,
			"agent_version": res.AgentVersion,
		}).Error
}

// GetAgent 根据 agent_id 查询单台 Agent。
func (s *AgentStore) GetAgent(agentID string) (*model.Agent, error) {
	var a model.Agent
	if err := s.db.Where("agent_id = ?", agentID).First(&a).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

// ListByTenant 查询指定租户下所有 Agent,最近心跳优先。
func (s *AgentStore) ListByTenant(tenantID string) ([]model.Agent, error) {
	var agents []model.Agent
	if err := s.db.Where("tenant_id = ?", tenantID).
		Order("last_seen DESC NULLS LAST").Find(&agents).Error; err != nil {
		return nil, err
	}
	return agents, nil
}

// ListAll 查询所有 Agent(平台超管使用)。
func (s *AgentStore) ListAll() ([]model.Agent, error) {
	var agents []model.Agent
	if err := s.db.Order("last_seen DESC NULLS LAST").Find(&agents).Error; err != nil {
		return nil, err
	}
	return agents, nil
}
