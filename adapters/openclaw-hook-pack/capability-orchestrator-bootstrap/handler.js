import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderAwareness } = require("../../../scripts/host-adapter-bridge.cjs");

export default async function capabilityOrchestratorBootstrapHook(event) {
  try {
    if (!event || event.type !== "agent" || event.action !== "bootstrap") {
      return;
    }
    const cwd = event.context?.workspaceDir || process.cwd();
    const text = renderAwareness({
      platform: "openclaw",
      cwd,
      mode: "awareness",
    });
    if (text) {
      event.messages.push(text);
    }
  } catch {
    // Hook failures should never block OpenClaw bootstrap.
  }
}
