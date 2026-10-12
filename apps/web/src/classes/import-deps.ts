import { approveApplication, browseStudents, issueStudentPin, loadApplication, loadQueue, registerWalkIn, suggestStudentEmail } from "@/admissions/client";
import { toAd } from "@/content/client";
import type { AdmitDeps } from "@/sheets/admit-rows";
import type { useSession } from "@/session/SessionProvider";

type Api = ReturnType<typeof useSession>["api"];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What the class import asks of the server, for one class: admitting a student, and finding what a failed try left (D-151). */
export function makeAdmitDeps(api: Api, classId: string, levelId: string): AdmitDeps {
  return {
    toAd: (bs) => toAd(api, bs),
    suggestEmail: (firstName, lastName) => suggestStudentEmail(api, firstName, lastName),
    walkIn: (values, ad, confirm) => registerWalkIn(api, values, ad, classId, confirm),
    recovery: {
      // What a try that got no answer may have left: the application waiting in the queue (found by name and its own sign-in email)...
      pendingApplications: async (values) => {
        const queue = await loadQueue(api);
        if (!queue.ok) return null;
        const named = queue.data.filter((a) => a.status === "pending_review" && a.walkIn && a.levelId === levelId && same(a.firstName, values.firstName) && same(a.lastName, values.lastName));
        const ids: string[] = [];
        for (const a of named) {
          const detail = await loadApplication(api, a.id);
          if (detail.ok && same(detail.data.email, values.email)) ids.push(a.id);
        }
        return ids;
      },
      approve: (id) => approveApplication(api, id, classId, null),
      // ...or the student it admitted before the answer was lost.
      studentsNamed: async (values) => {
        const found = await browseStudents(api, { class: classId, status: "all", q: [values.firstName, values.lastName].filter(Boolean).join(" "), pageSize: 50 });
        if (!found.ok) return null;
        return found.data.students.filter((x) => same(x.firstName, values.firstName) && same(x.lastName, values.lastName)).map((x) => ({ id: x.id, sid: x.sid }));
      },
      newPassword: async (studentId) => {
        const pin = await issueStudentPin(api, studentId);
        return pin.ok ? pin.password : null;
      },
    },
  };
}

/** The students already in the class, so a run never mistakes one of them for a student it admitted itself. */
export async function classSids(api: Api, classId: string): Promise<Set<string>> {
  const sids = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const found = await browseStudents(api, { class: classId, status: "all", pageSize: 50, page });
    if (!found.ok) break;
    found.data.students.forEach((x) => sids.add(x.sid));
    if (found.data.students.length < 50) break;
  }
  return sids;
}
