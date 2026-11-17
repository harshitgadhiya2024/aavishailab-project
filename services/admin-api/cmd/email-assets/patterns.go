package main

import (
	"flag"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
)

// The other website patterns, drawn for email. Each mirrors a CSS rule or
// component in frontend/website:
//
//   - pixel grid  .pixel-grid on bg-brand-soft: 12px orange hairline grid,
//     the stage behind every product visual;
//   - pixel mark  the logo mark redrawn in the site's pixel language (see mark.go).

func blend(fg color.NRGBA, a float64, bg color.NRGBA) color.NRGBA {
	mix := func(f, b uint8) uint8 { return uint8(math.Round(float64(f)*a + float64(b)*(1-a))) }
	return color.NRGBA{mix(fg.R, bg.R), mix(fg.G, bg.G), mix(fg.B, bg.B), 255}
}

func solid(w, h int, c color.NRGBA) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, c.A
	}
	return img
}

// gridTile is one 12×12 cell of the pixel-grid stage (1px lines top and left),
// tiled by the email client.
func gridTile() *image.NRGBA {
	soft := hex("#fff1e5")
	line := blend(hex("#ff7000"), 0.09, soft)
	img := solid(12, 12, soft)
	for i := 0; i < 12; i++ {
		img.SetNRGBA(i, 0, line)
		img.SetNRGBA(0, i, line)
	}
	return img
}

func write(dir, name string, img image.Image) {
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(f, img); err != nil {
		log.Fatal(err)
	}
	b := img.Bounds()
	log.Printf("wrote %s (%dx%d px)", path, b.Dx(), b.Dy())
}

func main() {
	out := flag.String("out", ".", "directory to write the PNGs into (the dashboard's public/brand)")
	logo := flag.String("logo", "../../frontend/website/src/app/icon.svg", "the logo mark SVG to draw the pixel mark from")
	patterns := flag.String("patterns", "../../docs/brand/patterns", "the brand pattern SVGs exported from Figma")
	flag.Parse()

	// Dither terrain (dither-field.tsx).
	for _, a := range []struct {
		name          string
		width, height int
		variant       string
		cell          float64
	}{
		{"email-terrain-hero.png", 600, 300, "hero", 7},  // behind hero cards and buttons (site hero: cell 7)
		{"email-terrain-band.png", 600, 200, "band", 7},  // behind a closing call to action (site CTA band)
		{"email-terrain-footer.png", 600, 96, "band", 6}, // the strip that ends every footer (site footer: cell 6)
	} {
		write(*out, a.name, draw(a.width, a.height, a.variant, a.cell, 2))
	}

	write(*out, "email-grid-tile.png", gridTile())
	// The seven bands of the pixel dither family, from the brand file (figma.go).
	for _, s := range []string{"terrain", "rise", "sunrise", "signal", "stream", "wave", "mesh"} {
		write(*out, "email-band-"+s+".png", figmaBand(filepath.Join(*patterns, s+".svg")))
	}
	write(*out, "email-pixel-mark.png", pixelMark(*logo))
}
