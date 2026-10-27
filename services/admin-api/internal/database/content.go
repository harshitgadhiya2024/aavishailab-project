package database

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
)

// One Markdown file per starter post, with a small "key: value" header
// between --- lines. The marketing website reads the same files in local
// development, so keep the header format in step with its src/lib/cms.ts.
//
//go:embed config/content/*.md
var contentSeedFS embed.FS

// parseContentSeed turns one seed file into a post. Unknown keys are ignored.
func parseContentSeed(name string, raw []byte) (models.ContentPost, error) {
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return models.ContentPost{}, fmt.Errorf("%s: missing --- header", name)
	}
	head, body, ok := strings.Cut(text[4:], "\n---\n")
	if !ok {
		return models.ContentPost{}, fmt.Errorf("%s: unterminated header", name)
	}

	post := models.ContentPost{Body: strings.TrimSpace(body), Status: models.ContentPublished}
	published := time.Now()
	for _, line := range strings.Split(head, "\n") {
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(key) {
		case "kind":
			post.Kind = models.ContentKind(value)
		case "slug":
			post.Slug = value
		case "title":
			post.Title = value
		case "excerpt":
			post.Excerpt = value
		case "category":
			post.Category = value
		case "tags":
			for _, t := range strings.Split(value, ",") {
				if t = strings.TrimSpace(t); t != "" {
					post.Tags = append(post.Tags, t)
				}
			}
		case "author":
			post.AuthorName = value
		case "cover":
			post.CoverImage = value
		case "thumbnail":
			post.ThumbnailImage = value
		case "seo_title":
			post.SEOTitle = value
		case "seo_description":
			post.SEODescription = value
		case "featured":
			post.Featured = value == "true"
		case "order":
			post.SortOrder, _ = strconv.Atoi(value)
		case "published":
			if t, err := time.Parse("2006-01-02", value); err == nil {
				published = t
			}
		}
	}
	if post.Kind != models.ContentBlog && post.Kind != models.ContentGuide {
		return models.ContentPost{}, fmt.Errorf("%s: kind must be blog or guide", name)
	}
	if post.Slug == "" || post.Title == "" {
		return models.ContentPost{}, fmt.Errorf("%s: slug and title are required", name)
	}
	post.PublishedAt = &published
	post.ReadingMinutes = models.EstimateReadingMinutes(post.Body)
	return post, nil
}

// SeedContent loads the starter blog posts and knowledge hub articles, so a
// fresh install has a working help centre on day one.
//
// Unlike SeedApplications, existing rows are never touched: once a post is in
// the database it belongs to whoever edits it in the superadmin panel, and a
// redeploy must not quietly revert their changes. A post someone deleted on
// purpose does come back on the next boot — unpublish it instead.
func SeedContent(db *gorm.DB) error {
	files, err := fs.Glob(contentSeedFS, "config/content/*.md")
	if err != nil {
		return fmt.Errorf("failed to list content seed: %w", err)
	}

	created := 0
	for _, name := range files {
		raw, err := contentSeedFS.ReadFile(name)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", name, err)
		}
		post, err := parseContentSeed(name, raw)
		if err != nil {
			return err
		}

		var count int64
		if err := db.Model(&models.ContentPost{}).
			Where("kind = ? AND slug = ?", post.Kind, post.Slug).
			Count(&count).Error; err != nil {
			return fmt.Errorf("failed to look up content %s/%s: %w", post.Kind, post.Slug, err)
		}
		if count > 0 {
			continue
		}
		if err := db.Create(&post).Error; err != nil {
			return fmt.Errorf("failed to create content %s/%s: %w", post.Kind, post.Slug, err)
		}
		created++
	}

	log.Printf("📝 Website content: %d added (%d in seed)", created, len(files))
	return nil
}
