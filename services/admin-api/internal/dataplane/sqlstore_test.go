package dataplane

import (
	"context"
	"strings"
	"testing"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// eventSQL renders the SQL the primary store would run for q, without a
// database: DryRun builds the statement and stops.
func eventSQL(t *testing.T, q EventQuery) string {
	t.Helper()
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=127.0.0.1 sslmode=disable"}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true, Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	var out []models.ActivityEvent
	stmt := newPrimaryStore(db).eventScope(context.Background(), q).Find(&out).Statement
	return stmt.SQL.String()
}

// A filter with a single alternative must narrow the query, not widen it.
// GORM renders a one-element clause.Or among other conditions as "OR x", so
// the portal's "DLP" tab once returned every row of the employee's plus
// every DLP row in the database, and the "Devices" tab showed other
// employees' devices.
func TestSingleAlternativeFiltersAreANDed(t *testing.T) {
	org, emp := uuid.New(), uuid.New()
	cases := map[string]EventQuery{
		"AnyOf": {
			OrgID: org, EmployeeID: &emp,
			AnyOf: []EventClause{{Categories: []string{"dlp"}}},
		},
		"Search, one field": {
			OrgID: org, EmployeeID: &emp,
			Search: "x", SearchFields: []string{"target_domain"},
		},
		"DomainContainsAny, one domain": {
			OrgID: org, EmployeeID: &emp,
			DomainContainsAny: []string{"example.com"},
		},
	}
	for name, q := range cases {
		t.Run(name, func(t *testing.T) {
			sql := eventSQL(t, q)
			if strings.Contains(sql, " OR ") {
				t.Fatalf("single alternative was ORed with the org/employee scope:\n%s", sql)
			}
		})
	}
}

// Several alternatives still OR together, inside their own parentheses.
func TestMultipleAlternativesStayGrouped(t *testing.T) {
	emp := uuid.New()
	sql := eventSQL(t, EventQuery{
		OrgID: uuid.New(), EmployeeID: &emp,
		AnyOf: []EventClause{{Categories: []string{"application_control"}}, {EventTypes: []string{"app_install"}}},
	})
	if !strings.Contains(sql, `AND ("category" `) {
		t.Fatalf("alternatives not grouped under AND:\n%s", sql)
	}
}
