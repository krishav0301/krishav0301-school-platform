import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ApprovalsPage from "@/app/portal/approvals/page";
import { ApprovalsList, DetailBody, InboxScreen } from "@/approvals/InboxScreen";
import type { ApprovalSummary, MyApproval } from "@/approvals/model";
import { RequestsView } from "@/approvals/RequestsPanel";
import { ContentList } from "@/content/ContentList";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/approvals", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};

const as = (role: string, scope: "institution" | "section" = "institution") => fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope }] } });
const inContext = (element: React.ReactNode, session = as("admin")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );
const noop = () => {};

const request = (over: Partial<ApprovalSummary> = {}): ApprovalSummary => ({
  id: "r1",
  kind: "website_content",
  subjectId: "c1",
  summary: 'Notice "Winter break"',
  snapshot: {},
  requestedBy: "Sita Sharma",
  createdAt: "2026-09-22T00:00:00Z",
  requesterRole: "coordinator",
  mine: false,
  createdOnBs: "2083-06-06",
  ...over,
});
const myRequest = (over: Partial<MyApproval> = {}): MyApproval => ({ ...request(), status: "pending", decisionReason: null, ...over });

// ---------------------------------------------------------------------------------------------
const fee = request({
  id: "f1",
  kind: "fee_structure",
  requestedBy: "Gita Thapa",
  requesterRole: "accountant",
  createdOnBs: "2083-06-16",
  snapshot: {
    programme: "+2 Science",
    level: "Grade 11",
    year: "2083",
    items: [
      { name: "Tuition", amountPaisa: 350_000, frequency: "monthly" },
      { name: "Admission", amountPaisa: 1_500_000, frequency: "one_time" },
    ],
    yearlyTotalPaisa: 6_200_000,
  },
});
const discount = request({ id: "d1", kind: "discount", requesterRole: "accountant", snapshot: { student: "Rishav Kumar", amountPaisa: 500_000, percent: null, reason: "sibling" } });

describe("the approvals inbox (D-102)", () => {
  it("each card says the kind, the subject, a short summary, who sent it and when, the status in words, and offers Review", () => {
    const html = inContext(<ApprovalsList requests={[fee, request()]} filtered={false} onReview={noop} />);
    expect(html).toContain(">Fee structure</h2>");
    expect(html).toContain("+2 Science · Grade 11 · 2083");
    expect(html).toContain("Tuition 3,500 / month · Admission 15,000 once");
    expect(html).toContain("Term total: NPR 62,000");
    expect(html).toContain("Sent by Gita Thapa");
    expect(html).toContain("16 Ashwin 2083");
    expect(html).toContain(">Waiting<");
    expect(html).toContain('aria-label="Review Fee structure: +2 Science · Grade 11 · 2083"');
    // One prominent button per view (D-030): a card offers Review, never a filled Approve.
    expect(html).not.toContain("Approve");
  });

  it("a discount card shows the student, the amount and its reason (admin FUT F-06)", () => {
    const html = inContext(<ApprovalsList requests={[discount]} filtered={false} onReview={noop} />);
    expect(html).toContain("Rishav Kumar");
    expect(html).toContain("NPR 5,000 · Reason: Sibling");
  });

  it("the Principal's own request is marked as theirs, in words (admin FUT F-13)", () => {
    expect(inContext(<ApprovalsList requests={[request({ mine: true })]} filtered={false} onReview={noop} />)).toContain(">Your request<");
  });

  it("an empty inbox is calm: nothing waiting, all caught up; a filter with nothing says so", () => {
    const empty = inContext(<ApprovalsList requests={[]} filtered={false} onReview={noop} />);
    expect(empty).toContain("Nothing is waiting for a decision.");
    expect(empty).toContain("You&#x27;re all caught up.");
    expect(inContext(<ApprovalsList requests={[]} filtered onReview={noop} />)).toContain("Nothing of this kind is waiting.");
  });

  it("while loading, it shows the shape of the cards, not a lone spinner", () => {
    const html = inContext(<InboxScreen />);
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Approvals</h1>");
    expect(html).toContain("You cannot approve your own request.");
    expect(html).toContain('aria-pressed="true"'); // All, chosen
    expect(html).toContain(">Newest first<");
  });

  it("the page has the portal around it", () => {
    const html = inContext(<ApprovalsPage />);
    expect(html).toContain(">Approvals</h1>");
    expect(html).toContain("Skip to main content");
  });
});

describe("the review panel's details, for each kind (D-102)", () => {
  it("a fee structure: every item, the yearly total, the programme and year, and what approving does", () => {
    const html = inContext(<DetailBody detail={{ kind: "fee_structure", programme: "+2 Science", level: "Grade 11", year: "2083", items: [{ name: "Tuition", amountPaisa: 350_000, frequency: "monthly" }, { name: "Laboratory", amountPaisa: 200_000, frequency: "yearly" }], yearlyTotalPaisa: 4_400_000 }} />);
    expect(html).toContain("<dt>Tuition</dt><dd>NPR 3,500 / month</dd>");
    expect(html).toContain("<dt>Laboratory</dt><dd>NPR 2,000 / term</dd>");
    expect(html).toContain("<dt>Term total</dt><dd>NPR 44,000</dd>");
    expect(html).toContain("+2 Science · Grade 11 · 2083");
    expect(html).toContain("If approved, this fee structure will take effect for the selected programme and term.");
  });

  it("a percentage discount: the percentage and its amount, the reason, and the note when Other", () => {
    const html = inContext(<DetailBody detail={{ kind: "discount", student: "Rishav Kumar", sid: "2083-00012", className: "BBS · Year 1", amountPaisa: 1_200_000, percent: 10, reason: "other", note: "Flood relief" }} />);
    expect(html).toContain("<dd>Rishav Kumar (2083-00012)</dd>");
    expect(html).toContain("<dt>Class</dt><dd>BBS · Year 1</dd>");
    expect(html).toContain("<dt>Discount</dt><dd>10%</dd>");
    expect(html).toContain("<dt>Equivalent amount</dt><dd>NPR 12,000</dd>");
    expect(html).toContain("<dt>Reason</dt><dd>Other</dd>");
    expect(html).toContain("<dt>Note</dt><dd>Flood relief</dd>");
  });

  it("a reversal: the original payment, its day and receipt, and that the payment itself is never changed", () => {
    const html = inContext(<DetailBody detail={{ kind: "reversal", student: "Rishav Kumar", sid: "2083-00012", className: null, amountPaisa: 2_500_000, reason: "Payment recorded twice", payment: { amountPaisa: 2_500_000, paidOnBs: "2083-06-12", receiptNumber: "P2-2083-00041", method: "cash" } }} />);
    expect(html).toContain("<dt>Original payment</dt><dd>NPR 25,000</dd>");
    expect(html).toContain("<dt>Payment date</dt><dd>12 Ashwin 2083</dd>");
    expect(html).toContain("<dt>Receipt</dt><dd>P2-2083-00041</dd>");
    expect(html).toContain("<dt>Reason</dt><dd>Payment recorded twice</dd>");
    expect(html).toContain("The original payment will not be edited or deleted.");
  });

  it("a refund: the credit and the amount; how it is paid back is the Accountant's, not a choice here", () => {
    const html = inContext(<DetailBody detail={{ kind: "refund", student: "Rishav Kumar", sid: "2083-00012", className: null, amountPaisa: 1_800_000, availableCreditPaisa: 1_800_000, note: "Excess payment" }} />);
    expect(html).toContain("<dt>Available credit</dt><dd>NPR 18,000</dd>");
    expect(html).toContain("<dt>Refund amount</dt><dd>NPR 18,000</dd>");
    expect(html).toContain("the Accountant records how the refund was paid");
    expect(html).not.toMatch(/<select|type="radio"/);
  });

  it("website content: the title and a preview of what will be published", () => {
    const html = inContext(<DetailBody detail={{ kind: "website_content", contentKind: "notice", title: "Grade 11 first terminal results are out", bodyPreview: "Students can check their results on the portal.", bodyTruncated: false, publishOnBs: "2083-06-15", holidayFromBs: null, holidayToBs: null }} />);
    expect(html).toContain("Grade 11 first terminal results are out");
    expect(html).toContain("Students can check their results on the portal.");
    expect(html).toContain("<dt>Shows from</dt><dd>15 Ashwin 2083</dd>");
  });
});

// ---------------------------------------------------------------------------------------------
describe("a Co-ordinator's own requests panel", () => {
  it("shows a pending request with a way to withdraw it", () => {
    const html = inContext(<RequestsView requests={[myRequest()]} busy={null} onWithdraw={noop} />, as("coordinator"));
    expect(html).toContain("Winter break");
    expect(html).toContain("Waiting for a decision");
    expect(html).toContain(">Withdraw<");
  });

  it("shows a declined request with its reason, and no withdraw button", () => {
    const html = inContext(<RequestsView requests={[myRequest({ status: "declined", decisionReason: "Not ready yet" })]} busy={null} onWithdraw={noop} />, as("coordinator"));
    expect(html).toContain("Declined: Not ready yet");
    expect(html).not.toContain(">Withdraw<");
  });

  it("hides an approved or withdrawn request: the content item's own state already says so", () => {
    const html = inContext(<RequestsView requests={[myRequest({ status: "approved" }), myRequest({ id: "r2", status: "withdrawn" })]} busy={null} onWithdraw={noop} />, as("coordinator"));
    expect(html).toContain("You have not sent anything for approval yet.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the content list's role-based actions", () => {
  it("shows the shape of the page for a Co-ordinator (no crash, no publish controls to fetch yet)", () => {
    const html = inContext(<ContentList />, as("coordinator"));
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Website Content</h1>");
  });

  it("shows the shape of the page for an Admin unchanged", () => {
    const html = inContext(<ContentList />, as("admin"));
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Website Content</h1>");
  });
});
