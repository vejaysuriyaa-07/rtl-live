import { isHostToWebview, type HostToWebview } from "../src/shared/protocol";
import { postToHost } from "./vscodeApi";
import "./styles.css";

let lastGeneration = -1;

function handle(msg: HostToWebview): void {
  if (msg.generation < lastGeneration) return;
  lastGeneration = Math.max(lastGeneration, msg.generation);
  switch (msg.type) {
    case "status": {
      const el = document.getElementById("status");
      if (el) el.textContent = msg.status.fidelity;
      break;
    }
    default:
      break;
  }
}

window.addEventListener("message", (ev: MessageEvent<unknown>) => {
  if (!isHostToWebview(ev.data)) {
    postToHost({ type: "log", generation: 0, level: "warn", text: "dropped malformed host message" });
    return;
  }
  handle(ev.data);
});

window.addEventListener("error", (ev) => {
  postToHost({ type: "log", generation: 0, level: "error", text: `uncaught: ${ev.message}` });
});

postToHost({ type: "ready", generation: 0 });
