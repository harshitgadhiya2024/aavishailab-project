package dataplane

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// sqlStore serves both Aavishield's own database (the primary store, tables
// activity_events / work_sessions / screenshots) and a company's SQL database
// (tables prefixed aavishield_, created by ensureSchema).
//
// Every condition is built from gorm clause values rather than SQL strings,
// so identifiers are quoted the way each engine wants and nothing here
// depends on Postgres syntax. Aggregations stay to what all four engines
// share (COUNT, COUNT DISTINCT, SUM, MIN, MAX, AVG); anything richer is done
// in Go over EachEvent by the caller.
type sqlStore struct {
	db      *gorm.DB
	kind    string
	dialect string // postgres | mysql | sqlserver
	tenant  bool

	tEvents, tSessions, tShots, tMeta string
}

const tablePrefix = "aavishield_"

func newPrimaryStore(db *gorm.DB) *sqlStore {
	return &sqlStore{
		db: db, kind: "primary", dialect: "postgres",
		tEvents: "activity_events", tSessions: "work_sessions", tShots: "screenshots",
	}
}

func newTenantSQLStore(db *gorm.DB, provider string) *sqlStore {
	dialect := "postgres"
	switch provider {
	case models.ResidencyDBMySQL, models.ResidencyDBMariaDB:
		dialect = "mysql"
	case models.ResidencyDBSQLServer:
		dialect = "sqlserver"
	}
	return &sqlStore{
		db: db, kind: provider, dialect: dialect, tenant: true,
		tEvents:   tablePrefix + "activity_events",
		tSessions: tablePrefix + "work_sessions",
		tShots:    tablePrefix + "screenshots",
		tMeta:     tablePrefix + "meta",
	}
}

func (s *sqlStore) Kind() string { return s.kind }

func (s *sqlStore) Ping(ctx context.Context) error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.PingContext(ctx)
}

func (s *sqlStore) Close() error {
	if !s.tenant {
		return nil // the primary pool belongs to the whole process
	}
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// q quotes an identifier for raw SELECT expressions.
func (s *sqlStore) q(name string) string {
	switch s.dialect {
	case "mysql":
		return "`" + name + "`"
	case "sqlserver":
		return "[" + name + "]"
	}
	return `"` + name + `"`
}

func col(name string) clause.Column { return clause.Column{Name: name} }

func anys[T any](in []T) []any {
	out := make([]any, len(in))
	for i, v := range in {
		out[i] = v
	}
	return out
}

func lowerLike(field, pattern string) clause.Expression {
	return clause.Expr{SQL: "LOWER(?) LIKE ?", Vars: []any{col(field), strings.ToLower(pattern)}}
}

// ─── Events ───────────────────────────────────────────────────────────────────

func (s *sqlStore) eventScope(ctx context.Context, q EventQuery) *gorm.DB {
	db := s.db.WithContext(ctx).Table(s.tEvents)
	var conds []clause.Expression

	if q.OrgID != uuid.Nil {
		conds = append(conds, clause.Eq{Column: col("org_id"), Value: q.OrgID})
	}
	if len(q.IDs) > 0 {
		conds = append(conds, clause.IN{Column: col("id"), Values: anys(q.IDs)})
	}
	if q.EmployeeID != nil {
		conds = append(conds, clause.Eq{Column: col("employee_id"), Value: *q.EmployeeID})
	}
	if q.RestrictEmployees {
		conds = append(conds, clause.IN{Column: col("employee_id"), Values: anys(q.EmployeeIn)})
	}
	if q.HasEmployee {
		conds = append(conds, clause.Neq{Column: col("employee_id"), Value: nil})
	}
	if q.DeviceID != nil {
		conds = append(conds, clause.Eq{Column: col("device_id"), Value: *q.DeviceID})
	}
	if q.PolicyID != nil {
		conds = append(conds, clause.Eq{Column: col("policy_id"), Value: *q.PolicyID})
	}
	if len(q.EventTypes) > 0 {
		conds = append(conds, clause.IN{Column: col("event_type"), Values: anys(q.EventTypes)})
	}
	if len(q.Actions) > 0 {
		conds = append(conds, clause.IN{Column: col("action"), Values: anys(q.Actions)})
	}
	if len(q.NotActions) > 0 {
		conds = append(conds, clause.Not(clause.IN{Column: col("action"), Values: anys(q.NotActions)}))
	}
	if len(q.Categories) > 0 {
		conds = append(conds, clause.IN{Column: col("category"), Values: anys(q.Categories)})
	}
	if len(q.NotCategories) > 0 {
		conds = append(conds, notCategories(q.NotCategories))
	}
	if len(q.AnyOf) > 0 {
		var alts []clause.Expression
		for _, c := range q.AnyOf {
			var parts []clause.Expression
			if len(c.EventTypes) > 0 {
				parts = append(parts, clause.IN{Column: col("event_type"), Values: anys(c.EventTypes)})
			}
			if len(c.Actions) > 0 {
				parts = append(parts, clause.IN{Column: col("action"), Values: anys(c.Actions)})
			}
			if len(c.Categories) > 0 {
				parts = append(parts, clause.IN{Column: col("category"), Values: anys(c.Categories)})
			}
			if len(c.NotCategories) > 0 {
				parts = append(parts, notCategories(c.NotCategories))
			}
			if len(parts) > 0 {
				alts = append(alts, clause.And(parts...))
			}
		}
		if len(alts) > 0 {
			conds = append(conds, anyOf(alts))
		}
	}
	if !q.Since.IsZero() {
		conds = append(conds, clause.Gte{Column: col("timestamp"), Value: q.Since.UTC()})
	}
	if !q.Before.IsZero() {
		conds = append(conds, clause.Lt{Column: col("timestamp"), Value: q.Before.UTC()})
	}
	if !q.Until.IsZero() {
		conds = append(conds, clause.Lte{Column: col("timestamp"), Value: q.Until.UTC()})
	}
	if q.Search != "" && len(q.SearchFields) > 0 {
		var alts []clause.Expression
		for _, f := range q.SearchFields {
			if searchableEventFields[f] {
				alts = append(alts, lowerLike(f, "%"+q.Search+"%"))
			}
		}
		if len(alts) > 0 {
			conds = append(conds, anyOf(alts))
		}
	}
	if len(q.DomainContainsAny) > 0 {
		var alts []clause.Expression
		for _, d := range q.DomainContainsAny {
			alts = append(alts, lowerLike("target_domain", "%"+d+"%"))
		}
		conds = append(conds, anyOf(alts))
	}
	if q.TargetDomain != "" {
		conds = append(conds, clause.Eq{Column: col("target_domain"), Value: q.TargetDomain})
	}
	if q.HasTargetDomain {
		conds = append(conds, clause.Neq{Column: col("target_domain"), Value: nil},
			clause.Neq{Column: col("target_domain"), Value: ""})
	}
	if q.DedupeKey != "" {
		conds = append(conds, clause.Eq{Column: col("dedupe_key"), Value: q.DedupeKey})
	}
	if len(conds) > 0 {
		db = db.Clauses(clause.Where{Exprs: conds})
	}
	return db
}

// anyOf ORs alternatives together as one condition. A single alternative is
// returned as is, never wrapped: GORM renders a one-element clause.Or among
// other WHERE conditions as "... OR x" rather than "... AND x", which would
// drop every other filter — org and employee included — for that query.
func anyOf(alts []clause.Expression) clause.Expression {
	if len(alts) == 1 {
		return alts[0]
	}
	return clause.Or(alts...)
}

func notCategories(cats []string) clause.Expression {
	return clause.Or(
		clause.Eq{Column: col("category"), Value: nil},
		clause.Not(clause.IN{Column: col("category"), Values: anys(cats)}),
	)
}

func (s *sqlStore) project(db *gorm.DB, fields []string) *gorm.DB {
	if len(fields) == 0 {
		return db
	}
	var ok []string
	for _, f := range fields {
		if validEventColumn(f) {
			ok = append(ok, f)
		}
	}
	return db.Select(ok)
}

// order sorts by (timestamp, id) — id breaks ties so paging and EachEvent's
// keyset are stable. One OrderByColumn per call: gorm's Order ignores a
// clause.OrderBy value.
func (s *sqlStore) order(db *gorm.DB, asc bool) *gorm.DB {
	return db.Order(clause.OrderByColumn{Column: col("timestamp"), Desc: !asc}).
		Order(clause.OrderByColumn{Column: col("id"), Desc: !asc})
}

func (s *sqlStore) prepareEvent(ev *models.ActivityEvent) {
	if ev.ID == uuid.Nil {
		ev.ID = uuid.New()
	}
	if ev.Action == "" {
		ev.Action = models.EventActionLogged
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now()
	}
	if ev.CreatedAt.IsZero() {
		ev.CreatedAt = time.Now()
	}
	if s.tenant {
		// The tenant schema bounds the indexed columns; an over-long value
		// must be shortened rather than refused (strict-mode MySQL errors).
		ev.TargetDomain = clamp(ev.TargetDomain, 255)
		ev.DedupeKey = clamp(ev.DedupeKey, 255)
		ev.Category = clamp(ev.Category, 128)
		ev.IPAddress = clamp(ev.IPAddress, 64)
		ev.GeoCountry = clamp(ev.GeoCountry, 64)
		ev.GeoCity = clamp(ev.GeoCity, 128)
	}
}

func clamp(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func (s *sqlStore) InsertEvents(ctx context.Context, events []*models.ActivityEvent) error {
	if len(events) == 0 {
		return nil
	}
	for _, ev := range events {
		s.prepareEvent(ev)
	}
	// SQL Server accepts at most 2,100 parameters per statement; a row of
	// activity_events binds 22.
	batch := 100
	if s.dialect == "sqlserver" {
		batch = 50
	}
	return s.db.WithContext(ctx).Table(s.tEvents).Omit(clause.Associations).CreateInBatches(events, batch).Error
}

func (s *sqlStore) UpdateEvent(ctx context.Context, ev *models.ActivityEvent, fields ...string) error {
	var ok []string
	for _, f := range fields {
		if updatableEventFields[f] {
			ok = append(ok, f)
		}
	}
	if len(ok) == 0 || ev.ID == uuid.Nil {
		return nil
	}
	return s.db.WithContext(ctx).Table(s.tEvents).Model(ev).Omit(clause.Associations).
		Select(ok).Updates(ev).Error
}

func (s *sqlStore) FindEvents(ctx context.Context, q EventQuery) ([]models.ActivityEvent, error) {
	db := s.order(s.project(s.eventScope(ctx, q), q.Fields), q.Ascending)
	if q.Offset > 0 {
		db = db.Offset(q.Offset)
	}
	if q.Limit > 0 {
		db = db.Limit(q.Limit)
	}
	var out []models.ActivityEvent
	err := db.Find(&out).Error
	return out, err
}

func (s *sqlStore) CountEvents(ctx context.Context, q EventQuery) (int64, error) {
	var n int64
	err := s.eventScope(ctx, q).Count(&n).Error
	return n, err
}

func (s *sqlStore) GroupEvents(ctx context.Context, q EventQuery, groupBy string, limit int) ([]EventGroup, error) {
	if !groupableEventFields[groupBy] {
		return nil, fmt.Errorf("cannot group by %q", groupBy)
	}
	ts := s.q("timestamp")
	sel := "COUNT(*) AS n, COUNT(DISTINCT " + s.q("employee_id") + ") AS e, COALESCE(SUM(" + s.q("risk_score") +
		"),0) AS r, MIN(" + ts + ") AS f, MAX(" + ts + ") AS l"
	db := s.eventScope(ctx, q)
	if groupBy != "" {
		sel = s.q(groupBy) + " AS k, " + sel
		db = db.Group(groupBy).Order("n DESC") // gorm quotes the (whitelisted) name per engine
		if limit > 0 {
			db = db.Limit(limit)
		}
	}
	var rows []struct {
		K *string
		N int64
		E int64
		R float64
		F *time.Time
		L *time.Time
	}
	if err := db.Select(sel).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]EventGroup, 0, len(rows))
	for _, r := range rows {
		g := EventGroup{Count: r.N, Employees: r.E, RiskSum: r.R, First: r.F, Last: r.L}
		if r.K != nil {
			g.Key = *r.K
		}
		if groupBy == "" && g.Count == 0 {
			g.First, g.Last = nil, nil
		}
		out = append(out, g)
	}
	return out, nil
}

// EachEvent pages with a keyset on (timestamp, id) rather than OFFSET, so a
// long scan stays cheap and is never holding one cursor open for minutes.
func (s *sqlStore) EachEvent(ctx context.Context, q EventQuery, fn func(*models.ActivityEvent) error) error {
	fields := withKeyset(q.Fields)
	remaining := q.Limit
	var lastTS time.Time
	var lastID uuid.UUID
	for {
		db := s.order(s.project(s.eventScope(ctx, q), fields), q.Ascending)
		if lastID != uuid.Nil {
			cmp := "<"
			if q.Ascending {
				cmp = ">"
			}
			ts, id := s.q("timestamp"), s.q("id")
			db = db.Where("("+ts+" "+cmp+" ? OR ("+ts+" = ? AND "+id+" "+cmp+" ?))", lastTS, lastTS, lastID)
		}
		batch := eachBatch
		if q.Limit > 0 && remaining < batch {
			batch = remaining
		}
		var page []models.ActivityEvent
		if err := db.Limit(batch).Find(&page).Error; err != nil {
			return err
		}
		for i := range page {
			if err := fn(&page[i]); err != nil {
				return err
			}
		}
		if len(page) < batch {
			return nil
		}
		last := page[len(page)-1]
		lastTS, lastID = last.Timestamp, last.ID
		if q.Limit > 0 {
			remaining -= len(page)
			if remaining <= 0 {
				return nil
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
}

func (s *sqlStore) DeleteEvents(ctx context.Context, q EventQuery) (int64, error) {
	res := s.eventScope(ctx, q).Delete(&models.ActivityEvent{})
	return res.RowsAffected, res.Error
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

func (s *sqlStore) sessionScope(ctx context.Context, q SessionQuery) *gorm.DB {
	db := s.db.WithContext(ctx).Table(s.tSessions)
	var conds []clause.Expression
	conds = append(conds, clause.Eq{Column: col("deleted_at"), Value: nil})
	if q.OrgID != uuid.Nil {
		conds = append(conds, clause.Eq{Column: col("org_id"), Value: q.OrgID})
	}
	if len(q.IDs) > 0 {
		conds = append(conds, clause.IN{Column: col("id"), Values: anys(q.IDs)})
	}
	if q.EmployeeID != nil {
		conds = append(conds, clause.Eq{Column: col("employee_id"), Value: *q.EmployeeID})
	}
	if q.DeviceID != nil {
		conds = append(conds, clause.Eq{Column: col("device_id"), Value: *q.DeviceID})
	}
	if q.Open != nil {
		if *q.Open {
			conds = append(conds, clause.Eq{Column: col("ended_at"), Value: nil})
		} else {
			conds = append(conds, clause.Neq{Column: col("ended_at"), Value: nil})
		}
	}
	if !q.UpdatedSince.IsZero() {
		conds = append(conds, clause.Gte{Column: col("updated_at"), Value: q.UpdatedSince.UTC()})
	}
	if !q.UpdatedBefore.IsZero() {
		conds = append(conds, clause.Lt{Column: col("updated_at"), Value: q.UpdatedBefore.UTC()})
	}
	if !q.StartedSince.IsZero() {
		conds = append(conds, clause.Gte{Column: col("started_at"), Value: q.StartedSince.UTC()})
	}
	if !q.StartedBefore.IsZero() {
		conds = append(conds, clause.Lt{Column: col("started_at"), Value: q.StartedBefore.UTC()})
	}
	if !q.ActiveAfter.IsZero() {
		conds = append(conds, clause.Or(
			clause.Eq{Column: col("ended_at"), Value: nil},
			clause.Gte{Column: col("ended_at"), Value: q.ActiveAfter.UTC()},
		))
	}
	if !q.EndedBefore.IsZero() {
		conds = append(conds, clause.Neq{Column: col("ended_at"), Value: nil},
			clause.Lt{Column: col("ended_at"), Value: q.EndedBefore.UTC()})
	}
	if q.NoScreenshots {
		conds = append(conds, clause.Eq{Column: col("screenshot_count"), Value: 0})
	}
	return db.Clauses(clause.Where{Exprs: conds})
}

func (s *sqlStore) InsertSession(ctx context.Context, ws *models.WorkSession) error {
	if ws.ID == uuid.Nil {
		ws.ID = uuid.New()
	}
	if ws.Project == "" {
		ws.Project = "Default Project"
	}
	if ws.Task == "" {
		ws.Task = "Default Task"
	}
	return s.db.WithContext(ctx).Table(s.tSessions).Omit(clause.Associations).Create(ws).Error
}

func (s *sqlStore) UpdateSessions(ctx context.Context, q SessionQuery, fields map[string]any) (int64, error) {
	set := map[string]any{}
	for k, v := range fields {
		if updatableSessionFields[k] {
			set[k] = v
		}
	}
	if len(set) == 0 {
		return 0, nil
	}
	if _, ok := set["updated_at"]; !ok {
		set["updated_at"] = time.Now().UTC()
	}
	res := s.sessionScope(ctx, q).Updates(set)
	return res.RowsAffected, res.Error
}

func (s *sqlStore) FindSessions(ctx context.Context, q SessionQuery) ([]models.WorkSession, error) {
	db := s.sessionScope(ctx, q)
	if q.OrderBy == "updated_at_desc" {
		db = db.Order(clause.OrderByColumn{Column: col("updated_at"), Desc: true})
	} else {
		db = db.Order(clause.OrderByColumn{Column: col("started_at")})
	}
	if q.Limit > 0 {
		db = db.Limit(q.Limit)
	}
	var out []models.WorkSession
	err := db.Find(&out).Error
	return out, err
}

func (s *sqlStore) DeleteSessions(ctx context.Context, q SessionQuery) (int64, error) {
	res := s.sessionScope(ctx, q).Unscoped().Delete(&models.WorkSession{})
	return res.RowsAffected, res.Error
}

// ─── Screenshots ──────────────────────────────────────────────────────────────

func (s *sqlStore) shotScope(ctx context.Context, q ScreenshotQuery) *gorm.DB {
	db := s.db.WithContext(ctx).Table(s.tShots)
	conds := []clause.Expression{clause.Eq{Column: col("deleted_at"), Value: nil}}
	if q.OrgID != uuid.Nil {
		conds = append(conds, clause.Eq{Column: col("org_id"), Value: q.OrgID})
	}
	if len(q.IDs) > 0 {
		conds = append(conds, clause.IN{Column: col("id"), Values: anys(q.IDs)})
	}
	if q.EmployeeID != nil {
		conds = append(conds, clause.Eq{Column: col("employee_id"), Value: *q.EmployeeID})
	}
	if q.SessionID != nil {
		conds = append(conds, clause.Eq{Column: col("session_id"), Value: *q.SessionID})
	}
	if !q.CapturedSince.IsZero() {
		conds = append(conds, clause.Gte{Column: col("captured_at"), Value: q.CapturedSince.UTC()})
	}
	if !q.CapturedBefore.IsZero() {
		conds = append(conds, clause.Lt{Column: col("captured_at"), Value: q.CapturedBefore.UTC()})
	}
	return db.Clauses(clause.Where{Exprs: conds})
}

func (s *sqlStore) InsertScreenshot(ctx context.Context, shot *models.Screenshot) error {
	if shot.ID == uuid.Nil {
		shot.ID = uuid.New()
	}
	if shot.State == "" {
		shot.State = "active"
	}
	// An interval the agent didn't report is the capture moment itself — and
	// Go's zero time is outside MySQL's DATETIME range.
	if shot.IntervalStart.IsZero() {
		shot.IntervalStart = shot.CapturedAt
	}
	if shot.IntervalEnd.IsZero() {
		shot.IntervalEnd = shot.CapturedAt
	}
	return s.db.WithContext(ctx).Table(s.tShots).Omit(clause.Associations).Create(shot).Error
}

func (s *sqlStore) FindScreenshots(ctx context.Context, q ScreenshotQuery) ([]models.Screenshot, error) {
	db := s.shotScope(ctx, q).Order(clause.OrderByColumn{Column: col("captured_at"), Desc: q.Descending})
	if q.Limit > 0 {
		db = db.Limit(q.Limit)
	}
	var out []models.Screenshot
	err := db.Find(&out).Error
	return out, err
}

func (s *sqlStore) DeleteScreenshots(ctx context.Context, q ScreenshotQuery) (int64, error) {
	res := s.shotScope(ctx, q).Unscoped().Delete(&models.Screenshot{})
	return res.RowsAffected, res.Error
}

func (s *sqlStore) SetScreenshotNote(ctx context.Context, orgID, employeeID, id uuid.UUID, note string, at time.Time) (bool, error) {
	q := ScreenshotQuery{OrgID: orgID, EmployeeID: &employeeID, IDs: []uuid.UUID{id}}
	// Look first: MySQL reports zero affected rows when the value is
	// unchanged, which would read as "not yours" on a repeat save.
	found, err := s.FindScreenshots(ctx, ScreenshotQuery{OrgID: orgID, EmployeeID: &employeeID, IDs: []uuid.UUID{id}, Limit: 1})
	if err != nil || len(found) == 0 {
		return false, err
	}
	err = s.shotScope(ctx, q).Updates(map[string]any{
		"employee_note": note, "employee_note_at": at.UTC(), "updated_at": time.Now().UTC(),
	}).Error
	return err == nil, err
}

func (s *sqlStore) ScreenshotEmployees(ctx context.Context, orgID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := s.shotScope(ctx, ScreenshotQuery{OrgID: orgID}).
		Where(clause.Neq{Column: col("employee_id"), Value: nil}).
		Distinct().Pluck("employee_id", &ids).Error
	return ids, err
}

func (s *sqlStore) SessionRollup(ctx context.Context, sessionID uuid.UUID) (Rollup, error) {
	var agg struct {
		Count   int
		Active  int
		Tracked int
		Avg     float64
	}
	err := s.shotScope(ctx, ScreenshotQuery{SessionID: &sessionID}).
		Select("COUNT(*) AS count, COALESCE(SUM(" + s.q("active_seconds") + "),0) AS active, " +
			"COALESCE(SUM(" + s.q("interval_seconds") + "),0) AS tracked, " +
			"COALESCE(AVG(" + s.q("activity_percent") + " * 1.0),0) AS avg").
		Scan(&agg).Error
	return Rollup{Count: agg.Count, Active: agg.Active, Tracked: agg.Tracked, AvgActivity: agg.Avg}, err
}

// ─── Schema (tenant databases only) ──────────────────────────────────────────

// ensureSchema creates Aavishield's tables in a company's database if they are
// not there yet. Idempotent; runs on every connect, so a schema change ships
// as one more IF NOT EXISTS statement here.
func (s *sqlStore) ensureSchema(ctx context.Context) error {
	if !s.tenant {
		return errors.New("ensureSchema is for company databases")
	}
	for _, stmt := range tenantDDL(s.dialect) {
		if err := s.db.WithContext(ctx).Exec(stmt).Error; err != nil {
			return describeSQLError(err, "create Aavishield's tables")
		}
	}
	for _, stmt := range tenantUpgrades(s.dialect) {
		if err := s.db.WithContext(ctx).Exec(stmt).Error; err != nil && !isDuplicateColumn(err) {
			return describeSQLError(err, "update Aavishield's tables")
		}
	}
	return nil
}

// tenantUpgrades adds columns introduced after a company's tables were first
// created. Each statement is idempotent; for MySQL, which has no ADD COLUMN IF
// NOT EXISTS, a "duplicate column" error simply means it is already there.
func tenantUpgrades(dialect string) []string {
	switch dialect {
	case "mysql":
		return []string{
			"ALTER TABLE aavishield_screenshots ADD COLUMN employee_note TEXT NULL",
			"ALTER TABLE aavishield_screenshots ADD COLUMN employee_note_at DATETIME(6) NULL",
		}
	case "sqlserver":
		return []string{
			`IF COL_LENGTH('aavishield_screenshots', 'employee_note') IS NULL
			ALTER TABLE aavishield_screenshots ADD employee_note NVARCHAR(MAX) NULL`,
			`IF COL_LENGTH('aavishield_screenshots', 'employee_note_at') IS NULL
			ALTER TABLE aavishield_screenshots ADD employee_note_at DATETIMEOFFSET NULL`,
		}
	}
	return []string{
		"ALTER TABLE aavishield_screenshots ADD COLUMN IF NOT EXISTS employee_note TEXT",
		"ALTER TABLE aavishield_screenshots ADD COLUMN IF NOT EXISTS employee_note_at TIMESTAMPTZ",
	}
}

func isDuplicateColumn(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "duplicate column") || strings.Contains(s, "1060")
}

func tenantDDL(dialect string) []string {
	switch dialect {
	case "mysql":
		return mysqlDDL
	case "sqlserver":
		return sqlserverDDL
	}
	return postgresDDL
}

var postgresDDL = []string{
	`CREATE TABLE IF NOT EXISTS aavishield_meta (
		k VARCHAR(100) PRIMARY KEY,
		v TEXT,
		updated_at TIMESTAMPTZ
	)`,
	`CREATE TABLE IF NOT EXISTS aavishield_activity_events (
		id UUID PRIMARY KEY,
		org_id UUID NOT NULL,
		employee_id UUID,
		device_id UUID,
		event_type VARCHAR(64) NOT NULL,
		action VARCHAR(32) NOT NULL DEFAULT 'logged',
		target TEXT,
		target_domain VARCHAR(255),
		operation TEXT,
		category VARCHAR(128),
		process_name TEXT,
		policy_id UUID,
		policy_name TEXT,
		risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
		ai_explanation TEXT,
		ip_address VARCHAR(64),
		geo_country VARCHAR(64),
		geo_city VARCHAR(128),
		metadata JSONB,
		dedupe_key VARCHAR(255),
		"timestamp" TIMESTAMPTZ NOT NULL,
		created_at TIMESTAMPTZ
	)`,
	`CREATE INDEX IF NOT EXISTS aavishield_ae_org_ts ON aavishield_activity_events (org_id, "timestamp")`,
	`CREATE INDEX IF NOT EXISTS aavishield_ae_emp_ts ON aavishield_activity_events (employee_id, "timestamp")`,
	`CREATE INDEX IF NOT EXISTS aavishield_ae_dev_dedupe ON aavishield_activity_events (device_id, dedupe_key, "timestamp")`,
	`CREATE INDEX IF NOT EXISTS aavishield_ae_org_domain ON aavishield_activity_events (org_id, target_domain)`,
	`CREATE INDEX IF NOT EXISTS aavishield_ae_policy ON aavishield_activity_events (policy_id)`,
	`CREATE TABLE IF NOT EXISTS aavishield_work_sessions (
		id UUID PRIMARY KEY,
		created_at TIMESTAMPTZ,
		updated_at TIMESTAMPTZ,
		deleted_at TIMESTAMPTZ,
		org_id UUID NOT NULL,
		employee_id UUID,
		device_id UUID,
		started_at TIMESTAMPTZ NOT NULL,
		ended_at TIMESTAMPTZ,
		project TEXT DEFAULT 'Default Project',
		task TEXT DEFAULT 'Default Task',
		hostname TEXT,
		ip VARCHAR(64),
		notes TEXT,
		screenshot_count INTEGER NOT NULL DEFAULT 0,
		active_seconds INTEGER NOT NULL DEFAULT 0,
		tracked_seconds INTEGER NOT NULL DEFAULT 0,
		avg_activity DOUBLE PRECISION NOT NULL DEFAULT 0
	)`,
	`CREATE INDEX IF NOT EXISTS aavishield_ws_org_emp ON aavishield_work_sessions (org_id, employee_id, started_at)`,
	`CREATE INDEX IF NOT EXISTS aavishield_ws_dev_open ON aavishield_work_sessions (device_id, ended_at)`,
	`CREATE TABLE IF NOT EXISTS aavishield_screenshots (
		id UUID PRIMARY KEY,
		created_at TIMESTAMPTZ,
		updated_at TIMESTAMPTZ,
		deleted_at TIMESTAMPTZ,
		org_id UUID NOT NULL,
		employee_id UUID,
		device_id UUID,
		session_id UUID,
		captured_at TIMESTAMPTZ NOT NULL,
		interval_start TIMESTAMPTZ,
		interval_end TIMESTAMPTZ,
		storage_key TEXT NOT NULL,
		width INTEGER NOT NULL DEFAULT 0,
		height INTEGER NOT NULL DEFAULT 0,
		bytes INTEGER NOT NULL DEFAULT 0,
		activity_percent INTEGER NOT NULL DEFAULT 0,
		active_seconds INTEGER NOT NULL DEFAULT 0,
		interval_seconds INTEGER NOT NULL DEFAULT 0,
		keyboard_count INTEGER NOT NULL DEFAULT 0,
		mouse_count INTEGER NOT NULL DEFAULT 0,
		scroll_count INTEGER NOT NULL DEFAULT 0,
		state VARCHAR(16) NOT NULL DEFAULT 'active',
		open_apps JSONB,
		employee_note TEXT,
		employee_note_at TIMESTAMPTZ
	)`,
	`CREATE INDEX IF NOT EXISTS aavishield_ss_org_emp ON aavishield_screenshots (org_id, employee_id, captured_at)`,
	`CREATE INDEX IF NOT EXISTS aavishield_ss_session ON aavishield_screenshots (session_id)`,
	`CREATE INDEX IF NOT EXISTS aavishield_ss_org_ts ON aavishield_screenshots (org_id, captured_at)`,
}

const mysqlTableOpts = ` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`

var mysqlDDL = []string{
	"CREATE TABLE IF NOT EXISTS aavishield_meta (\n" +
		"k VARCHAR(100) NOT NULL PRIMARY KEY,\n" +
		"v TEXT NULL,\n" +
		"updated_at DATETIME(6) NULL\n" +
		")" + mysqlTableOpts,
	"CREATE TABLE IF NOT EXISTS aavishield_activity_events (\n" +
		"id CHAR(36) NOT NULL PRIMARY KEY,\n" +
		"org_id CHAR(36) NOT NULL,\n" +
		"employee_id CHAR(36) NULL,\n" +
		"device_id CHAR(36) NULL,\n" +
		"event_type VARCHAR(64) NOT NULL,\n" +
		"`action` VARCHAR(32) NOT NULL DEFAULT 'logged',\n" +
		"target TEXT NULL,\n" +
		"target_domain VARCHAR(255) NULL,\n" +
		"operation TEXT NULL,\n" +
		"category VARCHAR(128) NULL,\n" +
		"process_name TEXT NULL,\n" +
		"policy_id CHAR(36) NULL,\n" +
		"policy_name TEXT NULL,\n" +
		"risk_score DOUBLE NOT NULL DEFAULT 0,\n" +
		"ai_explanation TEXT NULL,\n" +
		"ip_address VARCHAR(64) NULL,\n" +
		"geo_country VARCHAR(64) NULL,\n" +
		"geo_city VARCHAR(128) NULL,\n" +
		"metadata JSON NULL,\n" +
		"dedupe_key VARCHAR(255) NULL,\n" +
		"`timestamp` DATETIME(6) NOT NULL,\n" +
		"created_at DATETIME(6) NULL,\n" +
		"INDEX aavishield_ae_org_ts (org_id, `timestamp`),\n" +
		"INDEX aavishield_ae_emp_ts (employee_id, `timestamp`),\n" +
		"INDEX aavishield_ae_dev_dedupe (device_id, dedupe_key, `timestamp`),\n" +
		"INDEX aavishield_ae_org_domain (org_id, target_domain),\n" +
		"INDEX aavishield_ae_policy (policy_id)\n" +
		")" + mysqlTableOpts,
	"CREATE TABLE IF NOT EXISTS aavishield_work_sessions (\n" +
		"id CHAR(36) NOT NULL PRIMARY KEY,\n" +
		"created_at DATETIME(6) NULL,\n" +
		"updated_at DATETIME(6) NULL,\n" +
		"deleted_at DATETIME(6) NULL,\n" +
		"org_id CHAR(36) NOT NULL,\n" +
		"employee_id CHAR(36) NULL,\n" +
		"device_id CHAR(36) NULL,\n" +
		"started_at DATETIME(6) NOT NULL,\n" +
		"ended_at DATETIME(6) NULL,\n" +
		"project VARCHAR(255) NULL DEFAULT 'Default Project',\n" +
		"task VARCHAR(255) NULL DEFAULT 'Default Task',\n" +
		"hostname VARCHAR(255) NULL,\n" +
		"ip VARCHAR(64) NULL,\n" +
		"notes TEXT NULL,\n" +
		"screenshot_count INT NOT NULL DEFAULT 0,\n" +
		"active_seconds INT NOT NULL DEFAULT 0,\n" +
		"tracked_seconds INT NOT NULL DEFAULT 0,\n" +
		"avg_activity DOUBLE NOT NULL DEFAULT 0,\n" +
		"INDEX aavishield_ws_org_emp (org_id, employee_id, started_at),\n" +
		"INDEX aavishield_ws_dev_open (device_id, ended_at)\n" +
		")" + mysqlTableOpts,
	"CREATE TABLE IF NOT EXISTS aavishield_screenshots (\n" +
		"id CHAR(36) NOT NULL PRIMARY KEY,\n" +
		"created_at DATETIME(6) NULL,\n" +
		"updated_at DATETIME(6) NULL,\n" +
		"deleted_at DATETIME(6) NULL,\n" +
		"org_id CHAR(36) NOT NULL,\n" +
		"employee_id CHAR(36) NULL,\n" +
		"device_id CHAR(36) NULL,\n" +
		"session_id CHAR(36) NULL,\n" +
		"captured_at DATETIME(6) NOT NULL,\n" +
		"interval_start DATETIME(6) NULL,\n" +
		"interval_end DATETIME(6) NULL,\n" +
		"storage_key VARCHAR(1024) NOT NULL,\n" +
		"width INT NOT NULL DEFAULT 0,\n" +
		"height INT NOT NULL DEFAULT 0,\n" +
		"bytes INT NOT NULL DEFAULT 0,\n" +
		"activity_percent INT NOT NULL DEFAULT 0,\n" +
		"active_seconds INT NOT NULL DEFAULT 0,\n" +
		"interval_seconds INT NOT NULL DEFAULT 0,\n" +
		"keyboard_count INT NOT NULL DEFAULT 0,\n" +
		"mouse_count INT NOT NULL DEFAULT 0,\n" +
		"scroll_count INT NOT NULL DEFAULT 0,\n" +
		"state VARCHAR(16) NOT NULL DEFAULT 'active',\n" +
		"open_apps JSON NULL,\n" +
		"employee_note TEXT NULL,\n" +
		"employee_note_at DATETIME(6) NULL,\n" +
		"INDEX aavishield_ss_org_emp (org_id, employee_id, captured_at),\n" +
		"INDEX aavishield_ss_session (session_id),\n" +
		"INDEX aavishield_ss_org_ts (org_id, captured_at)\n" +
		")" + mysqlTableOpts,
}

var sqlserverDDL = []string{
	`IF OBJECT_ID(N'aavishield_meta', N'U') IS NULL
	CREATE TABLE aavishield_meta (
		k NVARCHAR(100) NOT NULL PRIMARY KEY,
		v NVARCHAR(MAX) NULL,
		updated_at DATETIMEOFFSET NULL
	)`,
	`IF OBJECT_ID(N'aavishield_activity_events', N'U') IS NULL
	CREATE TABLE aavishield_activity_events (
		id NVARCHAR(36) NOT NULL PRIMARY KEY,
		org_id NVARCHAR(36) NOT NULL,
		employee_id NVARCHAR(36) NULL,
		device_id NVARCHAR(36) NULL,
		event_type NVARCHAR(64) NOT NULL,
		[action] NVARCHAR(32) NOT NULL DEFAULT 'logged',
		target NVARCHAR(MAX) NULL,
		target_domain NVARCHAR(255) NULL,
		operation NVARCHAR(MAX) NULL,
		category NVARCHAR(128) NULL,
		process_name NVARCHAR(MAX) NULL,
		policy_id NVARCHAR(36) NULL,
		policy_name NVARCHAR(MAX) NULL,
		risk_score FLOAT NOT NULL DEFAULT 0,
		ai_explanation NVARCHAR(MAX) NULL,
		ip_address NVARCHAR(64) NULL,
		geo_country NVARCHAR(64) NULL,
		geo_city NVARCHAR(128) NULL,
		metadata NVARCHAR(MAX) NULL,
		dedupe_key NVARCHAR(255) NULL,
		[timestamp] DATETIMEOFFSET NOT NULL,
		created_at DATETIMEOFFSET NULL,
		INDEX aavishield_ae_org_ts (org_id, [timestamp]),
		INDEX aavishield_ae_emp_ts (employee_id, [timestamp]),
		INDEX aavishield_ae_dev_dedupe (device_id, dedupe_key, [timestamp]),
		INDEX aavishield_ae_org_domain (org_id, target_domain),
		INDEX aavishield_ae_policy (policy_id)
	)`,
	`IF OBJECT_ID(N'aavishield_work_sessions', N'U') IS NULL
	CREATE TABLE aavishield_work_sessions (
		id NVARCHAR(36) NOT NULL PRIMARY KEY,
		created_at DATETIMEOFFSET NULL,
		updated_at DATETIMEOFFSET NULL,
		deleted_at DATETIMEOFFSET NULL,
		org_id NVARCHAR(36) NOT NULL,
		employee_id NVARCHAR(36) NULL,
		device_id NVARCHAR(36) NULL,
		started_at DATETIMEOFFSET NOT NULL,
		ended_at DATETIMEOFFSET NULL,
		project NVARCHAR(255) NULL DEFAULT 'Default Project',
		task NVARCHAR(255) NULL DEFAULT 'Default Task',
		hostname NVARCHAR(255) NULL,
		ip NVARCHAR(64) NULL,
		notes NVARCHAR(MAX) NULL,
		screenshot_count INT NOT NULL DEFAULT 0,
		active_seconds INT NOT NULL DEFAULT 0,
		tracked_seconds INT NOT NULL DEFAULT 0,
		avg_activity FLOAT NOT NULL DEFAULT 0,
		INDEX aavishield_ws_org_emp (org_id, employee_id, started_at),
		INDEX aavishield_ws_dev_open (device_id, ended_at)
	)`,
	`IF OBJECT_ID(N'aavishield_screenshots', N'U') IS NULL
	CREATE TABLE aavishield_screenshots (
		id NVARCHAR(36) NOT NULL PRIMARY KEY,
		created_at DATETIMEOFFSET NULL,
		updated_at DATETIMEOFFSET NULL,
		deleted_at DATETIMEOFFSET NULL,
		org_id NVARCHAR(36) NOT NULL,
		employee_id NVARCHAR(36) NULL,
		device_id NVARCHAR(36) NULL,
		session_id NVARCHAR(36) NULL,
		captured_at DATETIMEOFFSET NOT NULL,
		interval_start DATETIMEOFFSET NULL,
		interval_end DATETIMEOFFSET NULL,
		storage_key NVARCHAR(1024) NOT NULL,
		width INT NOT NULL DEFAULT 0,
		height INT NOT NULL DEFAULT 0,
		bytes INT NOT NULL DEFAULT 0,
		activity_percent INT NOT NULL DEFAULT 0,
		active_seconds INT NOT NULL DEFAULT 0,
		interval_seconds INT NOT NULL DEFAULT 0,
		keyboard_count INT NOT NULL DEFAULT 0,
		mouse_count INT NOT NULL DEFAULT 0,
		scroll_count INT NOT NULL DEFAULT 0,
		state NVARCHAR(16) NOT NULL DEFAULT 'active',
		open_apps NVARCHAR(MAX) NULL,
		employee_note NVARCHAR(MAX) NULL,
		employee_note_at DATETIMEOFFSET NULL,
		INDEX aavishield_ss_org_emp (org_id, employee_id, captured_at),
		INDEX aavishield_ss_session (session_id),
		INDEX aavishield_ss_org_ts (org_id, captured_at)
	)`,
}

// ─── Permission probe ────────────────────────────────────────────────────────

// probe proves the read, write, update and delete permissions the settings
// page asks for, on a row of Aavishield's own meta table.
func (s *sqlStore) probe(ctx context.Context) error {
	key := "probe:" + uuid.NewString()
	db := s.db.WithContext(ctx)
	now := time.Now().UTC()
	t := s.tMeta
	if err := db.Exec("INSERT INTO "+t+" (k, v, updated_at) VALUES (?, ?, ?)", key, "write", now).Error; err != nil {
		return describeSQLError(err, "write (INSERT)")
	}
	var got []string
	if err := db.Raw("SELECT v FROM "+t+" WHERE k = ?", key).Scan(&got).Error; err != nil || len(got) != 1 {
		if err == nil {
			err = errors.New("the row just written could not be read back")
		}
		return describeSQLError(err, "read (SELECT)")
	}
	if err := db.Exec("UPDATE "+t+" SET v = ? WHERE k = ?", "update", key).Error; err != nil {
		return describeSQLError(err, "update (UPDATE)")
	}
	if err := db.Exec("DELETE FROM "+t+" WHERE k = ?", key).Error; err != nil {
		return describeSQLError(err, "delete (DELETE)")
	}
	if err := db.Exec("DELETE FROM "+t+" WHERE k = ?", "schema_version").Error; err != nil {
		return describeSQLError(err, "delete (DELETE)")
	}
	return db.Exec("INSERT INTO "+t+" (k, v, updated_at) VALUES (?, ?, ?)", "schema_version", "1", now).Error
}

// describeSQLError turns a driver error into something an admin can act on.
func describeSQLError(err error, what string) error {
	msg := err.Error()
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "permission denied"), strings.Contains(lower, "command denied"),
		strings.Contains(lower, "access denied"), strings.Contains(lower, "permission was denied"),
		strings.Contains(lower, "not authorized"), strings.Contains(lower, "unauthorized"):
		return fmt.Errorf("connected, but the database user is not allowed to %s. Grant it read, write and delete on this database (and CREATE, so Aavishield can add its tables). Server said: %s", what, msg)
	}
	return fmt.Errorf("could not %s: %s", what, msg)
}
