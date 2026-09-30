package handlers

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

// A minimal .xlsx writer: enough for report exports (text and numbers, a
// bold header row, frozen header, column widths), without pulling a
// spreadsheet library into the API image.

type xlsxSheet struct {
	Name     string
	Rows     [][]any
	Widths   []float64
	Header   bool  // first row is a bold, frozen header
	BoldRows []int // extra rows to render bold
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// colName turns a 0-based index into A, B, ..., Z, AA...
func colName(i int) string {
	name := ""
	for i >= 0 {
		name = string(rune('A'+i%26)) + name
		i = i/26 - 1
	}
	return name
}

func sheetXML(s xlsxSheet) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)
	if s.Header {
		b.WriteString(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`)
	}
	if len(s.Widths) > 0 {
		b.WriteString(`<cols>`)
		for i, w := range s.Widths {
			fmt.Fprintf(&b, `<col min="%d" max="%d" width="%.1f" customWidth="1"/>`, i+1, i+1, w)
		}
		b.WriteString(`</cols>`)
	}
	bold := map[int]bool{}
	for _, r := range s.BoldRows {
		bold[r] = true
	}
	if s.Header {
		bold[0] = true
	}
	b.WriteString(`<sheetData>`)
	for ri, row := range s.Rows {
		fmt.Fprintf(&b, `<row r="%d">`, ri+1)
		style := ""
		if bold[ri] {
			style = ` s="1"`
		}
		for ci, v := range row {
			ref := fmt.Sprintf("%s%d", colName(ci), ri+1)
			switch x := v.(type) {
			case int:
				fmt.Fprintf(&b, `<c r="%s"%s><v>%d</v></c>`, ref, style, x)
			case int64:
				fmt.Fprintf(&b, `<c r="%s"%s><v>%d</v></c>`, ref, style, x)
			case float64:
				fmt.Fprintf(&b, `<c r="%s"%s><v>%g</v></c>`, ref, style, x)
			default:
				str := fmt.Sprintf("%v", x)
				if str == "" {
					continue
				}
				fmt.Fprintf(&b, `<c r="%s" t="inlineStr"%s><is><t xml:space="preserve">%s</t></is></c>`, ref, style, xmlEscape(str))
			}
		}
		b.WriteString(`</row>`)
	}
	b.WriteString(`</sheetData>`)
	if s.Header && len(s.Rows) > 0 && len(s.Rows[0]) > 0 {
		fmt.Fprintf(&b, `<autoFilter ref="A1:%s%d"/>`, colName(len(s.Rows[0])-1), len(s.Rows))
	}
	b.WriteString(`</worksheet>`)
	return b.String()
}

// sheetName makes a name Excel accepts: at most 31 chars, none of []:*?/\
func sheetName(n string) string {
	n = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`[]:*?/\`, r) {
			return '-'
		}
		return r
	}, n)
	if len(n) > 31 {
		n = n[:31]
	}
	return n
}

func writeXLSX(w io.Writer, sheets []xlsxSheet) error {
	z := zip.NewWriter(w)
	add := func(name, body string) error {
		f, err := z.Create(name)
		if err != nil {
			return err
		}
		_, err = io.WriteString(f, body)
		return err
	}

	var ct, rels, wbSheets strings.Builder
	for i := range sheets {
		fmt.Fprintf(&ct, `<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, i+1)
		fmt.Fprintf(&rels, `<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, i+1, i+1)
		fmt.Fprintf(&wbSheets, `<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, xmlEscape(sheetName(sheets[i].Name)), i+1, i+1)
	}
	stylesID := len(sheets) + 1

	files := []struct{ name, body string }{
		{"[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
			`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
			`<Default Extension="xml" ContentType="application/xml"/>` +
			`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
			`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
			ct.String() + `</Types>`},
		{"_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
			`</Relationships>`},
		{"xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
			`<sheets>` + wbSheets.String() + `</sheets></workbook>`},
		{"xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + rels.String() +
			fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, stylesID) +
			`</Relationships>`},
		// Style 0 = default, style 1 = bold.
		{"xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
			`<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
			`<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
			`<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
			`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
			`<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
			`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
			`</styleSheet>`},
	}
	for _, f := range files {
		if err := add(f.name, f.body); err != nil {
			return err
		}
	}
	for i, s := range sheets {
		if err := add(fmt.Sprintf("xl/worksheets/sheet%d.xml", i+1), sheetXML(s)); err != nil {
			return err
		}
	}
	return z.Close()
}
