package auth

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// 令牌相关的业务错误。
var (
	// ErrTokenInvalid 表示令牌签名非法、格式错误或类型不匹配。
	ErrTokenInvalid = errors.New("无效的令牌")
	// ErrTokenExpired 表示令牌已过期。
	ErrTokenExpired = errors.New("令牌已过期")
	// ErrTokenBlacklisted 表示令牌已被注销(黑名单)。
	ErrTokenBlacklisted = errors.New("令牌已被注销")
	// ErrBlacklistNotConfigured 表示 JWTManager 未注入黑名单实现。
	ErrBlacklistNotConfigured = errors.New("令牌黑名单未配置")
)

// Claims 是 JWT 中携带的声明。
// 普通用户通过 UserID/TenantID/Role 完成多租户鉴权;
// SiteToken 仅 Agent 心跳上报使用,普通用户为空。
type Claims struct {
	UserID    string `json:"user_id"`
	TenantID  string `json:"tenant_id"`
	Role      string `json:"role"`
	SiteToken string `json:"site_token,omitempty"`
	// Refresh 标记该令牌是否为 refresh token(内部使用)。
	Refresh bool `json:"refresh,omitempty"`
	jwt.RegisteredClaims
}

// TokenBlacklist 是可注入的令牌黑名单接口,用于登出/吊销。
// 生产环境可替换为 Redis 实现。
type TokenBlacklist interface {
	// Add 将令牌加入黑名单,ttl 为有效时长。
	Add(token string, ttl time.Duration) error
	// IsBlacklisted 判断令牌是否已在黑名单中。
	IsBlacklisted(token string) bool
}

// MemoryBlacklist 是基于内存 map 的 TokenBlacklist 实现。
// 加锁保证并发安全;到期条目在读写时惰性清理。
type MemoryBlacklist struct {
	mu      sync.RWMutex
	entries map[string]time.Time // token -> 过期时间
}

// NewMemoryBlacklist 创建一个空的 MemoryBlacklist。
func NewMemoryBlacklist() *MemoryBlacklist {
	return &MemoryBlacklist{entries: make(map[string]time.Time)}
}

// Add 将令牌加入黑名单,ttl 之后自动失效。
func (b *MemoryBlacklist) Add(token string, ttl time.Duration) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.cleanupLocked(time.Now())
	b.entries[token] = time.Now().Add(ttl)
	return nil
}

// IsBlacklisted 判断令牌是否已在黑名单中;已过期的条目会被移除并视为不在黑名单。
func (b *MemoryBlacklist) IsBlacklisted(token string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.cleanupLocked(now)
	exp, ok := b.entries[token]
	if !ok {
		return false
	}
	if now.After(exp) {
		delete(b.entries, token)
		return false
	}
	return true
}

// cleanupLocked 惰性清理所有已过期的条目,调用方必须持有写锁。
func (b *MemoryBlacklist) cleanupLocked(now time.Time) {
	for t, exp := range b.entries {
		if now.After(exp) {
			delete(b.entries, t)
		}
	}
}

// JWTManager 负责 JWT 的签发与校验,使用 HS256。
type JWTManager struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
	blacklist  TokenBlacklist
}

// NewJWTManager 创建一个 JWTManager。
// secret 为 HMAC 签名密钥;accessTTL/refreshTTL 分别控制 access/refresh 令牌有效期。
func NewJWTManager(secret string, accessTTL, refreshTTL time.Duration) *JWTManager {
	return &JWTManager{
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

// SetBlacklist 注入令牌黑名单实现(登出/吊销)。
func (m *JWTManager) SetBlacklist(bl TokenBlacklist) {
	m.blacklist = bl
}

// Sign 签发令牌。
// refresh 为 true 时签发 refresh token(refreshTTL 有效期且带 refresh 标记),否则为 access token。
func (m *JWTManager) Sign(claims Claims, refresh bool) (string, error) {
	now := time.Now()
	ttl := m.accessTTL
	if refresh {
		ttl = m.refreshTTL
		claims.Refresh = true
	}
	claims.RegisteredClaims = jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		IssuedAt:  jwt.NewNumericDate(now),
		Subject:   claims.UserID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secret)
	if err != nil {
		return "", fmt.Errorf("签发令牌失败: %w", err)
	}
	return signed, nil
}

// parse 解析并校验签名与过期时间,返回 Claims。
func (m *JWTManager) parse(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(
		tokenStr,
		claims,
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("非预期的签名算法: %v", t.Header["alg"])
			}
			return m.secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, ErrTokenInvalid
	}
	if !token.Valid {
		return nil, ErrTokenInvalid
	}
	return claims, nil
}

// Verify 校验 access token:签名 + 过期 + 非 refresh 标记 + 黑名单。
func (m *JWTManager) Verify(tokenStr string) (*Claims, error) {
	claims, err := m.parse(tokenStr)
	if err != nil {
		return nil, err
	}
	if claims.Refresh {
		return nil, ErrTokenInvalid
	}
	if m.blacklist != nil && m.blacklist.IsBlacklisted(tokenStr) {
		return nil, ErrTokenBlacklisted
	}
	return claims, nil
}

// ParseRefresh 校验 refresh token:签名 + 过期 + refresh 标记 + 黑名单。
func (m *JWTManager) ParseRefresh(tokenStr string) (*Claims, error) {
	claims, err := m.parse(tokenStr)
	if err != nil {
		return nil, err
	}
	if !claims.Refresh {
		return nil, ErrTokenInvalid
	}
	if m.blacklist != nil && m.blacklist.IsBlacklisted(tokenStr) {
		return nil, ErrTokenBlacklisted
	}
	return claims, nil
}

// Blacklist 将令牌加入黑名单(登出/吊销)。
func (m *JWTManager) Blacklist(tokenStr string, ttl time.Duration) error {
	if m.blacklist == nil {
		return ErrBlacklistNotConfigured
	}
	return m.blacklist.Add(tokenStr, ttl)
}
