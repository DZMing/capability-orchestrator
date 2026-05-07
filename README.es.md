[English](README.md) | [中文](README.zh.md) | Español

# capability-orchestrator

> Conciencia de capacidades y auto-enrutamiento para Claude Code y Codex, con
> un adaptador experimental verificado para Hermes y compatibilidad de escaneo
> de solo lectura para OpenClaw.

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

`capability-orchestrator` escanea el entorno local del agente, resume las skills,
commands, plugins, agents y MCP servers disponibles, y enruta cada prompt hacia
la mejor superficie de ejecución. También incluye una capa independiente de
Intent Router que convierte instrucciones operativas breves en un contrato de
ejecución de cinco partes.

## Qué Hace

- Inyecta un resumen de capacidades al iniciar una sesión de Claude Code o Codex.
- Enruta prompts a la skill, command o MCP server correspondiente.
- Convierte frases cortas como "seguir", "ejecuta" o "qué falta" en un contrato
  completo con What / Guardrails / Success / Budget / Verify.
- Exige confirmación antes de publicar, hacer push, desplegar, borrar, pagar,
  tocar credenciales o cambiar producción o decisiones reales de producto / UX.
- Soporta Claude Code y Codex como hosts principales estables.
- Incluye un bridge experimental, pero verificado, para Hermes.
- Mantiene OpenClaw limitado a escaneo local de solo lectura; la instalación del
  host bridge de OpenClaw está congelada.
- Mantiene verificaciones ejecutables para instalación, reinstalación,
  desinstalación, ciclo de vida y release.

## Intent Router

La capa Intent Router sirve para instrucciones operativas breves, no para
reemplazar el mapeo directo de capacidades. Primero clasifica el intent y hace
un precheck de seguridad a nivel de prompt. Solo lee contexto de trabajo,
historial de rutas y preferencias cuando el prompt es un intent breve soportado
o una acción de alto riesgo que debe fallar cerrado.

Intentos habituales:

| Frase corta      | Intent                 | Resultado                                                         |
| ---------------- | ---------------------- | ----------------------------------------------------------------- |
| `继续`           | `continue_work`        | Continúa el trabajo técnico seguro según el contexto actual.      |
| `执行吧`         | `execute_plan`         | Ejecuta un plan ya discutido con verificación.                    |
| `还有什么没做完` | `work_status`          | Resume el trabajo pendiente y elige la siguiente tarea viable.    |
| `做到可以商用`   | `commercial_readiness` | Lleva el proyecto a un estado publicable y comercialmente usable. |

El contrato de ejecución siempre incluye:

- `What`
- `Guardrails`
- `Success`
- `Budget`
- `Verify`

Incorpora contexto acotado de las reglas del repositorio, el estado de git, los
eventos recientes del route log y un perfil opcional de preferencias en
`~/.config/capability-orchestrator/preferences.json`. Las preferencias son solo
asesoría y nunca reducen el riesgo. Si el prompt no parece un intent operativo
seguro, el matcher existente de skill / command / MCP sigue manejando el
enrutamiento directo.

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
| OpenClaw    | Congelado, solo escaneo  | Puede leer skills locales; sin instalación de host bridge, adapter commands ni compromiso de ciclo de vida |
| Hermes      | Experimental, verificado | Runtime snapshot, route bridge, slash command bridge, `pre_llm_call` bridge, verificación de ciclo de vida |

Hermes ya no es una integración solo de escaneo: tiene verificación de
instalación, reinstalación, desinstalación y bridge. Sigue marcado como
experimental hasta congelar compromisos más amplios de ciclo de vida y soporte
nativo en Windows. El host bridge de OpenClaw está congelado; solo se conserva
el escaneo local de solo lectura.

## Instalación Avanzada

```bash
# Instalar una versión específica
CAPABILITY_INSTALL_REF=vX.Y.Z \
  curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash

# Instalar desde master
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --channel=master

# Seleccionar host explícitamente
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=codex
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=hermes
```

## Verificación

```bash
npm test
npm run test:all
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
npm run verify:scenarios
npm run verify:host:hermes
npm run verify:host:lifecycle
npm run verify:release
npm run verify:release:strict  # solo antes de publicar un release/tag real
```

Comprobaciones manuales útiles:

```bash
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness

printf '%s' '{"prompt":"show all available capabilities","cwd":"."}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node ~/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs --explain

node --test tests/intent-classifier.test.cjs tests/intent-router.test.cjs \
  tests/safety-gate.test.cjs tests/prompt-composer.test.cjs \
  tests/work-context.test.cjs tests/preference-profile.test.cjs
```

## Modelo de Seguridad

- El instalador solo modifica hooks propios de capability-orchestrator.
- Los hooks no relacionados se conservan durante install, reinstall y uninstall.
- Los escaneos de runtime son best-effort y fault-open.
- El scanner no ejecuta directorios de plugins escaneados.
- Los MCP servers, manifests de plugins, cuerpos de legacy commands y
  descripciones escaneadas son solo señales asesoras de matching. No se
  ejecutan ni se tratan como instrucciones.
- `verify:release` es una auditoría pre-landing: comprueba package, manifests,
  versiones de adapters soportados, changelog, metadata del tag, estado de
  GitHub Release, y rechaza cualquier superficie o script restante de OpenClaw
  host bridge.
- `verify:scenarios` ejecuta una matriz Claude/Codex para prompts cortos,
  confirmaciones de alto riesgo, rutas de skill, MCP advisory, seguridad de
  legacy commands y redacción de preferencias.
- El test de route corpus añade cobertura tipo precision/recall para prompts
  breves, escapes, prompts de alto riesgo, matches de skill / command / MCP y
  no-match.
- `verify:release:strict` es el hard release gate para publicación real; también
  exige árbol limpio y `HEAD` igual al último release tag.
- Los intents de alto riesgo, como publicar, hacer push, desplegar, borrar,
  pagar, usar credenciales, cambiar producción o tomar decisiones reales de
  producto / UX, requieren confirmación antes de actuar.
- El route log conserva solo campos anónimos en allowlist, como prompt type,
  target type, confidence, host/source/scope y señales de confianza de MCP; no
  guarda prompts crudos ni credenciales.

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
- El host bridge de OpenClaw está congelado; solo se conserva compatibilidad de
  escaneo de solo lectura.
- Hermes es un bridge experimental verificado, todavía fuera de una matriz
  formal de soporte multiplataforma.
- La capa Intent Router está separada del matcher directo de capacidades; cuando
  el prompt no es un intent operativo seguro, el matcher sigue encargándose del
  enrutamiento de skill, command y MCP.

## Licencia

MIT
