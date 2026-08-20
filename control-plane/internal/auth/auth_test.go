package auth

import (
	"errors"
	"testing"
	"time"
)

// fakeUserRepo 是 UserRepository 的内存实现,便于单测。
type fakeUserRepo struct {
	byID    map[string]*User
	byEmail map[string]string // email -> userID
	// stateLog 记录 UpdateLoginState 的调用(userID, failedLogins, lockedUntil)。
	stateLog []struct {
		userID       string
		failedLogins int
		lockedUntil  *time.Time
	}
}

func newFakeUserRepo(users ...*User) *fakeUserRepo {
	r := &fakeUserRepo{
		byID:    make(map[string]*User),
		byEmail: make(map[string]string),
	}
	for _, u := range users {
		r.byID[u.ID] = u
		r.byEmail[u.Email] = u.ID
	}
	return r
}

func (r *fakeUserRepo) FindByEmail(email string) (*User, error) {
	uid, ok := r.byEmail[email]
	if !ok {
		return nil, ErrUserNotFound
	}
	return r.byID[uid], nil
}

func (r *fakeUserRepo) UpdateLoginState(userID string, failedLogins int, lockedUntil *time.Time) error {
	r.stateLog = append(r.stateLog, struct {
		userID       string
		failedLogins int
		lockedUntil  *time.Time
	}{userID, failedLogins, lockedUntil})
	// 模拟 DB 行为:更新 User 对象的字段,使后续调用可见状态变化
	if u, ok := r.byID[userID]; ok {
		u.FailedLogins = failedLogins
		u.LockedUntil = lockedUntil
	}
	return nil
}

func testUser() *User {
	hash, _ := HashPassword("Passw0rd123")
	return &User{
		ID:           "u-1",
		TenantID:     "t-1",
		Email:        "owner@richcat.ai",
		PasswordHash: hash,
		Role:         "owner",
	}
}

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("Passw0rd123")
	if err != nil {
		t.Fatalf("HashPassword error: %v", err)
	}
	if hash == "Passw0rd123" {
		t.Fatal("哈希不应等于明文")
	}
	if !VerifyPassword(hash, "Passw0rd123") {
		t.Fatal("正确密码应通过校验")
	}
	if VerifyPassword(hash, "wrong-pass") {
		t.Fatal("错误密码不应通过校验")
	}
}

func TestValidatePasswordStrength(t *testing.T) {
	cases := []struct {
		name string
		pw   string
		want error
	}{
		{"合法密码", "Passw0rd123", nil},
		{"太短", "Pw1", ErrPasswordTooShort},
		{"纯字母", "abcdefgh", ErrPasswordNoDigit},
		{"纯数字", "12345678", ErrPasswordNoLetter},
		{"8位含字母数字", "abcd1234", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ValidatePasswordStrength(c.pw); !errors.Is(got, c.want) {
				t.Fatalf("ValidatePasswordStrength(%q) = %v, want %v", c.pw, got, c.want)
			}
		})
	}
}

func TestJWTManagerSignVerify(t *testing.T) {
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)

	claims := Claims{UserID: "u-1", TenantID: "t-1", Role: "owner"}
	access, err := m.Sign(claims, false)
	if err != nil {
		t.Fatalf("Sign access error: %v", err)
	}
	refresh, err := m.Sign(claims, true)
	if err != nil {
		t.Fatalf("Sign refresh error: %v", err)
	}

	// access token 应通过 Verify,且被 ParseRefresh 拒绝
	got, err := m.Verify(access)
	if err != nil {
		t.Fatalf("Verify(access) error: %v", err)
	}
	if got.UserID != "u-1" || got.TenantID != "t-1" || got.Role != "owner" {
		t.Fatalf("Verify 返回的 claims 不正确: %+v", got)
	}
	if got.Refresh {
		t.Fatal("access token 不应带 refresh 标记")
	}

	if _, err := m.ParseRefresh(access); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("ParseRefresh(access) 应返回 ErrTokenInvalid, got %v", err)
	}

	// refresh token 应通过 ParseRefresh,且被 Verify 拒绝
	gotR, err := m.ParseRefresh(refresh)
	if err != nil {
		t.Fatalf("ParseRefresh(refresh) error: %v", err)
	}
	if !gotR.Refresh {
		t.Fatal("refresh token 应带 refresh 标记")
	}

	if _, err := m.Verify(refresh); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("Verify(refresh) 应返回 ErrTokenInvalid, got %v", err)
	}
}

func TestJWTManagerExpired(t *testing.T) {
	// accessTTL 为负值,签发后立即过期
	m := NewJWTManager("test-secret", -1*time.Second, 7*24*time.Hour)
	access, err := m.Sign(Claims{UserID: "u-1", Role: "owner"}, false)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if _, err := m.Verify(access); !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("Verify 应返回 ErrTokenExpired, got %v", err)
	}
}

func TestJWTManagerWrongSecret(t *testing.T) {
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	other := NewJWTManager("other-secret", 15*time.Minute, 7*24*time.Hour)

	access, err := m.Sign(Claims{UserID: "u-1", Role: "owner"}, false)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if _, err := other.Verify(access); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("错误密钥校验应返回 ErrTokenInvalid, got %v", err)
	}
}

func TestMemoryBlacklist(t *testing.T) {
	bl := NewMemoryBlacklist()
	token := "some-jwt-token"

	if bl.IsBlacklisted(token) {
		t.Fatal("新令牌不应在黑名单中")
	}
	if err := bl.Add(token, 10*time.Minute); err != nil {
		t.Fatalf("Add error: %v", err)
	}
	if !bl.IsBlacklisted(token) {
		t.Fatal("加入黑名单后应判定为已注销")
	}
}

func TestJWTBlacklist(t *testing.T) {
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	access, _ := m.Sign(Claims{UserID: "u-1", Role: "owner"}, false)

	// 未配置黑名单时,Blacklist 返回错误
	if err := m.Blacklist(access, time.Minute); !errors.Is(err, ErrBlacklistNotConfigured) {
		t.Fatalf("未配置黑名单应返回 ErrBlacklistNotConfigured, got %v", err)
	}

	bl := NewMemoryBlacklist()
	m.SetBlacklist(bl)
	if err := m.Blacklist(access, time.Minute); err != nil {
		t.Fatalf("Blacklist error: %v", err)
	}
	if _, err := m.Verify(access); !errors.Is(err, ErrTokenBlacklisted) {
		t.Fatalf("已注销令牌应返回 ErrTokenBlacklisted, got %v", err)
	}
}

func TestLoginSuccess(t *testing.T) {
	u := testUser()
	repo := newFakeUserRepo(u)
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	now := time.Now()

	access, refresh, gotUser, err := Login(repo, m, u.Email, "Passw0rd123", now)
	if err != nil {
		t.Fatalf("Login error: %v", err)
	}
	if access == "" || refresh == "" {
		t.Fatal("登录成功应签发 access 与 refresh token")
	}
	if gotUser.ID != u.ID {
		t.Fatalf("返回用户不正确: %+v", gotUser)
	}
	// 成功应重置 failedLogins 为 0
	if len(repo.stateLog) != 1 || repo.stateLog[0].failedLogins != 0 || repo.stateLog[0].lockedUntil != nil {
		t.Fatalf("成功登录应重置失败计数, stateLog=%+v", repo.stateLog)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	u := testUser()
	repo := newFakeUserRepo(u)
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	now := time.Now()

	_, _, _, err := Login(repo, m, u.Email, "wrong-password", now)
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("错误密码应返回 ErrInvalidCredentials, got %v", err)
	}
	// 失败应 +1
	if len(repo.stateLog) != 1 || repo.stateLog[0].failedLogins != 1 {
		t.Fatalf("失败应记录 failedLogins=1, stateLog=%+v", repo.stateLog)
	}
}

func TestLoginLockoutOnFifthFailure(t *testing.T) {
	u := testUser()
	repo := newFakeUserRepo(u)
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	now := time.Now()

	// 第 5 次失败触发锁定
	var err error
	for i := 0; i < 5; i++ {
		_, _, _, err = Login(repo, m, u.Email, "wrong-password", now)
	}
	if !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("第 5 次失败应返回 ErrAccountLocked, got %v", err)
	}
	last := repo.stateLog[len(repo.stateLog)-1]
	if last.failedLogins != 5 {
		t.Fatalf("第 5 次失败 failedLogins 应为 5, got %d", last.failedLogins)
	}
	if last.lockedUntil == nil {
		t.Fatal("第 5 次失败应设置 lockedUntil")
	}
	// 锁定 15min
	want := now.Add(15 * time.Minute)
	if diff := last.lockedUntil.Sub(want); diff < -time.Second || diff > time.Second {
		t.Fatalf("lockedUntil 应为 now+15min, got %v (now=%v)", last.lockedUntil, now)
	}
}

func TestLoginLockedAccount(t *testing.T) {
	u := testUser()
	locked := time.Now().Add(10 * time.Minute)
	u.LockedUntil = &locked
	repo := newFakeUserRepo(u)
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)

	_, _, _, err := Login(repo, m, u.Email, "Passw0rd123", time.Now())
	if !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("锁定期间应返回 ErrAccountLocked, got %v", err)
	}
}

func TestLoginUserNotFound(t *testing.T) {
	repo := newFakeUserRepo()
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)

	_, _, _, err := Login(repo, m, "nobody@richcat.ai", "Passw0rd123", time.Now())
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("用户不存在应返回 ErrInvalidCredentials(不泄露), got %v", err)
	}
	if len(repo.stateLog) != 0 {
		t.Fatal("用户不存在不应更新登录状态")
	}
}

func TestLoginLockedExpiryResets(t *testing.T) {
	u := testUser()
	// 锁定已过期
	past := time.Now().Add(-1 * time.Minute)
	u.LockedUntil = &past
	u.FailedLogins = 5
	repo := newFakeUserRepo(u)
	m := NewJWTManager("test-secret", 15*time.Minute, 7*24*time.Hour)

	_, _, _, err := Login(repo, m, u.Email, "Passw0rd123", time.Now())
	if err != nil {
		t.Fatalf("锁定过期后应可登录, got %v", err)
	}
	// 成功重置 failedLogins
	if len(repo.stateLog) != 1 || repo.stateLog[0].failedLogins != 0 {
		t.Fatalf("成功登录应重置失败计数, stateLog=%+v", repo.stateLog)
	}
}
