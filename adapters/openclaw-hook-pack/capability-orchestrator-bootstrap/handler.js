import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadBridge() {
  // Try relative path first (works in dev --link mode)
  const candidates = [
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "scripts",
      "host-adapter-bridge.cjs",
    ),
    // Walk up to find core root (works when hook-pack is inside cache/capability-orchestrator)
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "scripts",
      "host-adapter-bridge.cjs",
    ),
    // Check OPENCLAW_PLUGIN_DATA env
    process.env.OPENCLAW_PLUGIN_DATA &&
      path.join(
        process.env.OPENCLAW_PLUGIN_DATA,
        "capability-orchestrator",
        "scripts",
        "host-adapter-bridge.cjs",
      ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  return null;
}

export default async function capabilityOrchestratorBootstrapHook(event) {
  try {
    if (!event || event.type !== "agent" || event.action !== "bootstrap") {
      return;
    }
    const bridge = loadBridge();
    if (!bridge) return;
    const cwd = event.context?.workspaceDir || process.cwd();
    const text = bridge.renderAwareness({
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
