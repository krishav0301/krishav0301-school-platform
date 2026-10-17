import type { Metadata } from "next";

// The gate is a working screen for one computer, not a page for visitors: keep it out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function GateLayout({ children }: LayoutProps<"/gate">) {
  return children;
}
