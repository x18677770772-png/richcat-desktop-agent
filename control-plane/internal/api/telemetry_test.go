package api

// 遥测上报接口测试:心跳 / 用量 / 错误 → 校验入库;站点 Token 鉴权失败 → 401。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"richcat/control-plane/internal/sitetoken"
)

func TestTelemetryHeartbeat(t *testing.T) {
	// 准备工作:创建一个租户 + 站点 Token。
	secret := "test-secret-must-be-32bytes"
	token, _ := sitetoken.Generate()
	hash := sitetoken.Hash(token, secret)

	r, deps, _ := newTestRouter(t)
	_, _ = deps.Tenants.CreateTenant("测试企业", hash, "standard", 5)

	body := `{
		"event_type": "heartbeat",
		"producer": {
			"agent_id": "ag_001",
			"site_id": "site-1",
			"machine_id_hmac": "hmac_abc",
			"agent_version": "2.0.0"
		},
		"payload": {
			"status": "online",
			"cpu_pct": 45.2,
			"mem_pct": 62.1,
			"disk_free_gb": 128.5,
			"wechat_state": "connected"
		}
	}`

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/telemetry", strings.NewReader(body))
	req.Header.Set("Authorization", bearerHeader(token))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("心跳上报应返回 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["ok"] != true {
		t.Fatal("响应应包含 ok: true")
	}

	// 验证 Agent 入库
	agent, err := deps.Agents.GetAgent("ag_001")
	if err != nil {
		t.Fatalf("获取 Agent 失败: %v", err)
	}
	if agent.Status != "online" {
		t.Fatalf("Agent 状态应为 online, got %s", agent.Status)
	}
	if agent.CPUPct != 45.2 {
		t.Fatalf("CPU 应为 45.2, got %f", agent.CPUPct)
	}
}

func TestTelemetryUsage(t *testing.T) {
	secret := "test-secret-must-be-32bytes"
	token, _ := sitetoken.Generate()
	hash := sitetoken.Hash(token, secret)

	r, deps, _ := newTestRouter(t)
	_, _ = deps.Tenants.CreateTenant("测试企业", hash, "standard", 5)

	now := time.Now().UTC().Format("2006-01-02")
	body := `{
		"event_type": "usage",
		"producer": {
			"agent_id": "ag_001",
			"site_id": "site-1",
			"machine_id_hmac": "hmac_abc"
		},
		"payload": {
			"day": "` + now + `",
			"sessions": 10,
			"messages": 50,
			"replies": 30,
			"handoffs": 2,
			"api_calls": 100
		}
	}`

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/telemetry", strings.NewReader(body))
	req.Header.Set("Authorization", bearerHeader(token))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("用量上报应返回 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestTelemetryErrorAlert(t *testing.T) {
	secret := "test-secret-must-be-32bytes"
	token, _ := sitetoken.Generate()
	hash := sitetoken.Hash(token, secret)

	r, deps, _ := newTestRouter(t)
	_, _ = deps.Tenants.CreateTenant("测试企业", hash, "standard", 5)

	body := `{
		"event_type": "error",
		"producer": {
			"agent_id": "ag_001",
			"site_id": "site-1",
			"machine_id_hmac": "hmac_abc"
		},
		"payload": {
			"code": "AGENT_CRASH",
			"title_safe": "Agent 崩溃",
			"detail_safe": "进程异常退出"
		}
	}`

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/telemetry", strings.NewReader(body))
	req.Header.Set("Authorization", bearerHeader(token))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("错误上报应返回 200, got %d: %s", w.Code, w.Body.String())
	}

	alerts, err := deps.Alerts.ListAll("")
	if err != nil {
		t.Fatalf("查询告警失败: %v", err)
	}
	if len(alerts) == 0 {
		t.Fatal("AGENT_CRASH 应产生告警")
	}
	// 非告警集的错误码应不产生告警
	body2 := `{
		"event_type": "error",
		"producer": {"agent_id": "ag_001", "site_id": "site-1", "machine_id_hmac": "hmac_abc"},
		"payload": {"code": "MINOR_WARN", "title_safe": "minor", "detail_safe": "ignore"}
	}`
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodPost, "/api/v1/telemetry", strings.NewReader(body2))
	req2.Header.Set("Authorization", bearerHeader(token))
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("非告警错误应返回 200, got %d", w2.Code)
	}
	alerts2, _ := deps.Alerts.ListAll("")
	if len(alerts2) != 1 {
		t.Fatalf("不应为新错误码产生告警, got %d 条告警(应为 1)", len(alerts2))
	}
}

func TestTelemetryInvalidSiteToken(t *testing.T) {
	r, _, _ := newTestRouter(t)
	body := `{"event_type": "heartbeat", "producer": {"agent_id": "ag_001", "site_id": "s", "machine_id_hmac": "h"}}`

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/telemetry", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer invalid-token")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("无效站点 Token 应返回 401, got %d", w.Code)
	}
}

func TestTelemetryMissingToken(t *testing.T) {
	r, _, _ := newTestRouter(t)
	body := `{"event_type": "heartbeat", "producer": {"agent_id": "ag_001", "site_id": "s", "machine_id_hmac": "h"}}`

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/telemetry", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("缺少令牌应返回 401, got %d", w.Code)
	}
}
