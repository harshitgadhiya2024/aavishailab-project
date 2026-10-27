"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * next/link that ignores extra attributes (browser extensions, Cursor's
 * data-cursor-ref) stamped on the <a> before React hydrates.
 */
export function HydratedLink(props: ComponentProps<typeof NextLink>) {
  return <NextLink suppressHydrationWarning {...props} />;
}
