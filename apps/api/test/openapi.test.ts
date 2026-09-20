import { describe, expect, it } from "vitest";

import { createApp, OPENAPI_INFO } from "../src/app";
import committed from "../openapi.json";

/**
 * The web app's typed client is generated from openapi.json. If this fails, run in apps/api:
 *   npm run gen:openapi
 * then, in apps/web:  npm run gen:api
 */
describe("API contract", () => {
  it("the committed openapi.json matches what the code generates", () => {
    const generated = createApp().getOpenAPI31Document({ openapi: "3.1.0", info: OPENAPI_INFO });

    expect(JSON.parse(JSON.stringify(generated))).toEqual(committed);
  });
});
