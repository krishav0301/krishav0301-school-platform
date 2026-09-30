import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MailboxList } from "@/mailbox/MailboxScreen";

/** The test mailbox (D-086): each email's subject, who it went to, and its text with the links made followable. */
describe("the test mailbox", () => {
  it("shows each email with its links as links, and text as typed (never run)", () => {
    const html = renderToStaticMarkup(
      <MailboxList
        messages={[
          { id: 2, at: "2026-09-30T06:00:00Z", to: "sita@school.example", subject: "Confirm your email", body: "Open this:\nhttps://school.example/apply/verify#abc <b>hi</b>" },
        ]}
      />,
    );
    expect(html).toContain("<h2");
    expect(html).toContain("Confirm your email");
    expect(html).toContain("To sita@school.example, 30 Sept, 11:45");
    expect(html).toContain('<a href="https://school.example/apply/verify#abc">https://school.example/apply/verify#abc</a>');
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("says so when there is nothing yet", () => {
    expect(renderToStaticMarkup(<MailboxList messages={[]} />)).toContain("No emails yet.");
  });
});
