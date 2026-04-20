#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const OWNED_MARKERS = {
  sessionStart: [
    'CAPABILITY_ORCHESTRATOR_HOOK=session-start',
    'capability-orchestrator/scripts/scan-environment.cjs',
    'capability-orchestrator\\scripts\\scan-environment.cmd',
  ],
  userPromptSubmit: [
    'CAPABILITY_ORCHESTRATOR_HOOK=user-prompt-submit',
    'capability-orchestrator/scripts/route-matcher.cjs',
    'capability-orchestrator\\scripts\\route-matcher.cmd',
  ],
};

function matchesMarkers(command = '', markers = []) {
  return markers.some((marker) => command.includes(marker));
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function cleanEntryArray(entries, markers) {
  return (entries || []).map((entry) => {
    const hooks = (entry.hooks || []).filter((hook) => !(hook.command && matchesMarkers(hook.command, markers)));
    return hooks.length > 0 ? { ...entry, hooks } : null;
  }).filter(Boolean);
}

function registerHookEntry(entries, cmd, statusMessage, markers) {
  const next = Array.isArray(entries) ? entries : [];
  let found = false;
  for (const entry of next) {
    if (!entry.hooks) continue;
    for (const hook of entry.hooks) {
      if (hook.command && matchesMarkers(hook.command, markers)) {
        hook.command = cmd;
        if (statusMessage) hook.statusMessage = statusMessage;
        found = true;
      }
    }
  }
  if (!found) {
    next.push({
      hooks: [{ type: 'command', command: cmd, statusMessage }],
    });
  }
  return next;
}

function claudeInstall(file, scanCmd, routeCmd) {
  const settings = readJsonFile(file);
  if (!settings.hooks) settings.hooks = {};
  const hadSession = (settings.hooks.SessionStart || []).some((entry) =>
    entry.hooks && entry.hooks.some((hook) => hook.command && matchesMarkers(hook.command, OWNED_MARKERS.sessionStart))
  );
  const hadRoute = (settings.hooks.UserPromptSubmit || []).some((entry) =>
    entry.hooks && entry.hooks.some((hook) => hook.command && matchesMarkers(hook.command, OWNED_MARKERS.userPromptSubmit))
  );
  settings.hooks.SessionStart = registerHookEntry(
    settings.hooks.SessionStart,
    scanCmd,
    undefined,
    OWNED_MARKERS.sessionStart,
  );
  for (const entry of settings.hooks.SessionStart) {
    if (!entry.hooks) continue;
    for (const hook of entry.hooks) {
      if (hook.command && matchesMarkers(hook.command, OWNED_MARKERS.sessionStart)) {
        hook.timeout = 10;
      }
    }
  }
  settings.hooks.UserPromptSubmit = registerHookEntry(
    settings.hooks.UserPromptSubmit,
    routeCmd,
    undefined,
    OWNED_MARKERS.userPromptSubmit,
  );
  for (const entry of settings.hooks.UserPromptSubmit) {
    if (!entry.hooks) continue;
    for (const hook of entry.hooks) {
      if (hook.command && matchesMarkers(hook.command, OWNED_MARKERS.userPromptSubmit)) {
        hook.timeout = 5;
      }
    }
  }

  writeJsonFile(file, settings);
  return {
    sessionStatus: hadSession ? 'updated' : 'added',
    routeStatus: hadRoute ? 'updated' : 'added',
  };
}

function claudeUninstall(file) {
  const settings = readJsonFile(file);
  if (!settings.hooks) settings.hooks = {};
  settings.hooks.SessionStart = cleanEntryArray(settings.hooks.SessionStart, OWNED_MARKERS.sessionStart);
  settings.hooks.UserPromptSubmit = cleanEntryArray(settings.hooks.UserPromptSubmit, OWNED_MARKERS.userPromptSubmit);
  if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeJsonFile(file, settings);
}

function codexInstall(file, scanCmd, routeCmd) {
  const hooksConfig = readJsonFile(file);
  if (!hooksConfig.hooks) hooksConfig.hooks = {};
  hooksConfig.hooks.SessionStart = registerHookEntry(
    hooksConfig.hooks.SessionStart,
    scanCmd,
    'Scanning capabilities...',
    OWNED_MARKERS.sessionStart,
  );
  hooksConfig.hooks.UserPromptSubmit = registerHookEntry(
    hooksConfig.hooks.UserPromptSubmit,
    routeCmd,
    'Routing prompt...',
    OWNED_MARKERS.userPromptSubmit,
  );
  writeJsonFile(file, hooksConfig);
}

function codexUninstall(file) {
  const hooksConfig = readJsonFile(file);
  if (!hooksConfig.hooks) hooksConfig.hooks = {};
  for (const key of Object.keys(hooksConfig.hooks)) {
    hooksConfig.hooks[key] = cleanEntryArray(hooksConfig.hooks[key], [
      ...OWNED_MARKERS.sessionStart,
      ...OWNED_MARKERS.userPromptSubmit,
    ]);
  }
  hooksConfig.hooks = Object.fromEntries(
    Object.entries(hooksConfig.hooks).filter(([, value]) => value.length > 0)
  );
  if (Object.keys(hooksConfig.hooks).length === 0) delete hooksConfig.hooks;
  writeJsonFile(file, hooksConfig);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=');
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    args[key] = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const mode = args.mode;
  const file = args.file;
  const scanCmd = args['scan-cmd'] || '';
  const routeCmd = args['route-cmd'] || '';

  if (!mode || !file) {
    console.error('Usage: install-hooks.cjs --mode <claude-install|claude-uninstall|codex-install|codex-uninstall> --file <path> [--scan-cmd ...] [--route-cmd ...]');
    process.exit(2);
  }

  if (mode === 'claude-install') {
    const { sessionStatus, routeStatus } = claudeInstall(file, scanCmd, routeCmd);
    process.stdout.write(JSON.stringify({ sessionStatus, routeStatus }));
    return;
  }
  if (mode === 'claude-uninstall') {
    claudeUninstall(file);
    return;
  }
  if (mode === 'codex-install') {
    codexInstall(file, scanCmd, routeCmd);
    return;
  }
  if (mode === 'codex-uninstall') {
    codexUninstall(file);
    return;
  }

  console.error(`Unknown mode: ${mode}`);
  process.exit(2);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  module.exports = {
    OWNED_MARKERS,
    claudeInstall,
    claudeUninstall,
    codexInstall,
    codexUninstall,
    matchesMarkers,
    readJsonFile,
  };
}
