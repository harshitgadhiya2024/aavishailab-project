package handlers

import (
	"fmt"

	"github.com/aavishield/admin-api/internal/auth"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"time"
)

// issueSession mints the access + refresh pair and records the sign-in. Every
// path that completes an authentication (password-only, TOTP, emailed code,
// registration) ends here, so a session is created exactly one way.
func issueSession(db *gorm.DB, user *models.User, c *gin.Context) (gin.H, error) {
	accessToken, _, err := auth.GenerateAccessToken(user)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token")
	}
	plainRefresh, hashedRefresh, err := auth.GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate refresh token")
	}
	if err := db.Create(&models.RefreshToken{
		UserID:     user.ID,
		TokenHash:  hashedRefresh,
		ExpiresAt:  auth.RefreshExpiry(),
		IPAddress:  c.ClientIP(),
		DeviceInfo: c.GetHeader("User-Agent"),
	}).Error; err != nil {
		return nil, fmt.Errorf("failed to store refresh token")
	}
	db.Model(user).Update("last_login_at", time.Now())

	resp := buildAuthResponseWithAccess(db, user, accessToken, plainRefresh)
	return gin.H{
		"access_token":  resp.AccessToken,
		"refresh_token": resp.RefreshToken,
		"expires_in":    resp.ExpiresIn,
		"user":          resp.User,
	}, nil
}

// uniqueOrgSlug turns a company name into a slug nobody else holds.
func uniqueOrgSlug(db *gorm.DB, companyName string) string {
	base := slugify(companyName)
	if base == "" {
		return ""
	}
	slug := base
	for i := 2; ; i++ {
		var count int64
		db.Model(&models.Organization{}).Where("slug = ?", slug).Count(&count)
		if count == 0 {
			return slug
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
}
