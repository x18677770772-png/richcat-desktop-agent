package api

// 认证与后台管理接口测试:登录成功/失败/锁定,舰队/用量/告警/计费/平台超管。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"richcat/control-plane/internal/auth"
	"richcat/control-plane/internal/model"
)

// ----------------------------------------------------------------
// 登录
// ----------------------------------------------------------------

func TestLoginSuccess(t *testing.T) {
	r, deps, _ := newTestRouter(t)

	hash, _ := auth.HashPassword("TestPass123")
	_ = deps.Users.CreateUser(&model.User{
		ID:           "usr_001",
		TenantID:     "tn_001",
		Email:        "owner@test.ai",
		PasswordHash: hash,
		Role:         model.RoleOwner,
	})

	body := `{"email": "owner@test.ai", "password": "TestPass123"}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("登录成功应返回 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Access  string       `json:"access"`
		Refresh string       `json:"refresh"`
		User    userResponse `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	if resp.Access == "" || resp.Refresh == "" {
		t.Fatal("登录成功应返回 access 与 refresh token")
	}
	if resp.User.Email != "owner@test.ai" {
		t.Fatalf("用户邮箱不正确: %s", resp.User.Email)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	r, deps, _ := newTestRouter(t)
	hash, _ := auth.HashPassword("TestPass123")
	_ = deps.Users.CreateUser(&model.User{
		ID: "usr_001", Email: "owner@test.ai", PasswordHash: hash, Role: model.RoleOwner,
	})

	body := `{"email": "owner@test.ai", "password": "wrongpass"}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("错误密码应返回 401, got %d", w.Code)
	}
}

func TestLoginLocked(t *testing.T) {
	r, deps, _ := newTestRouter(t)
	locked := time.Now().Add(10 * time.Minute)
	hash, _ := auth.HashPassword("TestPass123")
	_ = deps.Users.CreateUser(&model.User{
		ID: "usr_001", Email: "owner@test.ai", PasswordHash: hash, Role: model.RoleOwner,
		LockedUntil: &locked,
	})

	body := `{"email": "owner@test.ai", "password": "TestPass123"}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusLocked {
		t.Fatalf("锁定账号应返回 423, got %d: %s", w.Code, w.Body.String())
	}
}

// ----------------------------------------------------------------
// 管理后台
// ----------------------------------------------------------------

func TestAdminFleet(t *testing.T) {
	r, deps, jwtMgr := newTestRouter(t)

	_, _ = deps.Tenants.CreateTenant("测试企业", "hash", "standard", 5)
	now := time.Now()
	_ = deps.Agents.UpsertAgent(&model.Agent{
		AgentID:  "ag_001",
		TenantID: "tn_test_测试企业",
		Status:   "online",
		LastSeen: &now,
	})

	claims := auth.Claims{UserID: "usr_001", TenantID: "tn_test_测试企业", Role: model.RoleOwner}
	access, _ := jwtMgr.Sign(claims, false)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/admin/fleet", nil)
	req.Header.Set("Authorization", bearerHeader(access))
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("查询舰队应返回 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data  []model.Agent `json:"data"`
		Total int           `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	if resp.Total != 1 {
		t.Fatalf("应返回 1 个 Agent, got %d", resp.Total)
	}
}

func TestAdminCrossTenantForbidden(t *testing.T) {
	r, deps, jwtMgr := newTestRouter(t)

	_, _ = deps.Tenants.CreateTenant("企业A", "hashA", "standard", 5)
	_, _ = deps.Tenants.CreateTenant("企业B", "hashB", "standard", 5)
	now := time.Now()
	_ = deps.Agents.UpsertAgent(&model.Agent{
		AgentID: "ag_001", TenantID: "tn_test_企业A", Status: "online", LastSeen: &now,
	})

	claims := auth.Claims{UserID: "usr_002", TenantID: "tn_test_企业B", Role: model.RoleOwner}
	access, _ := jwtMgr.Sign(claims, false)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/admin/agents/ag_001", nil)
	req.Header.Set("Authorization", bearerHeader(access))
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("跨租户访问应返回 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAdminUsage(t *testing.T) {
	r, deps, jwtMgr := newTestRouter(t)

	_, _ = deps.Tenants.CreateTenant("测试企业", "hash", "standard", 5)
	tenantID := "tn_test_测试企业"

	today := truncateToDay(time.Now())
	_ = deps.Usage.UpsertUsageDaily(&model.UsageDaily{
		AgentID:  "ag_001",
		TenantID: tenantID,
		Day:      today,
		Sessions: 10, Messages: 50, Replies: 30, Handoffs: 2, APICalls: 100,
	})

	claims := auth.Claims{UserID: "usr_001", TenantID: tenantID, Role: model.RoleOwner}
	access, _ := jwtMgr.Sign(claims, false)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/admin/usage", nil)
	req.Header.Set("Authorization", bearerHeader(access))
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("查询用量应返回 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAdminAlertsAndAck(t *testing.T) {
	r, deps, jwtMgr := newTestRouter(t)

	_, _ = deps.Tenants.CreateTenant("测试企业", "hash", "standard", 5)
	tenantID := "tn_test_测试企业"

	_ = deps.Alerts.CreateAlert(&model.Alert{
		AlertID: "al_001", AgentID: "ag_001", TenantID: tenantID,
		Severity: "critical", Category: "offline", TitleSafe: "test", State: "firing",
	})

	claims := auth.Claims{UserID: "usr_001", TenantID: tenantID, Role: model.RoleOwner}
	access, _ := jwtMgr.Sign(claims, false)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/admin/alerts", nil)
	req.Header.Set("Authorization", bearerHeader(access))
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("查询告警应返回 200, got %d", w.Code)
	}

	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodPost, "/api/v1/admin/alerts/al_001/ack", nil)
	req2.Header.Set("Authorization", bearerHeader(access))
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("ack 告警应返回 200, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestBillingSubscription(t *testing.T) {
	r, deps, jwtMgr := newTestRouter(t)

	start := time.Now()
	_, _ = deps.Tenants.CreateTenant("测试企业", "hash", "standard", 5)
	tenantID := "tn_test_测试企业"
	_ = deps.Tenants.UpdateSubscription(tenantID, "pro", 10, &start, nil)

	claims := auth.Claims{UserID: "usr_001", TenantID: tenantID, Role: model.RoleOwner}
	access, _ := jwtMgr.Sign(claims, false)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/admin/billing/subscription", nil)
	req.Header.Set("Authorization", bearerHeader(access))
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("查询订阅应返回 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUsageDailyUpsert(t *testing.T) {
	// 测试内存 fake 的复合主键 upsert 累加正确性。
	us := newFakeUsageStore()

	day := truncateToDay(time.Now())
	u1 := &model.UsageDaily{AgentID: "ag_001", TenantID: "tn_001", Day: day, Sessions: 5, Messages: 10}
	u2 := &model.UsageDaily{AgentID: "ag_001", TenantID: "tn_001", Day: day, Sessions: 3, Messages: 20}

	_ = us.UpsertUsageDaily(u1)
	_ = us.UpsertUsageDaily(u2)

	sum, _ := us.SumByTenantAndDayRange("tn_001", day, day.Add(24*time.Hour))
	if sum.TotalSessions != 8 {
		t.Fatalf("upsert 累加 sessions 应为 8, got %d", sum.TotalSessions)
	}
	if sum.TotalMessages != 30 {
		t.Fatalf("upsert 累加 messages 应为 30, got %d", sum.TotalMessages)
	}
}

// ----------------------------------------------------------------
// 平台超管
// ----------------------------------------------------------------

func TestPlatformCreateTenant(t *testing.T) {
	r, deps, jwtMgr := newTestRouter(t)

	_ = deps.Users.CreateUser(&model.User{
		Email: "admin@richcat.ai", PasswordHash: "hash", Role: model.RolePlatformAdmin,
	})
	claims := auth.Claims{UserID: "usr_adm", TenantID: "", Role: model.RolePlatformAdmin}
	access, _ := jwtMgr.Sign(claims, false)

	body := `{"name": "新企业", "plan": "pro", "seats": 10}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/platform/tenants", strings.NewReader(body))
	req.Header.Set("Authorization", bearerHeader(access))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("创建企业应返回 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Tenant    *model.Tenant `json:"tenant"`
		SiteToken string        `json:"site_token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	if resp.Tenant.Name != "新企业" {
		t.Fatalf("企业名称不匹配: %s", resp.Tenant.Name)
	}
	if resp.SiteToken == "" {
		t.Fatal("创建企业应返回 site_token")
	}
}

func TestPlatformCreateBill(t *testing.T) {
	r, deps, jwtMgr := newTestRouter(t)

	_ = deps.Users.CreateUser(&model.User{
		Email: "admin@richcat.ai", PasswordHash: "hash", Role: model.RolePlatformAdmin,
	})
	_, _ = deps.Tenants.CreateTenant("测试企业", "hash", "standard", 5)
	tenantID := "tn_test_测试企业"

	claims := auth.Claims{UserID: "usr_adm", Role: model.RolePlatformAdmin}
	access, _ := jwtMgr.Sign(claims, false)

	body := `{"tenant_id": "` + tenantID + `", "period": "2026-08", "amount_cents": 50000}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/platform/bills", strings.NewReader(body))
	req.Header.Set("Authorization", bearerHeader(access))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("创建账单应返回 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPlatformMarkBillPaid(t *testing.T) {
	r, deps, jwtMgr := newTestRouter(t)

	_ = deps.Users.CreateUser(&model.User{
		Email: "admin@richcat.ai", PasswordHash: "hash", Role: model.RolePlatformAdmin,
	})
	_, _ = deps.Tenants.CreateTenant("测试企业", "hash", "standard", 5)
	claims := auth.Claims{UserID: "usr_adm", Role: model.RolePlatformAdmin}
	access, _ := jwtMgr.Sign(claims, false)

	_ = deps.Bills.CreateBill(&model.Bill{BillID: "bl_001", TenantID: "tn_test_测试企业", AmountCents: 10000})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/platform/bills/bl_001/paid", nil)
	req.Header.Set("Authorization", bearerHeader(access))
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("标记已付应返回 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ----------------------------------------------------------------
// 健康检查
// ----------------------------------------------------------------

func TestHealthz(t *testing.T) {
	r, _, _ := newTestRouter(t)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/healthz", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("健康检查应返回 200, got %d", w.Code)
	}
}
