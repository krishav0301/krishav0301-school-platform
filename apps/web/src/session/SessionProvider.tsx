"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createApiClient } from "@/api/client";
import type { components } from "@/api/schema";

import { createRefreshingFetch } from "./refreshing-fetch";

export type RoleClaim = components["schemas"]["RoleClaim"];
export interface Me {
  name: string;
  roles: RoleClaim[];
}
export type SessionStatus = "checking" | "signedIn" | "signedOut";
export type SignInResult = { ok: true } | { ok: false; reason: "invalid" | "throttled" | "network" | "unexpected" };

export interface SessionValue {
  status: SessionStatus;
  me: Me | null;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

/** Who is signed in. Renews the session on its own when the 30-minute access cookie has expired. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: SessionStatus; me: Me | null }>({ status: "checking", me: null });

  const api = useRef<ReturnType<typeof createApiClient> | null>(null);
  api.current ??= createApiClient({
    fetch: createRefreshingFetch((request) => fetch(request), {
      onSignedOut: () => setState({ status: "signedOut", me: null }),
    }),
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // An expired access cookie is renewed inside this call by the refreshing fetch.
        const { data } = await api.current!.GET("/api/auth/me");
        if (!active) return;
        setState(data ? { status: "signedIn", me: { name: data.name, roles: data.roles } } : { status: "signedOut", me: null });
      } catch {
        if (active) setState({ status: "signedOut", me: null });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback<SessionValue["signIn"]>(async (email, password) => {
    try {
      const { data, response } = await api.current!.POST("/api/auth/sign-in", { body: { email, password } });
      if (data) {
        setState({ status: "signedIn", me: { name: data.user.fullName, roles: data.roles } });
        return { ok: true };
      }
      if (response.status === 401) return { ok: false, reason: "invalid" };
      if (response.status === 429) return { ok: false, reason: "throttled" };
      return { ok: false, reason: "unexpected" };
    } catch {
      return { ok: false, reason: "network" };
    }
  }, []);

  const signOut = useCallback<SessionValue["signOut"]>(async () => {
    try {
      await api.current!.POST("/api/auth/sign-out");
    } catch {
      /* the server always ends the session; offline, the cookies simply expire */
    }
    setState({ status: "signedOut", me: null });
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
