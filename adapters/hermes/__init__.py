"""Hermes adapter skeleton for capability-orchestrator.

The minimum experimental install path is now implemented and verified through
`hermes plugins install file://...`, but full host-native runtime integration
still needs to be completed around gateway hooks, plugin hooks, and command
surfaces.
"""


def capability_orchestrator_status():
    return {
        "name": "capability-orchestrator",
        "state": "experimental",
        "message": "Hermes adapter experiment is installable, but full host-native integration is not complete yet.",
    }
