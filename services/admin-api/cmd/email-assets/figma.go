package main

import (
	"image"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

// The seven brand bands ("pixel dither family") come straight from the brand
// file: Figma → Aavishield — Social Prelaunch → Brand patterns, exported as
// SVG into docs/brand/patterns/. Each SVG is 1080×330 and holds one path per
// ramp colour, every path a run of axis-aligned squares on a 12px grid:
// 4.1px dots, 7px half squares and 11px full squares.
//
// Emails can't use SVG (Gmail strips it), so each band becomes a PNG. Scaling
// 1080 down to the email column would put square edges between device
// pixels and blur them, so instead of resampling, every square is read back as
// (grid cell, size, colour) and redrawn with its cell's edges snapped to whole
// device pixels. Cells come out 13 or 14px wide at 2x; every square stays
// sharp and in exactly the cell Figma put it in.

const (
	figmaW, figmaH = 1080.0, 330.0
	figmaCell      = 12.0
	// The email column between the frame's rails is 598 CSS px; at 2x that's
	// 1196 device px, so the PNG maps 1:1 onto a retina screen.
	bandPxW = 1196
)

var (
	figmaPath = regexp.MustCompile(`<path[^>]* d="([^"]+)"[^>]* fill="(#[0-9A-Fa-f]{6})"`)
	figmaRect = regexp.MustCompile(`M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+V[\d.]+Z`)
)

// figmaBand rasterises one exported brand pattern SVG.
func figmaBand(svgPath string) *image.NRGBA {
	raw, err := os.ReadFile(svgPath)
	if err != nil {
		log.Fatal(err)
	}
	scale := float64(bandPxW) / figmaW
	h := int(math.Round(figmaH * scale))
	img := image.NewNRGBA(image.Rect(0, 0, bandPxW, h))
	edge := func(units float64) int { return int(math.Round(units * scale)) }

	squares := 0
	for _, p := range figmaPath.FindAllSubmatch(raw, -1) {
		col := hex(string(p[2]))
		for _, r := range figmaRect.FindAllSubmatch(p[1], -1) {
			x0, _ := strconv.ParseFloat(string(r[1]), 64)
			y0, _ := strconv.ParseFloat(string(r[2]), 64)
			x1, _ := strconv.ParseFloat(string(r[3]), 64)
			y1, _ := strconv.ParseFloat(string(r[4]), 64)

			// The cell this square sits in, and its size in device px.
			c := math.Floor((x0 + x1) / 2 / figmaCell)
			rw := math.Floor((y0 + y1) / 2 / figmaCell)
			size := int(math.Round((x1 - x0) * scale))

			cx0, cx1 := edge(c*figmaCell), edge((c+1)*figmaCell)
			cy0, cy1 := edge(rw*figmaCell), edge((rw+1)*figmaCell)
			if (cx1-cx0-size)%2 != 0 { // keep it centred on whole pixels
				size--
			}
			ox, oy := cx0+(cx1-cx0-size)/2, cy0+(cy1-cy0-size)/2
			for y := max(oy, 0); y < min(oy+size, h); y++ {
				for x := max(ox, 0); x < min(ox+size, bandPxW); x++ {
					img.SetNRGBA(x, y, col)
				}
			}
			squares++
		}
	}
	if squares == 0 {
		log.Fatalf("%s: no pattern squares found", svgPath)
	}
	log.Printf("%s: %d squares", filepath.Base(svgPath), squares)
	return img
}
