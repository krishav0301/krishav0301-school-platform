import { describe, expect, it } from "vitest";

import { createPageTitleStore, formatTitle } from "@/config/page-title";

describe("formatTitle", () => {
  it("is the school's name on its own, or the page then the school, in the same form the server writes", () => {
    expect(formatTitle("", "Royal Softech College")).toBe("Royal Softech College");
    // The Worker writes exactly this for the notice board (D-046), so a crawler and a browser agree.
    expect(formatTitle("Notices and updates", "Royal Softech College")).toBe("Notices and updates | Royal Softech College");
  });
});

describe("the page title store", () => {
  it("holds nothing until a page sets its title, and tells the page title's listeners when it changes", () => {
    const store = createPageTitleStore();
    const heard: string[] = [];
    const stop = store.subscribe(() => heard.push(store.get()));

    expect(store.get()).toBe("");
    store.set("Notices and updates");
    expect(store.get()).toBe("Notices and updates");
    store.set("");
    expect(heard).toEqual(["Notices and updates", ""]);
    stop();
    store.set("Ignored");
    expect(heard).toHaveLength(2);
  });

  it("does not shout when nothing changed", () => {
    const store = createPageTitleStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.set("A");
    store.set("A");
    expect(calls).toBe(1);
  });

  it("a page that leaves clears only its own title, not a newer page's", () => {
    const store = createPageTitleStore();
    const leaveFirst = store.claim("First page");
    const leaveSecond = store.claim("Second page");
    leaveFirst(); // the first page unmounts after the second has already claimed the title
    expect(store.get()).toBe("Second page");
    leaveSecond();
    expect(store.get()).toBe("");
  });
});
