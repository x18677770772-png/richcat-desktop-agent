package auth

import (
	"errors"
	"time"
)

// 登录相关的业务错误,使用中文消息(仅在需要时透出给用户)。
var (
	// ErrInvalidCredentials 表示账号或密码错误,不区分具体错误来源以防范枚举攻击。
	ErrInvalidCredentials = errors.New("账号或密码错误")
	// ErrAccountLocked 表示账号因多次失败尝试已被临时锁定。
	ErrAccountLocked = errors.New("账号已锁定,请稍后再试")
	// ErrUserNotFound 表示用户不存在,仅在内部使用,不直接返回给登录接口。
	ErrUserNotFound = errors.New("用户不存在")
)

// UserRepository 是用户数据访问的接口抽象,允许 Login 在不依赖具体 DB 实现的情况下进行测试。
type UserRepository interface {
	// FindByEmail 根据邮箱查找用户,返回 User 或 ErrUserNotFound。
	FindByEmail(email string) (*User, error)
	// UpdateLoginState 更新登录状态:失败次数、锁定截止时间。
	// lockedUntil 为 nil 时表示不锁定(成功重置)。
	UpdateLoginState(userID string, failedLogins int, lockedUntil *time.Time) error
}

// User 是登录流程中需要的用户信息子集,与数据库模型对应。
type User struct {
	ID           string
	TenantID     string
	Email        string
	PasswordHash string
	Role         string
	FailedLogins int
	LockedUntil  *time.Time
}

// maxFailedLogins 是触发锁定所需的最少失败次数。
const maxFailedLogins = 5

// lockDuration 是锁定持续时间。
const lockDuration = 15 * time.Minute

// Login 执行登录主流程,为纯函数,可脱离数据库进行单测。
//
// 流程:
//  1. 通过 repo 查找用户;不存在 → ErrInvalidCredentials(不泄露是否存在)。
//  2. 检查锁定:LockedUntil 在 now 之后 → ErrAccountLocked。
//  3. 校验密码:失败 → failedLogins+1;连续 5 次失败 → 锁定 15min。
//  4. 成功 → 重置 failedLogins;签发 access + refresh token。
//
// 返回 access token、refresh token、User 对象和可能的错误。
func Login(repo UserRepository, jwtMgr *JWTManager, email, password string, now time.Time) (access, refresh string, user *User, err error) {
	u, err := repo.FindByEmail(email)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return "", "", nil, ErrInvalidCredentials
		}
		return "", "", nil, err
	}

	// 锁定检查
	if u.LockedUntil != nil && now.Before(*u.LockedUntil) {
		return "", "", nil, ErrAccountLocked
	}

	// 密码校验
	if !VerifyPassword(u.PasswordHash, password) {
		newFailed := u.FailedLogins + 1
		var lockedUntil *time.Time
		if newFailed >= maxFailedLogins {
			deadline := now.Add(lockDuration)
			lockedUntil = &deadline
		}
		_ = repo.UpdateLoginState(u.ID, newFailed, lockedUntil)

		// 如果本次失败恰好触发锁定,需要返回锁定错误。
		// 否则仍返回"账号或密码错误"。
		if lockedUntil != nil {
			return "", "", nil, ErrAccountLocked
		}
		return "", "", nil, ErrInvalidCredentials
	}

	// 登录成功:重置失败计数
	_ = repo.UpdateLoginState(u.ID, 0, nil)

	// 签发令牌
	claims := Claims{
		UserID:   u.ID,
		TenantID: u.TenantID,
		Role:     u.Role,
	}
	accessToken, err := jwtMgr.Sign(claims, false)
	if err != nil {
		return "", "", u, err
	}
	refreshToken, err := jwtMgr.Sign(claims, true)
	if err != nil {
		return "", "", u, err
	}

	return accessToken, refreshToken, u, nil
}
