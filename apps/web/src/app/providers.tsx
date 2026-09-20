"use client";

import type { ReactNode } from "react";

import { ConfigProvider } from "@/config/ConfigProvider";
import { SessionProvider } from "@/session/SessionProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <SessionProvider>{children}</SessionProvider>
    </ConfigProvider>
  );
}
