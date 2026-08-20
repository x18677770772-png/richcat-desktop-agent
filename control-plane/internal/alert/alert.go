package alert

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"richcat/control-plane/internal/store"
)

// AlertConfig 告警模块配置。
type AlertConfig struct {
	// OfflineThreshold 离线判定阈值(默认 15 分钟)。
	OfflineThreshold time.Duration
	// ScanInterval 扫描间隔(默认 1 分钟)。
	ScanInterval time.Duration
	// DebounceWindow 防抖窗口:同一 Agent 同类告警在此窗口内不重复轰炸(默认 30 分钟)。
	DebounceWindow time.Duration
	// WebhookURLs 钉钉/企微/飞书 webhook 地址列表(逗号分隔或切片)。
	WebhookURLs []string
	// WebhookSecret 可选:webhook 签名密钥(钉钉加签用)。
	WebhookSecret string
}

func defaultConfig(c *AlertConfig) AlertConfig {
	cfg := *c
	if cfg.OfflineThreshold <= 0 {
		cfg.OfflineThreshold = 15 * time.Minute
	}
	if cfg.ScanInterval <= 0 {
		cfg.ScanInterval = time.Minute
	}
	if cfg.DebounceWindow <= 0 {
		cfg.DebounceWindow = 30 * time.Minute
	}
	return cfg
}

// Scanner 离线检测扫描器:定期扫描 Agents 的 last_seen,超阈值且未在防抖窗口内 → 创建告警 + 通知。
// 恢复心跳后 → 自动 resolve 对应告警。
type Scanner struct {
	cfg      AlertConfig
	store    *store.Store
	notifier *Notifier
	// 防抖:agentID → 上次告警时间
	mu     sync.Mutex
	lastAt map[string]time.Time
	stopCh chan struct{}
	once   sync.Once
}

// NewScanner 创建扫描器。store 需为聚合 Store(内含 Agents/Alerts)。
func NewScanner(cfg AlertConfig, s *store.Store, n *Notifier) *Scanner {
	return &Scanner{
		cfg:      defaultConfig(&cfg),
		store:    s,
		notifier: n,
		lastAt:   make(map[string]time.Time),
		stopCh:   make(chan struct{}),
	}
}

// Start 启动后台扫描协程(每 ScanInterval 一次)。
func (s *Scanner) Start() {
	go func() {
		ticker := time.NewTicker(s.cfg.ScanInterval)
		defer ticker.Stop()
		// 启动先扫一次
		s.scan()
		for {
			select {
			case <-ticker.C:
				s.scan()
			case <-s.stopCh:
				return
			}
		}
	}()
}

// Stop 停止扫描器。
func (s *Scanner) Stop() {
	s.once.Do(func() { close(s.stopCh) })
}

// scan 执行一次扫描。
func (s *Scanner) scan() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	now := time.Now()
	agents, err := s.store.Agents.ListAll()
	if err != nil {
		log.Printf("[alert] 扫描失败(列 Agent): %v", err)
		return
	}

	for _, a := range agents {
		if a.LastSeen == nil {
			continue
		}
		offlineFor := now.Sub(*a.LastSeen)
		if offlineFor <= s.cfg.OfflineThreshold {
			// 已恢复 → 尝试 resolve 该 Agent 的 firing 离线告警
			s.resolveOffline(ctx, a.AgentID, a.TenantID)
			continue
		}
		s.handleOffline(ctx, a.AgentID, a.TenantID, offlineFor)
	}
}

// handleOffline Agent 离线超阈值 → 防抖后创建告警并通知。
func (s *Scanner) handleOffline(ctx context.Context, agentID, tenantID string, offlineFor time.Duration) {
	s.mu.Lock()
	last, dup := s.lastAt[agentID]
	now := time.Now()
	if dup && now.Sub(last) < s.cfg.DebounceWindow {
		s.mu.Unlock()
		return // 防抖窗口内,不重复
	}
	s.lastAt[agentID] = now
	s.mu.Unlock()

	title := "Agent 离线超过 15 分钟"
	detail := fmt.Sprintf("agent=%s last_seen=%s", agentID, now.Add(-offlineFor).Format(time.RFC3339))
	alertID, err := s.store.Alerts.CreateOfflineAlert(agentID, tenantID, title, detail)
	if err != nil {
		log.Printf("[alert] 创建离线告警失败 agent=%s: %v", agentID, err)
		return
	}
	log.Printf("[alert] 离线告警 agent=%s alert=%s", agentID, alertID)

	if s.notifier != nil {
		go s.notifier.SendOffline(agentID, title, detail)
	}
}

// resolveOffline Agent 恢复心跳 → 将其 firing 离线告警置为 resolved 并通知。
func (s *Scanner) resolveOffline(ctx context.Context, agentID, tenantID string) {
	s.mu.Lock()
	delete(s.lastAt, agentID)
	s.mu.Unlock()

	resolved, err := s.store.Alerts.ResolveOfflineByAgent(agentID)
	if err != nil {
		log.Printf("[alert] resolve 离线告警失败 agent=%s: %v", agentID, err)
		return
	}
	if resolved > 0 && s.notifier != nil {
		go s.notifier.SendResolved(agentID)
	}
}

// Notifier webhook 通知器:推送到钉钉/企微/飞书。
type Notifier struct {
	urls   []string
	secret string
	client *http.Client
}

// NewNotifier 创建通知器。
func NewNotifier(urls []string, secret string) *Notifier {
	return &Notifier{
		urls:   urls,
		secret: secret,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// SendOffline 发送离线告警通知。
func (n *Notifier) SendOffline(agentID, title, detail string) {
	n.send(title, "离线告警", detail, "critical")
}

// SendResolved 发送恢复通知。
func (n *Notifier) SendResolved(agentID string) {
	n.send("Agent 已恢复在线", "恢复通知", "agent="+agentID, "ok")
}

// send 构造通用的 webhook 文本消息(钉钉/企微/飞书 markdown 兼容)。
func (n *Notifier) send(title, text, detail, level string) {
	if n == nil || len(n.urls) == 0 {
		return
	}
	payload := map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": title,
			"text":  fmt.Sprintf("## %s\n\n%s\n\n`%s`", title, text, detail),
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	for _, u := range n.urls {
		go func(url string) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
			if err != nil {
				return
			}
			req.Header.Set("Content-Type", "application/json")
			resp, err := n.client.Do(req)
			if err != nil {
				log.Printf("[alert] webhook 发送失败 %s: %v", url, err)
				return
			}
			defer resp.Body.Close()
		}(u)
	}
}
