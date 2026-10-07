import type { Metadata } from "next";

import { DEFAULT_THEME_CSS, THEME_BOOT_SCRIPT, THEME_STYLE_ID } from "@/theme/boot";
import { PALETTE_BOOT_SCRIPT, PALETTE_STYLE_ID } from "@/theme/personal";

import "./fonts.css";
import "./globals.css";
import { Providers } from "./providers";

// No description here either: a public page gets its own from the Worker (D-046), and a page that is not
// public (sign-in, the portal) has nothing to say to a search engine. A generic one would sit beside the real one.
export const metadata: Metadata = {};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        {/* The built-in theme. The script below swaps in the school's cached theme before first paint. */}
        <style id={THEME_STYLE_ID} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: DEFAULT_THEME_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* A person's own colours for the portal (D-127), laid over the school's; filled before first paint on portal pages. */}
        <style id={PALETTE_STYLE_ID} suppressHydrationWarning />
        <script dangerouslySetInnerHTML={{ __html: PALETTE_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
