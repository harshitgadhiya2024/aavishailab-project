// Package razorpay is a small, dependency-free client for the Razorpay
// Payment Links API — matching the rest of this codebase's own-HTTP-client
// style (the clamd, TOTP, and service-auth clients are all hand-rolled too).
//
// Payment Links, not embedded Checkout, is the deliberate choice here: the
// payer in this product is a customer organization's finance contact, not
// someone sitting in this dashboard — superadmin creates an invoice and
// sends a link, exactly like Razorpay's own invoicing product, with no
// checkout.js or card-handling surface for us to own at all.
package razorpay

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const apiBase = "https://api.razorpay.com/v1"

// Enabled reports whether Razorpay credentials are configured. Every caller
// checks this first and fails open (billing features simply unavailable)
// rather than erroring — matching threatintelclient/dlpclient's Enabled()
// pattern for optional integrations.
func Enabled() bool {
	return os.Getenv("RAZORPAY_KEY_ID") != "" && os.Getenv("RAZORPAY_KEY_SECRET") != ""
}

func keyID() string     { return os.Getenv("RAZORPAY_KEY_ID") }
func keySecret() string { return os.Getenv("RAZORPAY_KEY_SECRET") }

// Currency is the account's settlement currency — Razorpay accounts are
// provisioned for one currency (INR for an India-registered business), so
// this isn't a per-charge choice.
func Currency() string {
	if c := os.Getenv("RAZORPAY_CURRENCY"); c != "" {
		return c
	}
	return "INR"
}

type Client struct {
	httpClient *http.Client
}

func New() *Client {
	return &Client{httpClient: &http.Client{Timeout: 15 * time.Second}}
}

type PaymentLinkCustomer struct {
	Name    string `json:"name,omitempty"`
	Email   string `json:"email,omitempty"`
	Contact string `json:"contact,omitempty"`
}

type PaymentLink struct {
	ID          string `json:"id"`
	ShortURL    string `json:"short_url"`
	Status      string `json:"status"` // created | paid | cancelled | expired
	AmountPaise int64  `json:"amount"`
	Currency    string `json:"currency"`
}

type createPaymentLinkRequest struct {
	Amount         int64               `json:"amount"` // smallest currency unit (paise for INR)
	Currency       string              `json:"currency"`
	Description    string              `json:"description"`
	Customer       PaymentLinkCustomer `json:"customer,omitempty"`
	ReferenceID    string              `json:"reference_id,omitempty"`
	Notes          map[string]string   `json:"notes,omitempty"`
	ReminderEnable bool                `json:"reminder_enable"`
}

func (c *Client) do(method, path string, body any, out any) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, apiBase+path, reqBody)
	if err != nil {
		return err
	}
	req.SetBasicAuth(keyID(), keySecret())
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("razorpay: %s %s -> %d: %s", method, path, resp.StatusCode, string(respBody))
	}
	if out != nil {
		return json.Unmarshal(respBody, out)
	}
	return nil
}

// CreatePaymentLink creates a Razorpay-hosted payment page and returns its
// short URL — this call alone never moves money; the org's finance contact
// still has to open the link and pay.
func (c *Client) CreatePaymentLink(amountPaise int64, description, referenceID string, customer PaymentLinkCustomer, notes map[string]string) (*PaymentLink, error) {
	req := createPaymentLinkRequest{
		Amount:         amountPaise,
		Currency:       Currency(),
		Description:    description,
		Customer:       customer,
		ReferenceID:    referenceID,
		Notes:          notes,
		ReminderEnable: true,
	}
	var out PaymentLink
	if err := c.do(http.MethodPost, "/payment_links", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetPaymentLink polls current status — the fallback path for when a
// webhook was missed or arrived before the record existed to match against.
func (c *Client) GetPaymentLink(id string) (*PaymentLink, error) {
	var out PaymentLink
	if err := c.do(http.MethodGet, "/payment_links/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CancelPaymentLink voids a link that hasn't been paid yet.
func (c *Client) CancelPaymentLink(id string) error {
	return c.do(http.MethodPost, "/payment_links/"+id+"/cancel", nil, nil)
}

// VerifyWebhookSignature checks X-Razorpay-Signature against the raw
// request body using RAZORPAY_WEBHOOK_SECRET (a value distinct from the API
// key/secret pair, generated separately in the Razorpay dashboard for
// exactly this purpose). Fails closed: an unset secret or a mismatched
// signature both reject.
func VerifyWebhookSignature(rawBody []byte, signatureHeader string) bool {
	secret := os.Getenv("RAZORPAY_WEBHOOK_SECRET")
	if secret == "" || signatureHeader == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signatureHeader))
}
