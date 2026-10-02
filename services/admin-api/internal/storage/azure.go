package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Azure Blob Storage, hand-rolled like the S3 client above it: Shared Key
// authorization for writes and deletes, and a read-only service SAS for the
// short-lived links an <img> loads. Azure does not speak the S3 API, so it
// cannot share that client.

// azureVersion is the REST API version every request and SAS is signed for.
// 2020-12-06 or later is required for the SAS string-to-sign below (it
// includes the encryption-scope line).
const azureVersion = "2021-08-06"

// AzureConfig describes one container.
type AzureConfig struct {
	Account    string
	AccountKey string // base64, as shown in the portal under "Access keys"
	Container  string
	Prefix     string
	// Endpoint overrides https://<account>.blob.core.windows.net — for
	// sovereign clouds, private endpoints and the Azurite emulator. It is the
	// blob service root; the container is appended to it.
	Endpoint string
	Client   *http.Client
}

// NewAzure returns a Backend for one Azure Blob container.
func NewAzure(cfg AzureConfig) (Backend, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(cfg.AccountKey))
	if err != nil || len(key) == 0 {
		return nil, fmt.Errorf("the account key is not valid base64")
	}
	endpoint := strings.TrimRight(cfg.Endpoint, "/")
	if endpoint == "" {
		endpoint = "https://" + cfg.Account + ".blob.core.windows.net"
	}
	if _, err := url.Parse(endpoint); err != nil {
		return nil, fmt.Errorf("invalid endpoint: %w", err)
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &azureBackend{
		account:   cfg.Account,
		key:       key,
		container: cfg.Container,
		prefix:    cfg.Prefix,
		endpoint:  endpoint,
		client:    client,
	}, nil
}

type azureBackend struct {
	account   string
	key       []byte
	container string
	prefix    string
	endpoint  string
	client    *http.Client
}

func (b *azureBackend) Kind() string { return "azure_blob" }

func (b *azureBackend) blobName(key string) string {
	if b.prefix == "" {
		return strings.TrimLeft(key, "/")
	}
	return strings.Trim(b.prefix, "/") + "/" + strings.TrimLeft(key, "/")
}

func (b *azureBackend) blobURL(key string) string {
	return b.endpoint + "/" + b.container + "/" + s3EscapePath(b.blobName(key))
}

func (b *azureBackend) Put(ctx context.Context, key, contentType string, data []byte) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, b.blobURL(key), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.ContentLength = int64(len(data))
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("x-ms-blob-type", "BlockBlob")
	b.sign(req)
	return b.do(req, "put", key, false)
}

func (b *azureBackend) Delete(key string) error {
	req, err := http.NewRequest(http.MethodDelete, b.blobURL(key), nil)
	if err != nil {
		return err
	}
	b.sign(req)
	return b.do(req, "delete", key, true)
}

func (b *azureBackend) do(req *http.Request, op, key string, notFoundOK bool) error {
	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 == 2 || (notFoundOK && resp.StatusCode == http.StatusNotFound) {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("azure %s %s: %d %s", op, key, resp.StatusCode, strings.TrimSpace(string(body)))
}

func (b *azureBackend) Open(ctx context.Context, key string) (io.ReadCloser, string, error) {
	u, err := b.SignedURL(key, 5*time.Minute)
	if err != nil {
		return nil, "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode/100 != 2 {
		resp.Body.Close()
		return nil, "", fmt.Errorf("azure get %s: %d", key, resp.StatusCode)
	}
	return resp.Body, resp.Header.Get("Content-Type"), nil
}

// SignedURL is a read-only service SAS scoped to this one blob.
func (b *azureBackend) SignedURL(key string, ttl time.Duration) (string, error) {
	now := time.Now().UTC()
	// Backdated a few minutes so a client whose clock runs slightly ahead of
	// Azure's is not refused a link that was valid when it was minted.
	start := now.Add(-5 * time.Minute).Format("2006-01-02T15:04:05Z")
	expiry := now.Add(ttl).Format("2006-01-02T15:04:05Z")
	protocol := "https"
	if strings.HasPrefix(b.endpoint, "http://") {
		protocol = "https,http"
	}
	resource := "/blob/" + b.account + "/" + b.container + "/" + b.blobName(key)

	stringToSign := strings.Join([]string{
		"r",                // signedPermissions
		start,              // signedStart
		expiry,             // signedExpiry
		resource,           // canonicalizedResource
		"",                 // signedIdentifier
		"",                 // signedIP
		protocol,           // signedProtocol
		azureVersion,       // signedVersion
		"b",                // signedResource
		"",                 // signedSnapshotTime
		"",                 // signedEncryptionScope
		"", "", "", "", "", // rscc, rscd, rsce, rscl, rsct
	}, "\n")

	q := url.Values{}
	q.Set("sp", "r")
	q.Set("st", start)
	q.Set("se", expiry)
	q.Set("spr", protocol)
	q.Set("sv", azureVersion)
	q.Set("sr", "b")
	q.Set("sig", b.hmac(stringToSign))
	return b.blobURL(key) + "?" + q.Encode(), nil
}

// sign adds Shared Key authorization to a request.
func (b *azureBackend) sign(req *http.Request) {
	req.Header.Set("x-ms-date", time.Now().UTC().Format(http.TimeFormat))
	req.Header.Set("x-ms-version", azureVersion)

	length := ""
	if req.ContentLength > 0 {
		length = strconv.FormatInt(req.ContentLength, 10)
	}

	var xms []string
	for name := range req.Header {
		if lower := strings.ToLower(name); strings.HasPrefix(lower, "x-ms-") {
			xms = append(xms, lower)
		}
	}
	sort.Strings(xms)
	var headers strings.Builder
	for _, name := range xms {
		headers.WriteString(name + ":" + strings.TrimSpace(req.Header.Get(name)) + "\n")
	}

	stringToSign := strings.Join([]string{
		req.Method,
		req.Header.Get("Content-Encoding"),
		req.Header.Get("Content-Language"),
		length,
		req.Header.Get("Content-MD5"),
		req.Header.Get("Content-Type"),
		"", // Date — x-ms-date is used instead
		req.Header.Get("If-Modified-Since"),
		req.Header.Get("If-Match"),
		req.Header.Get("If-None-Match"),
		req.Header.Get("If-Unmodified-Since"),
		req.Header.Get("Range"),
	}, "\n") + "\n" + headers.String() + "/" + b.account + req.URL.EscapedPath()

	// Query parameters are part of the canonicalized resource: lower-cased
	// names, sorted, one "\nname:value[,value]" line each.
	query := req.URL.Query()
	params := make([]string, 0, len(query))
	for name := range query {
		params = append(params, name)
	}
	sort.Strings(params)
	for _, name := range params {
		vals := append([]string(nil), query[name]...)
		sort.Strings(vals)
		stringToSign += "\n" + strings.ToLower(name) + ":" + strings.Join(vals, ",")
	}

	req.Header.Set("Authorization", "SharedKey "+b.account+":"+b.hmac(stringToSign))
}

func (b *azureBackend) hmac(s string) string {
	m := hmac.New(sha256.New, b.key)
	m.Write([]byte(s))
	return base64.StdEncoding.EncodeToString(m.Sum(nil))
}
