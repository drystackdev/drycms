import { render } from "preact";
import App from "./routers/App.js";
import "./styles/index.css";
import "./lib/apply-system-theme.js";

export const PAGES_SOURCE_BROWSER_EVENT = "dry:pages-source-change";

if (import.meta.hot) {
  import.meta.hot.on(PAGES_SOURCE_BROWSER_EVENT, (data: { path?: string }) => {
    if (window.location.pathname.endsWith("/page-builder")) {
      window.dispatchEvent(new CustomEvent(PAGES_SOURCE_BROWSER_EVENT, { detail: data }));
    } else {
      window.location.reload();
    }
  });
}

render(<App />, document.getElementById("app")!);
