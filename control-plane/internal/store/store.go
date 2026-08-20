// Package store 提供数据访问层(repository)。
// 每个文件对应一个 repo,方法式接口返回 error;*gorm.DB 通过构造函数注入,
// 便于 api 层依赖接口、测试注入内存 fake。
package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"richcat/control-plane/internal/model"
)

// ErrNotFound 表示记录不存在。
var ErrNotFound = errors.New("记录不存在")

// Store 聚合所有 repo,并持有底层 DB/Redis 连接。
type Store struct {
	DB  *gorm.DB
	RDB *redis.Client

	Agents      *AgentStore
	Usage       *UsageStore
	Alerts      *AlertStore
	Tenants     *TenantStore
	Users       *UserStore
	Bills       *BillStore
	LoginAudits *LoginAuditStore
}

// New 构建聚合 Store。
func New(db *gorm.DB, rdb *redis.Client) *Store {
	return &Store{
		DB:          db,
		RDB:         rdb,
		Agents:      NewAgentStore(db),
		Usage:       NewUsageStore(db),
		Alerts:      NewAlertStore(db),
		Tenants:     NewTenantStore(db),
		Users:       NewUserStore(db),
		Bills:       NewBillStore(db),
		LoginAudits: NewLoginAuditStore(db),
	}
}

// OpenPG 打开 PostgreSQL 连接,执行自动迁移,并返回 *gorm.DB。
func OpenPG(dsn string) (*gorm.DB, error) {
	if dsn == "" {
		return nil, errors.New("未配置 PG_DSN 环境变量")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:                 logger.Default.LogMode(logger.Warn),
		SkipDefaultTransaction: true,
		PrepareStmt:            true,
	})
	if err != nil {
		return nil, fmt.Errorf("连接 PostgreSQL 失败: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("获取底层 sql.DB 失败: %w", err)
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(10 * time.Minute)

	// 自动迁移(usage_daily 复合主键由 GORM 自动处理)。
	if err := db.AutoMigrate(
		&model.Tenant{},
		&model.User{},
		&model.Agent{},
		&model.UsageDaily{},
		&model.Alert{},
		&model.Subscription{},
		&model.Bill{},
		&model.LoginAudit{},
	); err != nil {
		return nil, fmt.Errorf("自动迁移失败: %w", err)
	}

	return db, nil
}

// OpenRedis 打开 Redis 连接并返回客户端。
func OpenRedis(addr, password string) (*redis.Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DB:           0,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("连接 Redis 失败: %w", err)
	}
	return rdb, nil
}
