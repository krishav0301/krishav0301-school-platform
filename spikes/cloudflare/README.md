# Cloudflare spike (throwaway reference)

Code used for the all-Cloudflare test on 2026-09-20. Results: `docs/spikes/cloudflare-test.md`.
Not part of the product. To re-run: create a D1 database, fill in `wrangler.jsonc`, run
`wrangler d1 execute school_spike --remote --file schema.sql`, `wrangler deploy`, then
`BASE=https://school-spike.<subdomain>.workers.dev node race.mjs`.
The `/drop-guard` route exists to demonstrate a weakness. Never deploy this Worker with real data.
