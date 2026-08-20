// Package middleware 提供 Gin 中间件:JWT 认证、租户上下文、角色校验与 Redis 限流。
package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Limiter 滑动窗口限流抽象,由 store.RedisRateLimiter 等实现。
// Redis 不可用时传 nil 自动禁用。
type Limiter interface {
	// Allow 原子执行滑动窗口判断;allowed=true 表示本次请求放行。
	Allow(key string, limit int, windowNanos int64) (bool, error)
}

// RateLimit 基于滑动窗口限流中间件。
// l 为 nil 时自动禁用限流(便于无 Redis 环境与单测)。
// 命中上限返回 429。
func RateLimit(l Limiter, prefix string, limit int, windowNanos int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if l == nil {
			c.Next()
			return
		}
		key := prefix + c.ClientIP()
		allowed, err := l.Allow(key, limit, windowNanos)
		if err != nil || !allowed {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁,请稍后再试"})
			return
		}
		c.Next()
	}
}
