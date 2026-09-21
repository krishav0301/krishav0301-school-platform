import type { Metadata } from "next";

import { DEFAULT_THEME_CSS, THEME_BOOT_SCRIPT, THEME_STYLE_ID } from "@/theme/boot";

import "./fonts.css";
import "./globals.css";
import { Providers } from "./providers";

// No title here: the page title is the school's name, set by ConfigProvider (D-008: no school in the build).
export const metadata: Metadata = {
  description: "A school management platform and public website.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        {/* The built-in theme. The script below swaps in the school's cached theme before first paint. */}
        <style id={THEME_STYLE_ID} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: DEFAULT_THEME_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
