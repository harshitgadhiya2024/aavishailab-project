package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// GetScopedOrgID returns the org ID string from request context.
func GetScopedOrgID(c *gin.Context) string {
	v, exists := c.Get("scoped_org_id")
	if !exists || v == nil {
		return ""
	}
	switch id := v.(type) {
	case string:
		return id
	case uuid.UUID:
		return id.String()
	case *uuid.UUID:
		if id != nil {
			return id.String()
		}
	}
	return ""
}

// SetScopedOrgFromJWT extracts org_id from JWT claims into scoped_org_id string.
func SetScopedOrgFromJWT() gin.HandlerFunc {
	return func(c *gin.Context) {
		orgIDVal, exists := c.Get(ContextKeyOrgID)
		if !exists || orgIDVal == nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Organization context required"})
			return
		}

		var orgIDStr string
		switch v := orgIDVal.(type) {
		case *uuid.UUID:
			if v == nil {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Organization context required"})
				return
			}
			orgIDStr = v.String()
		case uuid.UUID:
			orgIDStr = v.String()
		case string:
			if v == "" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Organization context required"})
				return
			}
			orgIDStr = v
		default:
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Invalid organization context"})
			return
		}

		c.Set("scoped_org_id", orgIDStr)
		c.Next()
	}
}
