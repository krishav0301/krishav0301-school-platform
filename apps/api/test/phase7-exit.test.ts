/**
 * The Phase 7 exit check (docs/build-plan.md): results end to end, for BOTH schools, through the real HTTP API,
 * starting from each school's own pack, with real sign-ins from the real first-password flows.
 *
 *  - the Co-ordinator sets up the term (D-114): its exam pattern (two terminals of 40 and 60, both with the practical;
 *    graded with letters for Royal Softech's +2, a percentage for the sample school, its pack's "percentage grading"),
 *    a class, two subjects (Science with a 75/25 practical, English theory only), a teacher hired through the staff
 *    flow and assigned both, two students admitted as walk-ins
 *  - the teacher enters marks in the grid, saves a draft, submits; the Co-ordinator sends one back, then verifies both
 *  - nobody sees results before publish; the Co-ordinator publishes the first terminal (for information, no pass or
 *    fail), then the last, and the final result comes with it; the Top 20 (on the final) exists only where the school
 *    uses it
 *  - a student asks for a recheck; the Co-ordinator corrects a mark; the next card versions show it; the Admin sees
 *    the change; the other student cannot see it; the class sheet exports; the audit log is one unbroken chain
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, resolveModules, type Pack } from "../src/core/config";
import { bsToAd, daysInMonth, todayBs } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { firstProgrammeGraded, seedProgrammes, testPack } from "./programme-fixtures";

const app = createApp();

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("Phase 7 exit check: $label", ({ json, database }) => {
  const pack: Pack = testPack(json);
  const db = () => database();
  const top20On = resolveModules(pack.modules ?? {}).top20 === true;
  const graded = firstProgrammeGraded(pack);

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
  const state: { classId?: string; terminalId?: string; finalId?: string; science?: { id: string }; english?: { id: string }; students: string[]; publicationId?: string } = { students: [] };
  const sheet = (subject: { id: string }, terminal = state.terminalId) => `/api/results/classes/${state.classId}/subjects/${subject.id}/terminals/${terminal}`;

  it("setup: the term and its exam pattern, a class, two subjects with their papers, a hired teacher, two students", async () => {
    await applyPack(db(), pack);
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, pack); // a school starts with no programmes: the Admin makes them (D-087)
    cookies.coordinator = await signedIn("coordinator", "institution");
    cookies.admin = await signedIn("admin", "institution");
    const programmes = (await (await call("/api/academics/programmes", { cookie: cookies.coordinator })).json()) as { programmes: { levels: { id: string }[] }[] };
    const levelId = programmes.programmes[0]!.levels[0]!.id;

    const b = todayBs().year;
    const yearId = await idOf(await post("/api/academics/years", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }), levelIds: [levelId] }, cookies.admin));
    expect((await post(`/api/academics/years/${yearId}/activate`, undefined, cookies.admin)).status).toBe(200);
    state.classId = await idOf(await post("/api/academics/classes", { yearId, levelId, label: "" }, cookies.coordinator));
    const bands = [
      { grade: "A+", from: 90 },
      { grade: "A", from: 80 },
      { grade: "B+", from: 70 },
      { grade: "B", from: 60 },
      { grade: "C+", from: 50 },
      { grade: "C", from: 40 },
      { grade: "D", from: 35 },
    ];
    const madePattern = await put(
      `/api/academics/years/${yearId}/exam-pattern`,
      {
        graded,
        theoryMinPercent: 35,
        practicalMinPercent: 40,
        gradeBands: graded ? bands : null,
        terminals: [
          { name: "First terminal", weight: 40, hasPractical: true },
          { name: "Final", weight: 60, hasPractical: true },
        ],
      },
      cookies.coordinator,
    );
    expect(madePattern.status).toBe(200);
    const exam = (await (await call(`/api/academics/years/${yearId}/exam-pattern`, { cookie: cookies.coordinator })).json()) as { terminals: { id: string }[] };
    [state.terminalId, state.finalId] = exam.terminals.map((t) => t.id);

    const addSubject = async (name: string, practical: number | null) => {
      const subject = await post("/api/academics/subjects", { name: `${name} ${crypto.randomUUID().slice(0, 6)}` }, cookies.coordinator);
      const made = await post("/api/academics/offerings", { levelId, subjectId: await idOf(subject), fullMarksHundredths: 10_000, practicalHundredths: practical }, cookies.coordinator);
      expect(made.status).toBe(201);
      return { id: await idOf(made) };
    };
    state.science = await addSubject("Science", 2_500);
    state.english = await addSubject("English", null);

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
    const [sita, hari] = [grid.students.find((s) => s.name.startsWith("Sita"))!.enrollmentId, grid.students.find((s) => s.name.startsWith("Hari"))!.enrollmentId];
    state.students = [sita, hari];
    const [th, pr] = ["theory", "practical"];
    // Sita: 68/75 + 24/25 = 92%; Hari: 45/75 + 20/25 = 65%.
    expect((await put(sheet(state.science!), { marks: [{ enrollmentId: sita, componentId: th, valueHundredths: 6800 }, { enrollmentId: sita, componentId: pr, valueHundredths: 2400 }] }, cookies.teacher)).status).toBe(200);
    expect((await post(`${sheet(state.science!)}/submit`, undefined, cookies.teacher)).status).toBe(409); // Hari's marks are missing
    expect((await put(sheet(state.science!), { marks: [{ enrollmentId: hari, componentId: th, valueHundredths: 4500 }, { enrollmentId: hari, componentId: pr, valueHundredths: 2000 }] }, cookies.teacher)).status).toBe(200);
    expect((await post(`${sheet(state.science!)}/submit`, undefined, cookies.teacher)).status).toBe(200);
    // English: Sita 81, Hari 58.
    expect((await put(sheet(state.english!), { marks: [{ enrollmentId: sita, componentId: "theory", valueHundredths: 8100 }, { enrollmentId: hari, componentId: "theory", valueHundredths: 5800 }] }, cookies.teacher)).status).toBe(200);
    expect((await post(`${sheet(state.english!)}/submit`, undefined, cookies.teacher)).status).toBe(200);

    const board = (await (await call(`/api/results/review?terminalId=${state.terminalId}`, { cookie: cookies.coordinator })).json()) as { classes: { classId: string; subjects: { offeringId: string; sheetId: string; status: string }[] }[] };
    const subjects = board.classes.find((c) => c.classId === state.classId)!.subjects;
    const englishSheet = subjects.find((s) => s.offeringId === state.english!.id)!.sheetId;
    expect((await post(`/api/results/review/sheets/${englishSheet}/send-back`, { note: "Please check Hari's paper again" }, cookies.coordinator)).status).toBe(200);
    expect((await post(`${sheet(state.english!)}/submit`, undefined, cookies.teacher)).status).toBe(200);
    const verified = await post("/api/results/review/verify", { sheetIds: subjects.map((s) => s.sheetId) }, cookies.coordinator);
    expect(((await verified.json()) as { verified: number }).verified).toBe(2);
  });

  it("nothing shows before publish; the Co-ordinator publishes the first terminal, for information: no pass or fail", async () => {
    expect(((await (await call("/api/results/me", { cookie: cookies.Sita })).json()) as { results: unknown[] }).results).toHaveLength(0);
    expect((await post(`/api/results/classes/${state.classId}/publish`, { terminalId: state.terminalId }, cookies.admin)).status).toBe(403);
    const published = await post(`/api/results/classes/${state.classId}/publish`, { terminalId: state.terminalId }, cookies.coordinator);
    expect(published.status).toBe(201);
    const body = (await published.json()) as { publicationId: string; finalPublicationId: string | null };
    expect(body.finalPublicationId).toBeNull();
    state.publicationId = body.publicationId;

    const sita = (await (await call("/api/results/me", { cookie: cookies.Sita })).json()) as { results: { kind: string; card: { body: { kind: string; percentHundredths: number; grade: string | null; outcome: string; student: { name: string } } } }[] };
    const card = sita.results[0]!.card.body;
    expect(card.student.name).toMatch(/^Sita/);
    // Science 92%, English 81%: 86.50 on average; an A when graded, else the percentage.
    expect(card).toMatchObject({ kind: "terminal", percentHundredths: 8650, grade: graded ? "A" : null, outcome: graded ? "A" : "86.50%" });
  });

  it("the last terminal brings the final result with it: every terminal scaled to its weight, out of 100, pass or fail", async () => {
    const [sita, hari] = state.students;
    // Final terminal: Sita Science 60/75 + 20/25, English 90; Hari Science 30/75 + 12/25, English 50.
    expect((await put(sheet(state.science!, state.finalId), { marks: [
      { enrollmentId: sita, componentId: "theory", valueHundredths: 6000 }, { enrollmentId: sita, componentId: "practical", valueHundredths: 2000 },
      { enrollmentId: hari, componentId: "theory", valueHundredths: 3000 }, { enrollmentId: hari, componentId: "practical", valueHundredths: 1200 },
    ] }, cookies.teacher)).status).toBe(200);
    expect((await put(sheet(state.english!, state.finalId), { marks: [{ enrollmentId: sita, componentId: "theory", valueHundredths: 9000 }, { enrollmentId: hari, componentId: "theory", valueHundredths: 5000 }] }, cookies.teacher)).status).toBe(200);
    for (const subject of [state.science!, state.english!]) expect((await post(`${sheet(subject, state.finalId)}/submit`, undefined, cookies.teacher)).status).toBe(200);
    const board = (await (await call(`/api/results/review?terminalId=${state.finalId}`, { cookie: cookies.coordinator })).json()) as { classes: { classId: string; subjects: { sheetId: string }[] }[] };
    await post("/api/results/review/verify", { sheetIds: board.classes.find((c) => c.classId === state.classId)!.subjects.map((x) => x.sheetId) }, cookies.coordinator);
    const published = await post(`/api/results/classes/${state.classId}/publish`, { terminalId: state.finalId }, cookies.coordinator);
    expect(published.status).toBe(201);
    expect(((await published.json()) as { finalPublicationId: string | null }).finalPublicationId).toEqual(expect.any(String));

    type Own = { results: { kind: string; card: { body: { percentHundredths: number; passed: boolean; grade: string | null; outcome: string } } }[] };
    const finalOf = async (who: string) => ((await (await call("/api/results/me", { cookie: cookies[who] })).json()) as Own).results.find((r) => r.kind === "final")!.card.body;
    // Sita: Science 92 x 0.4 + 80 x 0.6 = 84.80; English 81 x 0.4 + 90 x 0.6 = 86.40; 85.60 overall.
    expect(await finalOf("Sita")).toMatchObject({ percentHundredths: 8560, passed: true, grade: graded ? "A" : null, outcome: graded ? "A" : "Pass" });
    // Hari: Science 26 + 25.20 = 51.20 (theory 48%, practical 60.8%); English 23.20 + 30 = 53.20; 52.20 overall.
    expect(await finalOf("Hari")).toMatchObject({ percentHundredths: 5220, passed: true, grade: graded ? "C+" : null });
  });

  it("the Top 20 (on the final) follows the school's switch", async () => {
    const response = await call("/api/results/top20", { cookie: cookies.Hari });
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
    expect((await post(`/api/results/rechecks/${recheckId}/decide`, { outcome: "changed", reason: "Last answer added: +6", marks: [{ componentId: "theory", valueHundredths: 6400 }] }, cookies.coordinator)).status).toBe(200);
    type Own = { results: { kind: string; terminalName: string | null; card: { version: number; body: { percentHundredths: number; subjects: { percentHundredths?: number }[] } } }[] };
    const hari = (await (await call("/api/results/me", { cookie: cookies.Hari })).json()) as Own;
    const first = hari.results.find((r) => r.terminalName === "First terminal")!;
    expect(first.card.version).toBe(2);
    expect(first.card.body.subjects.some((s) => s.percentHundredths === 6400)).toBe(true);
    // The final too: English 25.60 + 30 = 55.60; (51.20 + 55.60) / 2 = 53.40.
    const final = hari.results.find((r) => r.kind === "final")!;
    expect(final.card).toMatchObject({ version: 2, body: { percentHundredths: 5340 } });
    const changes = (await (await call("/api/results/rechecks", { cookie: cookies.admin })).json()) as { rechecks: { id: string; status: string }[] };
    expect(changes.rechecks.find((r) => r.id === recheckId)!.status).toBe("changed");
    const sita = (await (await call("/api/results/me", { cookie: cookies.Sita })).json()) as { results: { rechecks: unknown[] }[] };
    expect(sita.results.every((r) => r.rechecks.length === 0)).toBe(true);
  });

  it("the class sheet exports, and the audit log is one unbroken chain", async () => {
    const csv = await (await call(`/api/results/classes/${state.classId}/final/sheet.csv`, { cookie: cookies.admin })).text();
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
    const terminalCsv = await (await call(`/api/results/classes/${state.classId}/terminals/${state.terminalId}/sheet.csv`, { cookie: cookies.admin })).text();
    expect(terminalCsv.split("\r\n").filter(Boolean)).toHaveLength(3);
    expect((await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
  });
});
