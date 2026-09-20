import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "School Platform",
  description: "A school management platform and public website.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
