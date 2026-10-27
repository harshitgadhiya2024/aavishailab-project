package handlers

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ContentHandler manages the marketing website's blog posts and knowledge
// hub articles. Superadmins write them in the panel; the website reads
// published ones through the unauthenticated /public/content routes.
type ContentHandler struct {
	db *gorm.DB
}

func NewContentHandler(db *gorm.DB) *ContentHandler {
	return &ContentHandler{db: db}
}

var contentSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func parseContentKind(s string) (models.ContentKind, bool) {
	switch k := models.ContentKind(s); k {
	case models.ContentBlog, models.ContentGuide:
		return k, true
	}
	return "", false
}

// The list views never need the article body, which is by far the largest
// column, so it is left out of every list query.
var contentListColumns = []string{
	"id", "created_at", "updated_at", "kind", "slug", "title", "excerpt", "category", "tags",
	"author_name", "cover_image", "thumbnail_image", "featured", "sort_order", "status", "published_at", "reading_minutes",
}

// ─── Superadmin ─────────────────────────────────────────────────────────────

// List handles GET /superadmin/content?kind=&status=&q= — the management
// view, drafts included, with per-status counts for the tabs.
func (h *ContentHandler) List(c *gin.Context) {
	base := h.db.Model(&models.ContentPost{})
	if kind, ok := parseContentKind(c.Query("kind")); ok {
		base = base.Where("kind = ?", kind)
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		like := "%" + q + "%"
		base = base.Where("title ILIKE ? OR slug ILIKE ? OR category ILIKE ?", like, like, like)
	}

	counts := map[string]int64{"all": 0, "draft": 0, "published": 0}
	var rows []struct {
		Status string
		Count  int64
	}
	base.Session(&gorm.Session{}).Select("status, COUNT(*) AS count").Group("status").Scan(&rows)
	for _, r := range rows {
		counts[r.Status] = r.Count
		counts["all"] += r.Count
	}

	list := base.Session(&gorm.Session{})
	if status := c.Query("status"); status == string(models.ContentDraft) || status == string(models.ContentPublished) {
		list = list.Where("status = ?", status)
	}
	var items []models.ContentPost
	list.Select(contentListColumns).Order("updated_at DESC").Find(&items)
	c.JSON(http.StatusOK, gin.H{"posts": items, "total": len(items), "counts": counts})
}

// Get handles GET /superadmin/content/:id — one post with its body, for the editor.
func (h *ContentHandler) Get(c *gin.Context) {
	var item models.ContentPost
	if err := h.db.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

// Every field is optional so PATCH can change just one (publishing is a
// PATCH of status alone). Create checks the required ones itself.
type contentRequest struct {
	Kind           *string   `json:"kind"`
	Slug           *string   `json:"slug"`
	Title          *string   `json:"title"`
	Excerpt        *string   `json:"excerpt"`
	Body           *string   `json:"body"`
	Category       *string   `json:"category"`
	Tags           *[]string `json:"tags"`
	AuthorName     *string   `json:"author_name"`
	CoverImage     *string   `json:"cover_image"`
	ThumbnailImage *string   `json:"thumbnail_image"`
	SEOTitle       *string   `json:"seo_title"`
	SEODescription *string   `json:"seo_description"`
	Featured       *bool     `json:"featured"`
	SortOrder      *int      `json:"sort_order"`
	Status         *string   `json:"status"`
	PublishedAt    *string   `json:"published_at"`
}

// apply copies the request onto item, trimming and length-capping text.
// It returns a user-facing message when a value is invalid.
func (r *contentRequest) apply(item *models.ContentPost) string {
	str := func(p *string, dst *string, n int) {
		if p != nil {
			*dst = clip(strings.TrimSpace(*p), n)
		}
	}
	str(r.Title, &item.Title, 200)
	str(r.Excerpt, &item.Excerpt, 500)
	str(r.Category, &item.Category, 60)
	str(r.AuthorName, &item.AuthorName, 120)
	str(r.CoverImage, &item.CoverImage, 500)
	str(r.ThumbnailImage, &item.ThumbnailImage, 500)
	str(r.SEOTitle, &item.SEOTitle, 200)
	str(r.SEODescription, &item.SEODescription, 320)
	if r.Body != nil {
		item.Body = *r.Body
		item.ReadingMinutes = models.EstimateReadingMinutes(item.Body)
	}
	if r.Kind != nil {
		kind, ok := parseContentKind(*r.Kind)
		if !ok {
			return "Kind must be blog or guide"
		}
		item.Kind = kind
	}
	if r.Slug != nil {
		item.Slug = strings.TrimSpace(strings.ToLower(*r.Slug))
	}
	if item.Slug == "" {
		item.Slug = strings.Trim(clip(slugify(item.Title), 120), "-")
	}
	if !contentSlugPattern.MatchString(item.Slug) || len(item.Slug) > 120 {
		return "Slug may only use lowercase letters, numbers and single hyphens"
	}
	if r.Tags != nil {
		tags := make([]string, 0, len(*r.Tags))
		for _, t := range *r.Tags {
			if t = clip(strings.TrimSpace(t), 40); t != "" && len(tags) < 12 {
				tags = append(tags, t)
			}
		}
		item.Tags = tags
	}
	if r.Featured != nil {
		item.Featured = *r.Featured
	}
	if r.SortOrder != nil {
		item.SortOrder = *r.SortOrder
	}
	if r.Status != nil {
		switch s := models.ContentStatus(*r.Status); s {
		case models.ContentDraft, models.ContentPublished:
			item.Status = s
		default:
			return "Status must be draft or published"
		}
	}
	if r.PublishedAt != nil {
		item.PublishedAt = parseOptionalDateTime(r.PublishedAt)
	}
	// First publish stamps the date; later edits keep it unless set explicitly.
	if item.Status == models.ContentPublished && item.PublishedAt == nil {
		now := time.Now()
		item.PublishedAt = &now
	}
	if item.Title == "" {
		return "Title is required"
	}
	return ""
}

func (h *ContentHandler) slugTaken(item *models.ContentPost) bool {
	var count int64
	h.db.Model(&models.ContentPost{}).
		Where("kind = ? AND slug = ? AND id <> ?", item.Kind, item.Slug, item.ID).
		Count(&count)
	return count > 0
}

// Create handles POST /superadmin/content
func (h *ContentHandler) Create(c *gin.Context) {
	var req contentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Kind == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Kind is required"})
		return
	}
	item := models.ContentPost{Status: models.ContentDraft, Tags: []string{}, CreatedBy: currentUserID(c), UpdatedBy: currentUserID(c)}
	if msg := req.apply(&item); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if h.slugTaken(&item) {
		c.JSON(http.StatusConflict, gin.H{"error": "Another post already uses this slug"})
		return
	}
	if err := h.db.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create post"})
		return
	}
	writeAudit(h.db, c, nil, "create", "content_post", &item.ID, map[string]any{"kind": item.Kind, "slug": item.Slug, "status": item.Status})
	c.JSON(http.StatusCreated, item)
}

// Update handles PATCH /superadmin/content/:id
func (h *ContentHandler) Update(c *gin.Context) {
	var item models.ContentPost
	if err := h.db.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	var req contentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	before := item.Status
	if msg := req.apply(&item); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if h.slugTaken(&item) {
		c.JSON(http.StatusConflict, gin.H{"error": "Another post already uses this slug"})
		return
	}
	item.UpdatedBy = currentUserID(c)
	// Save writes every column, so clearing a field (an empty excerpt,
	// featured=false) sticks — Updates with a struct would skip zero values.
	if err := h.db.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save post"})
		return
	}
	action := "update"
	if before != item.Status {
		action = map[models.ContentStatus]string{models.ContentPublished: "publish", models.ContentDraft: "unpublish"}[item.Status]
	}
	writeAudit(h.db, c, nil, action, "content_post", &item.ID, map[string]any{"kind": item.Kind, "slug": item.Slug})
	c.JSON(http.StatusOK, item)
}

// Delete handles DELETE /superadmin/content/:id. Hard delete, so the slug
// is free again immediately; the audit log keeps the record of it.
func (h *ContentHandler) Delete(c *gin.Context) {
	var item models.ContentPost
	if err := h.db.Select("id", "kind", "slug", "title").First(&item, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	h.db.Unscoped().Delete(&models.ContentPost{}, "id = ?", item.ID)
	writeAudit(h.db, c, nil, "delete", "content_post", &item.ID, map[string]any{"kind": item.Kind, "slug": item.Slug, "title": item.Title})
	c.JSON(http.StatusOK, gin.H{"message": "Post deleted"})
}

// ─── Public (website) ───────────────────────────────────────────────────────

func (h *ContentHandler) published() *gorm.DB {
	return h.db.Model(&models.ContentPost{}).Where("status = ?", models.ContentPublished)
}

// PublicList handles GET /public/content?kind=&category=&q= — published
// posts without bodies. Guides come in reading order, blog posts newest first.
func (h *ContentHandler) PublicList(c *gin.Context) {
	kind, ok := parseContentKind(c.Query("kind"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind must be blog or guide"})
		return
	}
	q := h.published().Where("kind = ?", kind)
	if cat := c.Query("category"); cat != "" {
		q = q.Where("category = ?", cat)
	}
	if term := strings.TrimSpace(c.Query("q")); term != "" {
		like := "%" + clip(term, 100) + "%"
		q = q.Where("title ILIKE ? OR excerpt ILIKE ? OR body ILIKE ?", like, like, like)
	}
	if kind == models.ContentGuide {
		q = q.Order("sort_order ASC, title ASC")
	} else {
		q = q.Order("published_at DESC")
	}
	var items []models.ContentPost
	q.Select(contentListColumns).Limit(500).Find(&items)
	c.Header("Cache-Control", "public, max-age=60")
	c.JSON(http.StatusOK, gin.H{"posts": items})
}

// PublicGet handles GET /public/content/:kind/:slug — one published post
// with its body and up to three related posts from the same category.
func (h *ContentHandler) PublicGet(c *gin.Context) {
	kind, ok := parseContentKind(c.Param("kind"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}
	var item models.ContentPost
	if err := h.published().Where("kind = ? AND slug = ?", kind, c.Param("slug")).First(&item).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}
	var related []models.ContentPost
	h.published().
		Where("kind = ? AND category = ? AND id <> ?", kind, item.Category, item.ID).
		Select(contentListColumns).Order("sort_order ASC, published_at DESC").Limit(3).
		Find(&related)
	c.Header("Cache-Control", "public, max-age=60")
	c.JSON(http.StatusOK, gin.H{"post": item, "related": related})
}
