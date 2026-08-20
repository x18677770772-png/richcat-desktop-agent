package store

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/redis/go-redis/v9"
)

// uniqueMember 生成一个近乎唯一的 ZSET member(毫秒时间戳 + 随机数)。
func uniqueMember() string {
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), rand.Int63())
}

// RedisBlacklist 基于 Redis 的 JWT 黑名单实现。
type RedisBlacklist struct {
	rdb    *redis.Client
	prefix string
}

// NewRedisBlacklist 创建 Redis 黑名单。
func NewRedisBlacklist(rdb *redis.Client) *RedisBlacklist {
	return &RedisBlacklist{rdb: rdb, prefix: "richcat:jwt:bl:"}
}

// Add 将令牌加入黑名单,ttl 后自动过期删除。
func (b *RedisBlacklist) Add(token string, ttl time.Duration) error {
	return b.rdb.Set(context.Background(), b.prefix+token, "1", ttl).Err()
}

// IsBlacklisted 判断令牌是否已在黑名单中。
func (b *RedisBlacklist) IsBlacklisted(token string) bool {
	n, err := b.rdb.Exists(context.Background(), b.prefix+token).Result()
	return err == nil && n > 0
}

// RedisRateLimiter 基于 Redis 的滑动窗口限流实现。
type RedisRateLimiter struct {
	rdb *redis.Client
}

// NewRedisRateLimiter 创建 Redis 限流器。
func NewRedisRateLimiter(rdb *redis.Client) *RedisRateLimiter {
	return &RedisRateLimiter{rdb: rdb}
}

// Allow 原子执行滑动窗口判断。
// key 为限流键;limit 为窗口内最大次数;windowNanos 为窗口时长(纳秒)。
// allowed=true 表示本次请求放行。
func (r *RedisRateLimiter) Allow(key string, limit int, windowNanos int64) (bool, error) {
	// 采用 ZSET:score=unix 毫秒,member=毫秒:随机后缀。
	windowMs := windowNanos / 1e6
	nowMs := time.Now().UnixMilli()
	member := uniqueMember()
	script := redis.NewScript(`
		local key = KEYS[1]
		local now = tonumber(ARGV[1])
		local window = tonumber(ARGV[2])
		local limit = tonumber(ARGV[3])
		local member = ARGV[4]
		redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
		local count = redis.call('ZCARD', key)
		if count < limit then
			redis.call('ZADD', key, now, member)
			redis.call('PEXPIRE', key, window)
			return 1
		end
		return 0
	`)
	res, err := script.Run(context.Background(), r.rdb,
		[]string{key}, nowMs, windowMs, limit, member).Int()
	if err != nil {
		return false, err
	}
	return res == 1, nil
}
