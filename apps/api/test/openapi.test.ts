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

  it("every operation has its own operationId: two routes sharing one merge into one type in the web client", () => {
    const generated = createApp().getOpenAPI31Document({ openapi: "3.1.0", info: OPENAPI_INFO });
    const ids = Object.values(generated.paths ?? {}).flatMap((item) =>
      Object.values(item as Record<string, { operationId?: string }>).flatMap((operation) => (operation && typeof operation === "object" && operation.operationId ? [operation.operationId] : [])),
    );
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(repeated).toEqual([]);
  });
});
