package database

import (
	"os"
	"strconv"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// envInt reads an integer from the environment, falling back to default
// on either an unset or unparseable value.
func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

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
	// Hardcoded at 25/10 with no override before this — fine at the
	// current zero-customer scale, but the plan's own load test measured
	// this pool saturating well before 100k devices' worth of agent
	// traffic. DB_MAX_OPEN_CONNS/DB_MAX_IDLE_CONNS let ops raise it
	// per-deployment (bounded by Postgres's own max_connections) without
	// a code change; defaults are unchanged from before.
	sqlDB.SetMaxOpenConns(envInt("DB_MAX_OPEN_CONNS", 25))
	sqlDB.SetMaxIdleConns(envInt("DB_MAX_IDLE_CONNS", 10))
	// Recycles connections periodically rather than holding them forever
	// — guards against a connection surviving a Postgres-side failover or
	// an intermediate proxy's idle timeout while looking healthy to gorm.
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

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
