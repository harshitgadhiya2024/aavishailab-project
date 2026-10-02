package handlers

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/notifier"
)

// AccessRequestHandler manages employee requests for an exception to
// something that was blocked or flagged on their device, and the company's
// approve / deny / revoke workflow. An approved request IS the exception (see
// models.AccessRequest and access_scope.go) — there is no separate table to
// keep in sync.
type AccessRequestHandler struct {
	db *gorm.DB
}

func NewAccessRequestHandler(db *gorm.DB) *AccessRequestHandler {
	return &AccessRequestHandler{db: db}
}

// maxPendingPerEmployee keeps one person from flooding the company's queue.
const maxPendingPerEmployee = 25

// kindNoun is how a request kind reads in a sentence and an email.
func kindNoun(k models.AccessRequestKind) string {
	switch k {
	case models.AccessKindApplication:
		return "Application"
	case models.AccessKindExtension:
		return "Browser extension"
	case models.AccessKindDownload:
		return "Download"
	case models.AccessKindDLP:
		return "Data sharing"
	default:
		return "Website"
	}
}

// ─── Employee portal ──────────────────────────────────────────────────────────

// Create handles POST /api/v1/portal/access-requests.
//
// The employee names the activity row they were stopped on (event_id) and
// why they need it. The server, not the client, decides what that row can be
// granted for — so nobody can ask for access to something they never hit,
// and the request always names exactly what the row was about. Older portals
// sent {policy_id, domain}; that still works for websites.
func (h *AccessRequestHandler) Create(c *gin.Context) {
	empID, orgID, ok := portalIdentity(c)
	if !ok {
		return
	}

	var req struct {
		EventID string `json:"event_id"`
		Domain  string `json:"domain"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if len([]rune(req.Reason)) < 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Tell your company why you need this (a few words at least)"})
		return
	}
	if len([]rune(req.Reason)) > 1000 {
		req.Reason = string([]rune(req.Reason)[:1000])
	}

	st, ok := eventStore(c, orgID.String())
	if !ok {
		return
	}
	q := dataplane.EventQuery{OrgID: orgID, EmployeeID: &empID, Limit: 1}
	switch {
	case req.EventID != "":
		id, err := uuid.Parse(req.EventID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid event_id"})
			return
		}
		q.IDs = []uuid.UUID{id}
	case req.Domain != "":
		q.EventTypes = dataplane.Strings(models.EventTypeWebRequest)
		q.Actions = dataplane.Strings(models.EventActionBlocked)
		q.TargetDomain = normDomain(req.Domain)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "event_id is required"})
		return
	}
	found, err := st.FindEvents(c.Request.Context(), q)
	if err != nil {
		respondStoreError(c, err)
		return
	}
	if len(found) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "That activity was not found on your account"})
		return
	}
	ev := found[0]
	target, ok := requestableFrom(&ev)
	if !ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "There is nothing to request for this activity"})
		return
	}

	// One open request per thing: asking again returns the existing one.
	var existing models.AccessRequest
	if err := h.db.Where("employee_id = ? AND kind = ? AND resource = ? AND status IN ?",
		empID, target.Kind, target.Resource,
		[]models.AccessRequestStatus{models.AccessRequestPending, models.AccessRequestApproved}).
		First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, existing)
		return
	}
	var pending int64
	h.db.Model(&models.AccessRequest{}).Where("employee_id = ? AND status = ?", empID, models.AccessRequestPending).Count(&pending)
	if pending >= maxPendingPerEmployee {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "You have too many requests waiting. Wait for your company to review them first."})
		return
	}

	eventID := ev.ID
	request := models.AccessRequest{
		OrgID:      orgID,
		EmployeeID: empID,
		Kind:       target.Kind,
		Resource:   target.Resource,
		Label:      target.Label,
		EventID:    &eventID,
		PolicyID:   ev.PolicyID,
		Reason:     req.Reason,
		Status:     models.AccessRequestPending,
	}
	if target.Kind == models.AccessKindWebsite {
		request.Domain = target.Resource
	}
	if err := h.db.Create(&request).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create access request"})
		return
	}

	// Someone is stopped from something they say they need for work — that
	// waits on a human, so tell the humans now.
	var org models.Organization
	notify := true
	if err := h.db.First(&org, "id = ?", orgID).Error; err == nil {
		notify = org.WantsNotification("access_requests")
	}
	if admins := notifier.AdminEmails(h.db, orgID.String()); notify && len(admins) > 0 {
		var emp models.Employee
		name, email := "An employee", ""
		if err := h.db.First(&emp, "id = ?", empID).Error; err == nil {
			name, email = emp.FullName(), emp.Email
		}
		mailer.AccessRequestSubmitted(admins, name, email, kindNoun(target.Kind), target.Label, req.Reason, ev.PolicyName)
	}

	c.JSON(http.StatusCreated, request)
}

// ListMine handles GET /api/v1/portal/access-requests
func (h *AccessRequestHandler) ListMine(c *gin.Context) {
	empID, _, ok := portalIdentity(c)
	if !ok {
		return
	}
	var requests []models.AccessRequest
	h.db.Where("employee_id = ?", empID).Order("created_at DESC").Limit(200).Find(&requests)
	c.JSON(http.StatusOK, gin.H{"data": requests})
}

// Withdraw handles POST /api/v1/portal/access-requests/:id/withdraw — the
// employee no longer needs a request they have open.
func (h *AccessRequestHandler) Withdraw(c *gin.Context) {
	empID, _, ok := portalIdentity(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ? AND employee_id = ? AND status = ?", c.Param("id"), empID, models.AccessRequestPending).
		Delete(&models.AccessRequest{})
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "No open request to withdraw"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawn": true})
}

func portalIdentity(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
	empStr, ok1 := c.Get("portal_employee_id")
	orgStr, ok2 := c.Get("portal_org_id")
	if !ok1 || !ok2 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Employee portal authentication required"})
		return uuid.Nil, uuid.Nil, false
	}
	empID, err1 := uuid.Parse(empStr.(string))
	orgID, err2 := uuid.Parse(orgStr.(string))
	if err1 != nil || err2 != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid employee session"})
		return uuid.Nil, uuid.Nil, false
	}
	return empID, orgID, true
}

// ─── Company dashboard ─────────────────────────────────────────────────────────

// List handles GET /api/v1/access-requests
func (h *AccessRequestHandler) List(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}

	base := h.db.Model(&models.AccessRequest{}).Where("access_requests.org_id = ?", orgID)
	if kind := c.Query("kind"); kind != "" {
		base = base.Where("access_requests.kind = ?", kind)
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + strings.ToLower(search) + "%"
		base = base.Joins("LEFT JOIN employees e ON e.id = access_requests.employee_id").
			Where(`(LOWER(access_requests.label) LIKE ? OR LOWER(access_requests.resource) LIKE ? OR LOWER(access_requests.reason) LIKE ?
				OR LOWER(e.email) LIKE ? OR LOWER(e.first_name || ' ' || e.last_name) LIKE ?)`, like, like, like, like, like)
	}

	// Counts per status for the tabs, under the same kind/search filter.
	type statusCount struct {
		Status string
		N      int64
	}
	var sc []statusCount
	base.Session(&gorm.Session{}).Select("access_requests.status AS status, COUNT(*) AS n").Group("access_requests.status").Scan(&sc)
	counts := map[string]int64{}
	for _, s := range sc {
		counts[s.Status] = s.N
	}

	q := base.Session(&gorm.Session{})
	if status := c.Query("status"); status != "" {
		q = q.Where("access_requests.status IN ?", splitCSV(status))
	}
	var total int64
	q.Session(&gorm.Session{}).Count(&total)

	var requests []models.AccessRequest
	q.Session(&gorm.Session{}).Select("access_requests.*").
		Order("access_requests.created_at DESC").
		Offset((page - 1) * limit).Limit(limit).
		Find(&requests)
	attachRequestEmployees(h.db, requests)

	c.JSON(http.StatusOK, gin.H{
		"data": requests, "total": total, "page": page, "limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit), "counts": counts,
	})
}

// BlockedEmployees handles GET /api/v1/policies/:id/blocked-employees
// Lists employees who have actually been blocked by this policy at least
// once.
func (h *AccessRequestHandler) BlockedEmployees(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")

	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	type blockedEmp struct {
		EmployeeID    uuid.UUID `json:"employee_id"`
		FirstName     string    `json:"first_name"`
		LastName      string    `json:"last_name"`
		Email         string    `json:"email"`
		TargetDomain  string    `json:"target_domain"`
		LastBlockedAt time.Time `json:"last_blocked_at"`
	}
	st, ok := eventStore(c, orgID)
	if !ok {
		return
	}
	// Newest first, so the first row seen for each (employee, site) is the
	// latest block — what DISTINCT ON picked when this was one SQL query.
	events, err := st.FindEvents(c.Request.Context(), dataplane.EventQuery{
		OrgID: orgUUID(c), PolicyID: &policy.ID, HasEmployee: true,
		Actions: dataplane.Strings(models.EventActionBlocked),
		Fields:  []string{"id", "employee_id", "target_domain", "timestamp"},
		Limit:   5000,
	})
	if err != nil {
		respondStoreError(c, err)
		return
	}
	attachEmployees(h.db, events)
	rows := []blockedEmp{}
	seen := map[string]bool{}
	for _, ev := range events {
		if ev.Employee == nil {
			continue // employee since removed
		}
		k := ev.EmployeeID.String() + "|" + ev.TargetDomain
		if seen[k] {
			continue
		}
		seen[k] = true
		rows = append(rows, blockedEmp{
			EmployeeID: *ev.EmployeeID, FirstName: ev.Employee.FirstName, LastName: ev.Employee.LastName,
			Email: ev.Employee.Email, TargetDomain: ev.TargetDomain, LastBlockedAt: ev.Timestamp,
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].EmployeeID != rows[j].EmployeeID {
			return rows[i].EmployeeID.String() < rows[j].EmployeeID.String()
		}
		return rows[i].TargetDomain < rows[j].TargetDomain
	})

	c.JSON(http.StatusOK, gin.H{"data": rows})
}

// Approve handles POST /api/v1/access-requests/:id/approve
func (h *AccessRequestHandler) Approve(c *gin.Context) {
	h.resolve(c, models.AccessRequestPending, models.AccessRequestApproved)
}

// Deny handles POST /api/v1/access-requests/:id/deny
func (h *AccessRequestHandler) Deny(c *gin.Context) {
	h.resolve(c, models.AccessRequestPending, models.AccessRequestDenied)
}

// Revoke handles POST /api/v1/access-requests/:id/revoke — takes back access
// that was approved earlier.
func (h *AccessRequestHandler) Revoke(c *gin.Context) {
	h.resolve(c, models.AccessRequestApproved, models.AccessRequestRevoked)
}

func (h *AccessRequestHandler) resolve(c *gin.Context, from, to models.AccessRequestStatus) {
	orgID := c.GetString("scoped_org_id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var req struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	req.Note = strings.TrimSpace(req.Note)

	var ar models.AccessRequest
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&ar).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Access request not found"})
		return
	}
	if ar.Status != from {
		c.JSON(http.StatusConflict, gin.H{"error": "This request is already " + string(ar.Status)})
		return
	}

	// Conditional on the status it was read in, so two admins acting at once
	// can't both win.
	res := h.db.Model(&models.AccessRequest{}).Where("id = ? AND status = ?", ar.ID, from).Updates(map[string]any{
		"status":      to,
		"reviewed_by": uid,
		"reviewed_at": time.Now(),
		"review_note": req.Note,
	})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update access request"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Someone else just reviewed this request"})
		return
	}

	orgUUID, _ := uuid.Parse(orgID)
	h.db.Create(&models.AuditLog{
		OrgID: &orgUUID, UserID: &uid,
		Action: string(to), Resource: "access_request", ResourceID: &ar.ID,
		Changes:   map[string]any{"kind": ar.Kind, "resource": ar.Resource, "label": ar.Label, "note": req.Note},
		IPAddress: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	h.db.First(&ar, "id = ?", ar.ID)
	one := []models.AccessRequest{ar}
	attachRequestEmployees(h.db, one)
	ar = one[0]

	// The employee is waiting on this answer — tell them rather than making
	// them re-check the portal.
	if ar.Employee != nil && ar.Employee.Email != "" {
		mailer.AccessRequestResolved(ar.Employee.Email, ar.Employee.FirstName, kindNoun(ar.Kind), ar.Label, string(to), req.Note)
	}

	c.JSON(http.StatusOK, ar)
}

// attachRequestEmployees loads each request's employee in one query. Not
// Preload: Employee's own HRIS EmployeeID field confuses GORM's association
// detection (see attachEmployees).
func attachRequestEmployees(db *gorm.DB, requests []models.AccessRequest) {
	ids := make([]uuid.UUID, 0, len(requests))
	for _, r := range requests {
		ids = append(ids, r.EmployeeID)
	}
	if len(ids) == 0 {
		return
	}
	var emps []models.Employee
	db.Where("id IN ?", ids).Find(&emps)
	byID := make(map[uuid.UUID]models.Employee, len(emps))
	for _, e := range emps {
		byID[e.ID] = e
	}
	for i := range requests {
		if e, ok := byID[requests[i].EmployeeID]; ok {
			e := e
			requests[i].Employee = &e
		}
	}
}
