// The two kinds of website content, keyed by the URL segment used here.
// `api` is the kind the admin-api stores; `sitePath` is where the marketing
// website shows it.
export const KINDS = {
  blog: {
    api: "blog",
    label: "Blog",
    singular: "post",
    sitePath: "/blog",
    blurb: "Articles for the website blog. Published posts appear on the site within a few minutes.",
  },
  "knowledge-hub": {
    api: "guide",
    label: "Knowledge Hub",
    singular: "article",
    sitePath: "/knowledge-hub",
    blurb: "Help articles for customers and evaluators. Published articles appear on the site within a few minutes.",
  },
} as const;

export type KindKey = keyof typeof KINDS;

export const isKind = (k: string): k is KindKey => k in KINDS;

export const WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "https://aavishield.aavishailab.com";
