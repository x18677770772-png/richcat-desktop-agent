package store

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"richcat/control-plane/internal/model"
)

// TenantStore 租户数据访问。
type TenantStore struct {
	db *gorm.DB
}

// NewTenantStore 创建 TenantStore。
func NewTenantStore(db *gorm.DB) *TenantStore {
	return &TenantStore{db: db}
}

// CreateTenant 创建租户。
// siteTokenHash 为站点 Token 的 HMAC 哈希(由调用方用 sitetoken.Hash 计算)。
func (s *TenantStore) CreateTenant(name, siteTokenHash, plan string, seats int) (*model.Tenant, error) {
	if plan == "" {
		plan = "standard"
	}
	if seats <= 0 {
		seats = 5
	}
	tenant := &model.Tenant{
		ID:            newID("tn_"),
		Name:          name,
		SiteTokenHash: siteTokenHash,
		Plan:          plan,
		Seats:         seats,
		Status:        "active",
	}
	if err := s.db.Create(tenant).Error; err != nil {
		return nil, err
	}
	return tenant, nil
}

// GetTenant 根据 ID 查询租户。
func (s *TenantStore) GetTenant(tenantID string) (*model.Tenant, error) {
	var t model.Tenant
	if err := s.db.Where("id = ?", tenantID).First(&t).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

// UpdateSubscription 更新租户套餐字段:套餐、坐席数与订阅起止时间。
// 传入空指针表示清除对应字段。
func (s *TenantStore) UpdateSubscription(tenantID string, plan string, seats int, start, end *time.Time) error {
	updates := map[string]interface{}{
		"subscription_start": start,
		"subscription_end":   end,
	}
	if plan != "" {
		updates["plan"] = plan
	}
	if seats > 0 {
		updates["seats"] = seats
	}
	return s.db.Model(&model.Tenant{}).
		Where("id = ?", tenantID).
		Updates(updates).Error
}

// ListTenants 查询所有租户。
func (s *TenantStore) ListTenants() ([]model.Tenant, error) {
	var tenants []model.Tenant
	if err := s.db.Order("created_at DESC").Find(&tenants).Error; err != nil {
		return nil, err
	}
	return tenants, nil
}

// GetBySiteTokenHash 根据站点 Token 哈希查找租户(用于 Agent 鉴权)。
func (s *TenantStore) GetBySiteTokenHash(hash string) (*model.Tenant, error) {
	var t model.Tenant
	if err := s.db.Where("site_token_hash = ? AND status = 'active'", hash).First(&t).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}
