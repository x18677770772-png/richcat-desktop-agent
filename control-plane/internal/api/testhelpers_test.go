package api

// 测试用内存 fake,实现 api 包定义的全部 store 接口。
// 不依赖真实 PG/Redis,保证测试稳定。

import (
	"fmt"
	"sync"
	"time"

	"richcat/control-plane/internal/model"
	"richcat/control-plane/internal/store"
)

// ---- Agent ----

type fakeAgentStore struct {
	mu     sync.Mutex
	agents map[string]*model.Agent
}

func newFakeAgentStore() *fakeAgentStore {
	return &fakeAgentStore{agents: make(map[string]*model.Agent)}
}

func (f *fakeAgentStore) UpsertAgent(a *model.Agent) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.agents[a.AgentID] = a
	return nil
}

func (f *fakeAgentStore) UpdateLastSeen(agentID, status string, lastSeen time.Time, res model.ResourceSnapshot) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a, ok := f.agents[agentID]; ok {
		a.Status = status
		a.LastSeen = &lastSeen
		a.CPUPct = res.CPUPct
		a.MemPct = res.MemPct
		a.DiskFreeGb = res.DiskFreeGb
		a.WechatState = res.WechatState
		a.AgentVersion = res.AgentVersion
	}
	return nil
}

func (f *fakeAgentStore) GetAgent(id string) (*model.Agent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a, ok := f.agents[id]; ok {
		return a, nil
	}
	return nil, store.ErrNotFound
}

func (f *fakeAgentStore) ListByTenant(tenantID string) ([]model.Agent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.Agent, 0)
	for _, a := range f.agents {
		if a.TenantID == tenantID {
			out = append(out, *a)
		}
	}
	return out, nil
}

func (f *fakeAgentStore) ListAll() ([]model.Agent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.Agent, 0, len(f.agents))
	for _, a := range f.agents {
		out = append(out, *a)
	}
	return out, nil
}

// ---- Usage ----

type fakeUsageStore struct {
	mu   sync.Mutex
	rows map[string]*model.UsageDaily // key = agentID|YYYY-MM-DD
}

func newFakeUsageStore() *fakeUsageStore {
	return &fakeUsageStore{rows: make(map[string]*model.UsageDaily)}
}

func (f *fakeUsageStore) UpsertUsageDaily(u *model.UsageDaily) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := u.AgentID + "|" + u.Day.Format("2006-01-02")
	if existing, ok := f.rows[key]; ok {
		existing.Sessions += u.Sessions
		existing.Messages += u.Messages
		existing.Replies += u.Replies
		existing.Handoffs += u.Handoffs
		existing.APICalls += u.APICalls
		return nil
	}
	cp := *u
	f.rows[key] = &cp
	return nil
}

func (f *fakeUsageStore) SumByTenantAndDayRange(tenantID string, from, to time.Time) (*store.UsageSum, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var sum store.UsageSum
	for _, r := range f.rows {
		if r.TenantID == tenantID && !r.Day.Before(from) && r.Day.Before(to) {
			sum.TotalSessions += r.Sessions
			sum.TotalMessages += r.Messages
			sum.TotalReplies += r.Replies
			sum.TotalHandoffs += r.Handoffs
			sum.TotalAPICalls += r.APICalls
		}
	}
	return &sum, nil
}

func (f *fakeUsageStore) SumAllByDayRange(from, to time.Time) (*store.UsageSum, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var sum store.UsageSum
	for _, r := range f.rows {
		if !r.Day.Before(from) && r.Day.Before(to) {
			sum.TotalSessions += r.Sessions
			sum.TotalMessages += r.Messages
			sum.TotalReplies += r.Replies
			sum.TotalHandoffs += r.Handoffs
			sum.TotalAPICalls += r.APICalls
		}
	}
	return &sum, nil
}

func (f *fakeUsageStore) ListUsageByDay(tenantID string, from, to time.Time) ([]model.UsageDaily, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.UsageDaily, 0)
	for _, r := range f.rows {
		if r.TenantID == tenantID && !r.Day.Before(from) && r.Day.Before(to) {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (f *fakeUsageStore) ListByAgentAndDayRange(agentID string, from, to time.Time) ([]model.UsageDaily, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.UsageDaily, 0)
	for _, r := range f.rows {
		if r.AgentID == agentID && !r.Day.Before(from) && r.Day.Before(to) {
			out = append(out, *r)
		}
	}
	return out, nil
}

// ---- Alert ----

type fakeAlertStore struct {
	mu     sync.Mutex
	alerts map[string]*model.Alert
	nextID int
}

func newFakeAlertStore() *fakeAlertStore {
	return &fakeAlertStore{alerts: make(map[string]*model.Alert)}
}

func (f *fakeAlertStore) CreateAlert(a *model.Alert) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a.AlertID == "" {
		f.nextID++
		a.AlertID = fmt.Sprintf("al_%d", f.nextID)
	}
	if a.CreatedAt.IsZero() {
		a.CreatedAt = time.Now()
	}
	f.alerts[a.AlertID] = a
	return nil
}

func (f *fakeAlertStore) ResolveAlert(alertID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a, ok := f.alerts[alertID]; ok {
		a.State = "resolved"
	}
	return nil
}

func (f *fakeAlertStore) ListByTenant(tenantID, status string) ([]model.Alert, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.Alert, 0)
	for _, a := range f.alerts {
		if a.TenantID == tenantID && (status == "" || a.State == status) {
			out = append(out, *a)
		}
	}
	return out, nil
}

func (f *fakeAlertStore) ListAll(status string) ([]model.Alert, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.Alert, 0)
	for _, a := range f.alerts {
		if status == "" || a.State == status {
			out = append(out, *a)
		}
	}
	return out, nil
}

func (f *fakeAlertStore) GetAlert(alertID string) (*model.Alert, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a, ok := f.alerts[alertID]; ok {
		return a, nil
	}
	return nil, store.ErrNotFound
}

func (f *fakeAlertStore) AckAlert(alertID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a, ok := f.alerts[alertID]; ok {
		a.AckStatus = "acked"
	}
	return nil
}

// ---- Tenant ----

type fakeTenantStore struct {
	mu      sync.Mutex
	tenants map[string]*model.Tenant
	byHash  map[string]string
}

func newFakeTenantStore() *fakeTenantStore {
	return &fakeTenantStore{
		tenants: make(map[string]*model.Tenant),
		byHash:  make(map[string]string),
	}
}

func (f *fakeTenantStore) CreateTenant(name, siteTokenHash, plan string, seats int) (*model.Tenant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t := &model.Tenant{
		ID:            "tn_test_" + name,
		Name:          name,
		SiteTokenHash: siteTokenHash,
		Plan:          plan,
		Seats:         seats,
		Status:        "active",
		CreatedAt:     time.Now(),
	}
	f.tenants[t.ID] = t
	f.byHash[siteTokenHash] = t.ID
	return t, nil
}

func (f *fakeTenantStore) UpdateSubscription(tenantID string, plan string, seats int, start, end *time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if t, ok := f.tenants[tenantID]; ok {
		if plan != "" {
			t.Plan = plan
		}
		if seats > 0 {
			t.Seats = seats
		}
		t.SubscriptionStart = start
		t.SubscriptionEnd = end
	}
	return nil
}

func (f *fakeTenantStore) GetTenant(id string) (*model.Tenant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if t, ok := f.tenants[id]; ok {
		return t, nil
	}
	return nil, store.ErrNotFound
}

func (f *fakeTenantStore) ListTenants() ([]model.Tenant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.Tenant, 0, len(f.tenants))
	for _, t := range f.tenants {
		out = append(out, *t)
	}
	return out, nil
}

func (f *fakeTenantStore) GetBySiteTokenHash(hash string) (*model.Tenant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if id, ok := f.byHash[hash]; ok {
		return f.tenants[id], nil
	}
	return nil, store.ErrNotFound
}

// ---- User ----

type fakeUserStore struct {
	mu      sync.Mutex
	users   map[string]*model.User
	byEmail map[string]string
	nextID  int
}

func newFakeUserStore() *fakeUserStore {
	return &fakeUserStore{
		users:   make(map[string]*model.User),
		byEmail: make(map[string]string),
	}
}

func (f *fakeUserStore) CreateUser(u *model.User) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if u.ID == "" {
		f.nextID++
		u.ID = fmt.Sprintf("usr_test_%d", f.nextID)
	}
	f.users[u.ID] = u
	f.byEmail[u.Email] = u.ID
	return nil
}

func (f *fakeUserStore) FindByEmail(email string) (*model.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.byEmail[email]
	if !ok {
		return nil, store.ErrNotFound
	}
	return f.users[id], nil
}

func (f *fakeUserStore) FindByID(id string) (*model.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if u, ok := f.users[id]; ok {
		return u, nil
	}
	return nil, store.ErrNotFound
}

func (f *fakeUserStore) UpdateLoginState(userID string, failedLogins int, lockedUntil *time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if u, ok := f.users[userID]; ok {
		u.FailedLogins = failedLogins
		u.LockedUntil = lockedUntil
	}
	return nil
}

func (f *fakeUserStore) UpdateLastLogin(userID string, t time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if u, ok := f.users[userID]; ok {
		u.LastLogin = &t
	}
	return nil
}

func (f *fakeUserStore) ListByTenant(tenantID string) ([]model.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.User, 0)
	for _, u := range f.users {
		if u.TenantID == tenantID {
			out = append(out, *u)
		}
	}
	return out, nil
}

// ---- Bill ----

type fakeBillStore struct {
	mu    sync.Mutex
	bills map[string]*model.Bill
	nextID int
}

func newFakeBillStore() *fakeBillStore {
	return &fakeBillStore{bills: make(map[string]*model.Bill)}
}

func (f *fakeBillStore) CreateBill(b *model.Bill) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if b.BillID == "" {
		f.nextID++
		b.BillID = fmt.Sprintf("bl_%d", f.nextID)
	}
	b.CreatedAt = time.Now()
	f.bills[b.BillID] = b
	return nil
}

func (f *fakeBillStore) ListByTenant(tenantID string) ([]model.Bill, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.Bill, 0)
	for _, b := range f.bills {
		if b.TenantID == tenantID {
			out = append(out, *b)
		}
	}
	return out, nil
}

func (f *fakeBillStore) ListAll() ([]model.Bill, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.Bill, 0, len(f.bills))
	for _, b := range f.bills {
		out = append(out, *b)
	}
	return out, nil
}

func (f *fakeBillStore) MarkPaid(billID string, paidAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if b, ok := f.bills[billID]; ok {
		b.Status = "paid"
		b.PaidAt = &paidAt
		return nil
	}
	return store.ErrNotFound
}

// ---- LoginAudit ----

type fakeLoginAuditStore struct {
	mu      sync.Mutex
	entries []model.LoginAudit
}

func newFakeLoginAuditStore() *fakeLoginAuditStore {
	return &fakeLoginAuditStore{}
}

func (f *fakeLoginAuditStore) RecordLoginAudit(email string, success bool, ip, userAgent string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.entries = append(f.entries, model.LoginAudit{
		Email:     email,
		Success:   success,
		IP:        ip,
		UserAgent: userAgent,
		CreatedAt: time.Now(),
	})
	return nil
}

func (f *fakeLoginAuditStore) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.entries)
}
