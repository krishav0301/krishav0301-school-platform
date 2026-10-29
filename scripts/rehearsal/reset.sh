#!/bin/bash
# A clean local school: stops any local Worker, makes a new local database from a pack (default: Lahan Manakamana), adds the three
# staff sign-ins the rehearsal expects, and starts the Worker on port 8787. See README.md.
set -e
PACK="${1:-lahan-manakamana}"
cd "$(dirname "$0")/../../apps/api"
pkill -f "[w]rangler\.js dev" 2>/dev/null || true; pkill -x workerd 2>/dev/null || true; sleep 2
[ -f .dev.vars ] || { echo "Make apps/api/.dev.vars first (README.md, 'Run it locally')"; exit 1; }
rm -rf .wrangler
npm run provision -- --pack "../../packs/$PACK" --local > /tmp/rehearsal-provision.log 2>&1 || { echo "PROVISION FAILED"; tail /tmp/rehearsal-provision.log; exit 1; }
export USER_PASSWORD='Maple-River-2026-sunrise'
for r in "principal admin Principal" "coordinator coordinator Coordinator" "accountant accountant Accountant"; do set -- $r; npm run dev:user -- --email $1@lahan.test --name "$3 User" --role $2 > /dev/null 2>&1 || echo "user $1 failed"; done
(nohup npx wrangler dev --config wrangler.jsonc --port 8787 > /tmp/rehearsal-worker.log 2>&1 &)
for i in $(seq 1 40); do sleep 2; curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/api/config/public | grep -q 200 && { echo "worker up on http://localhost:8787"; exit 0; }; done
echo "WORKER DID NOT START"; exit 1
