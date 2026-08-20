package auth

import (
	"errors"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

// bcryptDefaultCost 是 bcrypt 的默认计算代价(10)。
// 足够安全且在本机测试中耗时可控。
const bcryptDefaultCost = bcrypt.DefaultCost

// ErrPasswordTooShort 表示密码长度不足 8 位。
var ErrPasswordTooShort = errors.New("密码长度至少为 8 位")

// ErrPasswordNoLetter 表示密码中不包含字母。
var ErrPasswordNoLetter = errors.New("密码必须包含字母")

// ErrPasswordNoDigit 表示密码中不包含数字。
var ErrPasswordNoDigit = errors.New("密码必须包含数字")

// HashPassword 使用 bcrypt 默认代价计算密码哈希,返回可直接入库的字符串。
func HashPassword(pw string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptDefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword 校验明文密码是否与 bcrypt 哈希匹配,匹配返回 true。
func VerifyPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

// ValidatePasswordStrength 校验密码强度:至少 8 个字符,且同时包含字母和数字。
// 不满足时返回对应的中文错误。
func ValidatePasswordStrength(pw string) error {
	if utf8.RuneCountInString(pw) < 8 {
		return ErrPasswordTooShort
	}

	hasLetter := false
	hasDigit := false
	for _, r := range pw {
		switch {
		case unicode.IsLetter(r):
			hasLetter = true
		case unicode.IsDigit(r):
			hasDigit = true
		}
	}
	if !hasLetter {
		return ErrPasswordNoLetter
	}
	if !hasDigit {
		return ErrPasswordNoDigit
	}
	return nil
}
