import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createApp, OPENAPI_INFO } from "../src/app";

/** Writes the committed API contract. The web app's typed client is generated from this file. */
const document = createApp().getOpenAPI31Document({ openapi: "3.1.0", info: OPENAPI_INFO });
const target = resolve(import.meta.dirname, "../openapi.json");
writeFileSync(target, JSON.stringify(document, null, 2) + "\n");
console.warn(`wrote ${target}`);
