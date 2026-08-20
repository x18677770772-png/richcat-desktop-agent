package api

import (
	"errors"
	"net/http"
)

// apiError 携带 HTTP 状态码的业务错误,由 handler 映射为 JSON 响应。
type apiError struct {
	Status  int
	Message string
}

// Error 实现 error 接口。
func (e *apiError) Error() string { return e.Message }

// errBadRequest 400 参数错误。
func errBadRequest(msg string) error { return &apiError{Status: http.StatusBadRequest, Message: msg} }

// errNotFound 404 记录不存在。
func errNotFound(msg string) error { return &apiError{Status: http.StatusNotFound, Message: msg} }

// errForbidden 403 无权访问。
func errForbidden(msg string) error { return &apiError{Status: http.StatusForbidden, Message: msg} }

// errInternal 500 内部错误。
func errInternal(msg string) error { return &apiError{Status: http.StatusInternalServerError, Message: msg} }

// errorsAs 遍历错误链查找 *apiError。
func errorsAs(err error, target **apiError) bool {
	for err != nil {
		if ae, ok := err.(*apiError); ok {
			*target = ae
			return true
		}
		err = errors.Unwrap(err)
	}
	return false
}
