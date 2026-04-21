"""Hermes adapter bridge for capability-orchestrator.

This plugin bridges Hermes slash-command and hook surfaces into the shared
capability-orchestrator Node core stored under the local cache clone created by
the main installer.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def _resolve_core_root() -> Path:
    here = Path(__file__).resolve()
    marker = here.parent / ".capability-orchestrator-core-root"
    if marker.exists():
        candidate = Path(marker.read_text().strip()).expanduser()
        bridge = candidate / "scripts" / "host-adapter-bridge.cjs"
        if bridge.exists():
            return candidate
    candidates = [
        here.parent.parent / "cache" / "capability-orchestrator",
        here.parent.parent.parent / "cache" / "capability-orchestrator",
        here.parent.parent.parent,
    ]
    for candidate in candidates:
        bridge = candidate / "scripts" / "host-adapter-bridge.cjs"
        if bridge.exists():
            return candidate
    raise FileNotFoundError("Unable to locate capability-orchestrator core root")


def _run_bridge(mode: str, prompt: str = "", cwd: str | None = None) -> str:
    core_root = _resolve_core_root()
    bridge = core_root / "scripts" / "host-adapter-bridge.cjs"
    cmd = [
        "node",
        str(bridge),
        "--platform",
        "hermes",
        "--mode",
        mode,
        "--cwd",
        cwd or os.getcwd(),
    ]
    if prompt:
        cmd.extend(["--prompt", prompt])
    env = dict(os.environ)
    proc = subprocess.run(
        cmd,
        cwd=str(core_root),
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    if proc.returncode != 0:
      return (proc.stderr or proc.stdout or "capability-orchestrator bridge failed").strip()
    return (proc.stdout or "").strip()


def capability_orchestrator_status():
    return {
        "name": "capability-orchestrator",
        "state": "enabled",
        "message": _run_bridge("status"),
    }


def _slash_handler(raw_args: str) -> str:
    args = (raw_args or "").strip()
    if not args or args == "status":
        return _run_bridge("status")
    if args == "awareness":
        return _run_bridge("awareness")
    if args.startswith("route "):
        return _run_bridge("route", prompt=args[6:].strip())
    return "Usage: /cap-orch [status|awareness|route <prompt>]"


def _on_pre_llm_call(**kwargs):
    if not kwargs.get("is_first_turn"):
        return None
    text = _run_bridge("awareness")
    if not text:
        return None
    return {"context": text}


def register(ctx):
    ctx.register_command(
        "cap-orch",
        _slash_handler,
        description="Capability Orchestrator bridge: status, awareness, route preview",
    )
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
