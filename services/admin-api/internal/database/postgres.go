package database

import (
	"os"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func ConnectPostgres() (*gorm.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=aavishield password=aavishield_dev_password dbname=aavishield port=6432 sslmode=disable"
	}

	logLevel := logger.Silent
	if os.Getenv("APP_ENV") == "development" {
		logLevel = logger.Info
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:                                   logger.Default.LogMode(logLevel),
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(10)

	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&models.Organization{},
		&models.User{},
		&models.UserTeam{},
		&models.MFARecoveryCode{},
		&models.EmailOTP{},
		&models.RefreshToken{},
		&models.EmployeeRefreshToken{},
		&models.PasswordResetToken{},
		&models.Team{},
		&models.Employee{},
		&models.Device{},
		&models.Policy{},
		&models.PolicyAssignment{},
		&models.DomainRule{},
		&models.ActivityEvent{},
		&models.AIChatSession{},
		&models.AIChatMessage{},
		&models.AuditLog{},
		&models.URLCategory{},
		&models.EnrollmentToken{},
		&models.AgentToken{},
		&models.ThreatIntelDomain{},
		&models.DomainRiskAssessment{},
		&models.OrgCACert{},
		&models.CategoryDomain{},
		&models.CategoryDomainExclusion{},
		&models.CASBRule{},
		&models.ManagedApplication{},
		&models.AppControlRule{},
		&models.EnforcementSchedule{},
		&models.WorkSession{},
		&models.Screenshot{},
		&models.ScreenshotSettings{},
		&models.AccessRequest{},
	)
}
