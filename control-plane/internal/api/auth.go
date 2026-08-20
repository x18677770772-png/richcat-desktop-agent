package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"richcat/control-plane/internal/auth"
	"richcat/control-plane/internal/config"
	"richcat/control-plane/internal/middleware"
	"richcat/control-plane/internal/model"
	"richcat/control-plane/internal/store"
)

// authHandler 处理登录/刷新/登出。
type authHandler struct {
	deps Deps
}

// newAuthHandler 创建认证 handler。
func newAuthHandler(deps Deps) *authHandler {
	return &authHandler{deps: deps}
}

// loginRequest 登录请求体。
type loginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// userResponse 登录成功返回的用户信息。
type userResponse struct {
	ID       string `json:"id"`
	TenantID string `json:"tenant_id,omitempty"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

// login 处理 POST /api/v1/auth/login。
// 复用 auth.Login 逻辑:失败计数累计 + 锁定;成功重置并签发 access/refresh。
// 同时记录登录审计。
func (h *authHandler) login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误:邮箱与密码必填"})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	repo := &authUserRepo{users: h.deps.Users}
	access, refresh, au, err := auth.Login(repo, h.deps.JWT, req.Email, req.Password, time.Now())
	ip := c.ClientIP()
	ua := c.GetHeader("User-Agent")

	if err != nil {
		// 记录失败审计(不泄露具体原因)。
		_ = h.deps.LoginAudits.RecordLoginAudit(req.Email, false, ip, ua)
		if errors.Is(err, auth.ErrAccountLocked) {
			c.JSON(http.StatusLocked, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	_ = h.deps.LoginAudits.RecordLoginAudit(req.Email, true, ip, ua)
	_ = h.deps.Users.UpdateLastLogin(au.ID, time.Now())

	c.JSON(http.StatusOK, gin.H{
		"access":  access,
		"refresh": refresh,
		"user":    toUserResponse(au),
	})
}

// refreshRequest 刷新请求体。
type refreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// refresh 处理 POST /api/v1/auth/refresh:校验 refresh token 并轮换签发新令牌对。
func (h *authHandler) refresh(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 refresh_token"})
		return
	}
	claims, err := h.deps.JWT.ParseRefresh(req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "刷新令牌无效或已过期"})
		return
	}
	// 校验用户仍存在。
	if _, err := h.deps.Users.FindByID(claims.UserID); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户不存在或已被删除"})
		return
	}
	// 轮换签发新的 access + refresh。
	access, err := h.deps.JWT.Sign(*claims, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "签发访问令牌失败"})
		return
	}
	refresh, err := h.deps.JWT.Sign(*claims, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "签发刷新令牌失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"access": access, "refresh": refresh})
}

// logoutRequest 登出请求体(可携带 refresh token 一并吊销)。
type logoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// logout 处理 POST /api/v1/auth/logout:将 access(与可选 refresh)加入黑名单。
func (h *authHandler) logout(c *gin.Context) {
	access := middleware.BearerToken(c)
	var req logoutRequest
	_ = c.ShouldBindJSON(&req)

	if h.deps.Blacklist == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "note": "未配置黑名单,令牌未吊销"})
		return
	}

	if access != "" {
		// 用剩余有效期作为黑名单 ttl,确保过期后自动清理。
		if claims, err := h.deps.JWT.Verify(access); err == nil {
			ttl := time.Until(claims.ExpiresAt.Time)
			if ttl > 0 {
				_ = h.deps.Blacklist.Add(access, ttl)
			}
		}
	}
	if req.RefreshToken != "" {
		if claims, err := h.deps.JWT.ParseRefresh(req.RefreshToken); err == nil {
			ttl := time.Until(claims.ExpiresAt.Time)
			if ttl > 0 {
				_ = h.deps.Blacklist.Add(req.RefreshToken, ttl)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// authUserRepo 适配 store.UserStore 为 auth.UserRepository,复用 auth.Login。
type authUserRepo struct {
	users UserStore
}

// FindByEmail 实现 auth.UserRepository。
func (r *authUserRepo) FindByEmail(email string) (*auth.User, error) {
	u, err := r.users.FindByEmail(email)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, auth.ErrUserNotFound
		}
		return nil, err
	}
	return &auth.User{
		ID:           u.ID,
		TenantID:     u.TenantID,
		Email:        u.Email,
		PasswordHash: u.PasswordHash,
		Role:         u.Role,
		FailedLogins: u.FailedLogins,
		LockedUntil:  u.LockedUntil,
	}, nil
}

// UpdateLoginState 实现 auth.UserRepository。
func (r *authUserRepo) UpdateLoginState(userID string, failedLogins int, lockedUntil *time.Time) error {
	return r.users.UpdateLoginState(userID, failedLogins, lockedUntil)
}

// toUserResponse 将 auth.User 转为 API 响应结构。
func toUserResponse(u *auth.User) userResponse {
	return userResponse{
		ID:       u.ID,
		TenantID: u.TenantID,
		Email:    u.Email,
		Role:     u.Role,
	}
}

// EnsureSuperAdmin 在首次启动时创建平台超管。
// 若已存在平台超管(邮箱匹配),则跳过。
func EnsureSuperAdmin(users UserStore, cfg *config.Config) error {
	if cfg.AdminEmail == "" || cfg.AdminPassword == "" {
		return errors.New("未配置 ADMIN_EMAIL/ADMIN_PASSWORD,无法初始化超管")
	}
	if _, err := users.FindByEmail(strings.ToLower(cfg.AdminEmail)); err == nil {
		return nil // 超管已存在
	}
	hash, err := auth.HashPassword(cfg.AdminPassword)
	if err != nil {
		return err
	}
	u := &model.User{
		Email:        strings.ToLower(cfg.AdminEmail),
		PasswordHash: hash,
		Role:         model.RolePlatformAdmin,
	}
	return users.CreateUser(u)
}
