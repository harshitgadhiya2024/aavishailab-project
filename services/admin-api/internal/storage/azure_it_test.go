package storage

// Azure Blob against the Azurite emulator, which checks Shared Key and SAS
// signatures the way Azure does. Opt-in:
//
//   docker run -d --rm --name dp-azurite -p 56806:10000 mcr.microsoft.com/azure-storage/azurite azurite-blob --blobHost 0.0.0.0
//   AZURITE_IT=1 go test ./internal/storage -run Azure -v

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Azurite's published development account.
const (
	azuriteAccount = "devstoreaccount1"
	azuriteKey     = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=="
)

func TestAzureAgainstAzurite(t *testing.T) {
	if os.Getenv("AZURITE_IT") == "" {
		t.Skip("AZURITE_IT not set")
	}
	ctx := context.Background()
	container := "it-" + uuid.NewString()[:8]
	b, err := NewAzure(AzureConfig{
		Account: azuriteAccount, AccountKey: azuriteKey, Container: container, Prefix: "tenant",
		Endpoint: "http://127.0.0.1:56806/" + azuriteAccount,
	})
	if err != nil {
		t.Fatal(err)
	}
	az := b.(*azureBackend)

	// Create the container (a company would have done this before connecting).
	req, _ := http.NewRequest(http.MethodPut, az.endpoint+"/"+container+"?restype=container", nil)
	az.sign(req)
	resp, err := az.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create container: %d", resp.StatusCode)
	}

	body := []byte("screenshot bytes")
	key := "screenshots/a b/" + uuid.NewString() + ".webp" // a space must survive signing
	if err := b.Put(ctx, key, "image/webp", body); err != nil {
		t.Fatalf("put: %v", err)
	}

	u, err := b.SignedURL(key, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = http.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !bytes.Equal(got, body) {
		t.Fatalf("signed GET: %d %q", resp.StatusCode, got)
	}

	rc, ct, err := b.Open(ctx, key)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	got, _ = io.ReadAll(rc)
	rc.Close()
	if !bytes.Equal(got, body) || ct != "image/webp" {
		t.Fatalf("open returned %q (%s)", got, ct)
	}

	// A link signed with the wrong key is refused.
	bad, _ := NewAzure(AzureConfig{Account: azuriteAccount, AccountKey: "d3Jvbmc=", Container: container, Prefix: "tenant",
		Endpoint: "http://127.0.0.1:56806/" + azuriteAccount})
	bu, _ := bad.SignedURL(key, time.Minute)
	if resp, err := http.Get(bu); err == nil {
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			t.Fatal("a SAS signed with the wrong key was accepted")
		}
	}

	if err := b.Delete(key); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := b.Delete(key); err != nil {
		t.Fatalf("deleting a missing blob should succeed: %v", err)
	}
	if _, _, err := b.Open(ctx, key); err == nil {
		t.Fatal("blob still readable after delete")
	}
}
