"""Hermes adapter skeleton for capability-orchestrator.

This file intentionally keeps the adapter minimal for now. The real Hermes host
integration still needs the plugin/runtime contract to be finalized around
gateway hooks, plugin hooks, slash commands, and install surfaces.
"""


def capability_orchestrator_status():
    return {
        "name": "capability-orchestrator",
        "state": "skeleton",
        "message": "Hermes adapter skeleton present; host-native integration is not complete yet.",
    }
