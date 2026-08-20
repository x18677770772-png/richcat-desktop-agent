package store

import (
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"richcat/control-plane/internal/model"
)

// newSqliteDB 创建内存 SQLite 连接并自动迁移,供 store 单测使用。
// 使用普通 ":memory:" + 单连接,保证每个测试获得独立数据库,互不污染。
func newSqliteDB(t *testing.T, models ...interface{}) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开 SQLite 失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("获取底层 DB 失败: %v", err)
	}
	// 单连接,确保内存库在整个测试期间保持不变。
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(models...); err != nil {
		t.Fatalf("自动迁移失败: %v", err)
	}
	return db
}

// TestUpsertUsageDailyCompositePK 验证 (agent_id, day) 复合主键 upsert 正确:
// 同 agent 同天累加,不同天或不同 agent 各自独立。
func TestUpsertUsageDailyCompositePK(t *testing.T) {
	db := newSqliteDB(t, &model.UsageDaily{})
	s := NewUsageStore(db)

	day1 := time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC)

	// 第一次插入。
	if err := s.UpsertUsageDaily(&model.UsageDaily{
		AgentID: "ag_001", TenantID: "tn_001", Day: day1,
		Sessions: 10, Messages: 20, Replies: 5, Handoffs: 1, APICalls: 50,
	}); err != nil {
		t.Fatalf("第一次 upsert 失败: %v", err)
	}

	// 同 agent 同天再次插入 → 应累加。
	if err := s.UpsertUsageDaily(&model.UsageDaily{
		AgentID: "ag_001", TenantID: "tn_001", Day: day1,
		Sessions: 5, Messages: 7, Replies: 3, Handoffs: 1, APICalls: 25,
	}); err != nil {
		t.Fatalf("第二次 upsert 失败: %v", err)
	}

	// 同 agent 不同天 → 应新增一行。
	if err := s.UpsertUsageDaily(&model.UsageDaily{
		AgentID: "ag_001", TenantID: "tn_001", Day: day2,
		Sessions: 3, Messages: 4, Replies: 2, Handoffs: 0, APICalls: 10,
	}); err != nil {
		t.Fatalf("第三天 upsert 失败: %v", err)
	}

	// 不同 agent 同天 → 应新增一行。
	if err := s.UpsertUsageDaily(&model.UsageDaily{
		AgentID: "ag_002", TenantID: "tn_001", Day: day1,
		Sessions: 1, Messages: 1, Replies: 1, Handoffs: 0, APICalls: 1,
	}); err != nil {
		t.Fatalf("另一 agent upsert 失败: %v", err)
	}

	// 行数应为 3。
	var count int64
	if err := db.Model(&model.UsageDaily{}).Count(&count).Error; err != nil {
		t.Fatalf("统计行数失败: %v", err)
	}
	if count != 3 {
		t.Fatalf("应存在 3 行,实际 %d", count)
	}

	// 校验 ag_001 在 day1 的累加结果。
	var row model.UsageDaily
	if err := db.Where("agent_id = ? AND day = ?", "ag_001", day1).First(&row).Error; err != nil {
		t.Fatalf("查询累加行失败: %v", err)
	}
	if row.Sessions != 15 || row.Messages != 27 || row.Replies != 8 {
		t.Fatalf("累加结果不正确: sessions=%d messages=%d replies=%d, 应为 15/27/8",
			row.Sessions, row.Messages, row.Replies)
	}

	// 汇总校验。
	sum, err := s.SumByTenantAndDayRange("tn_001", day1, day2.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("汇总失败: %v", err)
	}
	if sum.TotalSessions != 19 { // 15 + 3 + 1
		t.Fatalf("汇总 sessions 应为 19, got %d", sum.TotalSessions)
	}
	if sum.TotalAPICalls != 86 { // 50 + 25 + 10 + 1
		t.Fatalf("汇总 api_calls 应为 86, got %d", sum.TotalAPICalls)
	}
}

// TestSumByTenantAndDayRange 验证按租户与日期范围汇总的边界(左闭右开)。
func TestSumByTenantAndDayRange(t *testing.T) {
	db := newSqliteDB(t, &model.UsageDaily{})
	s := NewUsageStore(db)

	day := time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)
	_ = s.UpsertUsageDaily(&model.UsageDaily{
		AgentID: "ag_001", TenantID: "tn_001", Day: day, Sessions: 8,
	})
	_ = s.UpsertUsageDaily(&model.UsageDaily{
		AgentID: "ag_002", TenantID: "tn_002", Day: day, Sessions: 99,
	})

	// 只统计 tn_001。
	sum, err := s.SumByTenantAndDayRange("tn_001", day, day.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("汇总失败: %v", err)
	}
	if sum.TotalSessions != 8 {
		t.Fatalf("tn_001 汇总 sessions 应为 8, got %d", sum.TotalSessions)
	}

	// 空范围。
	sum, err = s.SumByTenantAndDayRange("tn_001", day.Add(48*time.Hour), day.Add(72*time.Hour))
	if err != nil {
		t.Fatalf("空范围汇总失败: %v", err)
	}
	if sum.TotalSessions != 0 {
		t.Fatalf("空范围 sessions 应为 0, got %d", sum.TotalSessions)
	}
}
