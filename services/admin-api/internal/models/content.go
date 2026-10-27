package models

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

// EstimateReadingMinutes is the "5 min read" figure, at ~220 words a minute.
func EstimateReadingMinutes(body string) int {
	words := len(strings.Fields(body))
	if m := (words + 219) / 220; m > 1 {
		return m
	}
	return 1
}

// ─── Website content (blog + knowledge hub) ─────────────────────────────────
// The marketing site's blog posts and help articles. Written in the superadmin
// panel, read by the website through the public /public/content endpoints —
// only published rows ever leave the API there.

type ContentKind string

const (
	ContentBlog  ContentKind = "blog"
	ContentGuide ContentKind = "guide" // a knowledge hub article
)

type ContentStatus string

const (
	ContentDraft     ContentStatus = "draft"
	ContentPublished ContentStatus = "published"
)

type ContentPost struct {
	Base
	Kind ContentKind `gorm:"type:varchar(10);not null;uniqueIndex:idx_content_kind_slug;index" json:"kind"`
	// Unique per kind, so a blog post and a guide may share a slug. Rows are
	// hard-deleted, so a deleted slug can be reused straight away.
	Slug     string `gorm:"type:varchar(120);not null;uniqueIndex:idx_content_kind_slug" json:"slug"`
	Title    string `gorm:"not null" json:"title"`
	Excerpt  string `gorm:"type:text" json:"excerpt"`
	Body     string `gorm:"type:text" json:"body"` // Markdown
	Category string `gorm:"type:varchar(60);index" json:"category"`
	// Free-form labels; used for search and related articles.
	Tags           []string      `gorm:"type:jsonb;serializer:json" json:"tags"`
	AuthorName     string        `json:"author_name"`
	CoverImage     string        `json:"cover_image"`
	// Card crop on the blog index; the hero uses CoverImage. Empty falls back
	// to the website's branded stills for the starter posts.
	ThumbnailImage string        `json:"thumbnail_image"`
	SEOTitle       string        `gorm:"column:seo_title" json:"seo_title"`
	SEODescription string        `gorm:"column:seo_description;type:text" json:"seo_description"`
	Featured       bool          `gorm:"default:false" json:"featured"`
	SortOrder      int           `gorm:"default:0" json:"sort_order"`
	Status         ContentStatus `gorm:"type:varchar(12);default:'draft';index" json:"status"`
	// Set the first time a post is published and kept through later edits,
	// so republishing a fix doesn't move it to the top of the blog.
	PublishedAt    *time.Time `gorm:"index" json:"published_at"`
	ReadingMinutes int        `json:"reading_minutes"`
	CreatedBy      *uuid.UUID `gorm:"type:uuid" json:"created_by"`
	UpdatedBy      *uuid.UUID `gorm:"type:uuid" json:"updated_by"`
}
