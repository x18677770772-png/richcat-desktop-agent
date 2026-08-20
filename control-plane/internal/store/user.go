package store

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"richcat/control-plane/internal/model"
)

// UserStore 用户数据访问。
type UserStore struct {
	db *gorm.DB
}

// NewUserStore 创建 UserStore。
func NewUserStore(db *gorm.DB) *UserStore {
	return &UserStore{db: db}
}

// FindByEmail 根据邮箱查找用户。
func (s *UserStore) FindByEmail(email string) (*model.User, error) {
	var u model.User
	if err := s.db.Where("email = ?", email).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// FindByID 根据用户 ID 查找用户。
func (s *UserStore) FindByID(id string) (*model.User, error) {
	var u model.User
	if err := s.db.Where("id = ?", id).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// CreateUser 创建用户,自动生成 ID。
func (s *UserStore) CreateUser(u *model.User) error {
	if u.ID == "" {
		u.ID = newID("usr_")
	}
	if u.Role == "" {
		u.Role = model.RoleOwner
	}
	return s.db.Create(u).Error
}

// UpdateLoginState 更新用户登录状态:失败次数与锁定截止时间。
// 成功登录时 failedLogins=0 且 lockedUntil=nil;失败时递增并可能设置锁定。
func (s *UserStore) UpdateLoginState(userID string, failedLogins int, lockedUntil *time.Time) error {
	return s.db.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"failed_logins": failedLogins,
			"locked_until":  lockedUntil,
		}).Error
}

// UpdateLastLogin 更新用户最后登录时间。
func (s *UserStore) UpdateLastLogin(userID string, lastLogin time.Time) error {
	return s.db.Model(&model.User{}).
		Where("id = ?", userID).
		Update("last_login", lastLogin).Error
}

// ListByTenant 查询指定租户下的所有用户。
func (s *UserStore) ListByTenant(tenantID string) ([]model.User, error) {
	var users []model.User
	if err := s.db.Where("tenant_id = ?", tenantID).
		Order("created_at ASC").Find(&users).Error; err != nil {
		return nil, err
	}
	return users, nil
}
