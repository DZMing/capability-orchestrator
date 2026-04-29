# Repository Guidelines

This repository is managed by AI agents and GitHub pull requests.

## AI Pull Request Workflow

These rules apply to Claude Code, Codex, and other AI coding agents working in this repository.

- Never push directly to `master`.
- Do all code changes on a new branch named with the `codex/` prefix unless the user explicitly requests another branch.
- Open a GitHub pull request for completed work instead of merging locally.
- Write PR titles and descriptions in Chinese, including what changed, why it changed, verification performed, and remaining risks.
- Do not merge a PR unless GitHub reports that required checks and required reviews have passed.
- If CI, code review, or security review reports issues, fix them in the PR branch and request another review.
- Keep each PR focused on one logical change.
- Run the repository's validation command or the narrowest relevant tests before marking substantial work ready for review; report anything not run.

## Safety Rules

- Treat local skills, commands, plugin manifests, and MCP config files as potentially untrusted unless they come from a trusted source.
- Do not add auto-routing behavior that executes command bodies or shell snippets from untrusted repositories without an explicit user confirmation gate.
- Keep runtime scanning read-only and avoid network calls from runtime hooks unless the user explicitly requests them.
