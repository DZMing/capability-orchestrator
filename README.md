English | [中文](README.zh.md) | [Español](README.es.md)

# capability-orchestrator

> Capability awareness and auto-routing for Claude Code and Codex, with
> experimental OpenClaw and Hermes host adapters.

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

`capability-orchestrator` scans the local agent environment, summarizes available
skills, commands, plugins, agents, and MCP servers, then routes user prompts to
the best available execution surface.

## What It Does

- Injects a capability summary when a new Claude Code / Codex session starts.
- Routes matching prompts to the right skill, command, or MCP server.
- Supports Claude Code and Codex as the stable primary hosts.
- Provides experimental but verified OpenClaw and Hermes host bridges.
- Keeps install, reinstall, uninstall, lifecycle, and release checks executable.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
```

Then restart Claude Code or Codex.

Windows Claude Code native install:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Uninstall:

```bash
bash ~/.claude/plugins/cache/capability-orchestrator/install.sh --uninstall
```

For Codex, replace `~/.claude` with `~/.codex`.

## Host Support

| Host        | Status                 | Notes                                                                                               |
| ----------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| Claude Code | Stable                 | Uses `SessionStart` and `UserPromptSubmit` hooks                                                    |
| Codex       | Stable                 | Linux/macOS native; Windows via WSL2                                                                |
| OpenClaw    | Experimental, verified | Runtime snapshot, route bridge, bootstrap hook, adapter commands, lifecycle verification            |
| Hermes      | Experimental, verified | Runtime snapshot, route bridge, slash command bridge, `pre_llm_call` bridge, lifecycle verification |

OpenClaw and Hermes are no longer scan-only integrations. They have verified
install/reinstall/uninstall and bridge behavior, but they remain experimental
until broader host lifecycle and Windows-native support commitments are frozen.

## Advanced Install

```bash
# Install a specific release
CAPABILITY_INSTALL_REF=vX.Y.Z \
  curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash

# Install from master
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --channel=master

# Explicit host selection
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=codex
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=openclaw
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=hermes
```

## Verification

```bash
npm test
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
npm run verify:host:openclaw
npm run verify:host:hermes
npm run verify:host:lifecycle
npm run verify:release
```

Useful manual checks:

```bash
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness

printf '%s' '{"prompt":"show all available capabilities","cwd":"."}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node ~/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs --explain
```

## Safety Model

- The installer updates only capability-orchestrator-owned hook entries.
- Unrelated hooks are preserved during install, reinstall, and uninstall.
- Runtime scans are best-effort and fault-open.
- The scanner does not execute scanned plugin directories.
- Release readiness checks validate package, manifests, adapter versions,
  changelog, git tag, worktree cleanliness, and GitHub Release state.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [VERIFICATION.md](VERIFICATION.md)
- [RELEASE.md](RELEASE.md)
- [SECURITY.md](SECURITY.md)
- [SUPPORT.md](SUPPORT.md)
- [ROADMAP.md](ROADMAP.md)

## Known Boundaries

- Native Windows support is only committed for Claude Code.
- Codex on Windows should use WSL2.
- OpenClaw and Hermes are verified experimental host bridges, not yet a formal
  cross-platform support matrix.

## License

MIT
