package store

import (
	"time"

	"gorm.io/gorm"

	"richcat/control-plane/internal/model"
)

// BillStore 账单数据访问。
type BillStore struct {
	db *gorm.DB
}

// NewBillStore 创建 BillStore。
func NewBillStore(db *gorm.DB) *BillStore {
	return &BillStore{db: db}
}

// CreateBill 创建账单记录。
func (s *BillStore) CreateBill(b *model.Bill) error {
	if b.BillID == "" {
		b.BillID = newID("bl_")
	}
	if b.Status == "" {
		b.Status = "pending"
	}
	return s.db.Create(b).Error
}

// ListByTenant 查询指定租户的账单列表,按创建时间倒序。
func (s *BillStore) ListByTenant(tenantID string) ([]model.Bill, error) {
	var bills []model.Bill
	if err := s.db.Where("tenant_id = ?", tenantID).
		Order("created_at DESC").Find(&bills).Error; err != nil {
		return nil, err
	}
	return bills, nil
}

// MarkPaid 标记账单为已支付,记录支付时间。
// 账单不存在时返回 ErrNotFound。
func (s *BillStore) MarkPaid(billID string, paidAt time.Time) error {
	res := s.db.Model(&model.Bill{}).
		Where("bill_id = ?", billID).
		Updates(map[string]interface{}{
			"status":  "paid",
			"paid_at": paidAt,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// ListAll 查询所有账单(平台超管使用)。
func (s *BillStore) ListAll() ([]model.Bill, error) {
	var bills []model.Bill
	if err := s.db.Order("created_at DESC").Find(&bills).Error; err != nil {
		return nil, err
	}
	return bills, nil
}
