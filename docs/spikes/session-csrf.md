# Spike: login session and CSRF between Next.js and Django

Date: 2026-09-20. Phase 0. Status: **finding is firm; settings applied (D-016).**

## Question

The web app and the API share one domain, and Next.js proxies `/api/*` to Django. Do Django's session cookie and CSRF protection work through that proxy?

## Method

Added a throwaway probe to the API (login, whoami, a protected POST) and drove it from the browser at `http://localhost:3000`. The probe code and test user were deleted afterwards. Nothing from the probe is committed.

## Findings

| Check | Result |
|---|---|
| Session cookie set at login and sent on later requests through the proxy | Works |
| CSRF cookie readable by page JavaScript | Works |
| Protected POST with a valid token | **403 at first**: `Origin checking failed - http://localhost:3000 does not match any trusted origins` |
| Same POST after adding `CSRF_TRUSTED_ORIGINS=http://localhost:3000` | 200 |
| Same POST without a token | 403 `CSRF token missing` |
| Same POST with a wrong token | 403 |
| POST with the token read **before** a login | 403: **login rotates the CSRF token** |
| POST with the token re-read **after** login | 200 |

What Django sees behind the proxy: `Host: 127.0.0.1:8000` and `X-Forwarded-Host: localhost:3000`. The browser's `Origin` is `http://localhost:3000`, so the origins differ.

## Rules for the build (D-016)

1. Set `CSRF_TRUSTED_ORIGINS` (now read from the environment) to the web app's origin in every environment.
2. **Do not** set `USE_X_FORWARDED_HOST`. Django is also reachable on its own hostname, so a client could spoof that header.
3. The web client must **re-read the `csrftoken` cookie after login** (simplest: read it on every request, never cache it).
4. Every API route ends in a slash; the proxy adds it (see `next.config.ts`).
5. **Not yet tested:** Next.js server components calling Django on a user's behalf. Server-side `fetch` does not forward the browser's cookies, so the session cookie must be passed explicitly from the request's cookies. Prove it with the first authenticated server-rendered page in Phase 1.
6. Not yet tested: HTTPS in staging. `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, and `SECURE_PROXY_SSL_HEADER` are set for staging and production but need checking on the first deploy.
