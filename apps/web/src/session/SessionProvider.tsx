"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createApiClient, type ApiClient } from "@/api/client";
import type { components } from "@/api/schema";

import { createRefreshingFetch } from "./refreshing-fetch";

export type RoleClaim = components["schemas"]["RoleClaim"];
export interface Me {
  name: string;
  roles: RoleClaim[];
}
export type SessionStatus = "checking" | "signedIn" | "signedOut";

/**
 * A finished sign-in; or the password was right and a second step is needed: enter the code from the
 * authenticator app (`required`), or set the app up first (`setup`). The `challenge` carries the
 * person through that step. It is not a session.
 */
export type SignInResult =
  | { ok: true }
  | { ok: true; twoFactor: "required" | "setup"; challenge: string }
  | { ok: false; reason: "invalid" | "throttled" | "network" | "unexpected" };

export type TwoFactorFailure = "invalid_code" | "invalid_challenge" | "throttled" | "network" | "unexpected";

export interface SessionValue {
  status: SessionStatus;
  me: Me | null;
  /** True when a signed-in session was ended by the server (expired or revoked), so the sign-in page can say why. */
  endedUnexpectedly: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  /** Second step for someone who already has the app: a 6-digit code or a recovery code. Signs in on success. */
  verifyTwoFactor: (challenge: string, code: string) => Promise<{ ok: true } | { ok: false; reason: TwoFactorFailure }>;
  /** Starts setting the app up: the key to type in, and the address an authenticator app can open. */
  startTwoFactorSetup: (challenge: string) => Promise<{ ok: true; secret: string; otpauthUri: string } | { ok: false; reason: TwoFactorFailure | "already_enabled" }>;
  /**
   * Confirms the first code and turns it on. The server has signed the person in, but the page holds that
   * back (returning `me`) until they have seen their recovery codes; `acceptSession` then lets them in.
   */
  enableTwoFactor: (challenge: string, code: string) => Promise<{ ok: true; recoveryCodes: string[]; me: Me } | { ok: false; reason: TwoFactorFailure | "no_setup" }>;
  acceptSession: (me: Me) => void;
  signOut: () => Promise<void>;
  /** The API client for signed-in calls. It renews the session by itself when the access cookie has expired. */
  api: ApiClient;
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

/** Maps a failed second-step response to a reason the page can show. */
export function twoFactorFailure(status: number, error: unknown): TwoFactorFailure {
  if (status === 429) return "throttled";
  const code = typeof error === "object" && error !== null && "error" in error ? (error as { error: unknown }).error : null;
  if (status === 401 && code === "invalid_code") return "invalid_code";
  if (status === 401 && code === "invalid_challenge") return "invalid_challenge";
  return "unexpected";
}

/** Who is signed in. Renews the session on its own when the 30-minute access cookie has expired. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "checking", me: null, ended: false });

  // One client for the life of the page. It renews the session when the access cookie has expired.
  const [api] = useState(() =>
    createApiClient({
      fetch: createRefreshingFetch((request) => fetch(request), {
        onSignedOut: () => setState(afterServerSignOut),
      }),
    }),
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // An expired access cookie is renewed inside this call by the refreshing fetch.
        const { data } = await api.GET("/api/auth/me");
        if (!active) return;
        setState((current) => (data ? { status: "signedIn", me: { name: data.name, roles: data.roles }, ended: false } : { status: "signedOut", me: null, ended: current.ended }));
      } catch {
        if (active) setState({ status: "signedOut", me: null, ended: false });
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  const signIn = useCallback<SessionValue["signIn"]>(async (email, password) => {
    try {
      const { data, response } = await api.POST("/api/auth/sign-in", { body: { email, password } });
      if (data && "twoFactor" in data) return { ok: true, twoFactor: data.twoFactor, challenge: data.challenge };
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
  }, [api]);

  const verifyTwoFactor = useCallback<SessionValue["verifyTwoFactor"]>(async (challenge, code) => {
    try {
      const { data, response, error } = await api.POST("/api/auth/2fa/verify", { body: { challenge, code } });
      if (data) {
        setState({ status: "signedIn", me: { name: data.user.fullName, roles: data.roles }, ended: false });
        return { ok: true };
      }
      return { ok: false, reason: twoFactorFailure(response.status, error) };
    } catch {
      return { ok: false, reason: "network" };
    }
  }, [api]);

  const startTwoFactorSetup = useCallback<SessionValue["startTwoFactorSetup"]>(async (challenge) => {
    try {
      const { data, response, error } = await api.POST("/api/auth/2fa/setup", { body: { challenge } });
      if (data) return { ok: true, secret: data.secret, otpauthUri: data.otpauthUri };
      if (response.status === 409) return { ok: false, reason: "already_enabled" };
      return { ok: false, reason: twoFactorFailure(response.status, error) };
    } catch {
      return { ok: false, reason: "network" };
    }
  }, [api]);

  const enableTwoFactor = useCallback<SessionValue["enableTwoFactor"]>(async (challenge, code) => {
    try {
      const { data, response, error } = await api.POST("/api/auth/2fa/enable", { body: { challenge, code } });
      if (data) return { ok: true, recoveryCodes: data.recoveryCodes, me: { name: data.user.fullName, roles: data.roles } };
      if (response.status === 409) return { ok: false, reason: "no_setup" };
      return { ok: false, reason: twoFactorFailure(response.status, error) };
    } catch {
      return { ok: false, reason: "network" };
    }
  }, [api]);

  const acceptSession = useCallback((me: Me) => setState({ status: "signedIn", me, ended: false }), []);

  const signOut = useCallback<SessionValue["signOut"]>(async () => {
    try {
      await api.POST("/api/auth/sign-out");
    } catch {
      /* the server always ends the session; offline, the cookies simply expire */
    }
    setState({ status: "signedOut", me: null, ended: false });
  }, [api]);

  const value = useMemo<SessionValue>(
    () => ({ status: state.status, me: state.me, endedUnexpectedly: state.ended, signIn, verifyTwoFactor, startTwoFactorSetup, enableTwoFactor, acceptSession, signOut, api }),
    [state, signIn, verifyTwoFactor, startTwoFactorSetup, enableTwoFactor, acceptSession, signOut, api],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
