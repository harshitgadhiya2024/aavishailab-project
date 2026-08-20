package handlers

import (
	"testing"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

func TestPolicyTargetMatches(t *testing.T) {
	emp := uuid.New()
	otherEmp := uuid.New()
	team := uuid.New()
	otherTeam := uuid.New()

	cases := []struct {
		name       string
		targets    map[string]any
		employeeID *uuid.UUID
		teamID     *uuid.UUID
		want       bool
	}{
		{"nil targets always match", nil, &emp, &team, true},
		{"empty scope always match", map[string]any{}, &emp, &team, true},
		{"explicit all scope always match", map[string]any{"scope": "all"}, &emp, &team, true},
		{
			"team scope matches employee's team",
			map[string]any{"scope": "team", "team_ids": []any{team.String()}},
			&emp, &team, true,
		},
		{
			"team scope rejects a different team",
			map[string]any{"scope": "team", "team_ids": []any{otherTeam.String()}},
			&emp, &team, false,
		},
		{
			"team scope with nil teamID never matches",
			map[string]any{"scope": "team", "team_ids": []any{team.String()}},
			&emp, nil, false,
		},
		{
			"employee scope matches listed employee",
			map[string]any{"scope": "employee", "employee_ids": []any{emp.String()}},
			&emp, &team, true,
		},
		{
			"employee scope rejects an unlisted employee",
			map[string]any{"scope": "employee", "employee_ids": []any{otherEmp.String()}},
			&emp, &team, false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := policyTargetMatches(c.targets, c.employeeID, c.teamID)
			if got != c.want {
				t.Errorf("policyTargetMatches() = %v, want %v", got, c.want)
			}
		})
	}
}

func TestExpandPoliciesToDomainRules_DomainsOnly(t *testing.T) {
	// No categories involved, so categoryDomainsBySlug's early-return means
	// this never touches the DB — safe to pass a nil *gorm.DB here.
	orgID := uuid.New()
	policies := []models.Policy{
		{
			Base:   models.Base{ID: uuid.New()},
			OrgID:  orgID,
			Name:   "Block Facebook",
			Action: models.PolicyActionBlock,
			Rules:  map[string]any{"domains": []any{"facebook.com", "  ", "instagram.com"}},
		},
	}

	out := expandPoliciesToDomainRules(nil, orgID, policies, nil, nil)
	if len(out) != 2 {
		t.Fatalf("expected 2 domain rules (blank entry skipped), got %d: %+v", len(out), out)
	}

	domains := map[string]bool{}
	for _, r := range out {
		domains[r.Domain] = true
		if r.Action != models.PolicyActionBlock {
			t.Errorf("expected action block, got %s", r.Action)
		}
	}
	if !domains["facebook.com"] || !domains["instagram.com"] {
		t.Errorf("expected facebook.com and instagram.com, got %+v", domains)
	}
}

func TestExpandPoliciesToDomainRules_ExcludesNonMatchingTarget(t *testing.T) {
	otherTeam := uuid.New()
	policies := []models.Policy{
		{
			Base:    models.Base{ID: uuid.New()},
			OrgID:   uuid.New(),
			Name:    "Engineering-only block",
			Action:  models.PolicyActionBlock,
			Rules:   map[string]any{"domains": []any{"example.com"}},
			Targets: map[string]any{"scope": "team", "team_ids": []any{otherTeam.String()}},
		},
	}

	// Employee is on a different team than the policy targets — must be excluded.
	myTeam := uuid.New()
	out := expandPoliciesToDomainRules(nil, uuid.New(), policies, nil, &myTeam)
	if len(out) != 0 {
		t.Fatalf("expected policy to be excluded for non-matching team, got %+v", out)
	}
}

func TestFilterPoliciesByTarget(t *testing.T) {
	employeeID := uuid.New()
	teamID := uuid.New()
	policies := []models.Policy{
		{Name: "all", Targets: map[string]any{"scope": "all"}},
		{Name: "employee", Targets: map[string]any{"scope": "employee", "employee_ids": []any{employeeID.String()}}},
		{Name: "other-team", Targets: map[string]any{"scope": "team", "team_ids": []any{uuid.New().String()}}},
	}

	got := filterPoliciesByTarget(policies, &employeeID, &teamID)
	if len(got) != 2 || got[0].Name != "all" || got[1].Name != "employee" {
		t.Fatalf("expected all and employee policies, got %+v", got)
	}
}

func TestIdListContains(t *testing.T) {
	id := uuid.New().String()
	if !idListContains([]any{id, "other"}, id) {
		t.Error("expected idListContains to find the id")
	}
	if idListContains([]any{"other"}, id) {
		t.Error("expected idListContains to not find a missing id")
	}
	if idListContains(nil, id) {
		t.Error("expected idListContains(nil, ...) to be false")
	}
}
