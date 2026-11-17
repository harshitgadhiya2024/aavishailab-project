// Command email-assets renders the website's dithered pixel terrain to PNGs
// for the transactional emails. Email clients can't run the site's canvas
// code, so the same algorithm is drawn ahead of time and served as images.
//
// It is a line-for-line port of frontend/website/src/components/landing/
// dither-field.tsx: keep the two in step if the terrain changes.
//
//	go run ./cmd/email-assets -out ../../frontend/company-dashboard/public/brand
package main

import (
	"image"
	"image/color"
	"math"
)

// ramp is lightest to deepest; index 0 (paper) is never drawn.
var ramp = []string{"", "#ffe7d4", "#ffc9a0", "#ffa461", "#ff8526", "#ff7000", "#e05f00"}

var bayer = [4][4]float64{
	{0, 8, 2, 10},
	{12, 4, 14, 6},
	{3, 11, 1, 9},
	{15, 7, 13, 5},
}

// imul matches JavaScript's Math.imul (32-bit wrapping multiply).
func imul(a, b int32) uint32 { return uint32(a) * uint32(b) }

func hash(x, y, seed int) float64 {
	h := imul(int32(x), 374761393) ^ imul(int32(y), 668265263) ^ imul(int32(seed), 1442695041)
	h = (h ^ (h >> 13)) * 1274126177
	return float64(h^(h>>16)) / 4294967295
}

func noise(x, y float64, seed int) float64 {
	xi, yi := math.Floor(x), math.Floor(y)
	s := func(t float64) float64 { return t * t * (3 - 2*t) }
	u, v := s(x-xi), s(y-yi)
	a := hash(int(xi), int(yi), seed)
	b := hash(int(xi)+1, int(yi), seed)
	c := hash(int(xi), int(yi)+1, seed)
	d := hash(int(xi)+1, int(yi)+1, seed)
	return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v
}

func fbm(x, y float64, seed int) float64 {
	sum, amp, f := 0.0, 0.5, 1.0
	for i := 0; i < 5; i++ {
		sum += amp * noise(x*f, y*f, seed+i)
		f *= 2
		amp *= 0.5
	}
	return sum
}

func clamp(n float64) float64  { return math.Max(0, math.Min(1, n)) }
func smooth(t float64) float64 { return t * t * (3 - 2*t) }

func ridged(x float64, seed int) float64 {
	sum, amp, f := 0.0, 0.6, 1.0
	for i := 0; i < 4; i++ {
		sum += amp * (1 - math.Abs(2*noise(x*f, 0.5, seed+i)-1))
		f *= 2.1
		amp *= 0.45
	}
	return sum
}

func ridge(x float64, variant string) float64 {
	peaks := ridged(x*2.6, 11) - 0.55
	fine := fbm(x*16, 2.5, 17) - 0.5
	if variant == "hero" {
		return 1 - (0.06 + 0.78*math.Pow(x, 1.15) + 0.34*peaks + 0.05*fine)
	}
	return 1 - (0.22 + 0.22*smooth(x) + 0.22*peaks + 0.04*fine)
}

func hex(s string) color.NRGBA {
	var c color.NRGBA
	c.A = 255
	for i, p := range []*uint8{&c.R, &c.G, &c.B} {
		var v uint8
		for _, ch := range s[1+2*i : 3+2*i] {
			v <<= 4
			switch {
			case ch >= '0' && ch <= '9':
				v |= uint8(ch - '0')
			case ch >= 'A' && ch <= 'F':
				v |= uint8(ch-'A') + 10
			default:
				v |= uint8(ch-'a') + 10
			}
		}
		*p = v
	}
	return c
}

// draw renders the terrain at width×height CSS pixels, scaled by dpr, on a
// transparent background so shadows of cards above it show through.
func draw(width, height int, variant string, cell float64, dpr int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, width*dpr, height*dpr))

	cols := int(math.Ceil(float64(width) / cell))
	rows := int(math.Ceil(float64(height) / cell))
	top := 0.62
	if variant == "hero" {
		top = 1
	}
	levels := float64(len(ramp) - 1)

	for c := 0; c < cols; c++ {
		x := float64(c) / float64(cols)
		r0 := ridge(x, variant)
		for r := 0; r < rows; r++ {
			y := float64(r) / float64(rows)
			grain := fbm(x*7, y*7, 5) - 0.5
			var v float64
			if y >= r0 {
				depth := y - r0
				gully := fbm(x*5+depth*3.2, depth*7, 23) - 0.5
				edge := 0.0
				if depth < 0.018 {
					edge = 0.2
				}
				v = 0.12 + x*0.55 + gully*1.1 + grain*0.35 - depth*0.3 + edge
			} else {
				d := r0 - y
				v = clamp(0.32-d*2.4+grain*0.5) * 0.7
			}
			v = clamp(v) * top
			t := (bayer[r%4][c%4] + 0.5) / 16
			scaled := v * levels
			lo := math.Floor(scaled)
			level := lo
			if scaled-lo > t {
				level++
			}
			level = math.Min(levels, level)
			if level == 0 {
				continue
			}
			size := cell - 1
			switch level {
			case 1:
				size = cell * 0.34
			case 2:
				size = cell * 0.58
			}
			off := (cell - size) / 2
			fill(img, (float64(c)*cell+off)*float64(dpr), (float64(r)*cell+off)*float64(dpr), size*float64(dpr), hex(ramp[int(level)]))
		}
	}
	return img
}

func fill(img *image.NRGBA, x, y, size float64, c color.NRGBA) {
	x0, y0 := int(math.Round(x)), int(math.Round(y))
	x1, y1 := int(math.Round(x+size)), int(math.Round(y+size))
	b := img.Bounds()
	for py := max(y0, b.Min.Y); py < min(y1, b.Max.Y); py++ {
		for px := max(x0, b.Min.X); px < min(x1, b.Max.X); px++ {
			img.SetNRGBA(px, py, c)
		}
	}
}
