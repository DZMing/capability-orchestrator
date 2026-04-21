---
name: capability-orchestrator-bootstrap
description: "Capability Orchestrator bootstrap hook for OpenClaw."
metadata:
  {
    "openclaw":
      {
        "emoji": "🧭",
        "events": ["agent:bootstrap"],
        "install":
          [
            {
              "id": "capability-orchestrator",
              "kind": "path",
              "label": "Capability Orchestrator hook-pack bridge",
            },
          ],
      },
  }
---

# Capability Orchestrator Bootstrap Hook

This hook injects capability awareness into OpenClaw agent bootstrap sessions by
bridging into the shared capability-orchestrator scan core.
