import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ApprovalsPage from "@/app/portal/approvals/page";
import { InboxScreen, InboxView } from "@/approvals/InboxScreen";
import type { ApprovalSummary, MyApproval } from "@/approvals/model";
import { RequestsView } from "@/approvals/RequestsPanel";
import { ContentList } from "@/content/ContentList";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/approvals", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
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
  ...over,
});
const myRequest = (over: Partial<MyApproval> = {}): MyApproval => ({ ...request(), status: "pending", decisionReason: null, ...over });

// ---------------------------------------------------------------------------------------------
describe("the inbox view", () => {
  it("lists each pending request with its summary, requester and both actions", () => {
    const html = inContext(<InboxView requests={[request()]} busy={null} onApprove={noop} onDecline={noop} />);
    expect(html).toContain("Winter break");
    expect(html).toContain("Website content");
    expect(html).toContain("Sita Sharma");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Decline<");
  });

  it("decline is a disclosure with a reason field and its own submit button", () => {
    const html = inContext(<InboxView requests={[request()]} busy={null} onApprove={noop} onDecline={noop} />);
    expect(html).toMatch(/<details[^>]*>[\s\S]*<summary/);
    expect(html).toContain(">Reason<");
    expect(html).toContain(">Decline with this reason<");
  });

  it("says so when nothing is waiting", () => {
    expect(inContext(<InboxView requests={[]} busy={null} onApprove={noop} onDecline={noop} />)).toContain("Nothing is waiting for a decision.");
  });

  it("the screen shows the shape of the page while it loads", () => {
    const html = inContext(<InboxScreen />);
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Approvals</h1>");
  });

  it("the page has the portal around it", () => {
    const html = inContext(<ApprovalsPage />);
    expect(html).toContain(">Approvals</h1>");
    expect(html).toContain("Skip to main content");
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
    expect(html).toContain(">Website content</h1>");
  });

  it("shows the shape of the page for an Admin unchanged", () => {
    const html = inContext(<ContentList />, as("admin"));
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Website content</h1>");
  });
});
