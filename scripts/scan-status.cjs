#!/usr/bin/env node
// scan-status.cjs — SessionStart 状态巡逻 CLI 入口
//
// 用法:SessionStart hook 调用,stdin 可选传 {"cwd": "..."}。
// 输出:有信号 → 巡逻报告纯文本;无信号 → 不输出(不刷存在感)。
// 故障开放:任何异常静默退出 0,绝不阻塞会话启动。

'use strict';

const { collectStatusSignals, renderStatusReport } = require('./lib/scan-status.cjs');

// stdin 读取带 1s 超时(同 scan-environment 模式,避免 hook 挂起)
function readStdinTimeout(timeoutMs) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    let settled = false;
    const finish = (value) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(value); }
    };
    const timer = setTimeout(() => {
      try { process.stdin.destroy(); } catch { /* ignore */ }
      finish('');
    }, timeoutMs);
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => finish(''));
  });
}

(async function main() {
  try {
    let stdinCwd;
    try {
      const parsed = JSON.parse(await readStdinTimeout(1000));
      if (parsed && parsed.cwd) stdinCwd = String(parsed.cwd);
    } catch { /* stdin 为空或非 JSON → 用进程 cwd */ }

    const signals = collectStatusSignals({ cwd: stdinCwd || process.cwd() });
    const text = renderStatusReport(signals);
    if (text) process.stdout.write(text + '\n');
  } catch { /* 故障开放:巡逻失败不阻塞会话 */ }
  process.exit(0);
})();
