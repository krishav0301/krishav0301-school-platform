import { createApp } from "./app";

// Requests outside /api/* never reach this Worker: Cloudflare serves the static web app directly.
export default createApp();
