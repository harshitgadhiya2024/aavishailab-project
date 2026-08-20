import type { Config } from "tailwindcss";

/** Token backed by a CSS variable, with Tailwind opacity modifiers preserved. */
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand scale is identical in both themes.
        brand: {
          DEFAULT: "#FF7000",
          50: "#FFF3E9",
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

        // Surfaces
        background: token("background"),
        card: {
          DEFAULT: token("card"),
          foreground: token("card-foreground"),
        },
        sunken: token("sunken"),
        elevated: token("elevated"),
        popover: {
          DEFAULT: token("popover"),
          foreground: token("popover-foreground"),
        },
        surface: {
          DEFAULT: token("background"),
          raised: token("card"),
          hover: token("elevated"),
          border: token("border"),
        },

        // Text ramp
        foreground: token("foreground"),
        body: token("body"),
        subtle: token("subtle"),
        faint: token("faint"),
        muted: {
          DEFAULT: token("muted"),
          foreground: token("muted-foreground"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },

        // Lines
        border: {
          DEFAULT: token("border"),
          strong: token("border-strong"),
        },
        input: token("input"),
        ring: token("ring"),

        // Brand roles
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
        },
        accent: {
          DEFAULT: token("accent"),
          foreground: token("accent-foreground"),
        },
        "on-brand": token("on-brand"),
        "brand-tint": token("brand-tint"),
        "brand-tint-soft": token("brand-tint-soft"),

        // Status
        success: token("success"),
        warning: token("warning"),
        danger: token("danger"),
        info: token("info"),
        "accent-purple": token("accent-purple"),
        destructive: {
          DEFAULT: token("destructive"),
          foreground: token("destructive-foreground"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: { sans: ["var(--font-inter)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
