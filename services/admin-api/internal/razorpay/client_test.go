package razorpay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"testing"
)

func sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyWebhookSignatureAcceptsValidSignature(t *testing.T) {
	t.Setenv("RAZORPAY_WEBHOOK_SECRET", "test-webhook-secret")
	body := []byte(`{"event":"payment_link.paid"}`)
	sig := sign("test-webhook-secret", body)
	if !VerifyWebhookSignature(body, sig) {
		t.Fatal("expected valid signature to be accepted")
	}
}

func TestVerifyWebhookSignatureRejectsWrongSecret(t *testing.T) {
	t.Setenv("RAZORPAY_WEBHOOK_SECRET", "test-webhook-secret")
	body := []byte(`{"event":"payment_link.paid"}`)
	sig := sign("wrong-secret", body)
	if VerifyWebhookSignature(body, sig) {
		t.Fatal("expected signature signed with the wrong secret to be rejected")
	}
}

func TestVerifyWebhookSignatureRejectsTamperedBody(t *testing.T) {
	t.Setenv("RAZORPAY_WEBHOOK_SECRET", "test-webhook-secret")
	sig := sign("test-webhook-secret", []byte(`{"event":"payment_link.paid","amount":100}`))
	tampered := []byte(`{"event":"payment_link.paid","amount":1000000}`)
	if VerifyWebhookSignature(tampered, sig) {
		t.Fatal("expected a body that doesn't match the signature to be rejected")
	}
}

func TestVerifyWebhookSignatureFailsClosedWithNoSecretConfigured(t *testing.T) {
	os.Unsetenv("RAZORPAY_WEBHOOK_SECRET")
	body := []byte(`{"event":"payment_link.paid"}`)
	// Even a signature that would be "valid" for an empty-string secret must
	// still be rejected — an unconfigured secret must never mean "trust
	// anything".
	sig := sign("", body)
	if VerifyWebhookSignature(body, sig) {
		t.Fatal("expected verification to fail closed when no webhook secret is configured")
	}
}

func TestEnabledRequiresBothKeyIDAndSecret(t *testing.T) {
	os.Unsetenv("RAZORPAY_KEY_ID")
	os.Unsetenv("RAZORPAY_KEY_SECRET")
	if Enabled() {
		t.Fatal("expected Enabled() to be false with nothing configured")
	}
	t.Setenv("RAZORPAY_KEY_ID", "rzp_test_x")
	if Enabled() {
		t.Fatal("expected Enabled() to be false with only key ID set")
	}
	t.Setenv("RAZORPAY_KEY_SECRET", "secret")
	if !Enabled() {
		t.Fatal("expected Enabled() to be true with both set")
	}
}
