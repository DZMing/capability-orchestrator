import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const adapterDir = dirname(fileURLToPath(import.meta.url));
const coreRoot = resolve(adapterDir, "../..");

function loadBridge() {
  try {
    return require("../../scripts/host-adapter-bridge.cjs");
  } catch (error) {
    return {
      error: error && error.message ? error.message : String(error),
    };
  }
}

function bridgeUnavailableText(error) {
  return [
    "capability-orchestrator host bridge is installed, but the shared core was not found.",
    "Install through the main capability-orchestrator installer, or place this adapter inside the full repository cache.",
    `Core root: ${coreRoot}`,
    `Error: ${error}`,
  ].join("\n");
}

function renderStatus(cwd) {
  const bridge = loadBridge();
  if (bridge.error) return bridgeUnavailableText(bridge.error);
  return bridge.buildStatus({
    platform: "openclaw",
    cwd: cwd || process.cwd(),
    coreRoot,
  });
}

function renderAwareness(cwd) {
  const bridge = loadBridge();
  if (bridge.error) return bridgeUnavailableText(bridge.error);
  return bridge.renderAwareness({
    platform: "openclaw",
    cwd: cwd || process.cwd(),
    mode: "awareness",
  });
}

function renderRoute(prompt, cwd) {
  const bridge = loadBridge();
  if (bridge.error) return bridgeUnavailableText(bridge.error);
  return bridge.renderRoute({
    platform: "openclaw",
    cwd: cwd || process.cwd(),
    prompt,
  }).rendered;
}

function buildTextReply(text) {
  return { text: text || "No output." };
}

export default definePluginEntry({
  id: "capability-orchestrator",
  name: "Capability Orchestrator",
  description:
    "Host-native OpenClaw bridge for capability-orchestrator awareness and route previews.",
  register(api) {
    api.registerCommand({
      name: "capability-orchestrator-status",
      description: "Report capability-orchestrator OpenClaw adapter status.",
      acceptsArgs: false,
      handler: async () => buildTextReply(renderStatus(process.cwd())),
    });
    api.registerCommand({
      name: "capability-orchestrator-awareness",
      description:
        "Show the current capability awareness snapshot for the active workspace.",
      acceptsArgs: false,
      handler: async () => buildTextReply(renderAwareness(process.cwd())),
    });
    api.registerCommand({
      name: "capability-orchestrator-route",
      description:
        "Preview how capability-orchestrator would route the provided prompt.",
      acceptsArgs: true,
      handler: async (ctx) =>
        buildTextReply(renderRoute(ctx.args || "", process.cwd())),
    });
    api.registerCli(
      async ({ program }) => {
        const root = program
          .command("cap-orch")
          .description("Capability Orchestrator host bridge commands");
        root
          .command("status")
          .description("Show capability-orchestrator OpenClaw adapter status")
          .action(() => {
            process.stdout.write(renderStatus(process.cwd()) + "\n");
          });
        root
          .command("awareness")
          .description(
            "Show the capability awareness snapshot for the current workspace",
          )
          .action(() => {
            process.stdout.write(renderAwareness(process.cwd()) + "\n");
          });
        root
          .command("route")
          .description(
            "Preview how capability-orchestrator would route a prompt",
          )
          .argument("<prompt...>")
          .action((promptParts) => {
            process.stdout.write(
              renderRoute(
                Array.isArray(promptParts)
                  ? promptParts.join(" ")
                  : String(promptParts || ""),
                process.cwd(),
              ) + "\n",
            );
          });
      },
      {
        descriptors: [
          {
            name: "cap-orch",
            description: "Capability Orchestrator host bridge commands",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
