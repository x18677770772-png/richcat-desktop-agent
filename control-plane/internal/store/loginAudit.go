package store

import (
	"time"

	"gorm.io/gorm"

	"richcat/control-plane/internal/model"
)

// LoginAuditStore 登录审计数据访问。
type LoginAuditStore struct {
	db *gorm.DB
}

// NewLoginAuditStore 创建 LoginAuditStore。
func NewLoginAuditStore(db *gorm.DB) *LoginAuditStore {
	return &LoginAuditStore{db: db}
}

// RecordLoginAudit 记录一次登录审计日志。
func (s *LoginAuditStore) RecordLoginAudit(email string, success bool, ip, userAgent string) error {
	entry := &model.LoginAudit{
		Email:     email,
		Success:   success,
		IP:        ip,
		UserAgent: userAgent,
		CreatedAt: time.Now(),
	}
	return s.db.Create(entry).Error
}
