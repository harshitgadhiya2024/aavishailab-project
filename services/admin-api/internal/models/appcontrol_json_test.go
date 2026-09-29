package models

import (
	"encoding/json"
	"strings"
	"testing"
)

// An app from the installed-software inventory has no process names; the
// agent must still get a list, never null.
func TestAppControlMatcherNeverSendsNullLists(t *testing.T) {
	b, err := json.Marshal([]AppControlMatcher{{AppID: "a", Name: "MongoDB Compass", Action: "block",
		BundleIDs: []string{"com.mongodb.compass"}, PathPatterns: []string{"/applications/mongodb compass.app"}}})
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if strings.Contains(s, "null") {
		t.Fatalf("matcher JSON contains null: %s", s)
	}
	if !strings.Contains(s, `"process_names":[]`) || !strings.Contains(s, `"bundle_ids":["com.mongodb.compass"]`) {
		t.Fatalf("unexpected JSON: %s", s)
	}
}
