import { resolved } from "./config.js";

export interface DryClientConfig {
  path: string;
  contentEngine: "sqlite" | "D1" | "file";
  /** Whether AI features (the Content Types "Ask AI" wizard) run against a
   * local CLI or the `aiKey` collection - not secret, just tells the client
   * whether to offer the AI Key picker combobox. */
  aiMode: "local" | "server";
}

const clientConfig: DryClientConfig = {
  path: resolved.path,
  contentEngine: resolved.content.engine,
  aiMode: resolved.ai.mode,
};

function serializeConfig(config: DryClientConfig): string {
  return JSON.stringify(config).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Inject the server-resolved values before the browser's module scripts run.
 * Escaping HTML-sensitive characters keeps config values data inside the
 * script even when a deployment uses an unusual user-supplied path. */
export function injectClientConfig(html: string, config: DryClientConfig = clientConfig): string {
  const script = `<script>window.__DRY_CONFIG__=${serializeConfig(config)};</script>`;
  const headClose = html.toLowerCase().indexOf("</head>");
  if (headClose === -1) return `${script}${html}`;
  return `${html.slice(0, headClose)}${script}${html.slice(headClose)}`;
}
