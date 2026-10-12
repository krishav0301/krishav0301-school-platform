"use client";

import type { ReactNode } from "react";

import { ImportJobProvider } from "@/classes/import-job";
import { ConfigProvider } from "@/config/ConfigProvider";
import { SessionProvider } from "@/session/SessionProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <SessionProvider>
        <ImportJobProvider>{children}</ImportJobProvider>
      </SessionProvider>
    </ConfigProvider>
  );
}
