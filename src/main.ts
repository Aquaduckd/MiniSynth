import { SynthApp } from "./SynthApp.js";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Missing #app element");
}

const app = new SynthApp();
app.mount(root);

window.addEventListener("beforeunload", () => {
  app.destroy();
});
