package handlers

import (
	"archive/zip"
	"bytes"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func windowFor(t *testing.T, query string) reportWindow {
	t.Helper()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/x?"+query, nil)
	return (&ReportHandler{}).parseWindow(c, "org")
}

func TestParseWindowWholeDaysInZone(t *testing.T) {
	w := windowFor(t, "start=2026-09-01&end=2026-09-30&tz=Asia/Kolkata")
	ist, _ := time.LoadLocation("Asia/Kolkata")
	if !w.Start.Equal(time.Date(2026, 9, 1, 0, 0, 0, 0, ist)) {
		t.Fatalf("start = %v, want 1 Sep 00:00 IST", w.Start)
	}
	// end date is inclusive: the window runs to the start of the next day
	if !w.End.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, ist)) {
		t.Fatalf("end = %v, want 1 Oct 00:00 IST", w.End)
	}
	if w.Hourly {
		t.Fatal("a month should be bucketed by day")
	}
	if !w.PrevEnd.Equal(w.Start) || w.End.Sub(w.Start) != w.PrevEnd.Sub(w.PrevStart) {
		t.Fatal("previous window must be the equal-length span right before")
	}
	if got := exportFilename("dlp", w, "csv"); got != "delsecure_dlp_2026-09-01_to_2026-09-30.csv" {
		t.Fatalf("filename = %q", got)
	}
}

func TestParseWindowSingleDayIsHourly(t *testing.T) {
	w := windowFor(t, "start=2026-09-30&end=2026-09-30&tz=UTC")
	if !w.Hourly || w.End.Sub(w.Start) != 24*time.Hour {
		t.Fatalf("one day should be a 24h hourly window, got %v hourly=%v", w.End.Sub(w.Start), w.Hourly)
	}
}

func TestParseWindowClampsAndRepairs(t *testing.T) {
	w := windowFor(t, "start=2020-01-01&end=2026-01-01&tz=UTC")
	if w.End.Sub(w.Start) > maxReportSpan {
		t.Fatalf("span %v exceeds the cap", w.End.Sub(w.Start))
	}
	w = windowFor(t, "start=2026-09-30&end=2026-09-01&tz=UTC")
	if !w.Start.Before(w.End) {
		t.Fatal("reversed range must still produce a valid window")
	}
	w = windowFor(t, "days=7&tz=Not/AZone")
	if w.Loc != time.UTC {
		t.Fatalf("unknown zone should fall back to UTC, got %v", w.Loc)
	}
}

func TestCSVSafeDefusesFormulas(t *testing.T) {
	for in, want := range map[string]string{
		"=HYPERLINK(\"x\")": "'=HYPERLINK(\"x\")",
		"+1":                "'+1",
		"@SUM(A1)":          "'@SUM(A1)",
		"report.pdf":        "report.pdf",
		"":                  "",
	} {
		if got := csvSafe(in); got != want {
			t.Errorf("csvSafe(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFmtDuration(t *testing.T) {
	for in, want := range map[int64]string{0: "0m", 59: "0m", 125: "2m", 3600: "1h 00m", 27120: "7h 32m"} {
		if got := fmtDuration(in); got != want {
			t.Errorf("fmtDuration(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestWriteXLSXProducesAWorkbook(t *testing.T) {
	var buf bytes.Buffer
	err := writeXLSX(&buf, []xlsxSheet{
		{Name: "Summary", Rows: [][]any{{"Report", "Data protection"}}},
		{Name: "Data", Header: true, Rows: [][]any{{"Employee", "Incidents"}, {"Ananya <&>", 3}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	files := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		files[f.Name] = string(b)
	}
	for _, want := range []string{"[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"} {
		if _, ok := files[want]; !ok {
			t.Errorf("missing %s", want)
		}
	}
	data := files["xl/worksheets/sheet2.xml"]
	if !strings.Contains(data, "Ananya &lt;&amp;&gt;") {
		t.Error("text must be XML-escaped")
	}
	if !strings.Contains(data, `<c r="B2"><v>3</v></c>`) {
		t.Error("numbers must be written as numeric cells")
	}
	if !strings.Contains(data, `state="frozen"`) {
		t.Error("header row should be frozen")
	}
}

func TestColName(t *testing.T) {
	for in, want := range map[int]string{0: "A", 25: "Z", 26: "AA", 27: "AB", 701: "ZZ", 702: "AAA"} {
		if got := colName(in); got != want {
			t.Errorf("colName(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestDetectorLabel(t *testing.T) {
	for in, want := range map[string]string{"ai_text": "AI-detected text", "pan_india": "PAN (India)", "new_thing": "New thing", "": ""} {
		if got := detectorLabel(in); got != want {
			t.Errorf("detectorLabel(%q) = %q, want %q", in, got, want)
		}
	}
}
