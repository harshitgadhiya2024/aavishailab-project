package handlers

import (
	"testing"

	"github.com/google/uuid"
)

// An employee's portal socket must only ever get messages about that
// employee; org-wide messages are for company connections.
func TestHubScopesEmployeeConnections(t *testing.T) {
	h := NewWebSocketHub()
	org := uuid.New()
	alice, bob := uuid.New(), uuid.New()
	company := &WSClient{orgID: org.String(), send: make(chan []byte, 8)}
	aliceC := &WSClient{orgID: org.String(), employeeID: &alice, send: make(chan []byte, 8)}
	bobC := &WSClient{orgID: org.String(), employeeID: &bob, send: make(chan []byte, 8)}
	for _, c := range []*WSClient{company, aliceC, bobC} {
		h.Register(c)
	}

	h.BroadcastToOrg(org.String(), "device_enrolled", map[string]string{"hostname": "bobs-laptop"})
	if len(company.send) != 1 || len(aliceC.send) != 0 || len(bobC.send) != 0 {
		t.Fatalf("org-wide message: company=%d alice=%d bob=%d", len(company.send), len(aliceC.send), len(bobC.send))
	}

	h.SendToEmployee(org, alice, "notification", map[string]string{"title": "hi"})
	if len(aliceC.send) != 1 || len(bobC.send) != 0 || len(company.send) != 1 {
		t.Fatalf("employee message: company=%d alice=%d bob=%d", len(company.send), len(aliceC.send), len(bobC.send))
	}

	h.SendToEmployee(uuid.New(), alice, "notification", nil) // another org
	if len(aliceC.send) != 1 {
		t.Fatal("a message for another org reached alice")
	}
}
