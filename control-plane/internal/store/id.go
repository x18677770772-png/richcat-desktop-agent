package store

import (
	"strings"

	"github.com/google/uuid"
)

// newID 生成带前缀的唯一 ID,例如 "tn_" + uuid(去横线)。
// 对齐 init.sql 中 tn_/usr_/ag_/al_/bl_ 前缀约定。
func newID(prefix string) string {
	return prefix + strings.ReplaceAll(uuid.NewString(), "-", "")
}
