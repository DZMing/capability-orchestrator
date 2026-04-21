import { definePluginEntry } from "openclaw/plugin-sdk";

function buildStatusText() {
  return [
    "capability-orchestrator OpenClaw adapter loaded.",
    "",
    "Current state:",
    "- Runtime capability discovery is implemented in the core repo.",
    "- OpenClaw host install/uninstall is not finished yet.",
    "- This adapter is a skeleton for the host-native integration path.",
    "",
    "Do not treat this as release-ready host support yet.",
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
