package models

import "github.com/google/uuid"

// Permissions are what the UI and the API both gate on. Roles are the thing an
// admin assigns; permissions are what the code checks — so adding a capability
// means adding it to a role here rather than sprinkling role comparisons
// through every handler.
const (
	PermEmployeesRead  = "employees:read"
	PermEmployeesWrite = "employees:write"
	PermTeamsRead      = "teams:read"
	PermTeamsWrite     = "teams:write"
	PermPoliciesRead   = "policies:read"
	PermPoliciesWrite  = "policies:write"
	PermActivityRead   = "activity:read"
	PermReportsRead    = "reports:read"
	PermDevicesRead    = "devices:read"
	PermDevicesWrite   = "devices:write"
	PermSWGRead        = "swg:read"
	PermSWGWrite       = "swg:write"
	PermShadowITRead   = "shadow_it:read"
	PermShadowITWrite  = "shadow_it:write"
	PermCASBRead       = "casb:read"
	PermCASBWrite      = "casb:write"
	PermCategoriesRead  = "categories:read"
	PermCategoriesWrite = "categories:write"
	PermSettingsRead   = "settings:read"
	PermSettingsWrite  = "settings:write"
	PermAccessReqRead  = "access_requests:read"
	PermAccessReqWrite = "access_requests:write"
	PermUsersRead      = "users:read"
	PermUsersWrite     = "users:write"
	PermAIUse          = "ai:use"
	// Time-and-activity monitoring (screenshots + activity). Read views the
	// screens; DeleteSession/DeleteScreenshot are separated because deleting
	// evidence is a heavier act than viewing it — the screenshot UI shows the
	// two as distinct grants.
	PermMonitoringRead      = "monitoring:read"
	PermMonitoringDeleteSes = "monitoring:delete_session"
	PermMonitoringDeleteImg = "monitoring:delete_screenshot"
)

// AllPermissions is the full set, granted to org_admin (and superadmin).
var AllPermissions = []string{
	PermEmployeesRead, PermEmployeesWrite,
	PermTeamsRead, PermTeamsWrite,
	PermPoliciesRead, PermPoliciesWrite,
	PermActivityRead, PermReportsRead,
	PermDevicesRead, PermDevicesWrite,
	PermSWGRead, PermSWGWrite,
	PermShadowITRead, PermShadowITWrite,
	PermCASBRead, PermCASBWrite,
	PermCategoriesRead, PermCategoriesWrite,
	PermSettingsRead, PermSettingsWrite,
	PermAccessReqRead, PermAccessReqWrite,
	PermUsersRead, PermUsersWrite,
	PermAIUse,
	PermMonitoringRead, PermMonitoringDeleteSes, PermMonitoringDeleteImg,
}

// rolePermissions maps each role to what it may do.
//
//   - org_admin   — runs the organization, including who else gets access.
//   - manager     — owns their teams: full sight of their people and the
//     day-to-day calls (approve a request, sanction an app), but cannot rewrite
//     org-wide policy or add administrators.
//   - analyst     — investigates and tunes enforcement across the org, but does
//     not manage users or org settings.
//   - read_only   — sees and exports; changes nothing. For auditors.
var rolePermissions = map[UserRole][]string{
	RoleSuperAdmin: AllPermissions,
	RoleOrgAdmin:   AllPermissions,
	RoleAnalyst: {
		PermEmployeesRead, PermTeamsRead,
		PermPoliciesRead, PermPoliciesWrite,
		PermActivityRead, PermReportsRead,
		PermDevicesRead,
		PermSWGRead, PermSWGWrite,
		PermShadowITRead, PermShadowITWrite,
		PermCASBRead, PermCASBWrite,
		PermCategoriesRead, PermCategoriesWrite,
		PermAccessReqRead, PermAccessReqWrite,
		PermSettingsRead,
		PermAIUse,
		PermMonitoringRead,
	},
	RoleManager: {
		PermEmployeesRead, PermEmployeesWrite,
		PermTeamsRead,
		PermPoliciesRead,
		PermActivityRead, PermReportsRead,
		PermDevicesRead,
		PermSWGRead, PermShadowITRead, PermCASBRead, PermCategoriesRead,
		PermAccessReqRead, PermAccessReqWrite,
		PermAIUse,
		PermMonitoringRead,
	},
	RoleReadOnly: {
		PermEmployeesRead, PermTeamsRead, PermPoliciesRead,
		PermActivityRead, PermReportsRead, PermDevicesRead,
		PermSWGRead, PermShadowITRead, PermCASBRead, PermCategoriesRead,
		PermAccessReqRead, PermSettingsRead,
	},
}

// PermissionsForRole returns the permission list for a role (never nil).
func PermissionsForRole(role UserRole) []string {
	if perms, ok := rolePermissions[role]; ok {
		return perms
	}
	return []string{}
}

// RoleHasPermission reports whether a role grants a permission.
func RoleHasPermission(role UserRole, permission string) bool {
	for _, p := range PermissionsForRole(role) {
		if p == permission {
			return true
		}
	}
	return false
}

// AssignableRoles are the roles an org admin can hand out. superadmin is
// deliberately absent: it is platform-level and not an org's to grant.
var AssignableRoles = []UserRole{RoleOrgAdmin, RoleManager, RoleAnalyst, RoleReadOnly}

// IsAssignableRole guards the user-management endpoints against privilege
// escalation through a hand-crafted request body.
func IsAssignableRole(role UserRole) bool {
	for _, r := range AssignableRoles {
		if r == role {
			return true
		}
	}
	return false
}

// UserTeam scopes a dashboard user to a team. A user with no rows here sees the
// whole organization; with one or more, their view of employees, devices and
// activity narrows to those teams. That is what lets several managers share one
// dashboard without seeing each other's people.
type UserTeam struct {
	ID     uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_user_team" json:"user_id"`
	TeamID uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_user_team" json:"team_id"`
	OrgID  uuid.UUID `gorm:"type:uuid;not null;index" json:"org_id"`
}
