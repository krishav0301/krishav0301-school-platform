import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ContentPage from "@/app/portal/content/page";
import EditContentPage from "@/app/portal/content/edit/page";
import { HomeView } from "@/site/HomeView";
import { siteFrom } from "./site-fixture";
import NoticesPage from "@/app/notices/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { ContentEditor, ContentForm } from "@/content/ContentForm";
import { ContentList } from "@/content/ContentList";
import { BsDateField } from "@/content/BsDateField";
import { ContentPreview } from "@/content/ContentPreview";
import { NoticeList } from "@/content/NoticeBoard";
import { emptyForm, type FormValues, type Kind, type PublicItem } from "@/content/model";
import { SessionContext } from "@/session/SessionProvider";
import { Checkbox, Select, TextArea } from "@/ui";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/content", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const admin = fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role: "admin", scope: "institution" }] } });

const inContext = (element: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={admin}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const editor = (over: Partial<Parameters<typeof ContentEditor>[0]> = {}, values: Partial<FormValues> = {}) =>
  inContext(<ContentEditor id={null} initial={{ ...emptyForm("2083-06-05"), ...values }} live={false} onSaved={() => {}} onGone={() => {}} {...over} />);

// ---------------------------------------------------------------------------------------------
describe("the Co-ordinator's form (Co-ordinator FUT F-08)", () => {
  it("offers Send for approval, never Publish", () => {
    const coordinator = fakeSession({ status: "signedIn", me: { name: "Sita", roles: [{ role: "coordinator", scope: "institution" }] } });
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <SessionContext.Provider value={coordinator}>
          <ContentEditor id={null} initial={emptyForm("2083-06-05")} live={false} onSaved={() => {}} onGone={() => {}} />
        </SessionContext.Provider>
      </ConfigContext.Provider>,
    );
    expect(html).toContain(">Send for approval<");
    expect(html).not.toContain(">Publish<");
    expect(editor()).toContain(">Publish<"); // the Principal still publishes
  });
});

describe("the new form controls", () => {
  it("TextArea: a visible label tied to the box, hint and error read out with it, invalid only with an error", () => {
    const plain = renderToStaticMarkup(<TextArea label="Text" hint="Plain text." />);
    expect(plain).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Text<\/label>/);
    const id = /<label[^>]*for="([^"]+)"/.exec(plain)![1];
    expect(plain).toContain(`<textarea`);
    expect(plain).toContain(`id="${id}"`);
    expect(plain).toContain(`aria-describedby="${id}-hint"`);
    expect(plain).not.toContain("aria-invalid");

    const bad = renderToStaticMarkup(<TextArea label="Text" hint="Plain text." error="Write some text." />);
    expect(bad).toContain('aria-invalid="true"');
    expect(bad).toMatch(/aria-describedby="[^"]+-hint [^"]+-error"/);
    expect(bad).toContain("Write some text.");
  });

  it("Select: a label, every option, and the current one chosen", () => {
    const html = renderToStaticMarkup(<Select label="Type" value="post" onChange={() => {}} options={[{ value: "notice", label: "Notice" }, { value: "post", label: "Post" }]} />);
    expect(html).toMatch(/<label[^>]*>Type<\/label>/);
    expect(html).toContain("<select");
    expect(count(html, /<option/g)).toBe(2);
    expect(html).toMatch(/<option value="post" selected/);
  });

  it("Checkbox: the label and the hint are one target, read out together", () => {
    const html = renderToStaticMarkup(<Checkbox label="Urgent" hint="Listed first." checked={false} onChange={() => {}} />);
    expect(html).toContain('type="checkbox"');
    const id = /<input[^>]*id="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`<label for="${id}"`);
    expect(html).toContain(`aria-describedby="${id}-hint"`);
    expect(html).toContain("Listed first.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("BsDateField", () => {
  const field = (props: Partial<Parameters<typeof BsDateField>[0]> = {}) => renderToStaticMarkup(<BsDateField legend="Show from" value="" onChange={() => {}} {...props} />);

  it("is one group with a legend, and three labelled boxes in the order a Nepali day is read: day, month, year", () => {
    const html = field();
    expect(html).toMatch(/<fieldset[^>]*>\s*<legend[^>]*>Show from<\/legend>/);
    expect(html.indexOf(">Day<")).toBeLessThan(html.indexOf(">Month<"));
    expect(html.indexOf(">Month<")).toBeLessThan(html.indexOf(">Year<"));
    for (const part of ["day", "month", "year"]) expect(html).toMatch(new RegExp(`<label[^>]*for="[^"]*-${part}"`));
  });

  it("offers the twelve months by name, and Choose while none is chosen", () => {
    const html = field();
    expect(count(html, /<option/g)).toBe(13);
    for (const name of ["Baisakh", "Ashwin", "Poush", "Chaitra"]) expect(html).toContain(`>${name}</option>`);
    expect(html).toMatch(/<option value="" selected="">Choose<\/option>/);
  });

  it("asks for the number keypad for the day and the year, and offers no autofill", () => {
    const html = field();
    expect(count(html, /inputMode="numeric"/g)).toBe(2);
    expect(count(html, /autoComplete="off"/g)).toBe(2);
    expect(html).toContain('maxLength="2"');
    expect(html).toContain('maxLength="4"');
  });

  it("fills the boxes from a saved day, and leaves them empty for none", () => {
    const filled = field({ value: "2083-10-09" });
    expect(filled).toContain('value="9"');
    expect(filled).toContain('value="2083"');
    expect(filled).toMatch(/<option value="10" selected="">Magh<\/option>/);
    // Empty for none: the day and year boxes carry no value.
    expect(field()).toMatch(/-day"[^>]*value=""/);
    expect(field()).toMatch(/-year"[^>]*value=""/);
  });

  it("ties the hint and the error to every box, and marks the boxes invalid only when there is an error", () => {
    const ok = field({ hint: "Nepali date." });
    expect(ok).toContain("Nepali date.");
    expect(ok).not.toContain("aria-invalid");
    const bad = field({ hint: "Nepali date.", error: "Choose the day, month and year." });
    expect(count(bad, /aria-invalid="true"/g)).toBe(3);
    expect(count(bad, /aria-describedby="[^"]+-hint [^"]+-error"/g)).toBe(3);
    expect(bad).toContain("Choose the day, month and year.");
  });
});

describe("the Website Content page (D-098, after the PM's reference)", () => {
  const html = inContext(<ContentList />);

  it("has one heading and one prominent action: New content", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Website Content<\/h1>/);
    expect(html).toContain("Publish news, notices, holidays, events, vacancies and important information to your public website.");
    expect(html).toMatch(/<button[^>]*class="[^"]*\bprimary\b[^"]*"[^>]*>.*New content<\/button>/);
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
  });

  it("offers every type and every status as a group of buttons, All pressed in each, and a labelled search", () => {
    for (const group of ["Type", "Status"]) expect(html).toMatch(new RegExp(`role="group" aria-label="${group}"`));
    for (const word of ["News", "Notice", "Holiday", "Event", "Vacancy", "Information", "Routine", "Published", "Draft", "Scheduled", "Archived"]) {
      expect(html, word).toMatch(new RegExp(`aria-pressed="false"[^>]*>${word}</button>`));
    }
    expect(count(html, /aria-pressed="true"[^>]*>All<\/button>/g)).toBe(2);
    expect(html).toContain('type="search"');
    expect(html).toContain("Search content");
  });

  it("shows the four figures, the public website card and the rows as shapes while it loads, announced politely", () => {
    for (const word of ["Published", "Drafts", "Scheduled", "Urgent", "On website", "Not visible", "Will be published", "Needs attention", "Public website"]) expect(html, word).toContain(word);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading content");
    expect(html).not.toContain('role="alert"');
  });

  it("asks for no image anywhere (D-098: website posts are text first)", () => {
    expect(html).not.toMatch(/image|photo|thumbnail|upload/i);
  });
});

describe("the edit page", () => {
  it("sits inside the portal frame, and starts by loading: the server-built page does not know the address yet", () => {
    const list = inContext(<ContentPage />);
    const edit = inContext(<EditContentPage />);
    expect(list).toContain("Website Content");
    expect(edit).toContain("Loading…");
    expect(inContext(<ContentForm />)).toContain('aria-busy="true"');
  });
});

// ---------------------------------------------------------------------------------------------
describe("the form for a new item", () => {
  const html = editor();

  it("has one prominent button: Publish, with Save draft beside it and Cancel back to the list", () => {
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
    expect(html).toMatch(/<button[^>]*class="[^"]*\bprimary\b[^"]*"[^>]*>Publish<\/button>/);
    expect(html).toMatch(/<button[^>]*class="[^"]*\bsecondary\b[^"]*"[^>]*>Save draft<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/portal\/content"[^>]*>Cancel<\/a>/);
    // In the pop-up, Cancel closes it instead of leaving the page.
    expect(editor({ onCancel: () => {} })).toMatch(/<button[^>]*>Cancel<\/button>/);
  });

  it("Enter in a box can only save a draft: Save draft is the one submit button, and Publish is a plain button after it", () => {
    expect(count(html, /type="submit"/g)).toBe(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save draft<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Publish<\/button>/);
    expect(html.indexOf(">Save draft<")).toBeLessThan(html.indexOf(">Publish<"));
    expect(html.indexOf(">Cancel<")).toBeLessThan(html.indexOf(">Save draft<"));
  });

  it("chooses the type from seven cards, one radio each, News chosen to start", () => {
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Content type<\/legend>/);
    expect(count(html, /<input type="radio"[^>]*name="kind"/g)).toBe(7);
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*value="post"/);
    for (const word of ["News", "Notice", "Holiday", "Event", "Vacancy", "Information", "Routine"]) expect(html, word).toContain(`>${word}</span>`);
    expect(html).not.toMatch(/type="radio"[^>]*disabled/);
  });

  it("starts the publish date on today's Nepali date and the time on the time it was opened", () => {
    expect(html).toMatch(/<legend[^>]*>Publish date \*<\/legend>/);
    expect(html).toContain('value="5"');
    expect(html).toContain('value="2083"');
    expect(html).toMatch(/<option value="6" selected="">Ashwin<\/option>/);
    expect(editor({ initial: emptyForm("2083-06-05", "post", "14:35") })).toMatch(/type="time"[^>]*value="14:35"/);
    expect(html).toContain(">Time</label>");
  });

  it("every box has a visible label (a placeholder is a hint, never the label)", () => {
    expect(html).toMatch(/<label[^>]*>Title \*<\/label>/);
    expect(html).toMatch(/<label[^>]*>Content<span[^>]*>\*<\/span><\/label>/);
    expect(html).toContain('placeholder="Enter a clear and concise title"');
    for (const legend of ["Publish date \\*", "Hide after \\(optional\\)"]) expect(html, legend).toMatch(new RegExp(`<legend[^>]*>${legend}</legend>`));
    for (const part of ["Day", "Month", "Year"]) expect(count(html, new RegExp(`<label[^>]*>${part}</label>`, "g")), part).toBe(2);
    expect(html).toMatch(/<label[^>]*><span[^>]*>Mark as urgent<\/span>/);
  });

  it("has a light formatting bar whose every button is named", () => {
    expect(html).toMatch(/role="toolbar" aria-label="Formatting"/);
    for (const name of ["Bold", "Italic", "Underline", "Bulleted list", "Numbered list", "Link"]) expect(html, name).toContain(`aria-label="${name}"`);
    expect(html).toMatch(/<select[^>]*aria-label="Text style"/);
    expect(html).toContain("Select words and use the buttons to format them.");
  });

  it("asks for no image (D-098)", () => {
    expect(html).not.toMatch(/image|photo|thumbnail|upload|type="file"/i);
  });

  it("does not show the contact box unless it is a vacancy", () => {
    expect(html).not.toContain("Email or phone to contact");
    const vacancy = editor({}, { kind: "vacancy" });
    expect(vacancy).toContain("Email or phone to contact");
    expect(vacancy).toContain("Shown on the website with the vacancy.");
  });

  it("does not start with an error or a notice", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("on the website. Saving");
  });

  it("draws the preview beside it, from what is in the form, with its marks", () => {
    expect(html).toContain("Preview");
    expect(html).toContain("This is how the content will appear on your public website.");
    expect(html).toContain("The title appears here");
    const filled = editor({}, { title: "Winter break", body: "Closed on **Friday**.\n\nBack on Sunday.", urgent: true });
    expect(filled).toContain("Winter break");
    expect(count(filled, /class="[^"]*\bparagraph\b[^"]*"/g)).toBe(2);
    expect(filled).toContain("<strong>Friday</strong>");
    expect(filled).toMatch(/>Urgent<\/span>/);
  });
});

describe("the form for an item already saved", () => {
  const saved = { kind: "vacancy" as const, title: "Teacher wanted", body: "Maths", contact: "jobs@school.example", publishOnBs: "2083-01-15" };

  it("keeps its type: the other cards are shown but cannot be chosen, and says why", () => {
    const html = editor({ id: "0123456789abcdef0123456789abcdef" }, saved);
    expect(count(html, /type="radio"[^>]*disabled=""/g)).toBe(6);
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*value="vacancy"/);
    expect(html).toContain("The type cannot be changed after the item is saved.");
    expect(html).toContain('value="Teacher wanted"');
    expect(html).toContain('value="jobs@school.example"');
    expect(html).toContain('value="15"');
    expect(html).toContain('value="2083"');
    expect(html).toMatch(/<option value="1" selected="">Baisakh<\/option>/);
  });

  it("a live item says so, and the button says it saves changes", () => {
    const html = editor({ id: "0123456789abcdef0123456789abcdef", live: true }, saved);
    expect(html).toContain("This item is on the website. Saving changes updates it, and visitors see the change within about a minute.");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save changes<\/button>/);
    expect(html).not.toContain(">Save draft<");
    expect(html).not.toContain(">Publish<");
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
  });

  it("a saved draft can be saved again or published, like a new one", () => {
    const html = editor({ id: "0123456789abcdef0123456789abcdef", live: false }, saved);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save draft<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Publish<\/button>/);
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the public notice board", () => {
  const item = (over: Partial<PublicItem> = {}): PublicItem => ({
    id: "i" + Math.random().toString(16).slice(2, 10),
    kind: "notice",
    title: "Winter break",
    body: "Closed on Friday.\n\nBack on Sunday.",
    contact: null,
    urgent: false,
    publishedOn: "2026-09-21",
    hideAfter: null,
    publishedOnBs: "2083-06-05",
    hideAfterBs: null,
    holidayFrom: null,
    holidayTo: null,
    holidayFromBs: null,
    holidayToBs: null,
    ...over,
  });
  const list = (items: PublicItem[], kind: Kind | "" = "") => renderToStaticMarkup(<NoticeList items={items} kind={kind} onKind={() => {}} />);

  it("draws each item as an article with a heading, paragraphs, and when it was posted", () => {
    const html = list([item()]);
    expect(html).toMatch(/<article[^>]*>/);
    expect(html).toMatch(/<h2[^>]*>Winter break<\/h2>/);
    expect(count(html, /class="[^"]*\bparagraph\b[^"]*"/g)).toBe(2);
    expect(html).toContain("Posted 5 Ashwin 2083");
    expect(html).toContain(">Notice<");
  });

  it("adds the last day when there is one", () => {
    expect(list([item({ hideAfterBs: "2083-06-20" })])).toContain("Posted 5 Ashwin 2083, until 20 Ashwin 2083");
  });

  it("marks an urgent item with a word and a heavy edge, not colour alone", () => {
    const html = list([item({ urgent: true })]);
    expect(html).toContain(">Urgent<");
    expect(html).toMatch(/class="[^"]*\burgentItem\b/);
    expect(list([item()])).not.toContain(">Urgent<");
  });

  it("makes a vacancy's email or phone a link, and shows anything else as plain text", () => {
    expect(list([item({ kind: "vacancy", contact: "jobs@school.example" })])).toMatch(/<a href="mailto:jobs@school\.example"[^>]*>jobs@school\.example<\/a>/);
    expect(list([item({ kind: "vacancy", contact: "+977 985-1234567" })])).toMatch(/<a href="tel:\+9779851234567"[^>]*>\+977 985-1234567<\/a>/);
    const plain = list([item({ kind: "vacancy", contact: "Ask at the office" })]);
    expect(plain).toContain("Ask at the office");
    expect(plain).not.toContain("<a ");
  });

  it("never turns a hostile contact into a link, and shows markup in a title or text as text", () => {
    const html = list([item({ kind: "vacancy", contact: "javascript:alert(1)", title: "<img src=x onerror=alert(1)>", body: "<script>alert(1)</script>" })]);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("offers filter buttons only when there is more than one kind, and only the kinds that have something", () => {
    expect(list([item(), item()])).not.toContain("aria-pressed");
    const html = list([item(), item({ kind: "holiday", title: "Dashain" })]);
    expect(count(html, /<button/g)).toBe(3);
    for (const label of ["All", "Notices", "Holidays"]) expect(html).toContain(`>${label}</button>`);
    for (const absent of ["Routines", "Vacancies", "News", "Events"]) expect(html).not.toContain(`>${absent}</button>`);
  });

  it("the filter buttons say which one is pressed, and pressed is more than a colour", () => {
    const all = list([item(), item({ kind: "holiday" })]);
    expect(all).toMatch(/aria-pressed="true"[^>]*>All</);
    expect(count(all, /aria-pressed="true"/g)).toBe(1);
    const holidays = list([item({ title: "A notice" }), item({ kind: "holiday", title: "A holiday" })], "holiday");
    expect(holidays).toMatch(/aria-pressed="true"[^>]*>Holidays</);
    expect(holidays).toContain("A holiday");
    expect(holidays).not.toContain("A notice");
    expect(holidays).toContain("1 shown");
  });

  it("a filter for a kind that is no longer there falls back to showing everything", () => {
    const html = list([item({ title: "Only notice" })], "vacancy");
    expect(html).toContain("Only notice");
  });

  it("announces how many are shown, politely", () => {
    const html = list([item(), item(), item()]);
    expect(html).toMatch(/role="status"[^>]*>3 shown</);
  });

  it("the page starts on a heading and a loading placeholder, with no sign-in needed and nothing alarming", () => {
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <SessionContext.Provider value={fakeSession()}>
          <NoticesPage />
        </SessionContext.Provider>
      </ConfigContext.Provider>,
    );
    expect(html).toMatch(/<h1[^>]*>Notices and updates<\/h1>/);
    expect(html).toContain("Loading notices");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="alert"');
  });

  it("the home page links to it as a quiet action, leaving How to apply the one prominent button", () => {
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <SessionContext.Provider value={fakeSession()}>
          <HomeView site={siteFrom(royal)} sections={TEST_SECTIONS.royal} urgent={[]} />
        </SessionContext.Provider>
      </ConfigContext.Provider>,
    );
    expect(html).toMatch(/<a[^>]*href="\/notices"[^>]*>Notices and updates<\/a>/);
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
  });
});

describe("the preview", () => {
  const preview = (values: Partial<FormValues>) => renderToStaticMarkup(<ContentPreview values={{ ...emptyForm("2083-06-05"), ...values }} />);

  it("shows the Nepali day the item starts, in words, and the last day when there is one", () => {
    // The same words the public board writes, so the preview is the page.
    expect(preview({ publishOnBs: "2083-06-05" })).toContain("Posted 5 Ashwin 2083");
    expect(preview({ publishOnBs: "2083-06-05", hideAfterBs: "2083-07-01" })).toContain("Posted 5 Ashwin 2083, until 1 Kartik 2083");
  });

  it("shows a dash while the day is not yet a valid Nepali date", () => {
    expect(preview({ publishOnBs: "2083-6" })).toContain("Posted —");
  });

  it("names the kind, marks an urgent item, and shows a vacancy's contact only for a vacancy", () => {
    const html = preview({ kind: "vacancy", urgent: true, contact: "jobs@school.example" });
    expect(html).toContain("Vacancy");
    expect(html).toContain("Urgent");
    expect(html).toContain("Contact:");
    expect(html).toMatch(/<a href="mailto:jobs@school\.example"[^>]*>jobs@school\.example<\/a>/);
    expect(preview({ kind: "notice", contact: "leftover@school.example" })).not.toContain("leftover@school.example");
  });

  it("shows markup as text: nothing typed is ever run, and a link to a script is not made", () => {
    const html = preview({ title: "<img src=x onerror=alert(1)>", body: "<script>alert(1)</script> [x](javascript:alert(1))" });
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("a blank line starts a new paragraph, and empty text draws none", () => {
    expect(count(preview({ body: "One\n\nTwo\n\n\nThree" }), /class="[^"]*\bparagraph\b[^"]*"/g)).toBe(3);
    expect(count(preview({ body: "" }), /class="[^"]*\bparagraph\b[^"]*"/g)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("a holiday names its own days (D-094)", () => {
  it("the form asks for the holiday's date before Show from, and has no Hide after", () => {
    const html = editor({}, { kind: "holiday" });
    const at = (word: string) => html.indexOf(word);
    expect(html).toContain("Holiday date");
    expect(html).toContain("Last day of the holiday (optional)");
    expect(at("Holiday date")).toBeLessThan(at("Publish date"));
    expect(html).toContain("It comes off the website after the holiday.");
    expect(html).not.toContain("Hide after");
  });

  it("other kinds keep Hide after and never ask for a holiday date", () => {
    const html = editor({}, { kind: "notice" });
    expect(html).toContain("Hide after");
    expect(html).not.toContain("Holiday date");
  });

  it("the preview says when the holiday is, and, like the public board, does not repeat it as an until", () => {
    const html = renderToStaticMarkup(<ContentPreview values={{ ...emptyForm("2083-06-14"), kind: "holiday", holidayFromBs: "2083-06-16", holidayToBs: "2083-06-20" }} />);
    expect(html).toContain("Holiday from 16 Ashwin 2083 to 20 Ashwin 2083");
    expect(html).toContain("Posted 14 Ashwin 2083");
    expect(html).not.toContain("until");
  });

  it("the public board puts the holiday's day under its title, and does not repeat it as an until", () => {
    const html = renderToStaticMarkup(
      <NoticeList
        items={[{ id: "h", kind: "holiday", title: "Dashain", body: "Closed.", contact: null, urgent: false, publishedOn: "2026-09-30", hideAfter: "2026-10-02", publishedOnBs: "2083-06-14", hideAfterBs: "2083-06-16", holidayFrom: "2026-10-02", holidayTo: null, holidayFromBs: "2083-06-16", holidayToBs: null }]}
        kind=""
        onKind={() => {}}
      />,
    );
    expect(html).toMatch(/Dashain<\/h2><p class="[^"]*holiday[^"]*">Holiday on 16 Ashwin 2083<\/p>/);
    expect(html).toContain("Posted 14 Ashwin 2083");
    expect(html).not.toContain("until");
  });
});
