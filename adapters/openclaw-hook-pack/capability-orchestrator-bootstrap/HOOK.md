---
name: capability-orchestrator-bootstrap
description: "Capability Orchestrator bootstrap hook skeleton for OpenClaw."
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
              "label": "Capability Orchestrator hook-pack skeleton",
            },
          ],
      },
  }
---

# Capability Orchestrator Bootstrap Hook

This is a minimal OpenClaw hook-pack skeleton used to prove the install shape
for capability-orchestrator.

It is intentionally non-functional. The real implementation still needs the
host-native integration path to be completed.
