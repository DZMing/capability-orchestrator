'use strict';
// CO_DEBUG=1 时把静默 catch 写入 route-errors.log；默认零开销

const fs = require('fs');
const path = require('path');

const MAX_ERROR_LOG = 100 * 1024; // 100KB

function getErrorLogPath() {
  const pluginData = process.env.CLAUDE_PLUGIN_DATA || process.env.CODEX_PLUGIN_DATA;
  if (pluginData) return path.join(pluginData, 'route-errors.log');
  try {
    const { resolveUserDir } = require('./user-dir.cjs');
    return path.join(resolveUserDir(), 'plugins', 'cache', 'capability-orchestrator', 'data', 'route-errors.log');
  } catch {
    return path.join(require('os').homedir(), '.claude', 'route-errors.log');
  }
}

function debugError(scope, error) {
  if (process.env.CO_DEBUG !== '1') return;
  try {
    const p = getErrorLogPath();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      scope,
      message: String(error?.message || error).slice(0, 500),
    }) + '\n';
    let size = 0;
    try { size = fs.statSync(p).size; } catch { /* new file */ }
    if (size > MAX_ERROR_LOG) fs.writeFileSync(p, line);
    else fs.appendFileSync(p, line);
  } catch { /* never throw from debug */ }
}

module.exports = { debugError };
