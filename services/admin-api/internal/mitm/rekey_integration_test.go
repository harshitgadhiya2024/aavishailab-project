package mitm

// Rotating CA_KEY_ENCRYPTION_KEY re-seals every org CA key without changing
// the CA, against a real Postgres. Opt-in: set CA_REKEY_IT_DSN to a THROWAWAY
// database (its public schema is wiped), e.g.
//   docker run --rm -e POSTGRES_PASSWORD=it -e POSTGRES_DB=it -p 56791:5432 postgres:16-alpine
//   CA_REKEY_IT_DSN="host=127.0.0.1 port=56791 user=postgres password=it dbname=it sslmode=disable" go test ./internal/mitm -run TestRekeyAll

import (
	"os"
	"testing"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRekeyAllIntegration(t *testing.T) {
	dsn := os.Getenv("CA_REKEY_IT_DSN")
	if dsn == "" {
		t.Skip("CA_REKEY_IT_DSN not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).Error)
	must(db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	must(db.AutoMigrate(&models.OrgCACert{}))

	const oldSecret, newSecret = "old-ca-encryption-secret-for-the-test", "new-ca-encryption-secret-for-the-test"
	defer os.Setenv("CA_KEY_ENCRYPTION_KEY", os.Getenv("CA_KEY_ENCRYPTION_KEY"))

	os.Setenv("CA_KEY_ENCRYPTION_KEY", oldSecret)
	orgs := []uuid.UUID{uuid.New(), uuid.New()}
	before := map[uuid.UUID]*CA{}
	for _, org := range orgs {
		ca, err := EnsureOrgCA(db, org)
		must(err)
		before[org] = ca
	}

	os.Setenv("CA_KEY_ENCRYPTION_KEY", newSecret)
	if _, err := RekeyAll(db, "wrong-old-secret-for-the-test"); err == nil {
		t.Fatal("rekey with the wrong old secret must fail")
	}
	n, err := RekeyAll(db, oldSecret)
	must(err)
	if n != len(orgs) {
		t.Fatalf("re-sealed %d rows, want %d", n, len(orgs))
	}
	for _, org := range orgs {
		ca, err := EnsureOrgCA(db, org)
		must(err)
		if !ca.Key.Equal(before[org].Key) || ca.Cert.SerialNumber.Cmp(before[org].Cert.SerialNumber) != 0 {
			t.Fatalf("org %s: CA changed across the rekey", org)
		}
	}

	// A second run finds nothing left to do.
	n, err = RekeyAll(db, oldSecret)
	must(err)
	if n != 0 {
		t.Fatalf("second rekey re-sealed %d rows, want 0", n)
	}
}
