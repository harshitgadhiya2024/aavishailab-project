package handlers

import (
	"encoding/json"
	"testing"
)

// Regression test for a real bug found in production: the "No team" option
// in both the Add and Edit Employee dashboard forms submits "team_id": "" —
// when TeamID was *uuid.UUID, JSON unmarshaling that empty string called
// uuid.UUID's own UnmarshalJSON and failed with "invalid UUID length: 0"
// before the handler ever ran, surfaced to the person as a raw 400 on the
// most common case (an employee with no team).
func TestEmployeeRequest_EmptyTeamIDUnmarshalsCleanly(t *testing.T) {
	var req EmployeeRequest
	if err := json.Unmarshal([]byte(`{"first_name":"riya","last_name":"patel","email":"riya@example.com","team_id":""}`), &req); err != nil {
		t.Fatalf("unmarshaling an empty team_id must not fail: %v", err)
	}
	if req.TeamID != "" {
		t.Fatalf("expected TeamID to stay empty, got %q", req.TeamID)
	}
}

func TestEmployeeRequest_RealTeamIDUnmarshalsCleanly(t *testing.T) {
	const id = "b2e5b1b0-1f2a-4b3c-9d4e-5f6a7b8c9d0e"
	var req EmployeeRequest
	if err := json.Unmarshal([]byte(`{"first_name":"riya","last_name":"patel","email":"riya@example.com","team_id":"`+id+`"}`), &req); err != nil {
		t.Fatalf("unmarshaling a real team_id must not fail: %v", err)
	}
	if req.TeamID != id {
		t.Fatalf("expected TeamID %q, got %q", id, req.TeamID)
	}
}
