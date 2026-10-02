package dataplane

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

// mongoStore keeps a company's employee data in MongoDB, in three collections
// that mirror the SQL tables (aavishield_activity_events, …). Documents use
// the same field names as the SQL columns and store IDs as UUID strings, so a
// company querying its own data sees the same shape whichever engine it chose.
type mongoStore struct {
	client *mongo.Client
	db     *mongo.Database
	events *mongo.Collection
	sess   *mongo.Collection
	shots  *mongo.Collection
	meta   *mongo.Collection
}

func newMongoStore(client *mongo.Client, database string) *mongoStore {
	db := client.Database(database)
	return &mongoStore{
		client: client,
		db:     db,
		events: db.Collection(tablePrefix + "activity_events"),
		sess:   db.Collection(tablePrefix + "work_sessions"),
		shots:  db.Collection(tablePrefix + "screenshots"),
		meta:   db.Collection(tablePrefix + "meta"),
	}
}

func (m *mongoStore) Kind() string { return models.ResidencyDBMongoDB }

func (m *mongoStore) Ping(ctx context.Context) error {
	return m.client.Ping(ctx, readpref.Primary())
}

func (m *mongoStore) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return m.client.Disconnect(ctx)
}

// ─── Documents ────────────────────────────────────────────────────────────────

type mEvent struct {
	ID            string         `bson:"_id"`
	OrgID         string         `bson:"org_id"`
	EmployeeID    *string        `bson:"employee_id"`
	DeviceID      *string        `bson:"device_id"`
	EventType     string         `bson:"event_type"`
	Action        string         `bson:"action"`
	Target        string         `bson:"target"`
	TargetDomain  string         `bson:"target_domain"`
	Operation     string         `bson:"operation"`
	Category      string         `bson:"category"`
	ProcessName   string         `bson:"process_name"`
	PolicyID      *string        `bson:"policy_id"`
	PolicyName    string         `bson:"policy_name"`
	RiskScore     float64        `bson:"risk_score"`
	AIExplanation string         `bson:"ai_explanation"`
	IPAddress     string         `bson:"ip_address"`
	GeoCountry    string         `bson:"geo_country"`
	GeoCity       string         `bson:"geo_city"`
	Metadata      map[string]any `bson:"metadata"`
	DedupeKey     string         `bson:"dedupe_key,omitempty"`
	Timestamp     time.Time      `bson:"timestamp"`
	CreatedAt     time.Time      `bson:"created_at"`
}

type mSession struct {
	ID              string     `bson:"_id"`
	CreatedAt       time.Time  `bson:"created_at"`
	UpdatedAt       time.Time  `bson:"updated_at"`
	OrgID           string     `bson:"org_id"`
	EmployeeID      *string    `bson:"employee_id"`
	DeviceID        *string    `bson:"device_id"`
	StartedAt       time.Time  `bson:"started_at"`
	EndedAt         *time.Time `bson:"ended_at"`
	Project         string     `bson:"project"`
	Task            string     `bson:"task"`
	Hostname        string     `bson:"hostname"`
	IP              string     `bson:"ip"`
	Notes           string     `bson:"notes"`
	ScreenshotCount int        `bson:"screenshot_count"`
	ActiveSeconds   int        `bson:"active_seconds"`
	TrackedSeconds  int        `bson:"tracked_seconds"`
	AvgActivity     float64    `bson:"avg_activity"`
}

type mShot struct {
	ID              string    `bson:"_id"`
	CreatedAt       time.Time `bson:"created_at"`
	UpdatedAt       time.Time `bson:"updated_at"`
	OrgID           string    `bson:"org_id"`
	EmployeeID      *string   `bson:"employee_id"`
	DeviceID        *string   `bson:"device_id"`
	SessionID       *string   `bson:"session_id"`
	CapturedAt      time.Time `bson:"captured_at"`
	IntervalStart   time.Time `bson:"interval_start"`
	IntervalEnd     time.Time `bson:"interval_end"`
	StorageKey      string    `bson:"storage_key"`
	Width           int       `bson:"width"`
	Height          int       `bson:"height"`
	Bytes           int       `bson:"bytes"`
	ActivityPercent int       `bson:"activity_percent"`
	ActiveSeconds   int       `bson:"active_seconds"`
	IntervalSeconds int       `bson:"interval_seconds"`
	KeyboardCount   int       `bson:"keyboard_count"`
	MouseCount      int       `bson:"mouse_count"`
	ScrollCount     int       `bson:"scroll_count"`
	State           string    `bson:"state"`
	OpenApps        []string  `bson:"open_apps"`
}

func idStr(id *uuid.UUID) *string {
	if id == nil {
		return nil
	}
	s := id.String()
	return &s
}

func idPtr(s *string) *uuid.UUID {
	if s == nil {
		return nil
	}
	id, err := uuid.Parse(*s)
	if err != nil {
		return nil
	}
	return &id
}

func toMEvent(ev *models.ActivityEvent) mEvent {
	return mEvent{
		ID: ev.ID.String(), OrgID: ev.OrgID.String(),
		EmployeeID: idStr(ev.EmployeeID), DeviceID: idStr(ev.DeviceID),
		EventType: string(ev.EventType), Action: string(ev.Action),
		Target: ev.Target, TargetDomain: ev.TargetDomain, Operation: ev.Operation,
		Category: ev.Category, ProcessName: ev.ProcessName,
		PolicyID: idStr(ev.PolicyID), PolicyName: ev.PolicyName,
		RiskScore: ev.RiskScore, AIExplanation: ev.AIExplanation,
		IPAddress: ev.IPAddress, GeoCountry: ev.GeoCountry, GeoCity: ev.GeoCity,
		Metadata: ev.Metadata, DedupeKey: ev.DedupeKey,
		Timestamp: ev.Timestamp.UTC(), CreatedAt: ev.CreatedAt.UTC(),
	}
}

func (d mEvent) model() models.ActivityEvent {
	id, _ := uuid.Parse(d.ID)
	org, _ := uuid.Parse(d.OrgID)
	meta, _ := normalizeBSON(d.Metadata).(map[string]any)
	return models.ActivityEvent{
		ID: id, OrgID: org, EmployeeID: idPtr(d.EmployeeID), DeviceID: idPtr(d.DeviceID),
		EventType: models.EventType(d.EventType), Action: models.EventAction(d.Action),
		Target: d.Target, TargetDomain: d.TargetDomain, Operation: d.Operation,
		Category: d.Category, ProcessName: d.ProcessName, PolicyID: idPtr(d.PolicyID),
		PolicyName: d.PolicyName, RiskScore: d.RiskScore, AIExplanation: d.AIExplanation,
		IPAddress: d.IPAddress, GeoCountry: d.GeoCountry, GeoCity: d.GeoCity,
		Metadata: meta, DedupeKey: d.DedupeKey, Timestamp: d.Timestamp, CreatedAt: d.CreatedAt,
	}
}

// normalizeBSON gives decoded metadata the shapes encoding/json would have
// produced — map[string]any, []any, float64 — because every reader of
// ActivityEvent.Metadata type-asserts against exactly those.
func normalizeBSON(v any) any {
	switch t := v.(type) {
	case bson.M:
		out := make(map[string]any, len(t))
		for k, x := range t {
			out[k] = normalizeBSON(x)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, x := range t {
			out[k] = normalizeBSON(x)
		}
		return out
	case bson.D:
		out := make(map[string]any, len(t))
		for _, e := range t {
			out[e.Key] = normalizeBSON(e.Value)
		}
		return out
	case bson.A:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = normalizeBSON(x)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = normalizeBSON(x)
		}
		return out
	case int32:
		return float64(t)
	case int64:
		return float64(t)
	case int:
		return float64(t)
	case bson.DateTime:
		return t.Time().UTC().Format(time.RFC3339Nano)
	}
	return v
}

func toMSession(s *models.WorkSession) mSession {
	return mSession{
		ID: s.ID.String(), CreatedAt: s.CreatedAt.UTC(), UpdatedAt: s.UpdatedAt.UTC(),
		OrgID: s.OrgID.String(), EmployeeID: idStr(s.EmployeeID), DeviceID: idStr(s.DeviceID),
		StartedAt: s.StartedAt.UTC(), EndedAt: s.EndedAt, Project: s.Project, Task: s.Task,
		Hostname: s.Hostname, IP: s.IP, Notes: s.Notes, ScreenshotCount: s.ScreenshotCount,
		ActiveSeconds: s.ActiveSeconds, TrackedSeconds: s.TrackedSeconds, AvgActivity: s.AvgActivity,
	}
}

func (d mSession) model() models.WorkSession {
	id, _ := uuid.Parse(d.ID)
	org, _ := uuid.Parse(d.OrgID)
	ws := models.WorkSession{
		OrgID: org, EmployeeID: idPtr(d.EmployeeID), DeviceID: idPtr(d.DeviceID),
		StartedAt: d.StartedAt, EndedAt: d.EndedAt, Project: d.Project, Task: d.Task,
		Hostname: d.Hostname, IP: d.IP, Notes: d.Notes, ScreenshotCount: d.ScreenshotCount,
		ActiveSeconds: d.ActiveSeconds, TrackedSeconds: d.TrackedSeconds, AvgActivity: d.AvgActivity,
	}
	ws.ID, ws.CreatedAt, ws.UpdatedAt = id, d.CreatedAt, d.UpdatedAt
	return ws
}

func toMShot(s *models.Screenshot) mShot {
	return mShot{
		ID: s.ID.String(), CreatedAt: s.CreatedAt.UTC(), UpdatedAt: s.UpdatedAt.UTC(),
		OrgID: s.OrgID.String(), EmployeeID: idStr(s.EmployeeID), DeviceID: idStr(s.DeviceID),
		SessionID: idStr(s.SessionID), CapturedAt: s.CapturedAt.UTC(),
		IntervalStart: s.IntervalStart.UTC(), IntervalEnd: s.IntervalEnd.UTC(),
		StorageKey: s.StorageKey, Width: s.Width, Height: s.Height, Bytes: s.Bytes,
		ActivityPercent: s.ActivityPercent, ActiveSeconds: s.ActiveSeconds,
		IntervalSeconds: s.IntervalSeconds, KeyboardCount: s.KeyboardCount,
		MouseCount: s.MouseCount, ScrollCount: s.ScrollCount, State: s.State, OpenApps: s.OpenApps,
	}
}

func (d mShot) model() models.Screenshot {
	id, _ := uuid.Parse(d.ID)
	org, _ := uuid.Parse(d.OrgID)
	s := models.Screenshot{
		OrgID: org, EmployeeID: idPtr(d.EmployeeID), DeviceID: idPtr(d.DeviceID),
		SessionID: idPtr(d.SessionID), CapturedAt: d.CapturedAt,
		IntervalStart: d.IntervalStart, IntervalEnd: d.IntervalEnd, StorageKey: d.StorageKey,
		Width: d.Width, Height: d.Height, Bytes: d.Bytes, ActivityPercent: d.ActivityPercent,
		ActiveSeconds: d.ActiveSeconds, IntervalSeconds: d.IntervalSeconds,
		KeyboardCount: d.KeyboardCount, MouseCount: d.MouseCount, ScrollCount: d.ScrollCount,
		State: d.State, OpenApps: d.OpenApps,
	}
	s.ID, s.CreatedAt, s.UpdatedAt = id, d.CreatedAt, d.UpdatedAt
	return s
}

// ─── Filters ──────────────────────────────────────────────────────────────────

func uuidStrings(ids []uuid.UUID) bson.A {
	out := make(bson.A, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	return out
}

func strAnys(in []string) bson.A {
	out := make(bson.A, len(in))
	for i, v := range in {
		out[i] = v
	}
	return out
}

func containsRe(s string) bson.Regex {
	return bson.Regex{Pattern: regexp.QuoteMeta(s), Options: "i"}
}

func notCategoriesM(cats []string) bson.M {
	return bson.M{"$or": bson.A{
		bson.M{"category": nil},
		bson.M{"category": bson.M{"$nin": strAnys(cats)}},
	}}
}

func eventFilter(q EventQuery) bson.M {
	var and bson.A
	add := func(m bson.M) { and = append(and, m) }

	if q.OrgID != uuid.Nil {
		add(bson.M{"org_id": q.OrgID.String()})
	}
	if len(q.IDs) > 0 {
		add(bson.M{"_id": bson.M{"$in": uuidStrings(q.IDs)}})
	}
	if q.EmployeeID != nil {
		add(bson.M{"employee_id": q.EmployeeID.String()})
	}
	if q.RestrictEmployees {
		add(bson.M{"employee_id": bson.M{"$in": uuidStrings(q.EmployeeIn)}})
	}
	if q.HasEmployee {
		add(bson.M{"employee_id": bson.M{"$ne": nil}})
	}
	if q.DeviceID != nil {
		add(bson.M{"device_id": q.DeviceID.String()})
	}
	if q.PolicyID != nil {
		add(bson.M{"policy_id": q.PolicyID.String()})
	}
	if len(q.EventTypes) > 0 {
		add(bson.M{"event_type": bson.M{"$in": strAnys(q.EventTypes)}})
	}
	if len(q.Actions) > 0 {
		add(bson.M{"action": bson.M{"$in": strAnys(q.Actions)}})
	}
	if len(q.NotActions) > 0 {
		add(bson.M{"action": bson.M{"$nin": strAnys(q.NotActions)}})
	}
	if len(q.Categories) > 0 {
		add(bson.M{"category": bson.M{"$in": strAnys(q.Categories)}})
	}
	if len(q.NotCategories) > 0 {
		add(notCategoriesM(q.NotCategories))
	}
	if len(q.AnyOf) > 0 {
		var alts bson.A
		for _, c := range q.AnyOf {
			var parts bson.A
			if len(c.EventTypes) > 0 {
				parts = append(parts, bson.M{"event_type": bson.M{"$in": strAnys(c.EventTypes)}})
			}
			if len(c.Actions) > 0 {
				parts = append(parts, bson.M{"action": bson.M{"$in": strAnys(c.Actions)}})
			}
			if len(c.Categories) > 0 {
				parts = append(parts, bson.M{"category": bson.M{"$in": strAnys(c.Categories)}})
			}
			if len(c.NotCategories) > 0 {
				parts = append(parts, notCategoriesM(c.NotCategories))
			}
			if len(parts) > 0 {
				alts = append(alts, bson.M{"$and": parts})
			}
		}
		if len(alts) > 0 {
			add(bson.M{"$or": alts})
		}
	}
	ts := bson.M{}
	if !q.Since.IsZero() {
		ts["$gte"] = q.Since.UTC()
	}
	if !q.Before.IsZero() {
		ts["$lt"] = q.Before.UTC()
	}
	if !q.Until.IsZero() {
		ts["$lte"] = q.Until.UTC()
	}
	if len(ts) > 0 {
		add(bson.M{"timestamp": ts})
	}
	if q.Search != "" && len(q.SearchFields) > 0 {
		var alts bson.A
		for _, f := range q.SearchFields {
			if searchableEventFields[f] {
				alts = append(alts, bson.M{f: containsRe(q.Search)})
			}
		}
		if len(alts) > 0 {
			add(bson.M{"$or": alts})
		}
	}
	if len(q.DomainContainsAny) > 0 {
		var alts bson.A
		for _, d := range q.DomainContainsAny {
			alts = append(alts, bson.M{"target_domain": containsRe(d)})
		}
		add(bson.M{"$or": alts})
	}
	if q.TargetDomain != "" {
		add(bson.M{"target_domain": q.TargetDomain})
	}
	if q.HasTargetDomain {
		add(bson.M{"target_domain": bson.M{"$nin": bson.A{nil, ""}}})
	}
	if q.DedupeKey != "" {
		add(bson.M{"dedupe_key": q.DedupeKey})
	}
	if len(and) == 0 {
		return bson.M{}
	}
	return bson.M{"$and": and}
}

func eventSort(asc bool) bson.D {
	dir := -1
	if asc {
		dir = 1
	}
	return bson.D{{Key: "timestamp", Value: dir}, {Key: "_id", Value: dir}}
}

func projection(fields []string) bson.M {
	if len(fields) == 0 {
		return nil
	}
	p := bson.M{}
	for _, f := range fields {
		if !validEventColumn(f) {
			continue
		}
		if f == "id" {
			continue // _id is always returned
		}
		p[f] = 1
	}
	return p
}

// ─── Events ───────────────────────────────────────────────────────────────────

func (m *mongoStore) InsertEvents(ctx context.Context, events []*models.ActivityEvent) error {
	if len(events) == 0 {
		return nil
	}
	docs := make([]any, len(events))
	for i, ev := range events {
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
		docs[i] = toMEvent(ev)
	}
	_, err := m.events.InsertMany(ctx, docs)
	return err
}

func (m *mongoStore) UpdateEvent(ctx context.Context, ev *models.ActivityEvent, fields ...string) error {
	doc := toMEvent(ev)
	values := map[string]any{
		"metadata": doc.Metadata, "risk_score": doc.RiskScore, "target": doc.Target,
		"policy_id": doc.PolicyID, "policy_name": doc.PolicyName, "ai_explanation": doc.AIExplanation,
	}
	set := bson.M{}
	for _, f := range fields {
		if updatableEventFields[f] {
			set[f] = values[f]
		}
	}
	if len(set) == 0 {
		return nil
	}
	_, err := m.events.UpdateOne(ctx, bson.M{"_id": doc.ID}, bson.M{"$set": set})
	return err
}

func (m *mongoStore) FindEvents(ctx context.Context, q EventQuery) ([]models.ActivityEvent, error) {
	opts := options.Find().SetSort(eventSort(q.Ascending))
	if p := projection(q.Fields); p != nil {
		opts.SetProjection(p)
	}
	if q.Offset > 0 {
		opts.SetSkip(int64(q.Offset))
	}
	if q.Limit > 0 {
		opts.SetLimit(int64(q.Limit))
	}
	cur, err := m.events.Find(ctx, eventFilter(q), opts)
	if err != nil {
		return nil, err
	}
	var docs []mEvent
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	out := make([]models.ActivityEvent, len(docs))
	for i := range docs {
		out[i] = docs[i].model()
	}
	return out, nil
}

func (m *mongoStore) CountEvents(ctx context.Context, q EventQuery) (int64, error) {
	return m.events.CountDocuments(ctx, eventFilter(q))
}

func (m *mongoStore) GroupEvents(ctx context.Context, q EventQuery, groupBy string, limit int) ([]EventGroup, error) {
	if !groupableEventFields[groupBy] {
		return nil, fmt.Errorf("cannot group by %q", groupBy)
	}
	var key any
	if groupBy != "" {
		key = "$" + groupBy
	}
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: eventFilter(q)}},
		{{Key: "$group", Value: bson.M{
			"_id":   key,
			"n":     bson.M{"$sum": 1},
			"emps":  bson.M{"$addToSet": "$employee_id"},
			"risk":  bson.M{"$sum": "$risk_score"},
			"first": bson.M{"$min": "$timestamp"},
			"last":  bson.M{"$max": "$timestamp"},
		}}},
		{{Key: "$project", Value: bson.M{
			"n": 1, "risk": 1, "first": 1, "last": 1,
			"e": bson.M{"$size": bson.M{"$setDifference": bson.A{"$emps", bson.A{nil}}}},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "n", Value: -1}}}},
	}
	if groupBy != "" && limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
	}
	cur, err := m.events.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID    any        `bson:"_id"`
		N     int64      `bson:"n"`
		E     int64      `bson:"e"`
		Risk  float64    `bson:"risk"`
		First *time.Time `bson:"first"`
		Last  *time.Time `bson:"last"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	out := make([]EventGroup, 0, len(rows))
	for _, r := range rows {
		k, _ := r.ID.(string)
		out = append(out, EventGroup{Key: k, Count: r.N, Employees: r.E, RiskSum: r.Risk, First: r.First, Last: r.Last})
	}
	if groupBy == "" && len(out) == 0 {
		out = append(out, EventGroup{})
	}
	return out, nil
}

func (m *mongoStore) EachEvent(ctx context.Context, q EventQuery, fn func(*models.ActivityEvent) error) error {
	opts := options.Find().SetSort(eventSort(q.Ascending)).SetBatchSize(eachBatch)
	if p := projection(withKeyset(q.Fields)); p != nil {
		opts.SetProjection(p)
	}
	if q.Limit > 0 {
		opts.SetLimit(int64(q.Limit))
	}
	cur, err := m.events.Find(ctx, eventFilter(q), opts)
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var d mEvent
		if err := cur.Decode(&d); err != nil {
			return err
		}
		ev := d.model()
		if err := fn(&ev); err != nil {
			return err
		}
	}
	return cur.Err()
}

func (m *mongoStore) DeleteEvents(ctx context.Context, q EventQuery) (int64, error) {
	res, err := m.events.DeleteMany(ctx, eventFilter(q))
	if err != nil {
		return 0, err
	}
	return res.DeletedCount, nil
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

func sessionFilter(q SessionQuery) bson.M {
	var and bson.A
	add := func(m bson.M) { and = append(and, m) }
	if q.OrgID != uuid.Nil {
		add(bson.M{"org_id": q.OrgID.String()})
	}
	if len(q.IDs) > 0 {
		add(bson.M{"_id": bson.M{"$in": uuidStrings(q.IDs)}})
	}
	if q.EmployeeID != nil {
		add(bson.M{"employee_id": q.EmployeeID.String()})
	}
	if q.DeviceID != nil {
		add(bson.M{"device_id": q.DeviceID.String()})
	}
	if q.Open != nil {
		if *q.Open {
			add(bson.M{"ended_at": nil})
		} else {
			add(bson.M{"ended_at": bson.M{"$ne": nil}})
		}
	}
	if !q.UpdatedSince.IsZero() {
		add(bson.M{"updated_at": bson.M{"$gte": q.UpdatedSince.UTC()}})
	}
	if !q.UpdatedBefore.IsZero() {
		add(bson.M{"updated_at": bson.M{"$lt": q.UpdatedBefore.UTC()}})
	}
	if !q.StartedSince.IsZero() {
		add(bson.M{"started_at": bson.M{"$gte": q.StartedSince.UTC()}})
	}
	if !q.StartedBefore.IsZero() {
		add(bson.M{"started_at": bson.M{"$lt": q.StartedBefore.UTC()}})
	}
	if !q.ActiveAfter.IsZero() {
		add(bson.M{"$or": bson.A{
			bson.M{"ended_at": nil},
			bson.M{"ended_at": bson.M{"$gte": q.ActiveAfter.UTC()}},
		}})
	}
	if !q.EndedBefore.IsZero() {
		add(bson.M{"ended_at": bson.M{"$ne": nil, "$lt": q.EndedBefore.UTC()}})
	}
	if q.NoScreenshots {
		add(bson.M{"screenshot_count": 0})
	}
	if len(and) == 0 {
		return bson.M{}
	}
	return bson.M{"$and": and}
}

func (m *mongoStore) InsertSession(ctx context.Context, s *models.WorkSession) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	now := time.Now()
	if s.CreatedAt.IsZero() {
		s.CreatedAt = now
	}
	if s.UpdatedAt.IsZero() {
		s.UpdatedAt = now
	}
	if s.Project == "" {
		s.Project = "Default Project"
	}
	if s.Task == "" {
		s.Task = "Default Task"
	}
	_, err := m.sess.InsertOne(ctx, toMSession(s))
	return err
}

func (m *mongoStore) UpdateSessions(ctx context.Context, q SessionQuery, fields map[string]any) (int64, error) {
	set := bson.M{}
	for k, v := range fields {
		if !updatableSessionFields[k] {
			continue
		}
		if t, ok := v.(time.Time); ok {
			v = t.UTC()
		}
		set[k] = v
	}
	if len(set) == 0 {
		return 0, nil
	}
	if _, ok := set["updated_at"]; !ok {
		set["updated_at"] = time.Now().UTC()
	}
	res, err := m.sess.UpdateMany(ctx, sessionFilter(q), bson.M{"$set": set})
	if err != nil {
		return 0, err
	}
	return res.ModifiedCount, nil
}

func (m *mongoStore) FindSessions(ctx context.Context, q SessionQuery) ([]models.WorkSession, error) {
	sort := bson.D{{Key: "started_at", Value: 1}}
	if q.OrderBy == "updated_at_desc" {
		sort = bson.D{{Key: "updated_at", Value: -1}}
	}
	opts := options.Find().SetSort(sort)
	if q.Limit > 0 {
		opts.SetLimit(int64(q.Limit))
	}
	cur, err := m.sess.Find(ctx, sessionFilter(q), opts)
	if err != nil {
		return nil, err
	}
	var docs []mSession
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	out := make([]models.WorkSession, len(docs))
	for i := range docs {
		out[i] = docs[i].model()
	}
	return out, nil
}

func (m *mongoStore) DeleteSessions(ctx context.Context, q SessionQuery) (int64, error) {
	res, err := m.sess.DeleteMany(ctx, sessionFilter(q))
	if err != nil {
		return 0, err
	}
	return res.DeletedCount, nil
}

// ─── Screenshots ──────────────────────────────────────────────────────────────

func shotFilter(q ScreenshotQuery) bson.M {
	var and bson.A
	add := func(m bson.M) { and = append(and, m) }
	if q.OrgID != uuid.Nil {
		add(bson.M{"org_id": q.OrgID.String()})
	}
	if len(q.IDs) > 0 {
		add(bson.M{"_id": bson.M{"$in": uuidStrings(q.IDs)}})
	}
	if q.EmployeeID != nil {
		add(bson.M{"employee_id": q.EmployeeID.String()})
	}
	if q.SessionID != nil {
		add(bson.M{"session_id": q.SessionID.String()})
	}
	ts := bson.M{}
	if !q.CapturedSince.IsZero() {
		ts["$gte"] = q.CapturedSince.UTC()
	}
	if !q.CapturedBefore.IsZero() {
		ts["$lt"] = q.CapturedBefore.UTC()
	}
	if len(ts) > 0 {
		add(bson.M{"captured_at": ts})
	}
	if len(and) == 0 {
		return bson.M{}
	}
	return bson.M{"$and": and}
}

func (m *mongoStore) InsertScreenshot(ctx context.Context, s *models.Screenshot) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	now := time.Now()
	if s.CreatedAt.IsZero() {
		s.CreatedAt = now
	}
	if s.UpdatedAt.IsZero() {
		s.UpdatedAt = now
	}
	if s.State == "" {
		s.State = "active"
	}
	if s.IntervalStart.IsZero() {
		s.IntervalStart = s.CapturedAt
	}
	if s.IntervalEnd.IsZero() {
		s.IntervalEnd = s.CapturedAt
	}
	_, err := m.shots.InsertOne(ctx, toMShot(s))
	return err
}

func (m *mongoStore) FindScreenshots(ctx context.Context, q ScreenshotQuery) ([]models.Screenshot, error) {
	dir := 1
	if q.Descending {
		dir = -1
	}
	opts := options.Find().SetSort(bson.D{{Key: "captured_at", Value: dir}})
	if q.Limit > 0 {
		opts.SetLimit(int64(q.Limit))
	}
	cur, err := m.shots.Find(ctx, shotFilter(q), opts)
	if err != nil {
		return nil, err
	}
	var docs []mShot
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	out := make([]models.Screenshot, len(docs))
	for i := range docs {
		out[i] = docs[i].model()
	}
	return out, nil
}

func (m *mongoStore) DeleteScreenshots(ctx context.Context, q ScreenshotQuery) (int64, error) {
	res, err := m.shots.DeleteMany(ctx, shotFilter(q))
	if err != nil {
		return 0, err
	}
	return res.DeletedCount, nil
}

func (m *mongoStore) ScreenshotEmployees(ctx context.Context, orgID uuid.UUID) ([]uuid.UUID, error) {
	res := m.shots.Distinct(ctx, "employee_id", bson.M{"org_id": orgID.String(), "employee_id": bson.M{"$ne": nil}})
	if err := res.Err(); err != nil {
		return nil, err
	}
	var raw []string
	if err := res.Decode(&raw); err != nil {
		return nil, err
	}
	out := make([]uuid.UUID, 0, len(raw))
	for _, s := range raw {
		if id, err := uuid.Parse(s); err == nil {
			out = append(out, id)
		}
	}
	return out, nil
}

func (m *mongoStore) SessionRollup(ctx context.Context, sessionID uuid.UUID) (Rollup, error) {
	cur, err := m.shots.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"session_id": sessionID.String()}}},
		{{Key: "$group", Value: bson.M{
			"_id":     nil,
			"count":   bson.M{"$sum": 1},
			"active":  bson.M{"$sum": "$active_seconds"},
			"tracked": bson.M{"$sum": "$interval_seconds"},
			"avg":     bson.M{"$avg": "$activity_percent"},
		}}},
	})
	if err != nil {
		return Rollup{}, err
	}
	var rows []struct {
		Count   int     `bson:"count"`
		Active  int     `bson:"active"`
		Tracked int     `bson:"tracked"`
		Avg     float64 `bson:"avg"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return Rollup{}, err
	}
	if len(rows) == 0 {
		return Rollup{}, nil
	}
	r := rows[0]
	return Rollup{Count: r.Count, Active: r.Active, Tracked: r.Tracked, AvgActivity: r.Avg}, nil
}

// ─── Schema and probe ────────────────────────────────────────────────────────

func (m *mongoStore) ensureSchema(ctx context.Context) error {
	idx := func(name string, keys ...string) mongo.IndexModel {
		d := bson.D{}
		for _, k := range keys {
			d = append(d, bson.E{Key: k, Value: 1})
		}
		return mongo.IndexModel{Keys: d, Options: options.Index().SetName(name)}
	}
	sets := []struct {
		coll *mongo.Collection
		idx  []mongo.IndexModel
	}{
		{m.events, []mongo.IndexModel{
			idx("aavishield_ae_org_ts", "org_id", "timestamp"),
			idx("aavishield_ae_emp_ts", "employee_id", "timestamp"),
			idx("aavishield_ae_dev_dedupe", "device_id", "dedupe_key", "timestamp"),
			idx("aavishield_ae_org_domain", "org_id", "target_domain"),
			idx("aavishield_ae_policy", "policy_id"),
		}},
		{m.sess, []mongo.IndexModel{
			idx("aavishield_ws_org_emp", "org_id", "employee_id", "started_at"),
			idx("aavishield_ws_dev_open", "device_id", "ended_at"),
		}},
		{m.shots, []mongo.IndexModel{
			idx("aavishield_ss_org_emp", "org_id", "employee_id", "captured_at"),
			idx("aavishield_ss_session", "session_id"),
			idx("aavishield_ss_org_ts", "org_id", "captured_at"),
		}},
	}
	for _, s := range sets {
		if _, err := s.coll.Indexes().CreateMany(ctx, s.idx); err != nil {
			return describeMongoError(err, "create Aavishield's collections and indexes")
		}
	}
	return nil
}

func (m *mongoStore) probe(ctx context.Context) error {
	key := "probe:" + uuid.NewString()
	if _, err := m.meta.InsertOne(ctx, bson.M{"_id": key, "v": "write", "updated_at": time.Now().UTC()}); err != nil {
		return describeMongoError(err, "write (insert)")
	}
	var got bson.M
	if err := m.meta.FindOne(ctx, bson.M{"_id": key}).Decode(&got); err != nil {
		return describeMongoError(err, "read (find)")
	}
	if _, err := m.meta.UpdateOne(ctx, bson.M{"_id": key}, bson.M{"$set": bson.M{"v": "update"}}); err != nil {
		return describeMongoError(err, "update")
	}
	if _, err := m.meta.DeleteOne(ctx, bson.M{"_id": key}); err != nil {
		return describeMongoError(err, "delete")
	}
	_, err := m.meta.UpdateOne(ctx, bson.M{"_id": "schema_version"},
		bson.M{"$set": bson.M{"v": "1", "updated_at": time.Now().UTC()}}, options.UpdateOne().SetUpsert(true))
	return err
}

func describeMongoError(err error, what string) error {
	var cmd mongo.CommandError
	msg := err.Error()
	if errors.As(err, &cmd) && (cmd.Code == 13 || cmd.Code == 18) || strings.Contains(strings.ToLower(msg), "not authorized") {
		return fmt.Errorf("connected, but the MongoDB user is not allowed to %s. Give it the readWrite role on this database (plus createIndex). Server said: %s", what, msg)
	}
	return fmt.Errorf("could not %s: %s", what, msg)
}
