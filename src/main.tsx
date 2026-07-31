import { render } from "preact";
import App from "./routers/App.js";
import "./styles/index.css";

render(<App />, document.getElementById("app")!);
