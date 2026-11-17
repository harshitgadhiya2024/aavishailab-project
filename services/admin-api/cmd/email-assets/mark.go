package main

import (
	"image"
	"image/color"
	"log"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// The pixel mark: the Aavishield logo mark redrawn on an exact pixel grid in
// the website's pixel language, for the header of the account-security
// emails. It is rasterised from the real vector logo (icon.svg), not traced
// from a PNG, so every cell is decided by how much of it the true shape
// covers:
//
//   - well covered cells are solid brand-orange pixels;
//   - edge cells become the small light-orange dots the dither terrain uses
//     for its lightest level, which smooths curves without blurring;
//   - a faint ordered (Bayer) halo of dots trails off to the right.
//
// Geometry is integer CSS pixels throughout (4px cells, 3px squares, 1px
// gutters), drawn at 2x, so the art is crisp at its displayed size. The mark
// starts at x=0 so it lines up exactly with the text column in the email.

const (
	markCell  = 4  // CSS px per pixel cell
	markSq    = 3  // CSS px of a full pixel; the rest is the 1px gutter
	markRows  = 24 // the mark is 24 cells (96px) tall
	markWidth = 42 // cells: the mark plus the halo to its right (168px)
	markDPR   = 2
)

type pt struct{ x, y float64 }

// parsePath flattens an SVG path made of M/m, L/l, H/h, V/v, C/c and Z/z
// commands (all the logo uses) into closed polygons.
func parsePath(d string) [][]pt {
	tok := regexp.MustCompile(`[MmLlHhVvCcZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`).FindAllString(d, -1)
	var polys [][]pt
	var cur []pt
	var p, start pt
	var cmd string
	i := 0
	num := func() float64 {
		v, err := strconv.ParseFloat(tok[i], 64)
		if err != nil {
			log.Fatalf("bad number %q in path", tok[i])
		}
		i++
		return v
	}
	isCmd := func(s string) bool { return strings.ContainsAny(s[:1], "MmLlHhVvCcZz") }
	closeSub := func() {
		if len(cur) > 2 {
			polys = append(polys, cur)
		}
		cur = nil
	}
	for i < len(tok) {
		if isCmd(tok[i]) {
			cmd = tok[i]
			i++
		}
		rel := cmd == strings.ToLower(cmd)
		var o pt
		if rel {
			o = p
		}
		switch strings.ToUpper(cmd) {
		case "M":
			closeSub()
			p = pt{o.x + num(), o.y + num()}
			start = p
			cur = append(cur, p)
			if rel { // further pairs after m are implicit l
				cmd = "l"
			} else {
				cmd = "L"
			}
		case "L":
			p = pt{o.x + num(), o.y + num()}
			cur = append(cur, p)
		case "H":
			x := num()
			if rel {
				x += p.x
			}
			p = pt{x, p.y}
			cur = append(cur, p)
		case "V":
			y := num()
			if rel {
				y += p.y
			}
			p = pt{p.x, y}
			cur = append(cur, p)
		case "C":
			c1 := pt{o.x + num(), o.y + num()}
			c2 := pt{o.x + num(), o.y + num()}
			e := pt{o.x + num(), o.y + num()}
			for k := 1; k <= 24; k++ {
				t := float64(k) / 24
				u := 1 - t
				cur = append(cur, pt{
					u*u*u*p.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*e.x,
					u*u*u*p.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*e.y,
				})
			}
			p = e
		case "Z":
			closeSub()
			p = start
		default:
			log.Fatalf("unsupported path command %q", cmd)
		}
	}
	closeSub()
	return polys
}

// inside is the non-zero winding rule, SVG's default fill rule.
func inside(polys [][]pt, x, y float64) bool {
	wn := 0
	for _, poly := range polys {
		for i := range poly {
			a, b := poly[i], poly[(i+1)%len(poly)]
			if a.y <= y {
				if b.y > y && (b.x-a.x)*(y-a.y)-(x-a.x)*(b.y-a.y) > 0 {
					wn++
				}
			} else if b.y <= y && (b.x-a.x)*(y-a.y)-(x-a.x)*(b.y-a.y) < 0 {
				wn--
			}
		}
	}
	return wn != 0
}

func pixelMark(svgPath string) *image.NRGBA {
	raw, err := os.ReadFile(svgPath)
	if err != nil {
		log.Fatal(err)
	}
	m := regexp.MustCompile(` d="([^"]+)"`).FindSubmatch(raw)
	if m == nil {
		log.Fatalf("no path in %s", svgPath)
	}
	polys := parsePath(string(m[1]))

	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, poly := range polys {
		for _, q := range poly {
			minX, minY = math.Min(minX, q.x), math.Min(minY, q.y)
			maxX, maxY = math.Max(maxX, q.x), math.Max(maxY, q.y)
		}
	}
	unit := (maxY - minY) / markRows // path units per cell; the mark fills the height
	markCols := int(math.Ceil((maxX - minX) / unit))
	offX := minX - (float64(markCols)*unit-(maxX-minX))/2 // centre the mark in its cells

	coverage := func(c, r int) float64 {
		const s = 8 // 8×8 samples per cell
		hit := 0
		for sy := 0; sy < s; sy++ {
			for sx := 0; sx < s; sx++ {
				x := offX + (float64(c)+(float64(sx)+0.5)/s)*unit
				y := minY + (float64(r)+(float64(sy)+0.5)/s)*unit
				if inside(polys, x, y) {
					hit++
				}
			}
		}
		return float64(hit) / (s * s)
	}

	img := image.NewNRGBA(image.Rect(0, 0, markWidth*markCell*markDPR, markRows*markCell*markDPR))
	put := func(c, r, size int, col color.NRGBA) {
		off := (markCell*markDPR - size) / 2 // whole device pixels: no blur
		x0, y0 := c*markCell*markDPR+off, r*markCell*markDPR+off
		for y := y0; y < y0+size; y++ {
			for x := x0; x < x0+size; x++ {
				img.SetNRGBA(x, y, col)
			}
		}
	}

	solidPx := markSq * markDPR // 6 device px
	dotPx := 2 * markDPR / 1    // 4 device px: the terrain's light level
	finePx := 1 * markDPR       // 2 device px: the faintest halo dots
	orange, deep := hex("#ff7000"), hex("#e05f00")
	light, faint := hex("#ffc9a0"), hex("#ffe1c8")

	for r := 0; r < markRows; r++ {
		for c := 0; c < markWidth; c++ {
			cov := 0.0
			if c < markCols {
				cov = coverage(c, r)
			}
			switch {
			case cov >= 0.5:
				col := orange
				if r >= markRows*2/3 && (c+r)%3 == 0 {
					col = deep // the lower faces deepen, as on the terrain
				}
				put(c, r, solidPx, col)
			case cov >= 0.18:
				put(c, r, dotPx, light)
			default:
				// Halo: ordered dither fading with distance from the mark's
				// right edge and from its vertical centre.
				dx := float64(c-markCols) / float64(markWidth-markCols)
				dy := math.Abs(float64(r)-markRows/2) / (markRows / 2)
				if c < markCols || dx < 0 {
					continue
				}
				v := (1 - dx) * (1 - dy*dy) * 0.55
				t := (bayer[r%4][c%4] + 0.5) / 16
				if v > t {
					col := faint
					if v > 0.42 {
						col = light
					}
					put(c, r, finePx, col)
				}
			}
		}
	}
	return img
}
