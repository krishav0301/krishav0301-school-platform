/**
 * A `fetch` that renews the session when the access cookie has expired (D-021, D-024).
 *
 * The access cookie lasts 30 minutes. When a request comes back 401, this asks the API to swap the
 * refresh cookie for new ones, then repeats the request once. Rules that matter:
 *  - A refresh token works exactly once, so any number of requests failing together share ONE
 *    refresh. Two refreshes in a row would be treated by the server as theft.
 *  - `refresh_in_progress` (another tab is renewing) is retried once after a short wait.
 *  - Sign-in, refresh and sign-out are never refreshed: a wrong password is a 401 that means "wrong password".
 *  - A network failure while refreshing is not "signed out". Being offline keeps the person signed in.
 *  - A request is repeated at most once, so a route that always answers 401 cannot loop.
 */
export type SendRequest = (request: Request) => Promise<Response>;

export interface RefreshingFetchOptions {
  /** Called when the server says the session is really over (not for offline or server errors). */
  onSignedOut: () => void;
  retryDelayMs?: number;
}

/** Requests where a 401 means what it says (wrong password, no session to renew). `/api/auth/me` is not here: an expired access cookie is exactly when it should renew. */
const NEVER_REFRESHED = new Set(["/api/auth/sign-in", "/api/auth/refresh", "/api/auth/sign-out"]);

export function createRefreshingFetch(send: SendRequest, options: RefreshingFetchOptions): SendRequest {
  const retryDelayMs = options.retryDelayMs ?? 300;
  let refreshing: Promise<boolean> | null = null;

  async function refreshOnce(origin: string): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await send(new Request(new URL("/api/auth/refresh", origin), { method: "POST", credentials: "same-origin" }));
      } catch {
        return false; // offline or unreachable: keep the session, try again later
      }
      if (response.ok) return true;
      if (response.status !== 401) return false;

      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "refresh_in_progress" && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      options.onSignedOut();
      return false;
    }
    return false;
  }

  return async (request) => {
    const url = new URL(request.url);
    const isAuthRequest = NEVER_REFRESHED.has(url.pathname);
    const repeat = isAuthRequest ? null : request.clone(); // the body can only be read once

    const response = await send(request);
    if (response.status !== 401 || isAuthRequest) return response;

    refreshing ??= refreshOnce(url.origin).finally(() => {
      refreshing = null;
    });
    return (await refreshing) ? send(repeat!) : response;
  };
}
