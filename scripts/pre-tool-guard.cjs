#!/usr/bin/env node
// pre-tool-guard.cjs — PreToolUse hook
// 拦截危险 Bash 命令，输出 permissionDecision:"ask" 要求用户确认
// 故障开放：任何异常静默 exit 0，不阻断主流程

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

/**
 * 检查给定 tool 调用是否需要用户确认
 * @param {string} toolName — tool 名称
 * @param {string} command — Bash 命令字符串
 * @returns {null | { permissionDecision: string, permissionDecisionReason: string }}
 *   null 表示放行，对象表示需要确认
 */
function checkCommand(toolName, command) {
  // 只处理 Bash tool
  if (toolName !== 'Bash') return null;

  const { isDangerous } = require('./lib/danger-rules.cjs');
  const result = isDangerous(command);
  if (!result.dangerous) return null;

  return {
    permissionDecision: 'ask',
    permissionDecisionReason: result.reason,
  };
}

async function main() {
  const input = await readStdin(STDIN_TIMEOUT);
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    // 畸形输入直接放行
    return;
  }

  const toolName = String(data.tool_name || data.toolName || '');
  const toolInput = data.tool_input || data.toolInput || {};
  const command = String(toolInput.command || toolInput.cmd || '');

  const decision = checkCommand(toolName, command);
  if (decision) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.permissionDecision,
        permissionDecisionReason: decision.permissionDecisionReason,
      },
    }) + '\n');
  }
  // 未命中：无输出，exit 0
}

if (require.main === module) {
  main().catch(() => {
    // 故障开放：任何异常静默退出
    process.exit(0);
  });
} else {
  module.exports = { checkCommand };
}
