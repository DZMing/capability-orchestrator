import { definePluginEntry } from "openclaw/plugin-sdk";

function buildStatusText() {
  return [
    "capability-orchestrator OpenClaw adapter loaded.",
    "",
    "Current state:",
    "- Runtime capability discovery is implemented in the core repo.",
    "- Experimental OpenClaw install/uninstall path is implemented through the hook-pack adapter.",
    "- Runtime loader and restart semantics are still being hardened.",
    "- This adapter remains an experimental host-native integration path.",
    "",
    "Do not treat this as full release-ready host parity yet.",
  ].join("\n");
}

export default definePluginEntry({
  id: "capability-orchestrator",
  name: "Capability Orchestrator",
  description:
    "Host-native OpenClaw adapter skeleton for capability-orchestrator.",
  register(api) {
    api.registerCommand({
      name: "capability-orchestrator-status",
      description: "Report capability-orchestrator OpenClaw adapter status.",
      acceptsArgs: false,
      handler: async () => ({ text: buildStatusText() }),
    });
    api.registerCli(
      async ({ program }) => {
        program
          .command("cap-orch-status")
          .description("Show capability-orchestrator OpenClaw adapter status")
          .action(() => {
            process.stdout.write(buildStatusText() + "\n");
          });
      },
      {
        descriptors: [
          {
            name: "cap-orch-status",
            description: "Show capability-orchestrator OpenClaw adapter status",
            hasSubcommands: false,
          },
        ],
      },
    );
  },
});
