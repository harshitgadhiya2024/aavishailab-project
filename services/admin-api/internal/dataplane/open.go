package dataplane

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/storage"
	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	mssql "github.com/microsoft/go-mssqldb"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlserver"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Connection limits for a company's database. Deliberately small: these are
// pools held open from Aavishield's side into someone else's server, one per
// organization, and a company's DBA should never find us holding dozens of
// its connections.
const (
	tenantMaxOpen     = 5
	tenantMaxIdle     = 2
	tenantConnMaxLife = 30 * time.Minute
	tenantConnMaxIdle = 5 * time.Minute
	dialTimeout       = 10 * time.Second
)

// guardedMySQLNet is the network name the MySQL driver dials through
// guardedDialContext.
const guardedMySQLNet = "aavishield-guarded"

func init() {
	mysqldriver.RegisterDialContext(guardedMySQLNet, func(ctx context.Context, addr string) (net.Conn, error) {
		return guardedDialContext(ctx, "tcp", addr)
	})
}

// tenantStore is a Store that can also create its schema and prove its
// permissions — what the settings page's "Test connection" runs.
type tenantStore interface {
	Store
	ensureSchema(ctx context.Context) error
	probe(ctx context.Context) error
}

// openDB connects to a company's database. It does not create tables; see
// connectDB for the full connect-and-prepare sequence.
func openDB(ctx context.Context, cfg *DBConfig) (tenantStore, error) {
	if cfg.URI == "" {
		if err := checkHostResolvable(ctx, cfg.Host); err != nil {
			return nil, err
		}
	}
	switch cfg.Provider {
	case models.ResidencyDBPostgres:
		return openPostgres(cfg)
	case models.ResidencyDBMySQL, models.ResidencyDBMariaDB:
		return openMySQL(cfg)
	case models.ResidencyDBSQLServer:
		return openSQLServer(cfg)
	case models.ResidencyDBMongoDB:
		return openMongo(ctx, cfg)
	}
	return nil, fmt.Errorf("unsupported database %q", cfg.Provider)
}

// connectDB opens, pings, creates Aavishield's tables if needed and returns
// the ready store.
func connectDB(ctx context.Context, cfg *DBConfig) (tenantStore, error) {
	st, err := openDB(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := st.Ping(pingCtx); err != nil {
		st.Close()
		return nil, describeConnectError(err, cfg)
	}
	schemaCtx, cancel2 := context.WithTimeout(ctx, 60*time.Second)
	defer cancel2()
	if err := st.ensureSchema(schemaCtx); err != nil {
		st.Close()
		return nil, err
	}
	return st, nil
}

func gormConfig() *gorm.Config {
	return &gorm.Config{
		Logger:                 logger.Default.LogMode(logger.Silent),
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	}
}

func tunePool(db *sql.DB) {
	db.SetMaxOpenConns(tenantMaxOpen)
	db.SetMaxIdleConns(tenantMaxIdle)
	db.SetConnMaxLifetime(tenantConnMaxLife)
	db.SetConnMaxIdleTime(tenantConnMaxIdle)
}

func openPostgres(cfg *DBConfig) (tenantStore, error) {
	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(cfg.Username, cfg.Password),
		Host:   hostPort(cfg.Host, cfg.Port),
		Path:   "/" + cfg.Database,
	}
	q := url.Values{}
	q.Set("sslmode", cfg.TLS)
	q.Set("connect_timeout", strconv.Itoa(int(dialTimeout.Seconds())))
	q.Set("application_name", "aavishield")
	u.RawQuery = q.Encode()

	pcfg, err := pgx.ParseConfig(u.String())
	if err != nil {
		return nil, fmt.Errorf("invalid PostgreSQL settings: %w", err)
	}
	pcfg.DialFunc = guardedDialContext
	// Every unqualified table name — Aavishield's included — resolves to the
	// company's chosen schema.
	pcfg.RuntimeParams["search_path"] = cfg.Schema
	// A company's database may sit behind PgBouncer in transaction mode,
	// which cannot keep named server-side prepared statements; describe-exec
	// uses the unnamed statement only.
	pcfg.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec

	sqlDB := stdlib.OpenDB(*pcfg)
	tunePool(sqlDB)
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), gormConfig())
	if err != nil {
		sqlDB.Close()
		return nil, err
	}
	st := newTenantSQLStore(db, cfg.Provider)
	return &pgTenant{sqlStore: st, schema: cfg.Schema}, nil
}

// pgTenant creates the company's chosen schema before the tables, when it
// is allowed to.
type pgTenant struct {
	*sqlStore
	schema string
}

func (p *pgTenant) ensureSchema(ctx context.Context) error {
	if p.schema != "" && p.schema != "public" {
		// Best effort: a user without CREATE on the database may still own an
		// existing schema, and the table statements below say so clearly if not.
		p.db.WithContext(ctx).Exec(`CREATE SCHEMA IF NOT EXISTS "` + p.schema + `"`)
	}
	return p.sqlStore.ensureSchema(ctx)
}

func openMySQL(cfg *DBConfig) (tenantStore, error) {
	m := mysqldriver.NewConfig()
	m.User = cfg.Username
	m.Passwd = cfg.Password
	m.Net = guardedMySQLNet
	m.Addr = hostPort(cfg.Host, cfg.Port)
	m.DBName = cfg.Database
	m.ParseTime = true
	m.Loc = time.UTC
	m.Timeout = dialTimeout
	m.ReadTimeout = 60 * time.Second
	m.WriteTimeout = 60 * time.Second
	m.AllowNativePasswords = true
	m.Params = map[string]string{"charset": "utf8mb4", "time_zone": "'+00:00'"}
	switch cfg.TLS {
	case "verify-full":
		m.TLSConfig = "true"
	case "require":
		m.TLSConfig = "skip-verify"
	default:
		m.TLSConfig = "false"
	}
	connector, err := mysqldriver.NewConnector(m)
	if err != nil {
		return nil, fmt.Errorf("invalid MySQL settings: %w", err)
	}
	sqlDB := sql.OpenDB(connector)
	tunePool(sqlDB)
	db, err := gorm.Open(mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}), gormConfig())
	if err != nil {
		sqlDB.Close()
		return nil, err
	}
	return newTenantSQLStore(db, cfg.Provider), nil
}

// mssqlDialer adapts guardedDialContext to go-mssqldb's Dialer interface.
type mssqlDialer struct{}

func (mssqlDialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	return guardedDialContext(ctx, network, addr)
}

func openSQLServer(cfg *DBConfig) (tenantStore, error) {
	q := url.Values{}
	q.Set("database", cfg.Database)
	q.Set("app name", "aavishield")
	q.Set("dial timeout", strconv.Itoa(int(dialTimeout.Seconds())))
	switch cfg.TLS {
	case "verify-full":
		q.Set("encrypt", "true")
		q.Set("TrustServerCertificate", "false")
	case "require":
		q.Set("encrypt", "true")
		q.Set("TrustServerCertificate", "true")
	default:
		q.Set("encrypt", "disable")
	}
	u := url.URL{
		Scheme:   "sqlserver",
		User:     url.UserPassword(cfg.Username, cfg.Password),
		Host:     hostPort(cfg.Host, cfg.Port),
		RawQuery: q.Encode(),
	}
	connector, err := mssql.NewConnector(u.String())
	if err != nil {
		return nil, fmt.Errorf("invalid SQL Server settings: %w", err)
	}
	connector.Dialer = mssqlDialer{}
	sqlDB := sql.OpenDB(connector)
	tunePool(sqlDB)
	db, err := gorm.Open(sqlserver.New(sqlserver.Config{Conn: sqlDB}), gormConfig())
	if err != nil {
		sqlDB.Close()
		return nil, err
	}
	return newTenantSQLStore(db, cfg.Provider), nil
}

func openMongo(ctx context.Context, cfg *DBConfig) (tenantStore, error) {
	uri := cfg.URI
	if uri == "" {
		u := url.URL{
			Scheme: "mongodb",
			User:   url.UserPassword(cfg.Username, cfg.Password),
			Host:   hostPort(cfg.Host, cfg.Port),
			Path:   "/",
		}
		q := url.Values{}
		q.Set("authSource", "admin")
		switch cfg.TLS {
		case "verify-full":
			q.Set("tls", "true")
		case "require":
			q.Set("tls", "true")
			q.Set("tlsInsecure", "true")
		default:
			q.Set("tls", "false")
		}
		u.RawQuery = q.Encode()
		uri = u.String()
	}
	opts := options.Client().ApplyURI(uri).
		SetDialer(guardedDialer()).
		SetAppName("aavishield").
		SetServerSelectionTimeout(10 * time.Second).
		SetConnectTimeout(dialTimeout).
		SetMaxPoolSize(tenantMaxOpen).
		SetMaxConnIdleTime(tenantConnMaxIdle)
	if err := opts.Validate(); err != nil {
		return nil, fmt.Errorf("invalid MongoDB connection string: %w", err)
	}
	client, err := mongo.Connect(opts)
	if err != nil {
		return nil, fmt.Errorf("invalid MongoDB settings: %w", err)
	}
	return newMongoStore(client, cfg.Database), nil
}

// describeConnectError makes a failed connection readable on the settings
// page.
func describeConnectError(err error, cfg *DBConfig) error {
	var priv ErrPrivateAddress
	if asPrivate(err, &priv) {
		return priv
	}
	return fmt.Errorf("could not connect to %s: %v", describeDB(cfg), err)
}

// ─── Object storage ───────────────────────────────────────────────────────────

// openFiles builds the storage backend for a company's bucket.
func openFiles(ctx context.Context, cfg *FilesConfig) (storage.Backend, error) {
	if host := cfg.endpointHost(); host != "" {
		if err := checkHostResolvable(ctx, host); err != nil {
			return nil, err
		}
	}
	client := guardedHTTPClient()
	if cfg.Provider == models.ResidencyFilesAzure {
		return storage.NewAzure(storage.AzureConfig{
			Account: cfg.AccountName, AccountKey: cfg.AccountKey, Container: cfg.Container,
			Prefix: cfg.Prefix, Endpoint: cfg.Endpoint, Client: client,
		})
	}
	pathStyle := true
	switch cfg.Provider {
	case models.ResidencyFilesS3:
		// AWS: virtual-hosted unless the bucket name can't be a hostname
		// label (dots break TLS wildcard matching).
		pathStyle = cfg.Endpoint != "" || containsDot(cfg.Bucket)
	case models.ResidencyFilesS3Compatible:
		pathStyle = cfg.PathStyle
	}
	return storage.NewS3(storage.S3Config{
		Kind: cfg.Provider, Endpoint: cfg.endpoint(), Region: cfg.Region, Bucket: cfg.Bucket,
		Prefix: cfg.Prefix, AccessKey: cfg.AccessKeyID, SecretKey: cfg.SecretAccessKey,
		PathStyle: pathStyle, Client: client,
	}), nil
}

func containsDot(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == '.' {
			return true
		}
	}
	return false
}
