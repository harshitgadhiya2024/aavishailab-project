package handlers

import (
	"testing"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

func TestPolicyTargetMatchesInfersScope(t *testing.T) {
	alice, bob := uuid.New(), uuid.New()
	teamA, teamB := uuid.New(), uuid.New()

	cases := []struct {
		name    string
		targets map[string]any
		emp     *uuid.UUID
		team    *uuid.UUID
		want    bool
	}{
		{"nil targets = whole org", nil, &alice, &teamA, true},
		{"scope all", map[string]any{"scope": "all"}, &bob, &teamB, true},
		{"scope team, in team", map[string]any{"scope": "team", "team_ids": []any{teamA.String()}}, &alice, &teamA, true},
		{"scope team, other team", map[string]any{"scope": "team", "team_ids": []any{teamA.String()}}, &bob, &teamB, false},
		{"scope team, no team", map[string]any{"scope": "team", "team_ids": []any{teamA.String()}}, &bob, nil, false},
		{"scope employee, named", map[string]any{"scope": "employee", "employee_ids": []any{alice.String()}}, &alice, &teamA, true},
		{"scope employee, same team but not named", map[string]any{"scope": "employee", "employee_ids": []any{alice.String()}}, &bob, &teamA, false},

		// The bug: a rule saved as just {"employee_ids": [...]} (no scope)
		// used to match everyone in the company.
		{"no scope, employee list, named", map[string]any{"employee_ids": []any{alice.String()}}, &alice, &teamA, true},
		{"no scope, employee list, NOT named", map[string]any{"employee_ids": []any{alice.String()}}, &bob, &teamA, false},
		{"no scope, team list, in team", map[string]any{"team_ids": []any{teamB.String()}}, &bob, &teamB, true},
		{"no scope, team list, other team", map[string]any{"team_ids": []any{teamB.String()}}, &alice, &teamA, false},
		{"no scope, empty lists = whole org", map[string]any{"employee_ids": []any{}}, &bob, nil, true},
		{"no scope, []string lists (in-memory)", map[string]any{"employee_ids": []string{alice.String()}}, &bob, nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := policyTargetMatches(c.targets, c.emp, c.team); got != c.want {
				t.Fatalf("policyTargetMatches(%v) = %v, want %v", c.targets, got, c.want)
			}
		})
	}
}

// An employee's own rule covers only that employee, whatever else its Targets
// say — so one employee's block can never reach another.
func TestAppRuleCoversOnlyItsEmployee(t *testing.T) {
	alice, bob := uuid.New(), uuid.New()
	team := uuid.New()

	own := models.AppControlRule{EmployeeID: &alice, Targets: map[string]any{"scope": "employee", "employee_ids": []any{alice.String()}}}
	if !appRuleCovers(own, &alice, &team) {
		t.Fatal("an employee's own rule must cover them")
	}
	if appRuleCovers(own, &bob, &team) {
		t.Fatal("an employee's own rule must not cover a teammate")
	}
	if appRuleCovers(own, nil, nil) {
		t.Fatal("an employee's own rule must not cover a device with no employee")
	}

	orgWide := models.AppControlRule{Targets: map[string]any{"scope": "all"}}
	if !appRuleCovers(orgWide, &bob, nil) {
		t.Fatal("an org-wide rule covers everyone")
	}

	teamRule := models.AppControlRule{Targets: map[string]any{"scope": "team", "team_ids": []any{team.String()}}}
	if !appRuleCovers(teamRule, &bob, &team) || appRuleCovers(teamRule, &bob, nil) {
		t.Fatal("a team rule covers exactly that team")
	}
}
