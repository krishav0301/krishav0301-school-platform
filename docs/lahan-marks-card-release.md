# Lahan marks card and ledger: release handoff (D-185, D-186, D-187)

Branch `ccr-87e36364-6j9j12` (head `0660b77` when written). **Nothing is deployed.** The full CI workflow passed on this commit in a
fresh clone (every step, including the full API suite), and the local rehearsal passed (below). This page is for whoever deploys it,
from a laptop that holds Lahan's `wrangler` config (the git-ignored `apps/api/wrangler.local.jsonc` or `wrangler.lahan.jsonc`).

## What is in it

| Change | Where it is written |
|---|---|
| Lahan's **GRADE-SHEET** marks card (TH and PR marks and grades, grade point, class-highest GP, percentage, division, average, rank `x/y`, empty attendance, remarks and activities and signatures), on the school's yellow, A4, print and **Download PDF** | D-185 and its five addenda |
| The class **Mark Ledger** (marks per subject, total, percentage, rank per class), print and Download PDF | D-185 |
| Grades **as the shared cards award them** (a mark on a line stays in the band below; 35 to 40 is D+ 1.60), divisions 80, 60, 45, 35 "and above" | D-185 fifth addendum |
| **Roll numbers**: one click gives a class its numbers alphabetically; a later student gets the next number | D-186 |
| The **Class Teacher** opens the marks cards of the class they lead (new action `results.card.view`) | D-187 |
| Fixes from the break-it round and the local rehearsal (a name-only student's card crashed; long names; PDF paging; and more) | D-185 third addendum, commit `0660b77` |

The only new migration is **`0046_grade_sheet.sql`** (one nullable column on `school`). Lahan's live database (frozen on 13 October at
migration 0039) will also get **`0040` to `0045`**, which are the earlier fees redesign (D-172), already on `main`. Three of them
(0040, 0041, 0042) rebuild fee tables by copying; Lahan has fees off, so they should hold nothing. The pack file now carries
`school.gradeSheet` (the scale, divisions, crest, yellow paper, dense ranks). Nothing in results data changes: both documents are
read from the stored marks-card snapshots.

## On the laptop

```bash
git fetch origin ccr-87e36364-6j9j12 && git checkout ccr-87e36364-6j9j12      # or merge it to main first and use main
cd apps/api && npm ci && cd ../web && npm ci
```

Run the local rehearsal once if you want to see it first (no accounts needed; see `scripts/rehearsal/README.md`):
`cd apps/web && npm run build`, make `apps/api/.dev.vars` (README, "Run it locally"), then `../../scripts/rehearsal/reset.sh lahan-manakamana`
and the scripts it lists.

## Before deploying (all from `apps/api`, with `--config <your Lahan config>`)

1. **What is live?** `npx wrangler d1 migrations list DB --remote --config <cfg>`. Expect exactly `0040` to `0046` pending. Anything else: stop and ask.
2. **Are the fee tables empty?**
   `npx wrangler d1 execute DB --remote --config <cfg> --command "SELECT (SELECT COUNT(*) FROM ledger_entries) AS ledger, (SELECT COUNT(*) FROM fee_structures) AS structures, (SELECT COUNT(*) FROM receipts) AS receipts"`
   Expect `0, 0, 0`. If not, stop: the fee migrations have not been tried on Lahan fee data.
3. **Restore point.** `npx wrangler d1 time-travel info DB --config <cfg>` and write down the bookmark (kept 30 days).
4. Quiet time, after school hours.

## Deploy

```bash
cd apps/web && npm run build && cd ../api
npm run provision -- --pack ../../packs/lahan-manakamana --remote --config <cfg>    # migrations 0040-0046 and the pack
npx wrangler deploy --config <cfg>
```

The Lahan freeze test (`apps/web/test/lahan-frozen.test.tsx`) was refreshed for the pack change on purpose (the PM asked for it); a later
change that reaches Lahan's pack, photos, one-page layout or page will fail it until the PM says it is wanted.

## After deploying

Sign in as the Principal, then the Co-ordinator. Open a class, a card, a ledger. For each class the Co-ordinator clicks **Give roll numbers**
(Lahan's existing students have none). Check one real class against its paper ledger.

## If something is wrong

Restore the database first, then roll back the Worker (README, "Updating an existing deployment"):
`npx wrangler d1 time-travel restore DB --bookmark <bookmark> --config <cfg>` (loses anything written since), then `npx wrangler rollback --config <cfg>`.
In the rehearsal the old Worker also ran fine on the upgraded database (sign-in, results, admissions), so rolling back **only** the Worker is
safe for Lahan's features; fees on the upgraded database were not tried.

## What the rehearsal showed (2026-10-29, on a local Worker and database)

A live-style Lahan (the 13 October version) with results published, upgraded to this branch: all 6 class sheets, 16 students' own results and
both class lists read identically; all sign-ins worked; 2,975 figures on cards of old-code results matched an independent calculation (3,186 on a
fresh run); 11 roles got exactly the documented access; two people pressing Publish or Give roll numbers together gave one winner; the audit
chain verified (166 events).

## Still open (`OPEN:` in D-185)

- **Exactly 35 per cent** is NG (the same rule as every other line); no shared card shows it. Say if Lahan wants it to pass at D+.
- The card's printed legend says "D 1.40" for 35 to 40; the card's own rows award D+ 1.6, which is what ours uses and prints.
- Practical marks sit beside theory on one line per subject (not a separate "Practical" line, as the paper cards had for Classes 8 and 9).
- Attendance, exam remarks and other activities are empty on purpose (filled in by hand).
- A student who left after an exam stays on that exam's ledger and in its rank. Names are first and last (the card and ledger add the middle name).
- Not tried: a real printer on yellow stock; the PDF on a phone; fees data on the upgraded database.
