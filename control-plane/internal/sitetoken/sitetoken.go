// Package sitetoken 提供 Agent 站点 Token 的生成与 HMAC-SHA256 哈希。
// 站点 Token 明文只返回一次,库中仅存哈希,便于吊销与防泄露。
package sitetoken

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// Hash 使用 HMAC-SHA256 对站点 Token 计算哈希,返回十六进制字符串。
// secret 应与 JWT 密钥同源,保证统一吊销体系。
func Hash(token, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}

// Generate 生成一个 32 字节的随机站点 Token(十六进制,64 字符)。
func Generate() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成站点 Token 失败: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
