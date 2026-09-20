# Packs

One folder per school. A pack is **data** that describes a school completely: name, sections, which optional modules it uses, renamed words, and its theme. It is how a new school is set up with little effort (D-008).

```
packs/
  royal-softech/pack.json        the first customer
  sample-basic-school/pack.json  a fictional Nursery to Grade 10 school
```

## Rules

1. **The core never imports from `packs/`.** A script or a test reads the JSON and hands it to `parsePack`. `scripts/check-boundaries.mjs` enforces this in CI.
2. **Nothing school-specific lives in code.** If a school needs something a pack cannot say, that is a change to the core for everyone, or (last resort) an extension written by us.
3. **Every pack must pass the readability check** (WCAG AA contrast, light and dark). A pack that does not is refused.
4. **`sample-basic-school` is a permanent test.** It runs the same flows as Royal Softech in CI, and its look and wording are deliberately different, so a Royal-specific assumption in the core shows up as a failure. It is also what we show to other schools. Royal Softech's data and branding are never shown to prospects.
5. Applying a pack twice changes nothing. It only adds and updates, never deletes.

## Fields

| Field | Meaning |
|---|---|
| `school` | name, short name, currency, timezone, region pack, template key |
| `sections` | the parts of the institution that scope roles (for Royal Softech: +2 and Bachelor's) |
| `modules` | optional modules to switch on or off. Unlisted ones stay on. Mandatory modules (ledger, approvals, audit, results and others) cannot be switched off |
| `terminology` | renamed words, such as `role.coordinator` |
| `theme` | colours for light and optional dark, font from a self-hosted list, corner radii |

Programmes, levels and fee structures join the pack in Phase 3 (setup) and Phase 6 (fees).

## Applying a pack

```bash
cd apps/api
npm run provision -- --pack ../../packs/royal-softech --local
npm run provision -- --pack ../../packs/royal-softech --remote --config wrangler.local.jsonc
```

The first creates the tables in the local development database and applies the pack. The second applies it to a deployed school (the Cloudflare account ids stay in the git-ignored `wrangler.local.jsonc`). Bootstrap provisioning is outside the audit log; the first audited entry is the first Super Admin action. Later theme changes go through the API and are audited.
