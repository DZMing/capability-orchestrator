[English](README.md) | [中文](README.zh.md) | Español

# capability-orchestrator

> Conciencia de capacidades y auto-enrutamiento para Claude Code y Codex, con
> adaptadores experimentales verificados para OpenClaw y Hermes.

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

`capability-orchestrator` escanea el entorno local del agente, resume las skills,
commands, plugins, agents y MCP servers disponibles, y enruta cada prompt hacia
la mejor superficie de ejecución.

## Qué Hace

- Inyecta un resumen de capacidades al iniciar una sesión de Claude Code o Codex.
- Enruta prompts a la skill, command o MCP server correspondiente.
- Soporta Claude Code y Codex como hosts principales estables.
- Incluye bridges experimentales, pero verificados, para OpenClaw y Hermes.
- Mantiene verificaciones ejecutables para instalación, reinstalación,
  desinstalación, ciclo de vida y release.

## Inicio Rápido

```bash
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
```

Después reinicia Claude Code o Codex.

Instalación nativa para Claude Code en Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Desinstalación:

```bash
bash ~/.claude/plugins/cache/capability-orchestrator/install.sh --uninstall
```

Para Codex, reemplaza `~/.claude` por `~/.codex`.

## Soporte de Hosts

| Host        | Estado                   | Notas                                                                                                      |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Claude Code | Estable                  | Usa hooks `SessionStart` y `UserPromptSubmit`                                                              |
| Codex       | Estable                  | Nativo en Linux/macOS; Windows vía WSL2                                                                    |
| OpenClaw    | Experimental, verificado | Runtime snapshot, route bridge, bootstrap hook, adapter commands, verificación de ciclo de vida            |
| Hermes      | Experimental, verificado | Runtime snapshot, route bridge, slash command bridge, `pre_llm_call` bridge, verificación de ciclo de vida |

OpenClaw y Hermes ya no son integraciones solo de escaneo. Tienen verificación
de instalación, reinstalación, desinstalación y bridge. Siguen marcados como
experimentales hasta congelar compromisos más amplios de ciclo de vida y soporte
nativo en Windows.

## Instalación Avanzada

```bash
# Instalar una versión específica
CAPABILITY_INSTALL_REF=vX.Y.Z \
  curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash

# Instalar desde master
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --channel=master

# Seleccionar host explícitamente
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=codex
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=openclaw
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=hermes
```

## Verificación

```bash
npm test
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
npm run verify:host:openclaw
npm run verify:host:hermes
npm run verify:host:lifecycle
npm run verify:release
```

Comprobaciones manuales útiles:

```bash
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness

printf '%s' '{"prompt":"show all available capabilities","cwd":"."}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node ~/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs --explain
```

## Modelo de Seguridad

- El instalador solo modifica hooks propios de capability-orchestrator.
- Los hooks no relacionados se conservan durante install, reinstall y uninstall.
- Los escaneos de runtime son best-effort y fault-open.
- El scanner no ejecuta directorios de plugins escaneados.
- La verificación de release comprueba package, manifests, versiones de adapters,
  changelog, git tag, árbol limpio y estado de GitHub Release.

## Documentación

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [VERIFICATION.md](VERIFICATION.md)
- [RELEASE.md](RELEASE.md)
- [SECURITY.md](SECURITY.md)
- [SUPPORT.md](SUPPORT.md)
- [ROADMAP.md](ROADMAP.md)

## Límites Conocidos

- El soporte nativo en Windows solo está comprometido para Claude Code.
- Codex en Windows debe usar WSL2.
- OpenClaw y Hermes son bridges experimentales verificados, no una matriz formal
  de soporte multiplataforma.

## Licencia

MIT
