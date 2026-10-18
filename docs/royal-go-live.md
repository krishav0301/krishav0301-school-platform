# Royal Softech: going live in its own Cloudflare account

Prepared 2026-10-18 (the PM's decision: Lahan stays alone in the first account; Royal gets a new one, because the free-plan limits are per account). Nothing here has been run against the new account. The agent never deploys; the PM runs these steps.

The Worker is `school-royal-softech`, its database `school_royal_softech`, its config `apps/api/wrangler.royal.jsonc` (local, git-ignored, already written; three `REPLACE_` values to fill). The general runbook is in `README.md`, "Deploying".

## 1. The account (the PM)

1. Make the new Cloudflare account (its own email, 2FA on). Choose the account email with care: it is the account's owner for good.
2. Note the **account id** (dashboard sidebar, or `npx wrangler whoami` after logging in).
3. Pick the public address. Either the account's `workers.dev` name (`school-royal-softech.<account-subdomain>.workers.dev`, the subdomain is chosen when the first Worker is made) or the school's own domain added to this account. `SITE_ORIGIN` must be exactly that address, with no slash at the end.

## 2. Fill the config

In `apps/api/wrangler.royal.jsonc`, replace the three values: `account_id`, `SITE_ORIGIN`, and (after step 3) `database_id`.

## 3. The commands, in order

Run from `apps/api`. PowerShell has no `&&`; one command per line.

```bash
npx wrangler login
```
Sign in as the **new** account. Check that `npx wrangler whoami` shows the new account and not the Lahan one, before every command below.

```bash
npx wrangler d1 create school_royal_softech
```
Copy the `database_id` it prints into the config.

```bash
npx wrangler secret put AUDIT_HMAC_KEY --config wrangler.royal.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.royal.jsonc
npx wrangler secret put DATA_KEY --config wrangler.royal.jsonc
```
Three different long random values, kept by the operator, never in git, never reused from Lahan or staging. Losing `DATA_KEY` loses every sealed secret (authenticator seeds); losing `AUDIT_HMAC_KEY` makes the audit log unverifiable.

```bash
npm run provision -- --pack ../../packs/royal-softech --remote --config wrangler.royal.jsonc
```
Applies every migration and Royal's pack. Safe to repeat.

```bash
cd ../web
npm run build
cd ../api
npx wrangler deploy --config wrangler.royal.jsonc
```
Stop any `wrangler dev` first (on Windows it locks `out`). The deploy needs `apps/web/out` freshly built.

```bash
USER_PASSWORD='a long passphrase' AUDIT_HMAC_KEY='the same key as the secret' npm run dev:user -- --remote --config wrangler.royal.jsonc --email you@example.com --name "Support" --role super_admin
```
The first Super Admin. They set up an authenticator app at first sign-in (ten recovery codes: keep them).

## 4. Check it (the PM, five minutes)

- The home page opens, with the hero photo and the programmes.
- `/robots.txt`, `/sitemap.xml` and `/llms.txt` answer, and `/favicon.ico`.
- Sign in as the Super Admin, finish the authenticator, open Setup.
- `npx wrangler d1 time-travel info DB --config wrangler.royal.jsonc` shows a bookmark: that is the restore point (30 days).

## 5. Before real people use it: decisions only the PM can make (`OPEN:`)

1. **The public admission form takes applications without an emailed link (done, D-183),** as Lahan's does (D-168): no email box, the platform fills in the sign-in email, the Co-ordinator reviews every application, and the form allows three applications per phone number and at most 100 a day. **Spam is the remaining risk**: no CAPTCHA yet; add Cloudflare Turnstile if junk applications appear. A Co-ordinator who asks an applicant for changes must phone them: nothing reaches a no-email applicant.
2. **No email is sent at all** until an adapter exists (D-034): a forgotten password cannot be reset by email, and no decision email (approved, rejected) reaches a family. The Admin and Super Admin sign in with an authenticator, so they are not locked out; a Co-ordinator or student who forgets a password needs the Principal or Support to set a new one.
3. **The Principal signs in without an authenticator for now (D-184).** Only the Super Admin (Support) uses one. Turn it on later by deleting `adminTwoFactor` from Royal's pack and running the provision command again; do it before real fee or marks data goes in.
4. **Sample photos.** Six facility photos are free stock pictures (D-180). Replace them with the college's own and delete the `sample-*` files from `apps/web/public/site/royal/` before telling anyone the site is final. Three photos come from the college's Facebook page; the college should confirm it is content with them.
5. **The college's own words.** The home page text, admission steps and eligibility rules were drafted from the college's Facebook posts and are not confirmed by the school. The award on Facebook is deliberately left out until confirmed. The email address and office hours are not shown because none was given.
6. **The theme is Royal's whole look,** portal included (navy, ivory and gold, serif headings, D-179).
7. **A daily export of the database and the audit chain to a second place** is still not built (README, Release A). Until it is, the only backup is Time Travel (30 days).
8. **Terms, programmes, sections, the exam pattern, staff, students and the card readers** start empty: a school begins with nothing (D-087). The Principal and the Co-ordinator enter them; card attendance (module `card_attendance`) is on in the pack but needs gate logins and cards made first.
9. **Legal review of the privacy notice** is still open (D-067).

## 6. Do not

- Do not use `wrangler.local.jsonc` or `wrangler.lahan.jsonc` for any of this: they point at the first account.
- Do not run `npm run uat:seed` against it: that is demo data, and Royal's Worker has demo mode off.
- Do not copy Lahan's secrets or database.
