package dataplane

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/aavishield/admin-api/internal/models"
)

// DBConfig is what a company enters to connect its database. It is sealed as
// a whole (see Seal) and only ever decrypted inside admin-api.
type DBConfig struct {
	Provider string `json:"provider"`

	// SQL engines, and MongoDB when no URI is given.
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	// Schema is Postgres-only (default "public"); SQL Server always uses the
	// login's default schema.
	Schema string `json:"schema"`
	// TLS: "verify-full" (encrypt and verify the certificate), "require"
	// (encrypt, accept a self-signed certificate) or "disable".
	TLS string `json:"tls"`

	// MongoDB connection string (mongodb:// or mongodb+srv://). When set it
	// wins over Host/Port/Username/Password; Database still names the
	// database to use.
	URI string `json:"uri"`
}

// FilesConfig is what a company enters to connect its object storage.
type FilesConfig struct {
	Provider string `json:"provider"`

	// S3, R2, GCS and S3-compatible.
	Bucket          string `json:"bucket"`
	Region          string `json:"region"`
	Endpoint        string `json:"endpoint"`
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
	AccountID       string `json:"account_id"` // Cloudflare R2
	PathStyle       bool   `json:"path_style"` // S3-compatible only

	// Azure Blob Storage.
	AccountName string `json:"account_name"`
	AccountKey  string `json:"account_key"`
	Container   string `json:"container"`

	// Prefix keeps Aavishield's objects in their own folder of a bucket that
	// also holds other data.
	Prefix string `json:"prefix"`
}

// FieldErrors maps a form field to what is wrong with it.
type FieldErrors map[string]string

func (f FieldErrors) Error() string {
	parts := make([]string, 0, len(f))
	for k, v := range f {
		parts = append(parts, k+": "+v)
	}
	return strings.Join(parts, "; ")
}

var (
	identRe  = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_$-]{0,62}$`)
	bucketRe = regexp.MustCompile(`^[a-z0-9][a-z0-9.\-_]{1,221}[a-z0-9]$`)
	regionRe = regexp.MustCompile(`^[a-z0-9-]{2,32}$`)
	acctRe   = regexp.MustCompile(`^[a-z0-9]{3,24}$`)
	hexRe    = regexp.MustCompile(`^[a-f0-9]{32}$`)
)

// DefaultPort is the engine's usual port, used when the form leaves it blank.
func DefaultPort(provider string) int {
	switch provider {
	case models.ResidencyDBPostgres:
		return 5432
	case models.ResidencyDBMySQL, models.ResidencyDBMariaDB:
		return 3306
	case models.ResidencyDBSQLServer:
		return 1433
	case models.ResidencyDBMongoDB:
		return 27017
	}
	return 0
}

// Normalize fills defaults and trims input in place.
func (c *DBConfig) Normalize() {
	c.Provider = strings.ToLower(strings.TrimSpace(c.Provider))
	c.Host = strings.TrimSpace(c.Host)
	c.Database = strings.TrimSpace(c.Database)
	c.Username = strings.TrimSpace(c.Username)
	c.Schema = strings.TrimSpace(c.Schema)
	c.URI = strings.TrimSpace(c.URI)
	if c.Port == 0 {
		c.Port = DefaultPort(c.Provider)
	}
	switch c.TLS {
	case "verify-full", "require", "disable":
	default:
		c.TLS = "require"
	}
	if c.Provider == models.ResidencyDBPostgres && c.Schema == "" {
		c.Schema = "public"
	}
}

// Validate checks the config for the form, before any connection is tried.
func (c *DBConfig) Validate() error {
	errs := FieldErrors{}
	switch c.Provider {
	case models.ResidencyDBPostgres, models.ResidencyDBMySQL, models.ResidencyDBMariaDB,
		models.ResidencyDBSQLServer, models.ResidencyDBMongoDB:
	default:
		errs["provider"] = "Choose PostgreSQL, MySQL, MariaDB, SQL Server or MongoDB"
		return errs
	}

	if c.Provider == models.ResidencyDBMongoDB && c.URI != "" {
		u, err := url.Parse(c.URI)
		if err != nil || (u.Scheme != "mongodb" && u.Scheme != "mongodb+srv") || u.Host == "" {
			errs["uri"] = "Use a connection string that starts with mongodb:// or mongodb+srv://"
		}
	} else {
		if !validHost(c.Host) {
			errs["host"] = "Enter the server's hostname or public IP address"
		}
		if c.Port < 1 || c.Port > 65535 {
			errs["port"] = "Enter a port between 1 and 65535"
		}
		if c.Username == "" {
			errs["username"] = "Enter the database user Aavishield should sign in as"
		}
		if c.Password == "" {
			errs["password"] = "Enter the password for that user"
		}
	}
	if !identRe.MatchString(c.Database) {
		errs["database"] = "Enter the database name (letters, digits and underscores)"
	}
	if c.Provider == models.ResidencyDBPostgres && !identRe.MatchString(c.Schema) {
		errs["schema"] = "Enter a schema name (letters, digits and underscores)"
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}

// Summary is the non-secret description shown on the settings page.
func (c *DBConfig) Summary() map[string]any {
	s := map[string]any{"provider": c.Provider, "database": c.Database, "tls": c.TLS}
	if c.Provider == models.ResidencyDBMongoDB && c.URI != "" {
		s["uri"] = redactURI(c.URI)
		return s
	}
	s["host"], s["port"], s["username"] = c.Host, c.Port, c.Username
	if c.Schema != "" {
		s["schema"] = c.Schema
	}
	return s
}

// MergeSecrets keeps the saved password (or URI credentials) when the form
// was resubmitted without re-typing them — the page never receives them back,
// so a blank field means "unchanged", not "remove".
func (c *DBConfig) MergeSecrets(prev *DBConfig) {
	if prev == nil || prev.Provider != c.Provider {
		return
	}
	if c.Password == "" && c.Host == prev.Host && c.Username == prev.Username {
		c.Password = prev.Password
	}
	if c.URI != "" && c.URI == redactURI(prev.URI) {
		c.URI = prev.URI
	}
}

// Normalize fills defaults and trims input in place.
func (c *FilesConfig) Normalize() {
	c.Provider = strings.ToLower(strings.TrimSpace(c.Provider))
	c.Bucket = strings.TrimSpace(c.Bucket)
	c.Region = strings.ToLower(strings.TrimSpace(c.Region))
	c.Endpoint = strings.TrimRight(strings.TrimSpace(c.Endpoint), "/")
	c.AccessKeyID = strings.TrimSpace(c.AccessKeyID)
	c.SecretAccessKey = strings.TrimSpace(c.SecretAccessKey)
	c.AccountID = strings.ToLower(strings.TrimSpace(c.AccountID))
	c.AccountName = strings.ToLower(strings.TrimSpace(c.AccountName))
	c.AccountKey = strings.TrimSpace(c.AccountKey)
	c.Container = strings.TrimSpace(c.Container)
	c.Prefix = strings.Trim(strings.TrimSpace(c.Prefix), "/")
	switch c.Provider {
	case models.ResidencyFilesR2, models.ResidencyFilesGCS:
		c.Region = "auto"
	case models.ResidencyFilesS3Compatible:
		if c.Region == "" {
			c.Region = "us-east-1"
		}
	}
}

// Validate checks the config for the form, before any connection is tried.
func (c *FilesConfig) Validate() error {
	errs := FieldErrors{}
	switch c.Provider {
	case models.ResidencyFilesAzure:
		if !acctRe.MatchString(c.AccountName) {
			errs["account_name"] = "Enter the storage account name (3–24 lowercase letters and digits)"
		}
		if c.AccountKey == "" {
			errs["account_key"] = "Paste one of the storage account's access keys"
		}
		if !regexp.MustCompile(`^[a-z0-9](?:[a-z0-9]|-[a-z0-9]){2,62}$`).MatchString(c.Container) {
			errs["container"] = "Enter the container name (3–63 lowercase letters, digits and hyphens)"
		}
		if c.Endpoint != "" && !validURL(c.Endpoint) {
			errs["endpoint"] = "Enter the blob service URL, e.g. https://account.blob.core.windows.net"
		}
	case models.ResidencyFilesS3, models.ResidencyFilesR2, models.ResidencyFilesGCS, models.ResidencyFilesS3Compatible:
		if !bucketRe.MatchString(c.Bucket) {
			errs["bucket"] = "Enter the bucket name (lowercase letters, digits, dots and hyphens)"
		}
		if c.AccessKeyID == "" {
			errs["access_key_id"] = "Enter the access key ID"
		}
		if c.SecretAccessKey == "" {
			errs["secret_access_key"] = "Enter the secret access key"
		}
		switch c.Provider {
		case models.ResidencyFilesS3:
			if !regionRe.MatchString(c.Region) {
				errs["region"] = "Enter the bucket's region, e.g. ap-south-1"
			}
		case models.ResidencyFilesR2:
			if !hexRe.MatchString(c.AccountID) {
				errs["account_id"] = "Enter your Cloudflare account ID (32 characters, on the R2 overview page)"
			}
		case models.ResidencyFilesS3Compatible:
			if !validURL(c.Endpoint) {
				errs["endpoint"] = "Enter the S3 endpoint URL, e.g. https://s3.eu-central-1.wasabisys.com"
			}
			if !regionRe.MatchString(c.Region) {
				errs["region"] = "Enter the region the endpoint expects (often us-east-1)"
			}
		}
	default:
		errs["provider"] = "Choose Amazon S3, Cloudflare R2, Google Cloud Storage, Azure Blob Storage or an S3-compatible store"
		return errs
	}
	if len(c.Prefix) > 200 || strings.Contains(c.Prefix, "..") {
		errs["prefix"] = "Use a short folder name, without '..'"
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}

// endpoint is the S3 endpoint for the provider.
func (c *FilesConfig) endpoint() string {
	switch c.Provider {
	case models.ResidencyFilesS3:
		if c.Endpoint != "" {
			return c.Endpoint
		}
		return "https://s3." + c.Region + ".amazonaws.com"
	case models.ResidencyFilesR2:
		return "https://" + c.AccountID + ".r2.cloudflarestorage.com"
	case models.ResidencyFilesGCS:
		return "https://storage.googleapis.com"
	}
	return c.Endpoint
}

// endpointHost is the host whose address the network guard checks up front.
func (c *FilesConfig) endpointHost() string {
	ep := c.endpoint()
	if c.Provider == models.ResidencyFilesAzure && ep == "" {
		return c.AccountName + ".blob.core.windows.net"
	}
	u, err := url.Parse(ep)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// Summary is the non-secret description shown on the settings page.
func (c *FilesConfig) Summary() map[string]any {
	s := map[string]any{"provider": c.Provider}
	if c.Prefix != "" {
		s["prefix"] = c.Prefix
	}
	if c.Provider == models.ResidencyFilesAzure {
		s["account_name"], s["container"] = c.AccountName, c.Container
		if c.Endpoint != "" {
			s["endpoint"] = c.Endpoint
		}
		return s
	}
	s["bucket"], s["region"], s["endpoint"] = c.Bucket, c.Region, c.endpoint()
	s["access_key_id"] = maskKey(c.AccessKeyID)
	if c.AccountID != "" {
		s["account_id"] = c.AccountID
	}
	if c.Provider == models.ResidencyFilesS3Compatible {
		s["path_style"] = c.PathStyle
	}
	return s
}

// MergeSecrets keeps the saved secret when the form was resubmitted without
// re-typing it.
func (c *FilesConfig) MergeSecrets(prev *FilesConfig) {
	if prev == nil || prev.Provider != c.Provider {
		return
	}
	if c.SecretAccessKey == "" && c.AccessKeyID == prev.AccessKeyID {
		c.SecretAccessKey = prev.SecretAccessKey
	}
	if c.AccountKey == "" && c.AccountName == prev.AccountName {
		c.AccountKey = prev.AccountKey
	}
}

func validHost(h string) bool {
	if h == "" || len(h) > 253 || strings.ContainsAny(h, " /\\?#@") {
		return false
	}
	if net.ParseIP(h) != nil {
		return true
	}
	return regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$`).MatchString(h)
}

func validURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil
}

// redactURI hides the password in a connection string.
func redactURI(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if u.User != nil {
		if _, has := u.User.Password(); has {
			u.User = url.UserPassword(u.User.Username(), "xxxxx")
		}
	}
	return u.String()
}

func maskKey(k string) string {
	if len(k) <= 4 {
		return strings.Repeat("•", len(k))
	}
	return strings.Repeat("•", 6) + k[len(k)-4:]
}

func hostPort(host string, port int) string {
	return net.JoinHostPort(host, strconv.Itoa(port))
}

func describeDB(c *DBConfig) string {
	if c.URI != "" {
		return redactURI(c.URI)
	}
	return fmt.Sprintf("%s/%s", hostPort(c.Host, c.Port), c.Database)
}
