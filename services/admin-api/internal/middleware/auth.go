package middleware

import (
	"net/http"
	"strings"

	"github.com/aavishield/admin-api/internal/auth"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
)

const (
	ContextKeyUserID  = "user_id"
	ContextKeyOrgID   = "org_id"
	ContextKeyEmail   = "email"
	ContextKeyRole    = "role"
	ContextKeyClaims  = "claims"
)

// AuthRequired validates the JWT access token
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization token required"})
			return
		}

		claims, err := auth.ParseAccessToken(token)
		if err != nil {
			if err == auth.ErrExpiredToken {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Token expired", "code": "TOKEN_EXPIRED"})
				return
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		c.Set(ContextKeyUserID, claims.UserID)
		c.Set(ContextKeyOrgID, claims.OrgID)
		c.Set(ContextKeyEmail, claims.Email)
		c.Set(ContextKeyRole, claims.Role)
		c.Set(ContextKeyClaims, claims)
		c.Next()
	}
}

// SuperAdminOnly allows only superadmin role
func SuperAdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get(ContextKeyRole)
		r, ok := role.(models.UserRole)
		if !ok {
			if s, isStr := role.(string); isStr {
				r = models.UserRole(s)
			}
		}
		if r != models.RoleSuperAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Superadmin access required"})
			return
		}
		c.Next()
	}
}

// OrgAdminOrAbove allows org_admin and superadmin
func OrgAdminOrAbove() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get(ContextKeyRole)
		r, _ := role.(models.UserRole)
		if r != models.RoleOrgAdmin && r != models.RoleSuperAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			return
		}
		c.Next()
	}
}

// OrgScoped ensures requests are scoped to org context
// For superadmin accessing org resources via /orgs/:org_id/...
// For org users, org_id comes from JWT claims
func OrgScoped() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get(ContextKeyRole)
		r, _ := role.(models.UserRole)

		if r == models.RoleSuperAdmin {
			// Superadmin can pass org_id as path param
			orgIDParam := c.Param("org_id")
			if orgIDParam == "" {
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "org_id required for superadmin"})
				return
			}
			c.Set("scoped_org_id", orgIDParam)
		} else {
			orgID, exists := c.Get(ContextKeyOrgID)
			if !exists || orgID == nil {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Organization context required"})
				return
			}
			c.Set("scoped_org_id", orgID)
		}
		c.Next()
	}
}

// PortalRequired validates a portal employee JWT (has employee_id claim set).
func PortalRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization required"})
			return
		}

		claims, err := auth.ParseAccessToken(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			return
		}

		if claims.EmployeeID == nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Employee portal token required"})
			return
		}

		c.Set("portal_employee_id", claims.EmployeeID.String())
		c.Set("portal_org_id", claims.OrgID.String())
		c.Set(ContextKeyEmail, claims.Email)
		c.Next()
	}
}

func extractToken(c *gin.Context) string {
	header := c.GetHeader("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer ")
	}
	// Also check cookie for web clients
	if cookie, err := c.Cookie("access_token"); err == nil {
		return cookie
	}
	return ""
}

// ─── Role & permission gates ──────────────────────────────────────────────────

// roleFromContext reads the role the auth middleware stored, tolerating both
// the typed and string forms different call paths leave behind.
func roleFromContext(c *gin.Context) models.UserRole {
	raw, _ := c.Get(ContextKeyRole)
	if r, ok := raw.(models.UserRole); ok {
		return r
	}
	if s, ok := raw.(string); ok {
		return models.UserRole(s)
	}
	return ""
}

// CompanyAccess admits any signed-in member of an organization. It replaces
// OrgAdminOrAbove on the shared company routes: an analyst or a read-only
// auditor has to get *in* before per-route permission checks can decide what
// they may do. Anything more specific is a RequirePermission on the route.
func CompanyAccess() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch roleFromContext(c) {
		case models.RoleSuperAdmin, models.RoleOrgAdmin, models.RoleManager,
			models.RoleAnalyst, models.RoleReadOnly:
			c.Next()
		default:
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Organization access required"})
		}
	}
}

// RequirePermission gates a route on a single permission.
func RequirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role := roleFromContext(c)
		if !models.RoleHasPermission(role, permission) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":               "You do not have permission to do that",
				"required_permission": permission,
				"role":                string(role),
			})
			return
		}
		c.Next()
	}
}
