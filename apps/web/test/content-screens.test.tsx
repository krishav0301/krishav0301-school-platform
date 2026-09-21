import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ContentPage from "@/app/portal/content/page";
import EditContentPage from "@/app/portal/content/edit/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { ContentEditor, ContentForm } from "@/content/ContentForm";
import { ContentList } from "@/content/ContentList";
import { BsDateField } from "@/content/BsDateField";
import { ContentPreview } from "@/content/ContentPreview";
import { emptyForm, type FormValues } from "@/content/model";
import { SessionContext } from "@/session/SessionProvider";
import { Checkbox, Select, TextArea } from "@/ui";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/content", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
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

describe("the list of website content", () => {
  const html = inContext(<ContentList />);

  it("has one heading, and one prominent action: New item, a link to the form", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toContain("Website content");
    expect(html).toMatch(/<a[^>]*href="\/portal\/content\/edit"[^>]*>New item<\/a>/);
    // Exactly one control is drawn as the main action: the primary button style.
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
  });

  it("offers the two filters with every kind and every state, in words", () => {
    for (const word of ["Type", "Status", "Notice", "Holiday", "Routine", "Vacancy", "Post", "Draft", "Waiting for approval", "Scheduled", "On the website", "Ended"]) {
      expect(html, word).toContain(word);
    }
    expect(count(html, /<select/g)).toBe(2);
  });

  it("shows the shape of the page while it loads, announced politely, and nothing that looks like an error", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading content");
    expect(html).not.toContain('role="alert"');
  });
});

describe("the edit page", () => {
  it("sits inside the portal frame, and starts by loading: the server-built page does not know the address yet", () => {
    const list = inContext(<ContentPage />);
    const edit = inContext(<EditContentPage />);
    expect(list).toContain("Website content");
    expect(edit).toContain("Loading…");
    expect(inContext(<ContentForm />)).toContain('aria-busy="true"');
  });
});

// ---------------------------------------------------------------------------------------------
describe("the form for a new item", () => {
  const html = editor();

  it("says what it is, and has one prominent button: Save draft, with a quiet Cancel back to the list", () => {
    expect(html).toMatch(/<h1[^>]*>New item<\/h1>/);
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save draft<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/portal\/content"[^>]*>Cancel<\/a>/);
  });

  it("lets the type be chosen, offering all five", () => {
    expect(html).toMatch(/<label[^>]*>Type<\/label><select[^>]*>(?:<option[^>]*>[^<]*<\/option>){5}<\/select>/);
  });

  it("starts the show-from day on today's Nepali date, as a day, a month by name and a year", () => {
    expect(html).toMatch(/<legend[^>]*>Show from<\/legend>/);
    expect(html).toContain('value="5"');
    expect(html).toContain('value="2083"');
    expect(html).toMatch(/<option value="6" selected="">Ashwin<\/option>/);
    expect(html).toContain("Nepali date (Bikram Sambat).");
  });

  it("every box has a visible label, and there are no placeholders standing in for labels", () => {
    for (const label of ["Title", "Text"]) expect(html, label).toMatch(new RegExp(`<label[^>]*>${label}</label>`));
    // Each day has a legend naming it, and its three boxes are labelled too.
    for (const legend of ["Show from", "Hide after (optional)"]) expect(html, legend).toMatch(new RegExp(`<legend[^>]*>${legend.replace(/[()]/g, "\\$&")}</legend>`));
    for (const part of ["Day", "Month", "Year"]) expect(count(html, new RegExp(`<label[^>]*>${part}</label>`, "g")), part).toBe(2);
    // The checkbox's label holds its own text and hint, so it is checked on its own.
    expect(html).toMatch(/<label[^>]*><span[^>]*>Urgent<\/span>/);
    expect(html).not.toContain("placeholder=");
    const inputs = count(html, /<(?:input|textarea|select)\b/g);
    expect(count(html, /<label\b/g)).toBeGreaterThanOrEqual(inputs);
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

  it("draws the preview beside it, from what is in the form", () => {
    expect(html).toContain("Preview");
    expect(html).toContain("The title appears here");
    const filled = editor({}, { title: "Winter break", body: "Closed on Friday.\n\nBack on Sunday." });
    expect(filled).toContain("Winter break");
    expect(count(filled, /class="[^"]*\bparagraph\b[^"]*"/g)).toBe(2);
  });
});

describe("the form for an item already saved", () => {
  const saved = { kind: "vacancy" as const, title: "Teacher wanted", body: "Maths", contact: "jobs@school.example", publishOnBs: "2083-01-15" };

  it("says it is an edit, shows the type as a fixed label instead of a choice, and keeps what was saved", () => {
    const html = editor({ id: "0123456789abcdef0123456789abcdef" }, saved);
    expect(html).toMatch(/<h1[^>]*>Edit item<\/h1>/);
    // No choice of type: it is a fixed label. (The month lists of the two days are the only selects.)
    expect(html).not.toMatch(/<label[^>]*>Type<\/label>/);
    expect(count(html, /<select/g)).toBe(2);
    expect(html).toContain("The type cannot be changed after the item is saved.");
    expect(html).toContain('value="Teacher wanted"');
    expect(html).toContain('value="jobs@school.example"');
    // The saved day, 15 Baisakh 2083, is filled into its three boxes.
    expect(html).toContain('value="15"');
    expect(html).toContain('value="2083"');
    expect(html).toMatch(/<option value="1" selected="">Baisakh<\/option>/);
  });

  it("a live item says so, and the button says it saves changes", () => {
    const html = editor({ id: "0123456789abcdef0123456789abcdef", live: true }, saved);
    expect(html).toContain("This item is on the website. Saving changes updates it, and visitors see the change within about a minute.");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save changes<\/button>/);
    expect(html).not.toContain(">Save draft<");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the preview", () => {
  const preview = (values: Partial<FormValues>) => renderToStaticMarkup(<ContentPreview values={{ ...emptyForm("2083-06-05"), ...values }} />);

  it("shows the Nepali day the item starts, in words, and the last day when there is one", () => {
    expect(preview({ publishOnBs: "2083-06-05" })).toContain("Shows from 5 Ashwin 2083");
    expect(preview({ publishOnBs: "2083-06-05", hideAfterBs: "2083-07-01" })).toContain("Shows from 5 Ashwin 2083 until 1 Kartik 2083");
  });

  it("shows a dash while the day is not yet a valid Nepali date", () => {
    expect(preview({ publishOnBs: "2083-6" })).toContain("Shows from —");
  });

  it("names the kind, marks an urgent item, and shows a vacancy's contact only for a vacancy", () => {
    const html = preview({ kind: "vacancy", urgent: true, contact: "jobs@school.example" });
    expect(html).toContain("Vacancy");
    expect(html).toContain("Urgent");
    expect(html).toContain("Contact: jobs@school.example");
    expect(preview({ kind: "notice", contact: "leftover@school.example" })).not.toContain("leftover@school.example");
  });

  it("shows markup as text: nothing typed is ever run", () => {
    const html = preview({ title: "<img src=x onerror=alert(1)>", body: "<script>alert(1)</script>" });
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
