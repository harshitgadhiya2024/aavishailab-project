import type { Config } from "tailwindcss";

/** Token backed by a CSS variable, with Tailwind opacity modifiers preserved. */
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#FF7000",
          50:  "#FFF3E9",
          100: "#FFE1CC",
          200: "#FFC299",
          300: "#FFA366",
          400: "#FF8B33",
          500: "#FF7000",
          600: "#E56400",
          700: "#CC5900",
          800: "#A34700",
          900: "#7A3500",
        },
        border: {
          DEFAULT: token("border"),
          strong: token("border-strong"),
        },
        input: token("input"),
        ring: token("ring"),
        background: token("background"),
        foreground: token("foreground"),
        // Text ramp and surfaces shared with the company dashboard.
        body: token("body"),
        subtle: token("subtle"),
        faint: token("faint"),
        sunken: token("sunken"),
        elevated: token("elevated"),
        "brand-tint": token("brand-tint"),
        "brand-tint-soft": token("brand-tint-soft"),
        primary: {
          DEFAULT: "#FF7000",
          // White on orange, as on the website.
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },
        muted: {
          DEFAULT: token("muted"),
          foreground: token("muted-foreground"),
        },
        accent: {
          DEFAULT: token("accent"),
          foreground: token("accent-foreground"),
        },
        destructive: {
          DEFAULT: token("destructive"),
          foreground: token("destructive-foreground"),
        },
        card: {
          DEFAULT: token("card"),
          foreground: token("card-foreground"),
        },
        popover: {
          DEFAULT: token("popover"),
          foreground: token("popover-foreground"),
        },
      },
      // The website's squared corners: 6px surfaces and buttons, 4px inputs.
      borderRadius: {
        "2xl": "calc(var(--radius) + 4px)",
        xl: "calc(var(--radius) + 2px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Flat, as on the website: hairlines do the separating, and only floating
      // layers (menus, dialogs) get a soft, wide shadow — never a dark glow.
      boxShadow: {
        sm: "0 1px 0 rgb(11 11 13 / 0.03)",
        DEFAULT: "0 1px 2px rgb(11 11 13 / 0.04)",
        md: "0 8px 24px -12px rgb(24 24 27 / 0.16)",
        lg: "0 16px 40px -20px rgb(24 24 27 / 0.2)",
        xl: "0 24px 60px -24px rgb(24 24 27 / 0.22)",
        "2xl": "0 24px 60px -24px rgb(24 24 27 / 0.22)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        logo: ["var(--font-sora)", "var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-dm-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
