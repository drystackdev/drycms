import { config } from "./src/server/options.js";

export default config({
  kind: import.meta.env.PROD ? "cloudflare": "local",
  ai: { lang: "vi", mode: "server" },
});
