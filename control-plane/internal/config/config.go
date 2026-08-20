// Package config 从环境变量加载控制面服务配置。
// 所有缺省值均适用于本机/容器开发,生产环境请显式注入。
package config

import (
	"os"
	"time"
)

// Config 控制面服务配置。
type Config struct {
	// HTTPAddr HTTP 监听地址,例如 ":8080"。
	HTTPAddr string
	// PGDSN PostgreSQL 连接串。
	PGDSN string
	// RedisAddr Redis 地址,例如 "127.0.0.1:6379"。
	RedisAddr string
	// RedisPassword Redis 密码(可为空)。
	RedisPassword string
	// JWTSecret JWT 与站点 Token 的 HMAC 签名密钥(必须足够长且保密)。
	JWTSecret string
	// AdminEmail 首次启动创建平台超管使用的邮箱。
	AdminEmail string
	// AdminPassword 首次启动创建平台超管使用的密码。
	AdminPassword string
	// AccessTTL access token 有效期。
	AccessTTL time.Duration
	// RefreshTTL refresh token 有效期。
	RefreshTTL time.Duration
	// AlertWebhookURLs 告警 webhook 地址(逗号分隔:钉钉/企微/飞书)。
	AlertWebhookURLs string
	// WebhookSecret 告警 webhook 加签密钥(可选)。
	WebhookSecret string
}

// Load 读取环境变量并返回配置;未设置的项使用默认值。
func Load() *Config {
	return &Config{
		HTTPAddr:         envOrDefault("HTTP_ADDR", ":8080"),
		PGDSN:            os.Getenv("PG_DSN"),
		RedisAddr:        envOrDefault("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:    os.Getenv("REDIS_PASSWORD"),
		JWTSecret:        os.Getenv("JWT_SECRET"),
		AdminEmail:       envOrDefault("ADMIN_EMAIL", "admin@richcat.ai"),
		AdminPassword:    os.Getenv("ADMIN_PASSWORD"),
		AccessTTL:        durationEnvOrDefault("ACCESS_TTL", 15*time.Minute),
		RefreshTTL:       durationEnvOrDefault("REFRESH_TTL", 7*24*time.Hour),
		AlertWebhookURLs: os.Getenv("ALERT_WEBHOOK_URLS"),
		WebhookSecret:    os.Getenv("WEBHOOK_SECRET"),
	}
}

// envOrDefault 读取环境变量,为空时返回默认值。
func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// durationEnvOrDefault 读取环境变量并解析为 time.Duration,解析失败或为空时返回默认值。
func durationEnvOrDefault(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
