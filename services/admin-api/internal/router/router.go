package router

import (
	"net/http"
	"os"
	"time"

	"github.com/aavishield/admin-api/internal/handlers"
	"github.com/aavishield/admin-api/internal/metrics"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/policysig"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"gorm.io/gorm"
)

func Setup(db *gorm.DB, rdb *redis.Client) *gin.Engine {
	if os.Getenv("APP_ENV") == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(otelgin.Middleware("admin-api"))
	r.Use(metrics.Middleware())

	// CORS — allow company/superadmin/employee frontends (local + tunnel hosts)
	r.Use(cors.New(cors.Config{
		AllowOrigins:     middleware.AllowedOrigins(),
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "Accept", "x-org-id", "X-Org-Id"},
		ExposeHeaders:    []string{"Content-Disposition", "Content-Length"},
		AllowCredentials: true,
	}))

	// ─── Handlers ────────────────────────────────────────────────────────────
	wsHub := handlers.NewWebSocketHub()
	authH := handlers.NewAuthHandler(db)
	empH := handlers.NewEmployeeHandler(db)
	teamH := handlers.NewTeamHandler(db)
	policyH := handlers.NewPolicyHandler(db)
	actH := handlers.NewActivityHandler(db, wsHub)
	orgH := handlers.NewOrgHandler(db)
	swgH := handlers.NewSWGHandler(db)
	policySigner := policysig.New()
	agentH := handlers.NewAgentHandler(db, wsHub, rdb, policySigner)
	portalH := handlers.NewPortalHandler(db, wsHub)
	arH := handlers.NewAccessRequestHandler(db)
	shadowH := handlers.NewShadowITHandler(db)
	casbH := handlers.NewCASBHandler(db)
	catH := handlers.NewCategoryHandler(db)
	repH := handlers.NewReportHandler(db)
	aiH := handlers.NewAIChatHandler(db)
	orgUserH := handlers.NewOrgUserHandler(db)
	mfaH := handlers.NewMFAHandler(db)
	otpH := handlers.NewOTPHandler(db)
	companyH := handlers.NewCompanyHandler(db)
	appH := handlers.NewAppControlHandler(db)
	enfH := handlers.NewEnforcementHandler(db)
	monH := handlers.NewMonitoringHandler(db)
	monIngestH := handlers.NewMonitoringIngestHandler(db, agentH)
	agentPkgH := handlers.NewAgentPackageAdminHandler(db)
	ciH := handlers.NewCITriggerHandler()
	appCatalogH := handlers.NewAppCatalogAdminHandler(db)
	auditH := handlers.NewAuditHandler(db)
	saTeamH := handlers.NewSuperAdminTeamHandler(db)
	settingsH := handlers.NewPlatformSettingsHandler(db)
	healthH := handlers.NewPlatformHealthHandler()
	seatAlertH := handlers.NewSeatAlertHandler(db)
	billingH := handlers.NewBillingHandler(db)
	impersonateH := handlers.NewImpersonationHandler(db)
	blocklistH := handlers.NewGlobalBlocklistHandler(db)
	announceH := handlers.NewAnnouncementHandler(db)
	flagH := handlers.NewFeatureFlagHandler(db)
	complianceH := handlers.NewComplianceHandler(db)
	revenueH := handlers.NewRevenueAnalyticsHandler(db)
	ticketH := handlers.NewTicketHandler(db)

	// ─── Agent script + native packages (public — used by installers) ──────────
	r.GET("/agent/aavishield-agent.py", handlers.ServeAgentScript)

	// Screenshot images stored on local disk are served here — public, but
	// each URL carries a short-lived HMAC over key+expiry. R2-backed images
	// never hit this; their signed URLs point straight at the bucket.
	r.GET("/media/screenshot", handlers.ServeMedia)
	r.GET("/agent/packages/:file", handlers.ServeAgentPackage)

	// Publishes a newly built native package (called by the agent-packages CI
	// workflow). Auth is its own bearer token, not portal/agent auth — see
	// handlers.UploadAgentPackage.
	r.POST("/internal/admin/agent-packages", handlers.UploadAgentPackage)

	// Razorpay calls this directly — no session, gated entirely on the
	// X-Razorpay-Signature header verified inside the handler.
	r.POST("/webhooks/razorpay", billingH.Webhook)

	// ─── Health ───────────────────────────────────────────────────────────────
	r.GET("/health", func(c *gin.Context) {
		sqlDB, _ := db.DB()
		dbOk := sqlDB.Ping() == nil
		redisOk := rdb.Ping(c.Request.Context()).Err() == nil
		status := "healthy"
		if !dbOk || !redisOk {
			status = "degraded"
		}
		c.JSON(http.StatusOK, gin.H{
			"status":   status,
			"service":  "admin-api",
			"database": dbOk,
			"redis":    redisOk,
		})
	})

	// ─── Metrics ──────────────────────────────────────────────────────────────
	r.GET("/metrics", metrics.Handler)

	// ─── WebSocket ────────────────────────────────────────────────────────────
	r.GET("/ws", wsHub.Serve)

	// ─── Auth (public) ────────────────────────────────────────────────────────
	// Rate-limited per IP: before this, login/register/OTP had no throttle at
	// all, on a service whose whole job is guarding access. Limits are per
	// minute; register/OTP endpoints that send email are stricter since each
	// hit has a real-world cost (an email sent) beyond CPU.
	loginLimit := middleware.RateLimit(rdb, "login", 20, time.Minute)
	otpLimit := middleware.RateLimit(rdb, "otp", 10, time.Minute)
	registerLimit := middleware.RateLimit(rdb, "register", 5, time.Minute)

	auth := r.Group("/api/v1/auth")
	{
		auth.POST("/login", loginLimit, authH.Login)
		auth.POST("/register", registerLimit, authH.Register)
		auth.POST("/refresh", authH.Refresh)
		auth.POST("/forgot-password", registerLimit, authH.ForgotPassword)
		auth.POST("/reset-password", authH.ResetPassword)
		auth.POST("/social", loginLimit, authH.SocialLogin)
		// Consumed by company-dashboard's own NextAuth backend, not a
		// browser — gated on X-Internal-Secret inside the handler, same as
		// /social above.
		auth.POST("/impersonate/consume", authH.ImpersonateConsume)
		// Second step of signing in: public, but only usable with the
		// short-lived challenge token the password step handed back.
		auth.POST("/mfa/verify", otpLimit, mfaH.Verify)
		// The emailed-code equivalent, for accounts without an authenticator.
		auth.POST("/otp/verify", otpLimit, otpH.VerifyLogin)
		auth.POST("/otp/resend", otpLimit, otpH.ResendLogin)
		// Registration is code-first: nothing is created until the address is
		// proven, so these replace a direct POST /register.
		auth.POST("/register/start", registerLimit, otpH.StartRegistration)
		auth.POST("/register/resend", registerLimit, otpH.ResendRegistration)
		auth.POST("/register/verify", otpLimit, otpH.VerifyRegistration)

		authProtected := auth.Group("")
		authProtected.Use(middleware.AuthRequired())
		{
			authProtected.POST("/logout", authH.Logout)
			authProtected.GET("/me", authH.Me)
			authProtected.PUT("/profile", authH.UpdateProfile)
			authProtected.POST("/change-password", authH.ChangePassword)
			// Enrolment and management of the user's own second factor.
			authProtected.GET("/mfa/status", mfaH.Status)
			authProtected.POST("/mfa/setup", mfaH.Setup)
			authProtected.POST("/mfa/enable", mfaH.Enable)
			authProtected.POST("/mfa/disable", mfaH.Disable)
			authProtected.POST("/mfa/recovery-codes", mfaH.RegenerateRecoveryCodes)
		}
	}

	// ─── API v1 (requires auth) ───────────────────────────────────────────────
	v1 := r.Group("/api/v1")
	v1.Use(middleware.AuthRequired())

	// Platform-wide, not org-scoped — every signed-in user (any role, any
	// panel) should see an active incident/maintenance notice.
	v1.GET("/announcements/active", announceH.Active)

	// ─── Superadmin routes ────────────────────────────────────────────────────
	superadmin := v1.Group("/superadmin")
	superadmin.Use(middleware.SuperAdminOnly())
	{
		superadmin.GET("/stats", orgH.Stats)
		superadmin.GET("/audit-log", auditH.List)
		superadmin.GET("/system-health", healthH.Get)
		superadmin.GET("/settings", settingsH.Get)
		superadmin.PUT("/settings/:key", middleware.SuperAdminFullOnly(), settingsH.Update)
		superadmin.GET("/seat-alerts", seatAlertH.List)
		superadmin.GET("/revenue-analytics", revenueH.Get)

		orgs := superadmin.Group("/organizations")
		{
			orgs.GET("", orgH.List)
			orgs.POST("", middleware.SuperAdminFullOnly(), orgH.Create)
			orgs.GET("/:id", orgH.Get)
			orgs.PUT("/:id", middleware.SuperAdminFullOnly(), orgH.Update)
			orgs.DELETE("/:id", middleware.SuperAdminFullOnly(), orgH.Delete)
			orgs.GET("/:id/export", complianceH.Export)
			orgs.POST("/:id/purge", middleware.SuperAdminFullOnly(), complianceH.Purge)
			orgs.POST("/:id/impersonate", middleware.SuperAdminFullOnly(), impersonateH.Start)
			orgs.GET("/:id/billing", billingH.ListForOrg)
			orgs.POST("/:id/billing", middleware.SuperAdminFullOnly(), billingH.Create)
		}

		billing := superadmin.Group("/billing")
		{
			billing.GET("", billingH.List)
			billing.POST("/:id/refresh", billingH.Refresh)
			billing.DELETE("/:id", middleware.SuperAdminFullOnly(), billingH.Cancel)
		}

		blocklist := superadmin.Group("/blocklist")
		{
			blocklist.GET("", blocklistH.List)
			blocklist.POST("", middleware.SuperAdminFullOnly(), blocklistH.Create)
			blocklist.PATCH("/:id", middleware.SuperAdminFullOnly(), blocklistH.Toggle)
			blocklist.DELETE("/:id", middleware.SuperAdminFullOnly(), blocklistH.Delete)
		}
		superadmin.GET("/threat-feeds", blocklistH.FeedStatus)

		announcements := superadmin.Group("/announcements")
		{
			announcements.GET("", announceH.List)
			announcements.POST("", middleware.SuperAdminFullOnly(), announceH.Create)
			announcements.PATCH("/:id", middleware.SuperAdminFullOnly(), announceH.Update)
			announcements.DELETE("/:id", middleware.SuperAdminFullOnly(), announceH.Delete)
		}

		flags := superadmin.Group("/feature-flags")
		{
			flags.GET("", flagH.List)
			flags.POST("", middleware.SuperAdminFullOnly(), flagH.Create)
			flags.PATCH("/:id", middleware.SuperAdminFullOnly(), flagH.Update)
			flags.DELETE("/:id", middleware.SuperAdminFullOnly(), flagH.Delete)
			flags.PUT("/:id/orgs/:org_id", middleware.SuperAdminFullOnly(), flagH.SetOrgOverride)
			flags.DELETE("/:id/orgs/:org_id", middleware.SuperAdminFullOnly(), flagH.RemoveOrgOverride)
		}

		saTickets := superadmin.Group("/tickets")
		{
			saTickets.GET("", ticketH.List)
			saTickets.POST("", ticketH.CreateInternal)
			saTickets.GET("/:id", ticketH.GetAny)
			saTickets.PATCH("/:id", ticketH.UpdateStatus)
			saTickets.POST("/:id/messages", ticketH.AddMessageAny)
		}

		agentPkgs := superadmin.Group("/agent-packages")
		{
			agentPkgs.GET("", agentPkgH.Manifest)
			agentPkgs.GET("/history", agentPkgH.History)
			agentPkgs.POST("", middleware.SuperAdminFullOnly(), agentPkgH.Upload)
			agentPkgs.POST("/rollback", middleware.SuperAdminFullOnly(), agentPkgH.Rollback)
			agentPkgs.POST("/trigger-build", middleware.SuperAdminFullOnly(), ciH.TriggerBuild)
			agentPkgs.GET("/build-status", ciH.BuildStatus)
		}

		catalog := superadmin.Group("/applications")
		{
			catalog.GET("", appCatalogH.List)
			catalog.POST("", middleware.SuperAdminFullOnly(), appCatalogH.Create)
			catalog.PATCH("/:id", middleware.SuperAdminFullOnly(), appCatalogH.Update)
			catalog.DELETE("/:id", middleware.SuperAdminFullOnly(), appCatalogH.Delete)
			catalog.POST("/:id/icon", middleware.SuperAdminFullOnly(), appCatalogH.UploadIcon)
		}

		saTeam := superadmin.Group("/team")
		{
			saTeam.GET("", saTeamH.List)
			saTeam.POST("", middleware.SuperAdminFullOnly(), saTeamH.Create)
			saTeam.PATCH("/:id", middleware.SuperAdminFullOnly(), saTeamH.Update)
			saTeam.DELETE("/:id", middleware.SuperAdminFullOnly(), saTeamH.Delete)
		}
	}

	// ─── Company routes (org-scoped) ──────────────────────────────────────────
	company := v1.Group("")
	// Any org member may enter; each route below states the permission it needs.
	company.Use(middleware.CompanyAccess())
	company.Use(middleware.SetScopedOrgFromJWT())

	// Employees (+ enrollment token sub-routes)
	emps := company.Group("/employees")
	{
		emps.GET("", middleware.RequirePermission(models.PermEmployeesRead), empH.List)
		emps.POST("", middleware.RequirePermission(models.PermEmployeesWrite), empH.Create)
		emps.GET("/departments", middleware.RequirePermission(models.PermEmployeesRead), empH.Departments)
		emps.GET("/export", middleware.RequirePermission(models.PermEmployeesRead), empH.ExportCSV)
		emps.POST("/import", middleware.RequirePermission(models.PermEmployeesWrite), empH.ImportCSV)
		emps.DELETE("/bulk", middleware.RequirePermission(models.PermEmployeesWrite), empH.BulkDelete)
		emps.GET("/:id", middleware.RequirePermission(models.PermEmployeesRead), empH.Get)
		emps.PUT("/:id", middleware.RequirePermission(models.PermEmployeesWrite), empH.Update)
		emps.DELETE("/:id", middleware.RequirePermission(models.PermEmployeesWrite), empH.Delete)
		emps.GET("/:id/activity", middleware.RequirePermission(models.PermActivityRead), empH.GetActivity)
		emps.POST("/:id/portal-password", middleware.RequirePermission(models.PermEmployeesWrite), portalH.SetPortalPassword)
		// Device enrollment tokens
		emps.POST("/:id/enrollment-token", middleware.RequirePermission(models.PermDevicesWrite), agentH.GenerateEnrollmentToken)
		emps.GET("/:id/enrollment-tokens", middleware.RequirePermission(models.PermDevicesRead), agentH.ListEnrollmentTokens)
	}

	// Devices
	devices := company.Group("/devices")
	{
		devices.GET("", middleware.RequirePermission(models.PermDevicesRead), agentH.ListDevices)
		devices.GET("/:id", middleware.RequirePermission(models.PermDevicesRead), agentH.GetDevice)
		devices.DELETE("/:id", middleware.RequirePermission(models.PermDevicesWrite), agentH.RevokeDevice)
		// Working hours: which device is company-owned vs personal, and when
		// its agent is allowed to enforce.
		devices.PATCH("/:id", middleware.RequirePermission(models.PermDevicesWrite), enfH.SetDeviceOwnership)
		devices.GET("/:id/enforcement", middleware.RequirePermission(models.PermDevicesRead), enfH.GetDeviceEnforcement)
		devices.PUT("/:id/schedule", middleware.RequirePermission(models.PermDevicesWrite), enfH.PutDeviceSchedule)
		devices.DELETE("/:id/schedule", middleware.RequirePermission(models.PermDevicesWrite), enfH.DeleteDeviceSchedule)
	}

	// Teams
	teams := company.Group("/teams")
	{
		teams.GET("", middleware.RequirePermission(models.PermTeamsRead), teamH.List)
		teams.POST("", middleware.RequirePermission(models.PermTeamsWrite), teamH.Create)
		teams.GET("/:id", middleware.RequirePermission(models.PermTeamsRead), teamH.Get)
		teams.PUT("/:id", middleware.RequirePermission(models.PermTeamsWrite), teamH.Update)
		teams.PUT("/:id/schedule", middleware.RequirePermission(models.PermTeamsWrite), enfH.PutTeamSchedule)
		teams.DELETE("/:id/schedule", middleware.RequirePermission(models.PermTeamsWrite), enfH.DeleteTeamSchedule)
		teams.DELETE("/:id", middleware.RequirePermission(models.PermTeamsWrite), teamH.Delete)
		teams.GET("/:id/members", middleware.RequirePermission(models.PermTeamsRead), teamH.GetMembers)
		teams.POST("/:id/employees", middleware.RequirePermission(models.PermTeamsWrite), teamH.AssignEmployees)
		teams.DELETE("/:id/employees/:emp_id", middleware.RequirePermission(models.PermTeamsWrite), teamH.RemoveEmployee)
	}

	// Policies
	policies := company.Group("/policies")
	{
		policies.GET("", middleware.RequirePermission(models.PermPoliciesRead), policyH.List)
		policies.POST("", middleware.RequirePermission(models.PermPoliciesWrite), policyH.Create)
		policies.GET("/types", middleware.RequirePermission(models.PermPoliciesRead), policyH.GetTypes)
		policies.GET("/export", middleware.RequirePermission(models.PermPoliciesRead), policyH.Export)
		policies.POST("/import", middleware.RequirePermission(models.PermPoliciesWrite), policyH.Import)
		policies.GET("/:id", middleware.RequirePermission(models.PermPoliciesRead), policyH.Get)
		policies.PUT("/:id", middleware.RequirePermission(models.PermPoliciesWrite), policyH.Update)
		policies.DELETE("/:id", middleware.RequirePermission(models.PermPoliciesWrite), policyH.Delete)
		policies.PATCH("/:id/toggle", middleware.RequirePermission(models.PermPoliciesWrite), policyH.Toggle)
		policies.POST("/:id/toggle", middleware.RequirePermission(models.PermPoliciesWrite), policyH.Toggle)
		policies.POST("/:id/duplicate", middleware.RequirePermission(models.PermPoliciesWrite), policyH.Duplicate)
		policies.POST("/:id/assign", middleware.RequirePermission(models.PermPoliciesWrite), policyH.Assign)
		policies.GET("/:id/resolved-domains", middleware.RequirePermission(models.PermPoliciesRead), policyH.ResolvedDomains)
		policies.GET("/:id/blocked-employees", middleware.RequirePermission(models.PermPoliciesRead), arH.BlockedEmployees)
	}

	// Working-hours enforcement. Org-wide default plus team overrides; the
	// per-device override lives under /devices above.
	// Time-and-activity monitoring (screenshots + activity).
	monitoring := company.Group("/monitoring")
	{
		monitoring.GET("/screenshots", middleware.RequirePermission(models.PermMonitoringRead), monH.Screenshots)
		monitoring.GET("/employees", middleware.RequirePermission(models.PermMonitoringRead), monH.Employees)
		monitoring.GET("/settings", middleware.RequirePermission(models.PermSettingsRead), monH.GetSettings)
		monitoring.PUT("/settings", middleware.RequirePermission(models.PermSettingsWrite), monH.UpdateSettings)
		monitoring.DELETE("/sessions/:id", middleware.RequirePermission(models.PermMonitoringDeleteSes), monH.DeleteSession)
		monitoring.DELETE("/screenshots/:id", middleware.RequirePermission(models.PermMonitoringDeleteImg), monH.DeleteScreenshot)
	}

	enforcement := company.Group("/enforcement")
	{
		enforcement.GET("/schedule", middleware.RequirePermission(models.PermSettingsRead), enfH.GetOrgSchedule)
		enforcement.PUT("/schedule", middleware.RequirePermission(models.PermSettingsWrite), enfH.PutOrgSchedule)
		enforcement.DELETE("/schedule", middleware.RequirePermission(models.PermSettingsWrite), enfH.DeleteOrgSchedule)
		enforcement.GET("/schedules", middleware.RequirePermission(models.PermSettingsRead), enfH.ListSchedules)
	}

	// Application control — blocking software, not just websites. Governed by
	// the policy permissions: deciding which apps may run is the same class of
	// decision as deciding which sites may load.
	apps := company.Group("/applications")
	{
		apps.GET("/catalog", middleware.RequirePermission(models.PermPoliciesRead), appH.Catalog)
		apps.GET("/rules", middleware.RequirePermission(models.PermPoliciesRead), appH.ListRules)
		apps.POST("/rules", middleware.RequirePermission(models.PermPoliciesWrite), appH.CreateRule)
		apps.PATCH("/rules/:id", middleware.RequirePermission(models.PermPoliciesWrite), appH.UpdateRule)
		apps.DELETE("/rules/:id", middleware.RequirePermission(models.PermPoliciesWrite), appH.DeleteRule)
		apps.GET("/events", middleware.RequirePermission(models.PermActivityRead), appH.Events)
		apps.POST("", middleware.RequirePermission(models.PermPoliciesWrite), appH.CreateApplication)
		apps.DELETE("/:id", middleware.RequirePermission(models.PermPoliciesWrite), appH.DeleteApplication)
	}

	// DLP — dashboard "test a sample" tool (runs pasted text through the org's
	// DLP scoring without persisting anything).
	dlpGroup := company.Group("/dlp")
	{
		dlpGroup.POST("/test", middleware.RequirePermission(models.PermPoliciesRead), policyH.TestDLP)
	}

	// Shadow IT — discovered SaaS/cloud apps from activity + sanction control.
	shadowIT := company.Group("/shadow-it")
	{
		shadowIT.GET("/apps", middleware.RequirePermission(models.PermShadowITRead), shadowH.DiscoveredApps)
		shadowIT.POST("/apps/sanction", middleware.RequirePermission(models.PermShadowITWrite), shadowH.Sanction)
	}

	// CASB — inline app-control + out-of-band cloud share analysis.
	casb := company.Group("/casb")
	{
		casb.POST("/app-control", middleware.RequirePermission(models.PermCASBRead), casbH.AppControl)
		casb.POST("/oob/analyze", middleware.RequirePermission(models.PermCASBRead), casbH.OOBAnalyze)
		// Org-authored app-control rules, evaluated before the built-in defaults.
		casb.GET("/rules", middleware.RequirePermission(models.PermCASBRead), casbH.ListRules)
		casb.POST("/rules", middleware.RequirePermission(models.PermCASBWrite), casbH.CreateRule)
		casb.PUT("/rules/:id", middleware.RequirePermission(models.PermCASBWrite), casbH.UpdateRule)
		casb.PATCH("/rules/:id/toggle", middleware.RequirePermission(models.PermCASBWrite), casbH.ToggleRule)
		casb.DELETE("/rules/:id", middleware.RequirePermission(models.PermCASBWrite), casbH.DeleteRule)
	}

	// Reports & analytics — dashboard figures and the exportable report set.
	reports := company.Group("/reports")
	{
		reports.GET("/overview", middleware.RequirePermission(models.PermReportsRead), repH.Overview)
		reports.GET("/catalog", middleware.RequirePermission(models.PermReportsRead), repH.Catalog)
		reports.GET("/:type", middleware.RequirePermission(models.PermReportsRead), repH.Report)
	}

	// AI assistant conversations (the AI service is stateless; threads live here)
	aiChat := company.Group("/ai")
	{
		aiChat.Use(middleware.RequirePermission(models.PermAIUse))
		aiChat.GET("/sessions", aiH.ListSessions)
		aiChat.POST("/sessions", aiH.CreateSession)
		aiChat.GET("/sessions/:id", aiH.GetSession)
		aiChat.PATCH("/sessions/:id", aiH.UpdateSession)
		aiChat.DELETE("/sessions/:id", aiH.DeleteSession)
		aiChat.POST("/sessions/:id/messages", aiH.AddMessage)
	}

	// The organization's own profile and preferences.
	organization := company.Group("/organization")
	{
		organization.GET("", middleware.RequirePermission(models.PermSettingsRead), companyH.Get)
		organization.PUT("", middleware.RequirePermission(models.PermSettingsWrite), companyH.Update)
		organization.GET("/timezones", middleware.RequirePermission(models.PermSettingsRead), companyH.Timezones)
		organization.PUT("/notifications", middleware.RequirePermission(models.PermSettingsWrite), companyH.UpdateNotifications)
	}

	// Dashboard users: who else can sign in, with which role and teams.
	orgUsers := company.Group("/users")
	{
		orgUsers.GET("", middleware.RequirePermission(models.PermUsersRead), orgUserH.List)
		orgUsers.POST("", middleware.RequirePermission(models.PermUsersWrite), orgUserH.Create)
		orgUsers.PUT("/:id", middleware.RequirePermission(models.PermUsersWrite), orgUserH.Update)
		orgUsers.DELETE("/:id", middleware.RequirePermission(models.PermUsersWrite), orgUserH.Delete)
	}

	// Activity
	activity := company.Group("/activity")
	{
		activity.GET("", middleware.RequirePermission(models.PermActivityRead), actH.List)
		activity.GET("/stats", middleware.RequirePermission(models.PermActivityRead), actH.Stats)
		activity.POST("", actH.Create)
		activity.POST("/bulk", actH.BulkCreate)
	}

	// SWG
	swg := company.Group("/swg")
	{
		swg.GET("/rules", middleware.RequirePermission(models.PermSWGRead), swgH.ListDomainRules)
		swg.POST("/rules", middleware.RequirePermission(models.PermSWGWrite), swgH.CreateDomainRule)
		swg.DELETE("/rules/:id", middleware.RequirePermission(models.PermSWGWrite), swgH.DeleteDomainRule)
		swg.GET("/categories", middleware.RequirePermission(models.PermCategoriesRead), swgH.ListCategories)
		swg.GET("/stats", middleware.RequirePermission(models.PermSWGRead), swgH.Stats)
		swg.POST("/check", middleware.RequirePermission(models.PermSWGRead), swgH.CheckURLDashboard)
		swg.GET("/threat-lookup", middleware.RequirePermission(models.PermSWGRead), swgH.ThreatLookup)
	}

	// URL categories — the shipped category lists plus this org's own
	// additions/removals, which is what category-based policies resolve to.
	categories := company.Group("/categories")
	{
		categories.GET("", middleware.RequirePermission(models.PermCategoriesRead), catH.List)
		categories.GET("/:id/domains", middleware.RequirePermission(models.PermCategoriesRead), catH.ListDomains)
		categories.POST("/:id/domains", middleware.RequirePermission(models.PermCategoriesWrite), catH.AddDomains)
		categories.DELETE("/:id/domains", middleware.RequirePermission(models.PermCategoriesWrite), catH.DeleteDomain)
	}

	// SSL Inspection (org-level MITM config, needed for DLP over HTTPS)
	settings := company.Group("/settings")
	{
		// Org-wide MFA requirement — managing who may sign in is user
		// administration, so it takes users:write rather than settings:write.
		settings.GET("/mfa", middleware.RequirePermission(models.PermUsersRead), mfaH.GetOrgPolicy)
		settings.PUT("/mfa", middleware.RequirePermission(models.PermUsersWrite), mfaH.SetOrgPolicy)
		settings.GET("/mitm", middleware.RequirePermission(models.PermSettingsRead), agentH.GetMITMSettings)
		settings.PUT("/mitm", middleware.RequirePermission(models.PermSettingsWrite), agentH.UpdateMITMSettings)
		// Guided bypass workflow: search a platform, get its sensitive/internal
		// hostnames (curated + what this org actually saw), pick a few.
		settings.GET("/mitm/platforms", middleware.RequirePermission(models.PermSettingsRead), agentH.ListBypassPlatforms)
		settings.GET("/mitm/discover", middleware.RequirePermission(models.PermSettingsRead), agentH.DiscoverBypassDomains)
	}

	// Access requests (employee-requested exceptions to a blocking policy)
	accessRequests := company.Group("/access-requests")
	{
		accessRequests.GET("", middleware.RequirePermission(models.PermAccessReqRead), arH.List)
		accessRequests.POST("/:id/approve", middleware.RequirePermission(models.PermAccessReqWrite), arH.Approve)
		accessRequests.POST("/:id/deny", middleware.RequirePermission(models.PermAccessReqWrite), arH.Deny)
	}

	// Support tickets — any signed-in org member may raise and follow one;
	// no specific permission gates it, the same way every role can ask a
	// human for help regardless of what they're otherwise allowed to change.
	tickets := company.Group("/tickets")
	{
		tickets.GET("", ticketH.ListForOrg)
		tickets.POST("", ticketH.Create)
		tickets.GET("/:id", ticketH.Get)
		tickets.POST("/:id/messages", ticketH.AddMessage)
	}

	// ─── Employee Portal (employee JWT) ───────────────────────────────────────
	portal := r.Group("/api/v1/portal")
	{
		portal.POST("/login", loginLimit, portalH.Login)
		portal.POST("/signup", registerLimit, portalH.Signup)
		portal.POST("/refresh", portalH.Refresh)
		portal.POST("/forgot-password", registerLimit, portalH.ForgotPassword)
		portal.POST("/reset-password", portalH.ResetPassword)
		portal.POST("/social", loginLimit, portalH.SocialLogin)

		portalProtected := portal.Group("")
		portalProtected.Use(middleware.PortalRequired())
		{
			portalProtected.GET("/me", portalH.Me)
			portalProtected.GET("/download/:os", portalH.DownloadInstaller)
			portalProtected.GET("/uninstall/:os", portalH.DownloadUninstaller)
			portalProtected.GET("/installer-info/:os", portalH.InstallerInfo)
			portalProtected.POST("/enroll-device", portalH.EnrollDevice)
			portalProtected.GET("/activity", portalH.Activity)
			portalProtected.GET("/activity/stats", portalH.ActivityStats)
			portalProtected.GET("/devices", portalH.Devices)
			portalProtected.DELETE("/devices/:id", portalH.DeleteDevice)
			portalProtected.POST("/access-requests", arH.Create)
			portalProtected.GET("/access-requests", arH.ListMine)
		}
	}

	// ─── Internal endpoints (no JWT — device-level bearer auth inside each handler) ──
	internal := r.Group("/internal")
	{
		// Agent lifecycle (device-level bearer token auth inside handler)
		agent := internal.Group("/agent")
		{
			agent.POST("/enroll", agentH.Enroll)
			agent.POST("/heartbeat", agentH.Heartbeat)
			agent.GET("/version", agentH.AgentVersion)
			agent.GET("/config", agentH.GetConfig)
			agent.GET("/rules", agentH.GetRules)
			agent.GET("/policy-public-key", agentH.PolicyPublicKey)
			agent.POST("/activity", agentH.ReportActivity)
			agent.POST("/scan-file", agentH.ScanFile)
			// Application control: which processes to watch for, and the
			// report when one is stopped.
			agent.GET("/app-control", agentH.GetAppControl)
			agent.POST("/app-block", agentH.ReportAppBlock)
			// Time-and-activity monitoring: sessions and screenshots.
			agent.POST("/session/start", monIngestH.StartSession)
			agent.POST("/session/end", monIngestH.EndSession)
			agent.POST("/screenshot", monIngestH.UploadScreenshot)
			agent.POST("/scan-dlp", agentH.ScanDLP)
			agent.GET("/mitm-config", agentH.GetMITMConfig)
			agent.GET("/ca-cert", agentH.GetCACert)
			agent.POST("/sign-cert", agentH.SignCert)
			agent.GET("/threat-lookup", agentH.ThreatLookup)
			agent.GET("/casb/app-control", agentH.CASBAppControl)
			agent.POST("/offline", agentH.ReportOffline)
		}
	}

	return r
}
