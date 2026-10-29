# Local rehearsal (no staging needed)

Runs the real Worker and a real local database with a school's pack, and drives the whole flow through the real API and the real
sign-in page, checking every figure on the marks cards and ledgers against an independent calculation. Written for Lahan Manakamana
(2026-10-29); the numbers and names are made up. **Local only: it refuses nothing, so never point `BASE` at a live site.**

```bash
cd apps/web && npm ci && npm run build            # the Worker serves the built web app
cd ../api && npm ci                               # then make .dev.vars (README.md, "Run it locally")
../../scripts/rehearsal/reset.sh lahan-manakamana # clean database, three staff sign-ins, Worker on :8787
cd ../../scripts/rehearsal
node seed.mjs       # structure, subjects with practicals and pass marks, teachers (real first sign-in), 17 students, roll numbers
node marks.mjs      # marks entered by each subject's own teacher, refusals, early publish refused, verify, publish both exams and the final
node verify.mjs     # every figure on every card and ledger against an independent calculation of the rules
node access.mjs     # who opens what, with real sign-ins for 11 roles
node races.mjs      # two people pressing Give roll numbers or Publish at once; a recheck
PW_PATH=$(npm root -g)/playwright node ui.mjs   # the real pages in a browser: sign-in, cards, ledgers, PDF download, print, errors
```

**Upgrade rehearsal** (a live database with results in it, then the new code): check out the version that is live in a worktree, run
`seed.mjs` and `marks.mjs` against it with `OLD=1 BASE=http://localhost:8788 STATE=$PWD/state-old.json`, take `snapshot.mjs` before and after
copying its `.wrangler/state` into `apps/api` and running `npm run provision -- --pack ../../packs/<school> --local`, and compare. Then start
the old Worker on the upgraded copy to see whether rolling back only the Worker is safe.
