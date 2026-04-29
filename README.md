English | [中文](README.zh.md) | [Español](README.es.md)

# capability-orchestrator

> Capability awareness and auto-routing for Claude Code and Codex, with an
> experimental Hermes host adapter.

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

`capability-orchestrator` scans the local agent environment, summarizes available
skills, commands, plugins, agents, and MCP servers, then routes user prompts to
the best available execution surface. It also includes a separate Intent Router
layer that expands short operational prompts into a five-part execution contract.

## What It Does

- Injects a capability summary when a new Claude Code / Codex session starts.
- Routes matching prompts to the right skill, command, or MCP server.
- Expands shorthand prompts like "continue", "execute", and "what is left" into
  a full What / Guardrails / Success / Budget / Verify contract.
- Requires confirmation before publish, push, deploy, delete, paid, credential,
  production, and real product or UX decisions.
- Supports Claude Code and Codex as the stable primary hosts.
- Provides an experimental but verified Hermes host bridge.
- Keeps OpenClaw limited to read-only scan compatibility; the OpenClaw host
  bridge install path is currently frozen.
- Keeps install, reinstall, uninstall, lifecycle, and release checks executable.

## Intent Router

The Intent Router layer is for shorthand operational prompts, not for replacing
direct capability matching. It classifies the prompt, collects live work
context, applies the safety gate, and composes a full execution contract.

Typical intents include:

| Short prompt     | Intent                 | Result                                                              |
| ---------------- | ---------------------- | ------------------------------------------------------------------- |
| `继续`           | `continue_work`        | Continue the current safe technical work from live context.         |
| `执行吧`         | `execute_plan`         | Execute an already-discussed plan with verification.                |
| `还有什么没做完` | `work_status`          | Summarize the remaining work and pick the next feasible task.       |
| `做到可以商用`   | `commercial_readiness` | Move the project toward a commercially usable, release-gated state. |

The execution contract always includes:

- `What`
- `Guardrails`
- `Success`
- `Budget`
- `Verify`

It folds in bounded live context from the repo rules, git status, recent route
log entries, and an optional preference profile at
`~/.config/capability-orchestrator/preferences.json`. Preferences are advisory
only and never reduce risk. If the prompt does not look like a safe operational
intent, the existing skill / command / MCP matcher still handles direct routing.

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
| OpenClaw    | Frozen, scan-only      | May read local workspace skills; no host bridge install, adapter commands, or lifecycle commitment  |
| Hermes      | Experimental, verified | Runtime snapshot, route bridge, slash command bridge, `pre_llm_call` bridge, lifecycle verification |

Hermes has verified install/reinstall/uninstall and bridge behavior, but it
remains experimental until broader host lifecycle and Windows-native support
commitments are frozen. OpenClaw host-bridge support is intentionally frozen;
only read-only local skill scanning is kept as compatibility surface.

## Advanced Install

```bash
# Install a specific release
CAPABILITY_INSTALL_REF=vX.Y.Z \
  curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash

# Install from master
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --channel=master

# Explicit host selection
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=codex
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=hermes
```

## Verification

```bash
npm test
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
npm run verify:host:hermes
npm run verify:host:lifecycle
npm run verify:release
npm run verify:release:strict  # required only for an actual release/tag publish
```

Useful manual checks:

```bash
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness

printf '%s' '{"prompt":"show all available capabilities","cwd":"."}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node ~/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs --explain

node --test tests/intent-classifier.test.cjs tests/intent-router.test.cjs \
  tests/safety-gate.test.cjs tests/prompt-composer.test.cjs \
  tests/work-context.test.cjs tests/preference-profile.test.cjs
```

## Safety Model

- The installer updates only capability-orchestrator-owned hook entries.
- Unrelated hooks are preserved during install, reinstall, and uninstall.
- Runtime scans are best-effort and fault-open.
- The scanner does not execute scanned plugin directories.
- `verify:release` is a pre-landing audit: it validates package, manifests,
  supported adapter versions, changelog, tag metadata, GitHub Release state, and
  rejects any leftover OpenClaw host bridge surface or script.
- `verify:release:strict` is the hard release gate for real publishing; it also
  requires a clean worktree and `HEAD` matching the latest release tag.
- High-risk intents such as publish, push, deploy, delete, paid actions,
  credential-gated actions, production changes, and real product or UX decisions
  require confirmation before action.

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
- OpenClaw host bridge support is frozen; only read-only scan compatibility is
  retained.
- Hermes is a verified experimental host bridge, not yet part of a formal
  cross-platform support matrix.
- The Intent Router layer is separate from the direct capability matcher; the
  matcher still handles skill, command, and MCP routing when the prompt is not a
  safe operational intent.

## License

MIT
