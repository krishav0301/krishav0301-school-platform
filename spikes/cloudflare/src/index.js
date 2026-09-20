// THROWAWAY spike. Tests D1 atomicity, append-only triggers, and password hashing CPU.
import { scrypt } from "@noble/hashes/scrypt.js";
import puppeteer from "@cloudflare/puppeteer";

const RECEIPT_HTML = `<!doctype html><html lang="ne"><head><meta charset="utf-8"><style>
body{font-family:"Noto Sans Devanagari","Noto Sans","Nirmala UI",sans-serif;margin:24px;font-size:22px}
h1{font-size:30px;margin:0 0 8px}.row{margin:6px 0}small{color:#555;font-size:14px}
</style></head><body>
<h1>रोयल सफ्टेक कलेज, लहान</h1>
<div class="row">Fee receipt / शुल्क रसिद — Receipt No. 2083-A-000123</div>
<div class="row">विद्यार्थीको नाम: कृष्ण प्रसाद यादव &nbsp; कक्षा: कक्षा ११ (विज्ञान)</div>
<div class="row">रकम: रु १२,५०,००० &nbsp; (Rs 12,50,000) &nbsp; मिति: २०८३ असोज ४</div>
<div class="row">संयुक्त अक्षर: क्ष त्र ज्ञ श्री द्ध ङ्ग स्त्री विद्यालय प्रमाणपत्र</div>
<small>Conjuncts and matras test: क्षत्रिय, ज्ञान, श्रीमान्, विद्यार्थी, पुस्तक, कार्यालय</small>
</body></html>`;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = env.DB;

    // Seed N pending approvals requested by "alice".
    if (url.pathname === "/seed") {
      const n = Number(url.searchParams.get("n") ?? 10);
      const stmts = [];
      for (let i = 1; i <= n; i++) {
        stmts.push(
          db.prepare("INSERT OR IGNORE INTO approvals (id, requested_by, amount_paisa) VALUES (?1, 'alice', 100000)").bind(i),
        );
      }
      await db.batch(stmts);
      return json({ seeded: n });
    }

    // Approve-and-apply in ONE batch (one transaction). Many callers race for one id.
    if (url.pathname === "/approve") {
      const id = Number(url.searchParams.get("id"));
      const actor = url.searchParams.get("actor") ?? "bob";
      const res = await db.batch([
        db
          .prepare(
            "UPDATE approvals SET status='approved', decided_by=?1 WHERE id=?2 AND status='pending' AND requested_by != ?1",
          )
          .bind(actor, id),
        db
          .prepare(
            `INSERT INTO ledger (kind, amount_paisa, approval_id)
             SELECT 'discount', amount_paisa, id FROM approvals
             WHERE id=?2 AND status='approved' AND decided_by=?1
               AND NOT EXISTS (SELECT 1 FROM ledger WHERE approval_id=?2)`,
          )
          .bind(actor, id),
      ]);
      const won = res[0].meta.changes === 1;
      return json({ id, actor, won, ledger_rows_added: res[1].meta.changes });
    }

    // Payment with a gapless receipt number, in ONE batch. amount<=0 must roll back everything.
    if (url.pathname === "/pay") {
      const amount = Number(url.searchParams.get("amount") ?? 5000);
      try {
        const res = await db.batch([
          db.prepare("UPDATE receipt_counter SET next_no = next_no + 1 WHERE id=1"),
          db
            .prepare(
              "INSERT INTO ledger (kind, amount_paisa, receipt_no) SELECT 'payment', ?1, next_no - 1 FROM receipt_counter WHERE id=1",
            )
            .bind(amount),
        ]);
        return json({ ok: true, ledger_id: res[1].meta.last_row_id });
      } catch (e) {
        return json({ ok: false, error: String(e.message ?? e) }, 400);
      }
    }

    // Try to alter or delete a ledger row. Triggers must abort.
    if (url.pathname === "/tamper") {
      const out = {};
      for (const [name, sql] of [
        ["update", "UPDATE ledger SET amount_paisa = 1 WHERE id = 1"],
        ["delete", "DELETE FROM ledger WHERE id = 1"],
      ]) {
        try {
          await db.prepare(sql).run();
          out[name] = "ALLOWED (bad)";
        } catch (e) {
          out[name] = "blocked: " + String(e.message ?? e).slice(0, 80);
        }
      }
      return json(out);
    }

    // What a compromised or careless Worker can still do: remove the guard itself.
    if (url.pathname === "/drop-guard") {
      try {
        await db.prepare("DROP TRIGGER ledger_no_update").run();
        await db.prepare("UPDATE ledger SET amount_paisa = 1 WHERE id = 1").run();
        return json({ result: "guard dropped and ledger row edited (D1 has no roles to prevent this)" });
      } catch (e) {
        return json({ result: "blocked: " + String(e.message ?? e) });
      }
    }

    // Same four reads as /stats, but sent as ONE batch = one round trip to the database.
    if (url.pathname === "/stats-batched") {
      const [rec, ctr, disc, dup] = await db.batch([
        db.prepare("SELECT COUNT(*) c FROM ledger WHERE receipt_no IS NOT NULL"),
        db.prepare("SELECT next_no FROM receipt_counter"),
        db.prepare("SELECT COUNT(*) c FROM ledger WHERE kind='discount'"),
        db.prepare("SELECT COUNT(*) c FROM (SELECT approval_id FROM ledger WHERE approval_id IS NOT NULL GROUP BY approval_id HAVING COUNT(*)>1)"),
      ]);
      return json({ receipts: rec.results[0].c, counterNext: ctr.results[0].next_no, discountRows: disc.results[0].c, dup: dup.results[0].c });
    }

    if (url.pathname === "/stats") {
      const receipts = (await db.prepare("SELECT receipt_no FROM ledger WHERE receipt_no IS NOT NULL ORDER BY receipt_no").all()).results.map((r) => r.receipt_no);
      const gaps = [];
      for (let i = 0; i < receipts.length; i++) if (receipts[i] !== i + 1) { gaps.push({ at: i, saw: receipts[i] }); break; }
      const counter = (await db.prepare("SELECT next_no FROM receipt_counter").first()).next_no;
      const discounts = (await db.prepare("SELECT COUNT(*) c FROM ledger WHERE kind='discount'").first()).c;
      const dupApprovals = (await db.prepare("SELECT COUNT(*) c FROM (SELECT approval_id FROM ledger WHERE approval_id IS NOT NULL GROUP BY approval_id HAVING COUNT(*)>1)").first()).c;
      return json({ receipts: receipts.length, first: receipts[0], last: receipts.at(-1), firstGap: gaps[0] ?? null, counterNext: counter, discountRows: discounts, approvalsWithDuplicateLedgerRows: dupApprovals });
    }

    // PBKDF2 (the only password hash WebCrypto offers). Wall time is not measurable inside Workers.
    if (url.pathname === "/hash") {
      const iterations = Number(url.searchParams.get("iter") ?? 100000);
      try {
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("correct horse battery staple"), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: crypto.getRandomValues(new Uint8Array(16)), iterations }, key, 256);
        return json({ iterations, derivedBytes: bits.byteLength });
      } catch (e) {
        return json({ iterations, error: String(e.name) + ": " + String(e.message) }, 400);
      }
    }

    // scrypt in pure JS (memory-hard, stronger than PBKDF2). Tests what fits in the free CPU limit.
    if (url.pathname === "/scrypt") {
      const logN = Number(url.searchParams.get("logn") ?? 12);
      try {
        const out = scrypt("correct horse battery staple", crypto.getRandomValues(new Uint8Array(16)), { N: 2 ** logN, r: 8, p: 1, dkLen: 32 });
        return json({ N: 2 ** logN, derivedBytes: out.length });
      } catch (e) {
        return json({ N: 2 ** logN, error: String(e.message) }, 400);
      }
    }

    // Browser Rendering: same HTML as the earlier Edge test, as a PNG and as a PDF.
    if (url.pathname === "/png" || url.pathname === "/pdf") {
      let browser;
      try {
        browser = await puppeteer.launch(env.BROWSER);
      } catch (e) {
        return json({ stage: "launch", error: String(e.message ?? e) }, 500);
      }
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 900, height: 330 });
        await page.setContent(RECEIPT_HTML, { waitUntil: "networkidle0" });
        if (url.pathname === "/png") {
          const img = await page.screenshot({ type: "png" });
          return new Response(img, { headers: { "content-type": "image/png" } });
        }
        const pdf = await page.pdf({ printBackground: true });
        return new Response(pdf, { headers: { "content-type": "application/pdf" } });
      } catch (e) {
        return json({ stage: "render", error: String(e.message ?? e) }, 500);
      } finally {
        await browser.close();
      }
    }

    // One browser session, many PDFs (how a class's marks cards would be generated at publish time).
    if (url.pathname === "/batch-pdf") {
      const n = Number(url.searchParams.get("n") ?? 20);
      let browser;
      try {
        browser = await puppeteer.launch(env.BROWSER);
      } catch (e) {
        return json({ stage: "launch", error: String(e.message ?? e) }, 500);
      }
      try {
        const started = Date.now();
        const page = await browser.newPage();
        let bytes = 0;
        for (let i = 1; i <= n; i++) {
          await page.setContent(RECEIPT_HTML.replace("000123", String(i).padStart(6, "0")), { waitUntil: "load" });
          bytes += (await page.pdf({ printBackground: true })).byteLength;
        }
        return json({ pdfs: n, totalBytes: bytes, elapsedMs: Date.now() - started });
      } catch (e) {
        return json({ stage: "render", error: String(e.message ?? e) }, 500);
      } finally {
        await browser.close();
      }
    }

    return json({ ok: true, routes: ["/seed", "/approve", "/pay", "/tamper", "/drop-guard", "/stats", "/hash"] });
  },
};
