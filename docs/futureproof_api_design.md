# Future-Proof API Design for Hadoku.me

This document explains how to design your Hadoku architecture so that each micro-app can have its own API strategy (tunneled local servers, Cloudflare-hosted functions, or self-contained routers) while keeping a stable client contract.

---

## ✅ Implementation Status

**hadoku-task** has been migrated to use the stable client contract pattern:

- **Client API calls**: All fetch calls use `/task/api/*` endpoints
- **Server mounting**: Nested Express app pattern (`app.use('/task', taskApp)`)
- **URL structure**: Follows `/{app}/api/*` convention for future flexibility
- **Documentation**: Updated to reflect new pattern across README, API docs, and templates

This allows the parent application to add additional routes like `/task/health` or `/task/metrics` without affecting the client contract at `/task/api/*`.

---

## 1. Stable Client Contract (Never Changes)

Each micro-app’s API always lives under its own route:

- UI paths: `/watchparty/`, `/task/`, `/contact/`, etc.
- API paths: `/watchparty/api/*`, `/task/api/*`, `/contact/api/*`

All requests are same-origin to **hadoku.me**, avoiding CORS headaches.

---

## 2. Single Edge Router (Fan-Out Design)

Use a single **edge layer** (Cloudflare Worker or Pages Functions) that routes by prefix:

| Prefix              | Backend Type                | Purpose                            |
|----------------------|-----------------------------|------------------------------------|
| `/task/api/*`        | Cloudflare Function          | GitHub JSON commits (light API)    |
| `/watchparty/api/*`  | Proxy → Cloudflare Tunnel    | Heavy local file/media API         |
| `/contact/api/*`     | Inline/self-contained        | Lightweight logic                  |
| `/*`                 | Static Astro site            | Main frontend                      |

### Option A — Cloudflare Pages + Functions (recommended)
Functions handle `/task/api/*` and proxy `/watchparty/api/*` to your tunnel origin.

### Option B — Front-Door Worker
A top-level Worker on `hadoku.me` can proxy and route everything, passing through static requests to your Pages origin.

Both options keep URLs identical for the UI.

---

## 3. Using Cloudflare Tunnel for Local APIs

Run your heavy or stateful services locally (e.g., large file streaming, FFmpeg jobs). Expose them with a Cloudflare Tunnel, e.g.:

```
https://watchparty-api.hadoku.me
```

Your edge just proxies `/watchparty/api/*` to that origin and streams responses back to the browser. Range requests, streaming, and auth headers all pass through.

---

## 4. Edge Router Example

```ts
// Simplified Cloudflare Worker / Pages Function
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Task API → handle directly (light JSON)
    if (url.pathname.startsWith('/task/api/')) {
      return env.TASK_API.fetch(req); // or inline handler
    }

    // Watchparty API → proxy to Tunnel origin
    if (url.pathname.startsWith('/watchparty/api/')) {
      const upstream = new URL(url.pathname.replace('/watchparty/api', ''), env.WATCHPARTY_ORIGIN);
      const resp = await fetch(new Request(upstream, req));
      return new Response(resp.body, { status: resp.status, headers: resp.headers });
    }

    // Default → static site
    return env.STATIC.fetch(req);
  }
}
```

**Bindings:**
- `STATIC` → your Astro static site (Cloudflare Pages project)
- `TASK_API` → GitHub-commit handler
- `WATCHPARTY_ORIGIN` → your tunnel URL (e.g. `https://watchparty-api.hadoku.me`)

---

## 5. Unified Auth Model

Keep it dead simple:
- All write endpoints require a single `X-Admin-Key` header.
- The edge validates it or passes it through to your tunneled API.
- Same-origin requests → no CORS.

---

## 6. Why This Is Future-Proof

- **Stable UI Contract** — `/app/api/*` never changes.
- **Flexible Backend** — swap Function → Worker → Tunnel anytime.
- **Extensible** — each micro-app can pick its own backend strategy.
- **Incremental Adoption** — start with Functions for small APIs, add tunnels for large workloads later.
- **Unified Edge Control** — one config (env vars + router) for all backends.

---

## 7. Deployment Checklist

- **DNS:** `hadoku.me` proxied via Cloudflare; optional `watchparty-api.hadoku.me` for tunnel.
- **Env Vars:**
  - `WATCHPARTY_ORIGIN` = tunnel endpoint
  - `GITHUB_PAT`, `REPO_OWNER`, `REPO_NAME`, `REPO_BRANCH`, `ADMIN_KEY`
- **Routes:**
  - `/task/api/*` → Pages Function / Worker
  - `/watchparty/api/*` → Proxy to tunnel
  - `/*` → static site

---

## 8. Free Tier + Limits

Cloudflare free tier gives **100k requests/day** pooled across Workers and Pages Functions — more than enough for personal use.

Streaming through Workers/Functions is I/O bound, not CPU bound, so you’ll stay well under limits. If you ever serve large public media, add Cloudflare R2 + caching later.

---

## ✅ Recommendation

Start with **Cloudflare Pages + Functions** for most micro-apps. Add Cloudflare Tunnel for heavy APIs. Use a consistent URL contract and let the edge decide where to route traffic. This gives you maximum flexibility, minimum complexity, and zero CORS pain.