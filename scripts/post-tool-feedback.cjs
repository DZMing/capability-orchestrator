#!/usr/bin/env node
// post-tool-feedback.cjs — PostToolUse hook
// 故障开放：任何异常静默退出，不影响主流程
// 仅记录与路由可关联的 tool 调用（Skill/Task/Agent），其他类型直接放行

'use strict';

const STDIN_TIMEOUT = 1500;

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        process.stdin.removeAllListeners();
        process.stdin.destroy();
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    }, timeoutMs);
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {
      if (!settled) {
        settled = true;
        clearTimeout(t);
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    });
    if (process.stdin.readableEnded && !settled) {
      settled = true;
      clearTimeout(t);
      resolve(Buffer.concat(chunks).toString('utf-8'));
    }
  });
}

// 从 PostToolUse stdin payload 提取 tool 名 + target（skill / agent / command 名）
function extractToolInfo(input) {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || data.toolName || (data.tool && data.tool.name) || '';
    const params = data.tool_input || data.toolInput || data.parameters || (data.tool && data.tool.input) || {};
    let toolTarget = '';
    if (toolName === 'Skill' || toolName === 'skill') toolTarget = String(params.skill || '');
    else if (toolName === 'Agent' || toolName === 'Task') toolTarget = String(params.subagent_type || params.agent_type || '');
    else if (toolName === 'Bash') {
      // /command 形式的 slash 命令调用从 command 提取首个 token
      const cmd = String(params.command || '');
      const m = cmd.match(/^\s*\/([a-z0-9_-]+)/i);
      if (m) toolTarget = m[1];
    }
    return { toolName, toolTarget };
  } catch {
    return { toolName: '', toolTarget: '' };
  }
}

async function main() {
  const input = await readStdin(STDIN_TIMEOUT);
  const { toolName, toolTarget } = extractToolInfo(input);
  // 仅记录可关联的 tool 调用
  if (!toolName || !toolTarget) {
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
    return;
  }
  const RECORDABLE = new Set(['Skill', 'skill', 'Agent', 'Task', 'Bash']);
  if (!RECORDABLE.has(toolName)) {
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
    return;
  }
  try {
    const { appendFeedback } = require('./lib/route-logger.cjs');
    appendFeedback({ toolName, toolTarget });
  } catch { /* fault-open */ }
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  });
} else {
  module.exports = { extractToolInfo };
}
