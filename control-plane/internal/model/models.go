// Package model 定义财听猫控制面(中央管理后台)的 GORM 数据模型。
// 字段与 deploy/init.sql 中的 DDL 对齐,保证自动迁移与手写 SQL 一致。
package model

import (
	"time"

	"gorm.io/datatypes"
)

// 角色常量(RBAC)。
const (
	// RolePlatformAdmin 平台超管,可跨租户查看全局数据、管理企业。
	RolePlatformAdmin = "platform_admin"
	// RoleOwner 企业主,仅可查看本企业数据。
	RoleOwner = "owner"
	// RoleAgent 坐席/操作员,只读为主。
	RoleAgent = "agent"
)

// Tenant 租户(企业客户)。
// 对应表 tenants;site_token_hash 只存 HMAC 哈希,不存站点 Token 明文。
type Tenant struct {
	ID                string     `gorm:"column:id;type:text;primaryKey" json:"id"` // tn_ 前缀
	Name              string     `gorm:"column:name;type:text;not null" json:"name"`
	SiteTokenHash     string     `gorm:"column:site_token_hash;type:text;not null" json:"-"`
	Plan              string     `gorm:"column:plan;type:text;default:standard" json:"plan"` // community|strategic|standard|pro|flagship
	Seats             int        `gorm:"column:seats;type:int;default:5" json:"seats"`
	SubscriptionStart *time.Time `gorm:"column:subscription_start;type:timestamptz" json:"subscription_start"`
	SubscriptionEnd   *time.Time `gorm:"column:subscription_end;type:timestamptz" json:"subscription_end"`
	Status            string     `gorm:"column:status;type:text;default:active" json:"status"` // active|expired|suspended
	CreatedAt         time.Time  `gorm:"column:created_at;type:timestamptz;default:now()" json:"created_at"`
}

// TableName 指定租户表名。
func (Tenant) TableName() string { return "tenants" }

// User 控制面登录用户。
// 平台超管 tenant_id 为空(不在任何租户内)。
// 对应表 users。
type User struct {
	ID                 string     `gorm:"column:id;type:text;primaryKey" json:"id"` // usr_ 前缀
	TenantID           string     `gorm:"column:tenant_id;type:text;index" json:"tenant_id,omitempty"`
	Email              string     `gorm:"column:email;type:text;uniqueIndex;not null" json:"email"`
	PasswordHash       string     `gorm:"column:password_hash;type:text;not null" json:"-"`
	Role               string     `gorm:"column:role;type:text;not null;default:owner" json:"role"`
	FailedLogins       int        `gorm:"column:failed_logins;type:int;default:0" json:"-"`
	LockedUntil        *time.Time `gorm:"column:locked_until;type:timestamptz" json:"-"`
	LastLogin          *time.Time `gorm:"column:last_login;type:timestamptz" json:"last_login,omitempty"`
	MustChangePassword bool       `gorm:"column:must_change_password;type:boolean;default:false" json:"-"`
	CreatedAt          time.Time  `gorm:"column:created_at;type:timestamptz;default:now()" json:"created_at"`
}

// TableName 指定用户表名。
func (User) TableName() string { return "users" }

// Agent 值守机(Agent 终端)的实时/近况状态。
// 对应表 agents;runtime 为 JSONB 运行时信息,只存元数据。
type Agent struct {
	AgentID        string          `gorm:"column:agent_id;type:text;primaryKey" json:"agent_id"` // ag_ 前缀
	TenantID       string          `gorm:"column:tenant_id;type:text;not null;index" json:"tenant_id"`
	SiteID         string          `gorm:"column:site_id;type:text;not null" json:"site_id"`
	MachineIDHmac  string          `gorm:"column:machine_id_hmac;type:text;not null" json:"machine_id_hmac"`
	AgentVersion   string          `gorm:"column:agent_version;type:text" json:"agent_version"`
	Runtime        datatypes.JSON  `gorm:"column:runtime;type:jsonb" json:"runtime,omitempty"`
	Status         string          `gorm:"column:status;type:text;default:offline" json:"status"` // online|degraded|offline
	LastSeen       *time.Time      `gorm:"column:last_seen;type:timestamptz;index" json:"last_seen"`
	CPUPct         float64         `gorm:"column:cpu_pct;type:numeric" json:"cpu_pct"`
	MemPct         float64         `gorm:"column:mem_pct;type:numeric" json:"mem_pct"`
	DiskFreeGb     float64         `gorm:"column:disk_free_gb;type:numeric" json:"disk_free_gb"`
	WechatState    string          `gorm:"column:wechat_state;type:text;default:unknown" json:"wechat_state"`
	FirstSeen      time.Time       `gorm:"column:first_seen;type:timestamptz;default:now()" json:"first_seen"`
}

// TableName 指定 Agent 表名。
func (Agent) TableName() string { return "agents" }

// UsageDaily 用量日桶,按 (agent_id, day) 复合主键去重累计。
// 对应表 usage_daily。
type UsageDaily struct {
	AgentID   string    `gorm:"column:agent_id;type:text;primaryKey" json:"agent_id"`
	TenantID  string    `gorm:"column:tenant_id;type:text;not null" json:"tenant_id"`
	Day       time.Time `gorm:"column:day;type:date;primaryKey" json:"day"` // 精确到天
	Sessions  int       `gorm:"column:sessions;type:int;default:0" json:"sessions"`
	Messages  int       `gorm:"column:messages;type:int;default:0" json:"messages"`
	Replies   int       `gorm:"column:replies;type:int;default:0" json:"replies"`
	Handoffs  int       `gorm:"column:handoffs;type:int;default:0" json:"handoffs"`
	APICalls  int       `gorm:"column:api_calls;type:int;default:0" json:"api_calls"`
}

// TableName 指定用量日桶表名。
func (UsageDaily) TableName() string { return "usage_daily" }

// Alert 告警记录,用于后台告警中心与 webhook 通道。
// 对应表 alerts。
type Alert struct {
	AlertID    string     `gorm:"column:alert_id;type:text;primaryKey" json:"alert_id"` // al_ 前缀
	AgentID    string     `gorm:"column:agent_id;type:text;index" json:"agent_id"`
	TenantID   string     `gorm:"column:tenant_id;type:text;not null" json:"tenant_id"`
	Severity   string     `gorm:"column:severity;type:text;not null" json:"severity"`     // critical|major|minor|info
	Category   string     `gorm:"column:category;type:text;not null" json:"category"`     // offline|degraded|resource|model|security
	TitleSafe  string     `gorm:"column:title_safe;type:text;not null" json:"title_safe"` // 已脱敏标题
	DetailSafe string     `gorm:"column:detail_safe;type:text" json:"detail_safe"`        // 已脱敏详情
	State      string     `gorm:"column:state;type:text;default:firing" json:"state"`     // firing|resolved
	AckStatus  string     `gorm:"column:ack_status;type:text;default:unacked" json:"ack_status"` // unacked|acked|closed
	CreatedAt  time.Time  `gorm:"column:created_at;type:timestamptz;default:now()" json:"created_at"`
	ResolvedAt *time.Time `gorm:"column:resolved_at;type:timestamptz" json:"resolved_at,omitempty"`
}

// TableName 指定告警表名。
func (Alert) TableName() string { return "alerts" }

// Subscription 订阅(套餐)。本期精简实现,与 tenants 表的套餐字段可拆分维护。
// 对应表 subscriptions。
type Subscription struct {
	ID        string     `gorm:"column:id;type:text;primaryKey" json:"id"`
	TenantID  string     `gorm:"column:tenant_id;type:text;not null;index" json:"tenant_id"`
	Plan      string     `gorm:"column:plan;type:text;not null" json:"plan"`
	Seats     int        `gorm:"column:seats;type:int;not null" json:"seats"`
	StartedAt *time.Time `gorm:"column:started_at;type:timestamptz" json:"started_at"`
	EndsAt    *time.Time `gorm:"column:ends_at;type:timestamptz" json:"ends_at"`
	Status    string     `gorm:"column:status;type:text;default:active" json:"status"`
	CreatedAt time.Time  `gorm:"column:created_at;type:timestamptz;default:now()" json:"created_at"`
}

// TableName 指定订阅表名。
func (Subscription) TableName() string { return "subscriptions" }

// Bill 账单记录(人工收款,不接支付网关)。
// 对应表 bills。
type Bill struct {
	BillID     string     `gorm:"column:bill_id;type:text;primaryKey" json:"bill_id"` // bl_ 前缀
	TenantID   string     `gorm:"column:tenant_id;type:text;not null;index" json:"tenant_id"`
	Period     string     `gorm:"column:period;type:text;not null" json:"period"` // YYYY-MM
	AmountCents int       `gorm:"column:amount_cents;type:int;not null" json:"amount_cents"`
	Status     string     `gorm:"column:status;type:text;default:pending" json:"status"` // pending|paid|overdue
	Note       string     `gorm:"column:note;type:text" json:"note,omitempty"`
	CreatedAt  time.Time  `gorm:"column:created_at;type:timestamptz;default:now()" json:"created_at"`
	PaidAt     *time.Time `gorm:"column:paid_at;type:timestamptz" json:"paid_at,omitempty"`
}

// TableName 指定账单表名。
func (Bill) TableName() string { return "bills" }

// LoginAudit 登录审计日志,记录每次登录成功/失败。
// 对应表 login_audits。
type LoginAudit struct {
	ID        uint      `gorm:"column:id;type:bigserial;primaryKey;autoIncrement" json:"id"`
	Email     string    `gorm:"column:email;type:text;not null;index" json:"email"`
	Success   bool      `gorm:"column:success;type:boolean;not null" json:"success"`
	IP        string    `gorm:"column:ip;type:text" json:"ip"`
	UserAgent string    `gorm:"column:user_agent;type:text" json:"user_agent"`
	CreatedAt time.Time `gorm:"column:created_at;type:timestamptz;default:now()" json:"created_at"`
}

// TableName 指定登录审计表名。
func (LoginAudit) TableName() string { return "login_audits" }

// ResourceSnapshot 一次心跳上报的资源指标快照(仅元数据,不含客户内容)。
type ResourceSnapshot struct {
	CPUPct      float64
	MemPct      float64
	DiskFreeGb  float64
	WechatState string
	AgentVersion string
}
