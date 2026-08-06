import { render } from "preact";
import App from "./routers/App.js";
import "./styles/index.css";
import "./lib/apply-system-theme.js";

render(<App />, document.getElementById("app")!);
