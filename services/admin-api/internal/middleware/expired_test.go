package middleware

import (
	"testing"

	"github.com/aavishield/admin-api/internal/models"
)

func TestExpiredBlocks(t *testing.T) {
	exp, admin := models.OrgStatusExpired, string(models.RoleOrgAdmin)
	cases := []struct {
		name   string
		status models.OrgStatus
		method string
		path   string
		role   string
		want   bool
	}{
		{"active org writes", models.OrgStatusActive, "POST", "/api/v1/policies", admin, false},
		{"trial org writes", models.OrgStatusTrial, "PUT", "/api/v1/policies/:id", admin, false},
		{"expired reads", exp, "GET", "/api/v1/policies", admin, false},
		{"expired policy write", exp, "POST", "/api/v1/policies", admin, true},
		{"expired employee delete", exp, "DELETE", "/api/v1/employees/:id", admin, true},
		{"expired checkout", exp, "POST", "/api/v1/billing/checkout", admin, false},
		{"expired demo booking", exp, "POST", "/api/v1/demo-booking", admin, false},
		{"expired support ticket", exp, "POST", "/api/v1/tickets/:id/messages", admin, false},
		{"expired report export", exp, "POST", "/api/v1/reports/generate", admin, false},
		{"prefix must be a whole segment", exp, "POST", "/api/v1/billing-hack", admin, true},
		{"superadmin bypass", exp, "POST", "/api/v1/policies", string(models.RoleSuperAdmin), false},
	}
	for _, c := range cases {
		if got := ExpiredBlocks(c.status, c.method, c.path, c.role); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
