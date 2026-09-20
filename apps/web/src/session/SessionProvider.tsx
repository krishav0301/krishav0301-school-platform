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
  /** True when a signed-in session was ended by the server (expired or revoked), so the sign-in page can say why. */
  endedUnexpectedly: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

export interface SessionState {
  status: SessionStatus;
  me: Me | null;
  ended: boolean;
}

/**
 * The state after the server says the session is over. Only a person who WAS signed in is told
 * their session ended; a first-time visitor (whose first check finds no session) is simply signed out.
 */
export const afterServerSignOut = (current: Pick<SessionState, "status">): SessionState => ({
  status: "signedOut",
  me: null,
  ended: current.status === "signedIn",
});

/** Who is signed in. Renews the session on its own when the 30-minute access cookie has expired. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "checking", me: null, ended: false });

  const api = useRef<ReturnType<typeof createApiClient> | null>(null);
  api.current ??= createApiClient({
    fetch: createRefreshingFetch((request) => fetch(request), {
      onSignedOut: () => setState(afterServerSignOut),
    }),
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // An expired access cookie is renewed inside this call by the refreshing fetch.
        const { data } = await api.current!.GET("/api/auth/me");
        if (!active) return;
        setState((current) => (data ? { status: "signedIn", me: { name: data.name, roles: data.roles }, ended: false } : { status: "signedOut", me: null, ended: current.ended }));
      } catch {
        if (active) setState({ status: "signedOut", me: null, ended: false });
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
        setState({ status: "signedIn", me: { name: data.user.fullName, roles: data.roles }, ended: false });
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
    setState({ status: "signedOut", me: null, ended: false });
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status: state.status, me: state.me, endedUnexpectedly: state.ended, signIn, signOut }),
    [state, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
