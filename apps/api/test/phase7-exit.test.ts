/**
 * The Phase 7 exit check (docs/build-plan.md): results end to end, for BOTH schools, through the real HTTP API,
 * starting from each school's own pack, with real sign-ins from the real first-password flows.
 *
 *  - the Co-ordinator sets up this year: a class, a terminal, two subjects with mark components (theory and practical)
 *    and credit hours, a teacher hired through the staff flow and assigned both, two students admitted as walk-ins
 *  - the teacher enters marks in the grid, saves a draft, submits; the Co-ordinator sends one back, then verifies both
 *  - nobody sees results before publish; the Co-ordinator publishes the class; each student sees their own marks card
 *  - the grading follows each school's pack: NEB GPA for Royal Softech's +2, percentage and division for the sample
 *    school (its pack's point: "percentage grading"); the Top 20 exists only where the school uses it
 *  - a student asks for a recheck; the Co-ordinator corrects a mark; the next card version shows it; the Admin sees
 *    the change; the other student cannot see it; the class sheet exports; the audit log is one unbroken chain
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, parsePack, resolveModules, type Pack } from "../src/core/config";
import { bsToAd, daysInMonth, todayBs } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { firstProgrammePolicy, seedProgrammes } from "./programme-fixtures";

const app = createApp();

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("Phase 7 exit check: $label", ({ json, database }) => {
  const pack: Pack = parsePack(json);
  const db = () => database();
  const top20On = resolveModules(pack.modules ?? {}).top20 === true;
  const policy = firstProgrammePolicy(pack);

  const call = (path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) =>
    app.request(
      `https://school.example${path}`,
      {
        method: options.method ?? "GET",
        headers: { "Sec-Fetch-Site": "same-origin", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { ...env, DB: db() },
    );
  const post = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "POST", body, cookie });
  const put = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "PUT", body, cookie });
  const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");

  async function signedIn(role: RoleClaim["role"], scope: RoleClaim["scope"]) {
    const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
      email: `${role}-p7exit-${crypto.randomUUID().slice(0, 6)}@school.example`,
      password: "blue-river-lamp-2083",
      fullName: `${role} person`,
      roles: [{ role: role as never, scope: scope as never }],
    });
    const now = Math.floor(Date.now() / 1000);
    return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [{ role, scope } as RoleClaim], iat: now, exp: now + 600 })}`;
  }
  async function firstSignIn(email: string, temporaryPassword: string, password: string): Promise<string> {
    const first = await call("/api/auth/sign-in", { method: "POST", body: { email, password: temporaryPassword } });
    const step = (await first.json()) as { challenge?: string };
    const changed = await call("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password } });
    expect(changed.status).toBe(200);
    return cookiesOf(changed);
  }

  const cookies: Record<string, string> = {};
  const state: { classId?: string; terminalId?: string; science?: { id: string; components: string[] }; english?: { id: string; components: string[] }; students: string[]; publicationId?: string } = { students: [] };
  const sheet = (subject: { id: string }) => `/api/results/classes/${state.classId}/subjects/${subject.id}/terminals/${state.terminalId}`;

  it("setup: this year, a class, a terminal, two subjects with components and credit hours, a hired teacher, two students", async () => {
    await applyPack(db(), pack);
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, pack); // a school starts with no programmes: the Admin makes them (D-087)
    cookies.coordinator = await signedIn("coordinator", "institution");
    cookies.admin = await signedIn("admin", "institution");
    const programmes = (await (await call("/api/academics/programmes", { cookie: cookies.coordinator })).json()) as { programmes: { gradingPolicy: string | null; levels: { id: string }[] }[] };
    expect(programmes.programmes[0]!.gradingPolicy).toBe(policy);
    const levelId = programmes.programmes[0]!.levels[0]!.id;

    const b = todayBs().year;
    const yearId = await idOf(await post("/api/academics/years", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }) }, cookies.coordinator));
    expect((await post(`/api/academics/years/${yearId}/activate`, undefined, cookies.coordinator)).status).toBe(200);
    state.classId = await idOf(await post("/api/academics/classes", { yearId, levelId, label: "" }, cookies.coordinator));
    const terminal = await post("/api/academics/terminals", { yearId, name: "First terminal" }, cookies.coordinator);
    expect(terminal.status).toBe(201);
    state.terminalId = await idOf(terminal);

    const addSubject = async (name: string, credit: number, components: [string, number, "theory" | "practical"][]) => {
      const subject = await post("/api/academics/subjects", { name: `${name} ${crypto.randomUUID().slice(0, 6)}` }, cookies.coordinator);
      const offeringId = await idOf(await post("/api/academics/offerings", { levelId, subjectId: await idOf(subject), creditHundredths: credit * 100 }, cookies.coordinator));
      const ids: string[] = [];
      for (const [cname, max, kind] of components) {
        const made = await post(`/api/academics/offerings/${offeringId}/components`, { name: cname, maxHundredths: max * 100, kind }, cookies.coordinator);
        expect(made.status).toBe(201);
        ids.push(await idOf(made));
      }
      return { id: offeringId, components: ids };
    };
    state.science = await addSubject("Science", 5, [["Theory", 75, "theory"], ["Practical", 25, "practical"]]);
    state.english = await addSubject("English", 4, [["Theory", 100, "theory"]]);

    const email = `teacher-p7exit-${crypto.randomUUID().slice(0, 6)}@school.example`;
    const hired = await post("/api/teachers", { fullName: "Gita Rai", email, homeSectionKey: pack.sections[0]!.key }, cookies.coordinator);
    const { id: teacherId, temporaryPassword } = (await hired.json()) as { id: string; temporaryPassword: string };
    cookies.teacher = await firstSignIn(email, temporaryPassword, "Mango-Sunrise-Harbour-4471");
    for (const offeringId of [state.science.id, state.english.id]) expect((await post("/api/academics/assignments", { classId: state.classId, offeringId, teacherId }, cookies.coordinator)).status).toBe(200);

    for (const first of ["Sita", "Hari"]) {
      const studentEmail = `${first.toLowerCase()}-p7exit-${crypto.randomUUID().slice(0, 6)}@example.com`;
      const admitted = await post(
        "/api/admissions/walk-ins",
        { firstName: first, lastName: "Exit", dob: "2009-11-02", phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email: studentEmail, guardianName: "Guardian", guardianPhone: "9800000021", levelId, classId: state.classId },
        cookies.coordinator,
      );
      expect(admitted.status).toBe(201);
      cookies[first] = await firstSignIn(studentEmail, ((await admitted.json()) as { temporaryPassword: string }).temporaryPassword, "Papaya-Compass-Ledger-8823");
    }
  });

  it("the teacher enters marks in the grid, saves a draft and submits; one comes back with a note and goes again", async () => {
    const grid = (await (await call(sheet(state.science!), { cookie: cookies.teacher })).json()) as { students: { enrollmentId: string; name: string }[]; missing: number };
    expect(grid.missing).toBe(4);
    state.students = grid.students.map((s) => s.enrollmentId);
    const [sita, hari] = [grid.students.find((s) => s.name.startsWith("Sita"))!.enrollmentId, grid.students.find((s) => s.name.startsWith("Hari"))!.enrollmentId];
    const [th, pr] = state.science!.components;
    // Sita: 68/75 + 24/25 = 92%; Hari: 45/75 + 20/25 = 65%.
    expect((await put(sheet(state.science!), { marks: [{ enrollmentId: sita, componentId: th, valueHundredths: 6800 }, { enrollmentId: sita, componentId: pr, valueHundredths: 2400 }] }, cookies.teacher)).status).toBe(200);
    expect((await post(`${sheet(state.science!)}/submit`, undefined, cookies.teacher)).status).toBe(409); // Hari's marks are missing
    expect((await put(sheet(state.science!), { marks: [{ enrollmentId: hari, componentId: th, valueHundredths: 4500 }, { enrollmentId: hari, componentId: pr, valueHundredths: 2000 }] }, cookies.teacher)).status).toBe(200);
    expect((await post(`${sheet(state.science!)}/submit`, undefined, cookies.teacher)).status).toBe(200);
    // English: Sita 81, Hari 58.
    expect((await put(sheet(state.english!), { marks: [{ enrollmentId: sita, componentId: state.english!.components[0], valueHundredths: 8100 }, { enrollmentId: hari, componentId: state.english!.components[0], valueHundredths: 5800 }] }, cookies.teacher)).status).toBe(200);
    expect((await post(`${sheet(state.english!)}/submit`, undefined, cookies.teacher)).status).toBe(200);

    const board = (await (await call(`/api/results/review?terminalId=${state.terminalId}`, { cookie: cookies.coordinator })).json()) as { classes: { classId: string; subjects: { offeringId: string; sheetId: string; status: string }[] }[] };
    const subjects = board.classes.find((c) => c.classId === state.classId)!.subjects;
    const englishSheet = subjects.find((s) => s.offeringId === state.english!.id)!.sheetId;
    expect((await post(`/api/results/review/sheets/${englishSheet}/send-back`, { note: "Please check Hari's paper again" }, cookies.coordinator)).status).toBe(200);
    expect((await post(`${sheet(state.english!)}/submit`, undefined, cookies.teacher)).status).toBe(200);
    const verified = await post("/api/results/review/verify", { sheetIds: subjects.map((s) => s.sheetId) }, cookies.coordinator);
    expect(((await verified.json()) as { verified: number }).verified).toBe(2);
  });

  it("nothing shows before publish; the Co-ordinator publishes the whole class; each student sees their own card", async () => {
    expect(((await (await call("/api/results/me", { cookie: cookies.Sita })).json()) as { results: unknown[] }).results).toHaveLength(0);
    expect((await post(`/api/results/classes/${state.classId}/publish`, { terminalId: state.terminalId }, cookies.admin)).status).toBe(403);
    const published = await post(`/api/results/classes/${state.classId}/publish`, { terminalId: state.terminalId }, cookies.coordinator);
    expect(published.status).toBe(201);
    state.publicationId = ((await published.json()) as { publicationId: string }).publicationId;

    const sita = (await (await call("/api/results/me", { cookie: cookies.Sita })).json()) as { results: { card: { body: { policy: string; gpaHundredths: number | null; percentHundredths: number | null; outcome: string; student: { name: string }; subjects: { grade: string }[] } } }[] };
    const card = sita.results[0]!.card.body;
    expect(card.student.name).toMatch(/^Sita/);
    expect(card.policy).toBe(policy);
    if (policy === "neb_gpa") {
      // Science 92% A+ (4.0 x 5 credits), English 81% A (3.6 x 4 credits): (20 + 14.4) / 9 = 3.82.
      expect(card.subjects.map((s) => s.grade).sort()).toEqual(["A", "A+"]);
      expect(card.gpaHundredths).toBe(382);
    } else {
      // 92 + 81 of 200 = 86.5%: Distinction.
      expect(card).toMatchObject({ percentHundredths: 8650, outcome: "Distinction" });
    }
  });

  it("the Top 20 follows the school's switch", async () => {
    const response = await call(`/api/results/top20?terminalId=${state.terminalId}`, { cookie: cookies.Hari });
    if (!top20On) return expect(response.status).toBe(404);
    const list = (await response.json()) as { pools: { entries: { rank: number; name: string }[] }[] };
    expect(list.pools[0]!.entries.map((e) => [e.rank, e.name.split(" ")[0]])).toEqual([
      [1, "Sita"],
      [2, "Hari"],
    ]);
  });

  it("a recheck: Hari asks, the Co-ordinator corrects the mark, the new card shows it, the Admin sees the change", async () => {
    const asked = await post(`/api/results/publications/${state.publicationId}/rechecks`, { offeringId: state.english!.id, reason: "My last answer was not marked" }, cookies.Hari);
    expect(asked.status).toBe(201);
    const recheckId = ((await asked.json()) as { id: string }).id;
    expect((await post(`/api/results/rechecks/${recheckId}/decide`, { outcome: "changed", reason: "Last answer added: +6", marks: [{ componentId: state.english!.components[0], valueHundredths: 6400 }] }, cookies.coordinator)).status).toBe(200);
    const hari = (await (await call("/api/results/me", { cookie: cookies.Hari })).json()) as { results: { card: { version: number; body: { subjects: { percentHundredths: number }[] } } }[] };
    expect(hari.results[0]!.card.version).toBe(2);
    expect(hari.results[0]!.card.body.subjects.some((s) => s.percentHundredths === 6400)).toBe(true);
    const changes = (await (await call("/api/results/rechecks", { cookie: cookies.admin })).json()) as { rechecks: { id: string; status: string }[] };
    expect(changes.rechecks.find((r) => r.id === recheckId)!.status).toBe("changed");
    const sita = (await (await call("/api/results/me", { cookie: cookies.Sita })).json()) as { results: { rechecks: unknown[] }[] };
    expect(sita.results[0]!.rechecks).toHaveLength(0);
  });

  it("the class sheet exports, and the audit log is one unbroken chain", async () => {
    const csv = await (await call(`/api/results/classes/${state.classId}/terminals/${state.terminalId}/sheet.csv`, { cookie: cookies.admin })).text();
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
    expect((await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
  });
});
