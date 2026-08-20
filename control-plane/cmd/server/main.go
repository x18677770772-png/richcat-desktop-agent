// 财听猫中央管理后台(控制面)后端服务入口。
// 加载配置 → 连接 PG/Redis → 自动迁移 → 初始化超管 → 启动 Gin + 告警扫描器。
package main

import (
	"log"
	"strings"
	"time"

	"richcat/control-plane/internal/alert"
	"richcat/control-plane/internal/api"
	"richcat/control-plane/internal/auth"
	"richcat/control-plane/internal/config"
	"richcat/control-plane/internal/middleware"
	"richcat/control-plane/internal/store"
)

func main() {
	cfg := config.Load()

	if cfg.JWTSecret == "" {
		log.Fatal("未配置 JWT_SECRET 环境变量")
	}

	// 连接 PostgreSQL 并自动迁移。
	db, err := store.OpenPG(cfg.PGDSN)
	if err != nil {
		log.Fatalf("初始化数据库失败: %v", err)
	}

	// 连接 Redis;失败仅告警,降级为内存黑名单 + 禁用限流。
	rdb, err := store.OpenRedis(cfg.RedisAddr, cfg.RedisPassword)
	if err != nil {
		log.Printf("[警告] Redis 不可用: %v(降级为内存黑名单并禁用限流)", err)
		rdb = nil
	}

	st := store.New(db, rdb)

	// JWT 管理 + 令牌黑名单。
	jwtMgr := auth.NewJWTManager(cfg.JWTSecret, cfg.AccessTTL, cfg.RefreshTTL)
	var blacklist auth.TokenBlacklist
	if rdb != nil {
		blacklist = store.NewRedisBlacklist(rdb)
		jwtMgr.SetBlacklist(blacklist)
	} else {
		mem := auth.NewMemoryBlacklist()
		blacklist = mem
		jwtMgr.SetBlacklist(mem)
	}

	// 首次启动初始化平台超管。
	if err := api.EnsureSuperAdmin(st.Users, cfg); err != nil {
		log.Printf("[警告] 初始化平台超管失败: %v", err)
	}

	// 登录限流器(Redis 不可用时禁用)。
	var limiter middleware.Limiter
	if rdb != nil {
		limiter = store.NewRedisRateLimiter(rdb)
	}

	deps := api.Deps{
		Config:      cfg,
		JWT:         jwtMgr,
		Agents:      st.Agents,
		Usage:       st.Usage,
		Alerts:      st.Alerts,
		Tenants:     st.Tenants,
		Users:       st.Users,
		Bills:       st.Bills,
		LoginAudits: st.LoginAudits,
		Redis:       rdb,
		Blacklist:   blacklist,
		RateLimiter: limiter,
	}

	r := api.NewRouter(deps)

	// ── C4 告警扫描器 + webhook 通知器 ──
	var webhookURLs []string
	if cfg.AlertWebhookURLs != "" {
		for _, u := range strings.Split(cfg.AlertWebhookURLs, ",") {
			if u = strings.TrimSpace(u); u != "" {
				webhookURLs = append(webhookURLs, u)
			}
		}
	}
	notifier := alert.NewNotifier(webhookURLs, cfg.WebhookSecret)
	scanner := alert.NewScanner(alert.AlertConfig{
		OfflineThreshold: 15 * time.Minute,
		ScanInterval:     time.Minute,
		DebounceWindow:   30 * time.Minute,
		WebhookURLs:      webhookURLs,
		WebhookSecret:    cfg.WebhookSecret,
	}, st, notifier)
	scanner.Start()
	log.Printf("[alert] 离线扫描器已启动(阈值 15min,webhook=%d 个)", len(webhookURLs))

	log.Printf("财听猫控制面服务启动,监听 %s", cfg.HTTPAddr)
	if err := r.Run(cfg.HTTPAddr); err != nil {
		log.Fatalf("HTTP 服务启动失败: %v", err)
	}
}
