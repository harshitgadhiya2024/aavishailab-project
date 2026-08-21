package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aavishield/admin-api/internal/auth"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ctxWithRole builds a gin.Context carrying exactly what AuthRequired would
// have set, so SuperAdminFullOnly can be tested without a real JWT.
func ctxWithRole(role models.UserRole, level models.SuperAdminLevel) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/x", nil)
	c.Set(ContextKeyRole, role)
	c.Set(ContextKeyClaims, &auth.Claims{Role: role, SuperAdminLevel: level})
	return c, w
}

func TestSuperAdminFullOnlyAllowsFullLevel(t *testing.T) {
	c, w := ctxWithRole(models.RoleSuperAdmin, models.SuperAdminLevelFull)
	SuperAdminFullOnly()(c)
	if c.IsAborted() {
		t.Fatalf("expected full-level superadmin to pass, got abort status %d", w.Code)
	}
}

func TestSuperAdminFullOnlyBlocksSupportLevel(t *testing.T) {
	c, w := ctxWithRole(models.RoleSuperAdmin, models.SuperAdminLevelSupport)
	SuperAdminFullOnly()(c)
	if !c.IsAborted() {
		t.Fatal("expected support-level superadmin to be blocked from a full-only route")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestSuperAdminFullOnlyAllowsUnsetLevel(t *testing.T) {
	// A token minted before SuperAdminLevel existed carries no level claim —
	// must behave like "full" so no pre-existing session is locked out.
	c, w := ctxWithRole(models.RoleSuperAdmin, "")
	SuperAdminFullOnly()(c)
	if c.IsAborted() {
		t.Fatalf("expected unset level to be treated as full, got abort status %d", w.Code)
	}
}

func TestSuperAdminFullOnlyBlocksNonSuperAdmin(t *testing.T) {
	c, w := ctxWithRole(models.RoleOrgAdmin, "")
	SuperAdminFullOnly()(c)
	if !c.IsAborted() {
		t.Fatal("expected org_admin to be blocked from a superadmin-only route")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}
